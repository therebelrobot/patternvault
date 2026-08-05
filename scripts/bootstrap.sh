#!/usr/bin/env bash
# Fetch Strudel from Codeberg into build/upstream and apply the overlay.
#
# build/ is gitignored. Strudel's source never enters this repo — the
# maintainers moved development to Codeberg and asked that it not be mirrored
# back to GitHub.
#
# Usage:
#   ./scripts/bootstrap.sh              # fetch if missing, then apply
#   ./scripts/bootstrap.sh --refresh    # discard build/upstream and refetch
#   STRUDEL_REF=v1.2.3 ./scripts/bootstrap.sh
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

STRUDEL_REPO="${STRUDEL_REPO:-https://codeberg.org/uzu/strudel.git}"
STRUDEL_REF="${STRUDEL_REF:-main}"
DEST="build/upstream"

if [ "${1:-}" = '--refresh' ]; then
  echo "removing $DEST"
  rm -rf "$DEST"
fi

if [ ! -d "$DEST/.git" ]; then
  mkdir -p "$(dirname "$DEST")"
  # init+fetch, so STRUDEL_REF can be a branch, tag, or bare commit sha
  git init --quiet "$DEST"
  git -C "$DEST" remote add origin "$STRUDEL_REPO"
  git -C "$DEST" fetch --depth 1 --quiet origin "$STRUDEL_REF"
  git -C "$DEST" checkout --quiet FETCH_HEAD
fi

echo "upstream: $(git -C "$DEST" log -1 --format='%h %ci')"
node scripts/install.mjs "$DEST"

# corepack's bundled pnpm is 8, which cannot resolve upstream's catalog:
# specifiers. Upstream pins no packageManager, so force it.
if ! command -v pnpm >/dev/null || [ "$(pnpm --version | cut -d. -f1)" -lt 9 ]; then
  corepack enable
  corepack install 2>/dev/null || corepack prepare pnpm@10 --activate
fi

echo
echo "Next:"
echo "  cd $DEST && pnpm install && pnpm dev"
echo
echo "After editing overlay/, re-run this script to push changes into $DEST."
