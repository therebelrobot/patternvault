# patternvault

GitHub-backed pattern storage for [Strudel](https://strudel.cc), the way Obsidian-git
backs a vault: one plain file per pattern, local-first, sync on a debounce, conflicts
kept as copies instead of resolved silently.

> **Unofficial.** patternvault is a third-party overlay. It is not affiliated with,
> endorsed by, or supported by the Strudel project. Strudel is developed at
> [codeberg.org/uzu/strudel](https://codeberg.org/uzu/strudel); please take bug
> reports about Strudel itself there, and bug reports about this overlay here.

**This repo contains no Strudel source.** Strudel's development moved to
[codeberg.org/uzu/strudel](https://codeberg.org/uzu/strudel) and the maintainers do
not want the project mirrored back to GitHub. So patternvault is an *overlay*: five
new files plus five anchored edits, applied to a checkout that is fetched from
Codeberg on demand — by `scripts/bootstrap.sh` for local work, and by the Dockerfile
at image build time. The two trees only ever meet inside a container.

## Layout

```
overlay/website/src/patternvault/   files copied into a Strudel checkout
scripts/install.mjs           applies / checks / reverts the overlay
scripts/bootstrap.sh          fetches upstream into build/ and applies
Dockerfile                    fetches upstream, applies, builds, serves via nginx
docker/                       nginx config + compose file for the Pi
build/                        gitignored working checkout
```

## Local development

```bash
./scripts/bootstrap.sh          # fetch upstream + apply overlay
cd build/upstream
pnpm install && pnpm dev
```

Edit files in `overlay/`, then re-run `./scripts/bootstrap.sh` to push them into the
checkout. `--refresh` discards `build/upstream` and refetches. `STRUDEL_REF=v1.2.3
./scripts/bootstrap.sh` pins a specific upstream ref.

**pnpm >= 9.5, not npm.** Upstream's manifests use `catalog:` version specifiers.
npm rejects them (`EUNSUPPORTEDPROTOCOL`) and pnpm 8 rejects them too
(`ERR_PNPM_SPEC_NOT_SUPPORTED_BY_ANY_RESOLVER`, usually alongside `Ignoring broken
lockfile`). `corepack enable` alone leaves you on corepack's bundled pnpm 8, and
upstream pins no `packageManager`, so force it — `bootstrap.sh` does this for you:

```bash
corepack enable
corepack install || corepack prepare pnpm@10 --activate
```

| Command | Does |
| --- | --- |
| `node scripts/install.mjs <dir>` | apply the overlay |
| `node scripts/install.mjs <dir> --check` | verify every anchor still matches, change nothing |
| `node scripts/install.mjs <dir> --revert` | remove it, leaving `git diff` clean |

## What the overlay does

Three things, in one folder (`overlay/website/src/patternvault/`):

| | |
| --- | --- |
| **GitHub sync** | a bar at the top of the patterns tab |
| **chords** | a new panel tab — build a chord, hear it, copy the notation |
| **midi** | a new panel tab — play notes in, get notation out |

### Chords tab

Root, quality, octave, inversion. It shows the spelled notes, plays them
(block or rolled) through a small standalone oscillator, and emits one of four
forms:

```js
note("[c3,e3,g3,bb3]")     // stacked
note("c3 e3 g3 bb3")       // sequence
note("<c3 e3 g3 bb3>")     // one per cycle
chord("C7").voicing()      // let Strudel voice it
```

Spelling is by interval, not pitch class — `C7` gives `bb3`, not `a#3`, because
a dominant seventh is a flatted seventh. Where strict spelling would need a
double accidental (`Cdim7`'s seventh is B-double-flat), it falls back to the
enharmonic name and says so, since Strudel's note parser isn't guaranteed to
take `bbb`.

The preview synth is a plain `AudioContext` with a triangle oscillator,
deliberately not wired into Strudel's audio engine — reaching into superdough
would couple the panel to internals that move, and "is this the chord I meant?"
doesn't need a sampler.

### Midi tab

Connect, pick an input, hit record, play. Note-ons within 40ms collapse into one
step, so a strummed chord reads as a chord rather than four sixteenths:

```js
note("c4 [e4,g4] a4")            // sequence
note("[c4,e4,g4]")               // everything stacked
note("c4 d4 ~ ~ e4")             // gaps filled with rests
```

Rests are quantised against the shortest gap in the take and capped at eight in
a row. Sharps or flats are your choice. Note-on with velocity 0 is handled as
note-off, which is what many controllers actually send.

Web MIDI needs a secure context, so on a plain-http LAN the panel says so
explicitly rather than appearing broken.

### The token

Fine-grained PAT from `https://github.com/settings/personal-access-tokens/new`:
**Only select repositories** → your pattern repo, **Contents: Read and write**,
nothing else, with an expiry. That is the whole grant.

It lives in `localStorage` under `strudel-github-token`, so any script on the origin
can read it — hence the narrow scope. Avoiding a browser-held token entirely means a
GitHub App with the OAuth device flow, and GitHub's device-flow token endpoint sends
no CORS headers, so that needs a backend. This build deliberately has none.

### Repo layout

```
patterns/
  breakbeat-study.js
  jungle-2026-08.js
```

The **filename is the pattern id**. No manifest, no sidecar metadata, nothing two
devices can conflict on except the pattern code. Renaming a file in GitHub reads as
*delete old + create new* — the right net result, but it loses that pattern's
`created_at`.

### How sync decides

Three shas per path: **local** (re-hashed with the same algorithm as
`git hash-object`), **base** (the sha at last successful sync), **remote** (from the
git tree API).

| local vs base | remote vs base | present | action |
| --- | --- | --- | --- |
| same | same | — | nothing |
| same | changed | remote exists | pull remote over local |
| same | changed | remote deleted | delete local |
| changed | same | local exists | push local |
| changed | same | local deleted | delete remote |
| changed | changed | both exist | **conflict**: remote lands at the original path, local copy saved as `<id>.conflict-<device>-<timestamp>` and pushed |
| changed | changed | local deleted, remote edited | restore remote (an edit beats a delete) |
| changed | changed | remote deleted, local edited | push local back (an edit beats a delete) |

Nothing is ever discarded. Worst case is an extra `.conflict-` file.

Triggers: on mount, 2.5s after any local write, every `autoSyncSeconds` while the tab
is visible, and manual **sync now**. Pushes go through the git data API — blobs →
tree → commit → `PATCH` ref with `force: false` — so a sync is one commit and a
racing device is rejected rather than overwritten.

**Strudel saves on evaluate, not on keystroke.** Upstream persists a pattern only in
`afterEval`, so edits reach the repo when you hit Ctrl+Enter, not while typing. A
brand-new pattern is genuinely empty (`defaultCode` is `''`) until its first eval.

## Secure context — read before hosting on a LAN

Browsers gate several APIs behind "secure context": HTTPS **or** `localhost`.
`http://<host>.local:3010` is neither.

| API | On plain-http LAN | Impact |
| --- | --- | --- |
| `crypto.subtle` | unavailable | handled — pure-JS SHA-1 fallback, verified against `git hash-object` |
| `navigator.requestMIDIAccess` | unavailable | **MIDI in/out dead** |
| `navigator.mediaDevices` | unavailable | no microphone input |
| service worker | unregistered | no PWA install, no offline cache |
| `fetch` to api.github.com | works | sync itself is fine |

Only the first is fixable in code, and it is fixed. For the rest, put it behind a
reverse proxy with a real certificate.

## Running it

```bash
mkdir -p ~/stacks/patternvault && cd ~/stacks/patternvault
curl -O https://raw.githubusercontent.com/therebelrobot/patternvault/main/docker/docker-compose.yml
docker compose up -d
# -> http://<host>:3010
```

No volumes — static files, with state in the browser and the pattern repo. Port 3010
on the host side is arbitrary. The watchtower label is opt-in.

Which upstream commit an image came from:

```bash
docker inspect ghcr.io/therebelrobot/patternvault:latest \
  --format '{{ index .Config.Labels "org.patternvault.upstream.ref" }}'
```

Locally: `npm run docker:build && npm run docker:run`.

### Why the Dockerfile looks like that

It fetches upstream itself with `git init` + `git fetch --depth 1`, which accepts a
branch, tag, **or bare commit sha** as `STRUDEL_REF` — `git clone --branch` cannot
take a sha. Then it applies the overlay and builds.

The build stage is pinned to `--platform=$BUILDPLATFORM` and the runtime stage only
`COPY`s, so no instruction ever runs under QEMU and the arm64 image builds at amd64
speed. `docker/nginx.conf` fixes four defaults: `application/wasm` for the
tree-sitter parsers, `no-cache` on `sw.js` so the PWA can't pin an old build,
immutable caching for `/_astro/`, and Astro's directory-index routing.

## CI

One workflow, `.github/workflows/publish-container.yml`, on push to `main`, on `v*`
tags, daily at 09:00 UTC, and on dispatch. Since upstream is fetched at build
time rather than vendored, "track upstream" and "publish an image" are the same
job:

1. `git ls-remote` resolves upstream's head to a sha. Annotated tags emit two
   lines (the tag object and the peeled commit), so the peeled one wins; a ref
   that matches nothing is assumed to already be a sha.
2. Shallow-fetch that sha and run `install.mjs --check`. A broken anchor fails here
   in seconds instead of after a ten-minute multi-arch build, and opens one
   `upstream-drift` issue with the offending anchor and the real surrounding source.
3. Build `linux/amd64` and `linux/arm64`, passing the **resolved sha** as
   `STRUDEL_REF`. That is what makes the daily run cheap: if upstream hasn't moved,
   the sha is unchanged, every layer is a cache hit, and the run is a no-op.
4. Push with `provenance: mode=max`, `sbom: true`, and a signed attestation.

The build also asserts `grep -rq 'strudel-github-token' website/dist/_astro/`
before the image is assembled. `--check` proves the anchors matched the source;
this proves the result survived bundling, so an overlay that silently no-ops
can't ship as a working-looking image with no sync in it.

Fetching a bare commit sha needs the server to allow
`uploadPack.allowReachableSHA1InWant`, which not every Forgejo instance enables.
Both the Dockerfile and the CI check fall back to deepening the branch and
checking the sha out of that.

Tags: `latest`, `upstream-<short-sha>`, long sha, branch, and semver on `v*`.

```bash
gh attestation verify oci://ghcr.io/therebelrobot/patternvault:latest --owner therebelrobot
```

## Licensing and naming

"Strudel" is named here only to say what this extends — patternvault claims no
affiliation with the project and no rights in the name.

The overlay in this repo is Unlicense. Strudel is AGPL-3.0-or-later, and the
published container image contains built Strudel code, so **the image is AGPL**. Its
corresponding source is upstream at the ref recorded in the
`org.patternvault.upstream.ref` label, plus this repo — both public.

## Verified vs not

- `gitBlobSha` matches `git hash-object` on both paths (subtle crypto and pure JS),
  across empty / 1 / 55 / 56 / 64 / 1000-byte and multi-byte-UTF-8 inputs
- `install.mjs` applies, is idempotent, `--check` passes, `--revert` leaves
  `git status` clean
- all eight anchors match exactly once; `--check` passes, apply is idempotent
- chord spelling unit-tested against known-correct answers (C7, Cmaj7, Bb maj7,
  F#m7, Db major, Eb m9, C13, inversions) and the double-accidental fallback
- MIDI notation unit-tested for jitter grouping, stacks inside sequences, rest
  quantisation, flat spelling, and the empty take
- `pnpm install && npm run build` on an overlaid checkout succeeds; the sync module
  is present in `website/dist/_astro/`
- all five overlay modules bundle clean through esbuild; workflow YAML parses and
  every shell block passes `bash -n`
- sync verified live against a real GitHub repo: connect, first sync, and pattern
  creation all push correctly

Not verified: the Docker image has never been built or run (no Docker daemon
available where this was written), so `nginx.conf`, the compose file, and the
upstream-fetch layers are unexercised. The workflow has never run on GitHub.

## Known limits

1. `created_at` is not stored in the repo — it lives in the local cache, so a pattern
   first seen on a new device gets that device's timestamp.
2. Pull fetches one blob per changed pattern, six at a time. A first sync of 500
   patterns is 500 requests against a 5000/hour authenticated limit.
3. Subfolders under the patterns directory are ignored, since ids are flat.
4. Featured/public community patterns still come from upstream's Supabase; only
   *your* patterns are backed by the repo.
5. Strudel loads sample packs from the open internet at runtime. A fully air-gapped
   LAN gets the UI but no default sounds.
