import { logger } from '@strudel/core';
import { settingsMap } from '../settings.mjs';
import { gh, gitBlobSha, mapLimit, GitHubError } from './client.mjs';
import {
  githubConfigMap,
  parseBool,
  getToken,
  loadSyncState,
  saveSyncState,
  getDeviceId,
  setSyncStatus,
  $syncStatus,
} from './config.mjs';
import { patternPath, idFromPath, toFileText, fromFileText, conflictId, normalizeDir } from './serialize.mjs';

// ---------------------------------------------------------------------------
// local pattern access
// ---------------------------------------------------------------------------

let applyingRemote = false;
export const isApplyingRemote = () => applyingRemote;

function readLocalPatterns() {
  try {
    const raw = settingsMap.get().userPatterns;
    const parsed = JSON.parse(raw && raw.length ? raw : '{}');
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

function writeLocalPatterns(obj) {
  applyingRemote = true;
  try {
    settingsMap.setKey('userPatterns', JSON.stringify(obj));
  } finally {
    applyingRemote = false;
  }
}

// ---------------------------------------------------------------------------
// config
// ---------------------------------------------------------------------------

function currentConfig() {
  const c = githubConfigMap.get();
  return {
    owner: c.owner?.trim() ?? '',
    repo: c.repo?.trim() ?? '',
    branch: (c.branch?.trim() || 'main'),
    dir: normalizeDir(c.dir ?? 'patterns'),
    enabled: parseBool(c.enabled),
    autoSyncSeconds: Number(c.autoSyncSeconds) || 0,
  };
}

export function isConfigured() {
  const c = currentConfig();
  return !!(c.enabled && c.owner && c.repo && getToken());
}

// ---------------------------------------------------------------------------
// sync
// ---------------------------------------------------------------------------

let inFlight = null;

export function sync({ reason = 'manual' } = {}) {
  if (inFlight) return inFlight;
  inFlight = runSync(reason).finally(() => {
    inFlight = null;
  });
  return inFlight;
}

async function runSync(reason, attempt = 0) {
  if (!isConfigured()) {
    setSyncStatus({ phase: 'idle', message: 'not configured' });
    return { skipped: true };
  }
  const cfg = currentConfig();
  const token = getToken();
  setSyncStatus({ phase: 'syncing', message: `syncing (${reason})…` });

  try {
    // 1. remote head
    let ref = await gh.getRef(token, cfg.owner, cfg.repo, cfg.branch);
    if (!ref) {
      await bootstrap(token, cfg);
      ref = await gh.getRef(token, cfg.owner, cfg.repo, cfg.branch);
      if (!ref) throw new Error(`branch "${cfg.branch}" could not be created`);
    }
    const headSha = ref.object.sha;
    const headCommit = await gh.getCommit(token, cfg.owner, cfg.repo, headSha);
    const tree = await gh.getTree(token, cfg.owner, cfg.repo, headCommit.tree.sha);

    // 2. remote index: path -> blob sha
    const remote = new Map();
    for (const entry of tree.tree ?? []) {
      if (entry.type !== 'blob') continue;
      if (idFromPath(cfg.dir, entry.path) == null) continue;
      remote.set(entry.path, entry.sha);
    }

    // 3. local index: path -> { id, code, sha, data }
    const localPatterns = readLocalPatterns();
    const local = new Map();
    await Promise.all(
      Object.entries(localPatterns).map(async ([id, data]) => {
        const code = data?.code ?? '';
        const path = patternPath(cfg.dir, id);
        local.set(path, { id, data, code, sha: await gitBlobSha(toFileText(code)) });
      }),
    );

    // 4. base from last sync: path -> blob sha
    const state = loadSyncState();
    const base = state.base ?? {};

    // 5. classify
    const paths = new Set([...remote.keys(), ...local.keys(), ...Object.keys(base)]);
    const toPull = [];
    const toPushWrite = [];
    const toPushDelete = [];
    const toDeleteLocal = [];
    const conflicts = [];

    for (const path of paths) {
      const r = remote.get(path) ?? null;
      const l = local.get(path)?.sha ?? null;
      const b = base[path] ?? null;

      if (r === l) continue; // already in agreement

      const localChanged = l !== b;
      const remoteChanged = r !== b;

      if (!localChanged && remoteChanged) {
        if (r) toPull.push({ path, sha: r });
        else toDeleteLocal.push(path);
      } else if (localChanged && !remoteChanged) {
        if (l) toPushWrite.push({ path, sha: l, text: toFileText(local.get(path).code) });
        else toPushDelete.push(path);
      } else {
        // both sides moved. Never discard either version.
        if (r && l) {
          conflicts.push({ path, remoteSha: r });
          toPull.push({ path, sha: r });
        } else if (r && !l) {
          // deleted locally, edited remotely -> the edit wins, restore it
          toPull.push({ path, sha: r });
        } else if (l && !r) {
          // deleted remotely, edited locally -> the edit wins, push it back
          toPushWrite.push({ path, sha: l, text: toFileText(local.get(path).code) });
        }
      }
    }

    // 6. pull
    const nextPatterns = { ...localPatterns };
    const nextBase = { ...base };
    const now = Date.now();

    // stash local side of each conflict under a new id before overwriting
    for (const c of conflicts) {
      const original = local.get(c.path);
      const newId = conflictId(original.id, getDeviceId());
      nextPatterns[newId] = { ...original.data, id: newId, code: original.code, created_at: now };
      const newPath = patternPath(cfg.dir, newId);
      toPushWrite.push({ path: newPath, sha: await gitBlobSha(toFileText(original.code)), text: toFileText(original.code) });
    }

    const pulled = await mapLimit(toPull, 6, async ({ path, sha }) => {
      const text = await gh.getBlobText(token, cfg.owner, cfg.repo, sha);
      return { path, sha, code: fromFileText(text) };
    });

    for (const { path, sha, code } of pulled) {
      const id = idFromPath(cfg.dir, path);
      const existing = nextPatterns[id];
      nextPatterns[id] = {
        ...(existing ?? {}),
        id,
        code,
        collection: 'user',
        created_at: existing?.created_at ?? now,
      };
      nextBase[path] = sha;
    }

    for (const path of toDeleteLocal) {
      const id = idFromPath(cfg.dir, path);
      delete nextPatterns[id];
      delete nextBase[path];
    }

    // 7. push
    let newHead = headSha;
    if (toPushWrite.length || toPushDelete.length) {
      const blobs = await mapLimit(toPushWrite, 6, async (op) => ({
        path: op.path,
        mode: '100644',
        type: 'blob',
        sha: await gh.createBlob(token, cfg.owner, cfg.repo, op.text),
      }));
      const deletions = toPushDelete.map((path) => ({ path, mode: '100644', type: 'blob', sha: null }));
      const newTree = await gh.createTree(token, cfg.owner, cfg.repo, headCommit.tree.sha, [...blobs, ...deletions]);
      const message = commitMessage(toPushWrite, toPushDelete);
      const commit = await gh.createCommit(token, cfg.owner, cfg.repo, {
        message,
        tree: newTree.sha,
        parents: [headSha],
      });
      await gh.updateRef(token, cfg.owner, cfg.repo, cfg.branch, commit.sha);
      newHead = commit.sha;

      for (const op of toPushWrite) nextBase[op.path] = op.sha;
      for (const path of toPushDelete) delete nextBase[path];
    }

    // 8. commit results locally
    writeLocalPatterns(nextPatterns);
    saveSyncState({ headSha: newHead, base: nextBase });

    const summary = {
      pulled: pulled.length,
      pushed: toPushWrite.length,
      deleted: toPushDelete.length + toDeleteLocal.length,
      conflicts: conflicts.map((c) => idFromPath(cfg.dir, c.path)),
    };
    setSyncStatus({
      phase: 'idle',
      message: describe(summary),
      lastSyncAt: Date.now(),
      dirty: 0,
      ...summary,
    });
    if (summary.conflicts.length) {
      logger(`[github] conflicts kept as copies: ${summary.conflicts.join(', ')}`, 'warning');
    }
    return summary;
  } catch (err) {
    // Someone else pushed between our read and our write. Re-read and retry once.
    if (err instanceof GitHubError && (err.status === 409 || err.status === 422) && attempt < 1) {
      return runSync(reason, attempt + 1);
    }
    const message = friendlyError(err);
    setSyncStatus({ phase: 'error', message });
    logger(`[github] sync failed: ${message}`, 'error');
    throw err;
  }
}

async function bootstrap(token, cfg) {
  const path = cfg.dir ? `${cfg.dir}/.gitkeep` : '.gitkeep';
  await gh.putContents(token, cfg.owner, cfg.repo, cfg.branch, path, '', 'strudel: initialize pattern store');
}

function commitMessage(writes, deletes) {
  const parts = [];
  if (writes.length) parts.push(`update ${writes.length} pattern${writes.length === 1 ? '' : 's'}`);
  if (deletes.length) parts.push(`delete ${deletes.length} pattern${deletes.length === 1 ? '' : 's'}`);
  const head = `strudel: ${parts.join(', ')}`;
  const body = [...writes.map((w) => `+ ${w.path}`), ...deletes.map((d) => `- ${d}`)].join('\n');
  return `${head}\n\n${body}\n`;
}

function describe({ pulled, pushed, deleted, conflicts }) {
  if (!pulled && !pushed && !deleted) return 'up to date';
  const bits = [];
  if (pulled) bits.push(`${pulled} in`);
  if (pushed) bits.push(`${pushed} out`);
  if (deleted) bits.push(`${deleted} removed`);
  if (conflicts.length) bits.push(`${conflicts.length} conflict${conflicts.length === 1 ? '' : 's'}`);
  return bits.join(', ');
}

function friendlyError(err) {
  if (!(err instanceof GitHubError)) return err?.message ?? String(err);
  if (err.status === 401) return 'token rejected (401) — expired or revoked';
  if (err.status === 403) return 'forbidden (403) — token lacks Contents: Read and write on this repo';
  if (err.status === 404) return 'repo or branch not found (404) — check owner/repo, and that the token grants access';
  if (err.status === 422) return 'push rejected (422) — remote moved ahead; sync again';
  return err.message;
}

// ---------------------------------------------------------------------------
// scheduling
// ---------------------------------------------------------------------------

let debounceTimer = null;
let intervalTimer = null;
let pendingDirty = 0;

// Called from user_pattern_utils whenever local patterns are written.
export function notifyLocalChange() {
  if (applyingRemote) return;
  if (!isConfigured()) return;
  pendingDirty += 1;
  setSyncStatus({ dirty: pendingDirty });
  clearTimeout(debounceTimer);
  debounceTimer = setTimeout(() => {
    pendingDirty = 0;
    sync({ reason: 'local change' }).catch(() => {});
  }, 2500);
}

export function startAutoSync() {
  stopAutoSync();
  if (!isConfigured()) return;
  const { autoSyncSeconds } = currentConfig();
  sync({ reason: 'startup' }).catch(() => {});
  if (autoSyncSeconds > 0) {
    intervalTimer = setInterval(() => {
      if (document.visibilityState === 'visible') sync({ reason: 'interval' }).catch(() => {});
    }, autoSyncSeconds * 1000);
  }
}

export function stopAutoSync() {
  clearInterval(intervalTimer);
  intervalTimer = null;
}

export function flushPendingSync() {
  clearTimeout(debounceTimer);
  if ($syncStatus.get().dirty > 0) return sync({ reason: 'flush' });
  return Promise.resolve();
}
