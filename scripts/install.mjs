#!/usr/bin/env node
// Applies the patternvault overlay to a Strudel checkout.
//
// patternvault is an unofficial third-party overlay, not affiliated with the
// Strudel project.
//
// The checkout is not tracked by this repo — Strudel's maintainers moved
// development to Codeberg and asked that their code not be mirrored back to
// GitHub, so patternvault carries only the overlay. `scripts/bootstrap.sh` and
// the Dockerfile each fetch upstream themselves and run this against it.
//
// Plain .mjs rather than TypeScript on purpose: it runs against a JS/Astro
// repo with no TS runner wired up, so this stays a single `node` invocation
// with zero install step.
//
// Usage:
//   node scripts/install.mjs /path/to/strudel
//   node scripts/install.mjs /path/to/strudel --revert
//   node scripts/install.mjs /path/to/strudel --check   (verify anchors only)

import { readFile, writeFile, mkdir, cp, rm, access, readdir } from 'node:fs/promises';
import { join, dirname, resolve, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const pkgRoot = resolve(here, '..');
const overlayRoot = join(pkgRoot, 'overlay');

const target = process.argv[2] ? resolve(process.argv[2]) : null;
const revert = process.argv.includes('--revert');
const checkOnly = process.argv.includes('--check');

if (!target) {
  console.error('usage: node scripts/install.mjs /path/to/strudel [--revert|--check]');
  process.exit(1);
}

const MARK = 'github-storage';

// Paths the overlay owns. Removed wholesale on --revert.
const OVERLAY_PATHS = ['website/src/github'];

// Each edit: anchor must appear exactly once; insertion is idempotent.
const edits = [
  {
    file: 'website/src/user_pattern_utils.mjs',
    steps: [
      {
        name: 'import sync hook',
        anchor: `import { confirmDialog, parseJSON, supabase } from './repl/util.mjs';`,
        insertAfter: `\nimport { notifyLocalChange } from './github/sync.mjs'; // ${MARK}`,
      },
      {
        name: 'notify on write',
        find: `function setUserPatterns(obj) {
  return settingsMap.setKey('userPatterns', JSON.stringify(obj));
}`,
        replace: `function setUserPatterns(obj) {
  const result = settingsMap.setKey('userPatterns', JSON.stringify(obj));
  notifyLocalChange(); // ${MARK}
  return result;
}`,
      },
    ],
  },
  {
    file: 'website/src/repl/components/panel/PatternsTab.jsx',
    steps: [
      {
        // Regex, not a literal: upstream reshuffles imports and Tailwind
        // classes constantly, and a literal anchor breaks on every reflow.
        name: 'import panel',
        pattern: /^import .*from '@src\/cx\.mjs';$/m,
        insertAfter: `\nimport { GitHubSyncBar, useGitHubAutoSync } from '@src/github/GitHubPanel.jsx'; // ${MARK}`,
        context: 'cx.mjs',
      },
      {
        // Opening brace of PatternsTab, whatever its props are. Upstream
        // folded the old inner UserPatterns component into this one.
        name: 'start autosync',
        pattern: /(?:export )?function PatternsTab\s*\([^)]*\)\s*\{\n/,
        insertAfter: `  useGitHubAutoSync(); // ${MARK}\n`,
        context: 'function PatternsTab',
      },
      {
        // First JSX element PatternsTab returns, whatever tag and classes it
        // has. The non-greedy span skips the non-JSX `return (` inside the
        // search filter above it.
        name: 'render sync bar',
        pattern: /(?:export )?function PatternsTab[\s\S]*?\n  return \(\n[ \t]*<[A-Za-z][^\n]*>\n/,
        insertAfter: `      <GitHubSyncBar /> {/* ${MARK} */}\n`,
        context: 'function PatternsTab',
      },
    ],
  },
];

async function exists(p) {
  try {
    await access(p);
    return true;
  } catch {
    return false;
  }
}

function fail(msg) {
  console.error(`\nERROR: ${msg}\n`);
  process.exit(1);
}

// A failed anchor means upstream moved. Print what upstream actually says
// around the relevant keyword, so fixing it does not require opening the file.
function anchorReport(file, step, count, src, needle) {
  let report =
    `${file}: anchor for "${step.name}" matched ${count} times, expected 1.\n` +
    `Upstream changed. Update it in scripts/install.mjs:\n\n  ${needle}\n`;
  if (step.context) {
    const lines = src.split('\n');
    const hits = lines.flatMap((l, i) => (l.includes(step.context) ? [i] : []));
    if (hits.length) {
      report += `\nWhat ${file} actually contains near "${step.context}":\n`;
      for (const i of hits.slice(0, 4)) {
        const from = Math.max(0, i - 2);
        const to = Math.min(lines.length, i + 8);
        report += '\n' + lines.slice(from, to).map((l, k) => `  ${String(from + k + 1).padStart(4)} | ${l}`).join('\n') + '\n';
      }
    } else {
      report += `\n"${step.context}" does not appear in ${file} at all.\n`;
    }
  }
  return report;
}

// --- overlay files ---------------------------------------------------------

// Finder, Explorer, and editors sprinkle these through any unzipped folder.
const JUNK = /^(\.DS_Store|Thumbs\.db|desktop\.ini|__MACOSX|\._.*|.*\.swp)$/;

async function walk(dir, base = dir) {
  const out = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    if (JUNK.test(entry.name)) continue;
    const full = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...(await walk(full, base)));
    else out.push(relative(base, full));
  }
  return out;
}

async function copyOverlay() {
  const files = await walk(overlayRoot);
  for (const rel of files.sort()) {
    const dest = join(target, rel);
    await mkdir(dirname(dest), { recursive: true });
    await cp(join(overlayRoot, rel), dest);
    console.log(`  + ${rel}`);
  }
}

// --- anchored edits --------------------------------------------------------

async function applyEdits({ dryRun = false } = {}) {
  for (const { file, steps } of edits) {
    const path = join(target, file);
    if (!(await exists(path))) {
      fail(`missing file: ${file}\nIs "${target}" a Strudel checkout?`);
    }
    let src = await readFile(path, 'utf8');
    for (const step of steps) {
      const applied = step.find ? src.includes(step.replace) : src.includes(step.insertAfter.trim());
      if (applied) {
        console.log(`  = ${file}: ${step.name} (already applied)`);
        continue;
      }

      if (step.find) {
        const count = src.split(step.find).length - 1;
        if (count !== 1) fail(anchorReport(file, step, count, src, step.find));
        src = src.replace(step.find, step.replace);
      } else if (step.pattern) {
        const matches = src.match(new RegExp(step.pattern.source, step.pattern.flags.replace('g', '') + 'g'));
        const count = matches?.length ?? 0;
        if (count !== 1) fail(anchorReport(file, step, count, src, String(step.pattern)));
        src = src.replace(step.pattern, (m) => m + step.insertAfter);
      } else {
        const count = src.split(step.anchor).length - 1;
        if (count !== 1) fail(anchorReport(file, step, count, src, step.anchor));
        src = src.replace(step.anchor, step.anchor + step.insertAfter);
      }
      console.log(`  ${dryRun ? '~' : '+'} ${file}: ${step.name}`);
    }
    if (!dryRun) await writeFile(path, src);
  }
}

async function revertEdits() {
  for (const { file } of edits) {
    const path = join(target, file);
    if (!(await exists(path))) continue;
    const src = await readFile(path, 'utf8');
    const kept = src
      .split('\n')
      .filter((line) => !line.includes(MARK))
      .join('\n')
      .replace(
        `function setUserPatterns(obj) {
  const result = settingsMap.setKey('userPatterns', JSON.stringify(obj));
  return result;
}`,
        `function setUserPatterns(obj) {
  return settingsMap.setKey('userPatterns', JSON.stringify(obj));
}`,
      );
    if (kept !== src) {
      await writeFile(path, kept);
      console.log(`  - reverted ${file}`);
    }
  }
  for (const p of OVERLAY_PATHS) {
    const full = join(target, p);
    if (await exists(full)) {
      await rm(full, { recursive: true, force: true });
      console.log(`  - removed ${p}`);
    }
  }
}

// --- main ------------------------------------------------------------------

if (checkOnly) {
  console.log(`Checking anchors against ${target}`);
  await applyEdits({ dryRun: true });
  console.log('\nAll anchors match.');
} else if (revert) {
  console.log(`Reverting ${MARK} in ${target}`);
  await revertEdits();
  console.log('\nDone. `git diff` should be clean.');
} else {
  console.log(`Installing ${MARK} into ${target}`);
  await copyOverlay();
  await applyEdits();
  // npm cannot install this repo: upstream uses pnpm catalog: specifiers,
  // which npm rejects with EUNSUPPORTEDPROTOCOL.
  console.log(`\nDone. Overlay applied to ${target}.`);
}
