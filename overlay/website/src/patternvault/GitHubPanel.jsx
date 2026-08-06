import { useEffect, useState } from 'react';
import cx from '@src/cx.mjs';
import {
  githubConfigMap,
  useGitHubConfig,
  useSyncStatus,
  useTokenPresent,
  getToken,
  setToken,
  resetSyncState,
} from './config.mjs';
import { sync, startAutoSync, stopAutoSync, isConfigured } from './sync.mjs';
import { gh } from './client.mjs';

function Field({ label, value, onChange, placeholder, type = 'text', hint }) {
  return (
    <label className="flex flex-col gap-1 text-sm">
      <span className="opacity-60">{label}</span>
      <input
        type={type}
        className="bg-background border border-muted rounded px-2 py-1 text-foreground"
        value={value}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
        spellCheck={false}
        autoComplete="off"
      />
      {hint && <span className="opacity-40 text-xs">{hint}</span>}
    </label>
  );
}

function StatusDot({ phase, ready }) {
  const color = !ready
    ? 'bg-foreground opacity-30'
    : phase === 'error'
      ? 'bg-red-500'
      : phase === 'syncing'
        ? 'bg-yellow-400'
        : 'bg-green-500';
  return <span className={cx('inline-block w-2 h-2 rounded-full shrink-0', color)} />;
}

export function GitHubSyncBar() {
  const cfg = useGitHubConfig();
  const status = useSyncStatus();
  const tokenPresent = useTokenPresent();
  const [open, setOpen] = useState(false);

  const ready = cfg.enabled && cfg.owner && cfg.repo && tokenPresent;

  return (
    <div className="px-2 py-1 shrink-0 border-b border-muted">
      <div className="flex items-center gap-3 text-sm">
        <StatusDot phase={status.phase} ready={ready} />
        <span className="opacity-70">
          {ready ? `${cfg.owner}/${cfg.repo}` : 'github sync off'}
          {status.message ? ` — ${status.message}` : ''}
          {status.dirty > 0 ? ` (${status.dirty} unsynced)` : ''}
        </span>
        <span className="flex-grow" />
        {ready && (
          <button className="hover:opacity-50" onClick={() => sync({ reason: 'manual' }).catch(() => {})}>
            sync now
          </button>
        )}
        <button className="hover:opacity-50" onClick={() => setOpen((o) => !o)}>
          {open ? 'close' : 'configure'}
        </button>
      </div>
      {open && <GitHubSettings />}
    </div>
  );
}

function GitHubSettings() {
  const cfg = useGitHubConfig();
  const tokenPresent = useTokenPresent();
  const [tokenInput, setTokenInput] = useState('');
  const [check, setCheck] = useState(null);

  const set = (key) => (value) => githubConfigMap.setKey(key, String(value));

  async function verify() {
    setCheck({ state: 'checking', message: 'checking…' });
    try {
      const token = tokenInput || getToken();
      if (!token) throw new Error('no token');
      const user = await gh.getUser(token);
      const repo = await gh.getRepo(token, cfg.owner.trim(), cfg.repo.trim());
      if (!repo.permissions?.push) throw new Error(`no write access to ${repo.full_name}`);
      setCheck({ state: 'ok', message: `ok — ${user.login} can write to ${repo.full_name}` });
    } catch (err) {
      setCheck({ state: 'error', message: err?.message ?? String(err) });
    }
  }

  return (
    <div className="flex flex-col gap-3 my-3 max-w-md overflow-y-auto">
      <div className="grid grid-cols-2 gap-3">
        <Field label="owner" value={cfg.owner} onChange={set('owner')} placeholder="your-username" />
        <Field label="repo" value={cfg.repo} onChange={set('repo')} placeholder="strudel-patterns" />
        <Field label="branch" value={cfg.branch} onChange={set('branch')} placeholder="main" />
        <Field label="folder" value={cfg.dir} onChange={set('dir')} placeholder="patterns" />
      </div>

      <Field
        label="fine-grained token"
        type="password"
        value={tokenInput}
        onChange={setTokenInput}
        placeholder={tokenPresent ? '•••••• (stored)' : 'github_pat_…'}
        hint="Needs exactly one permission: Contents → Read and write, on this repo only."
      />

      <Field
        label="auto sync (seconds, 0 = off)"
        value={String(cfg.autoSyncSeconds)}
        onChange={set('autoSyncSeconds')}
        placeholder="60"
      />

      <div className="flex flex-wrap gap-4 text-sm">
        <button
          className="hover:opacity-50"
          onClick={() => {
            if (tokenInput) setToken(tokenInput);
            setTokenInput('');
            verify();
          }}
        >
          save token
        </button>
        <button className="hover:opacity-50" onClick={verify}>
          test connection
        </button>
        <button
          className="hover:opacity-50"
          onClick={() => {
            githubConfigMap.setKey('enabled', cfg.enabled ? 'false' : 'true');
          }}
        >
          {cfg.enabled ? 'disable sync' : 'enable sync'}
        </button>
        <button
          className="hover:opacity-50 opacity-70"
          onClick={() => {
            setToken('');
            resetSyncState();
            setCheck({ state: 'ok', message: 'token cleared, sync state reset' });
          }}
        >
          sign out
        </button>
      </div>

      {check && (
        <div className={cx('text-xs', check.state === 'error' ? 'text-red-400' : 'opacity-60')}>{check.message}</div>
      )}

      <p className="text-xs opacity-50 leading-relaxed">
        The token is kept in this browser&apos;s localStorage. Any script running on this origin can read it, so scope
        it to one repo, grant Contents only, and set an expiry. Patterns are stored one file per pattern under{' '}
        <code>{cfg.dir || '.'}/</code>; the filename is the pattern id.
      </p>
    </div>
  );
}

// Mounted once by PatternsTab so the interval survives panel re-renders.
export function useGitHubAutoSync() {
  useEffect(() => {
    if (!isConfigured()) return;
    startAutoSync();
    return () => stopAutoSync();
  }, []);
}
