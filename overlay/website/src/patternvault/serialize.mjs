// Mapping between Strudel pattern records and files in the repo.
//
// The pattern id IS the file basename, so the repo stays readable and
// editable outside Strudel (the Obsidian model). No manifest, no sidecar
// files, nothing to merge-conflict on except the pattern code itself.
//
//   patterns/breakbeat-study.js  <->  { id: 'breakbeat-study', code: '...' }

const EXT = '.js';

// Filesystem- and URL-safe. Keeps case, since git is case-sensitive.
export function sanitizeId(id) {
  return String(id)
    .replace(/[/\\?%*:|"<>\u0000-\u001f]/g, '-')
    .replace(/\.+$/, '')
    .replace(/^\.+/, '')
    .trim()
    .slice(0, 100);
}

export function normalizeDir(dir) {
  return String(dir ?? '')
    .replace(/^\/+/, '')
    .replace(/\/+$/, '');
}

export function patternPath(dir, id) {
  const d = normalizeDir(dir);
  const name = sanitizeId(id) + EXT;
  return d ? `${d}/${name}` : name;
}

export function idFromPath(dir, path) {
  const d = normalizeDir(dir);
  const prefix = d ? `${d}/` : '';
  if (!path.startsWith(prefix)) return null;
  const rest = path.slice(prefix.length);
  if (rest.includes('/')) return null; // no recursion into subfolders
  if (!rest.endsWith(EXT)) return null;
  return rest.slice(0, -EXT.length);
}

export function conflictId(id, deviceId, when = new Date()) {
  const stamp = when.toISOString().replace(/[:.]/g, '-').slice(0, 19);
  return sanitizeId(`${id}.conflict-${deviceId}-${stamp}`);
}

// Code is written to the file byte-for-byte, with a single trailing newline
// so the repo diffs cleanly in normal git tooling.
export function toFileText(code) {
  const text = code ?? '';
  return text.endsWith('\n') ? text : text + '\n';
}

export function fromFileText(text) {
  return text.replace(/\n$/, '');
}
