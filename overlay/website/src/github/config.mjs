import { atom } from 'nanostores';
import { persistentMap } from '@nanostores/persistent';
import { useStore } from '@nanostores/react';

// Repo coordinates. Kept in its own persistent map (not strudel-settings) so
// exporting/importing patterns never drags sync config along with it.
export const defaultGitHubConfig = {
  owner: '',
  repo: '',
  branch: 'main',
  dir: 'patterns',
  enabled: 'false',
  autoSyncSeconds: '60',
  authorName: '',
  authorEmail: '',
};

export const githubConfigMap = persistentMap('strudel-github:', defaultGitHubConfig);

export const parseBool = (v) => v === true || v === 'true';

export function useGitHubConfig() {
  const state = useStore(githubConfigMap);
  return {
    ...state,
    enabled: parseBool(state.enabled),
    autoSyncSeconds: Number(state.autoSyncSeconds) || 0,
  };
}

// --- token -----------------------------------------------------------------
// Separate key, never in the settings map, never in pattern exports.
const TOKEN_KEY = 'strudel-github-token';

export const $tokenPresent = atom(false);

export function getToken() {
  if (typeof localStorage === 'undefined') return '';
  return localStorage.getItem(TOKEN_KEY) ?? '';
}

export function setToken(token) {
  if (typeof localStorage === 'undefined') return;
  if (token) localStorage.setItem(TOKEN_KEY, token);
  else localStorage.removeItem(TOKEN_KEY);
  $tokenPresent.set(!!token);
}

if (typeof localStorage !== 'undefined') {
  $tokenPresent.set(!!getToken());
}

export function useTokenPresent() {
  return useStore($tokenPresent);
}

// --- sync state ------------------------------------------------------------
// `base` is the last-synced blob sha per path. Local content is compared
// against it by re-hashing, so no copy of the base content is stored.
const STATE_KEY = 'strudel-github-syncstate';

export function loadSyncState() {
  if (typeof localStorage === 'undefined') return { headSha: null, base: {} };
  try {
    const raw = localStorage.getItem(STATE_KEY);
    const parsed = raw ? JSON.parse(raw) : null;
    return { headSha: parsed?.headSha ?? null, base: parsed?.base ?? {} };
  } catch {
    return { headSha: null, base: {} };
  }
}

export function saveSyncState(state) {
  if (typeof localStorage === 'undefined') return;
  localStorage.setItem(STATE_KEY, JSON.stringify(state));
}

export function resetSyncState() {
  if (typeof localStorage === 'undefined') return;
  localStorage.removeItem(STATE_KEY);
}

// --- device id -------------------------------------------------------------
// Used to name conflict copies so two devices never collide on the same path.
const DEVICE_KEY = 'strudel-github-device';

export function getDeviceId() {
  if (typeof localStorage === 'undefined') return 'device';
  let id = localStorage.getItem(DEVICE_KEY);
  if (!id) {
    id = Math.random().toString(36).slice(2, 8);
    localStorage.setItem(DEVICE_KEY, id);
  }
  return id;
}

// --- live status -----------------------------------------------------------

export const $syncStatus = atom({
  phase: 'idle', // idle | syncing | error
  message: '',
  lastSyncAt: null,
  pulled: 0,
  pushed: 0,
  deleted: 0,
  conflicts: [],
  dirty: 0,
});

export function useSyncStatus() {
  return useStore($syncStatus);
}

export function setSyncStatus(patch) {
  $syncStatus.set({ ...$syncStatus.get(), ...patch });
}
