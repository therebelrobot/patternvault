# syntax=docker/dockerfile:1.7
#
# Upstream is fetched at build time from Codeberg. Strudel's source is never
# stored in this repo — the maintainers moved off GitHub deliberately, and
# this image is the only place the two trees ever meet.
#
# The build stage is pinned to $BUILDPLATFORM and the runtime stage only
# COPYs, so no instruction runs under QEMU and the arm64 image builds at
# amd64 speed.

FROM --platform=$BUILDPLATFORM node:22-bookworm-slim AS build

ARG STRUDEL_REPO=https://codeberg.org/uzu/strudel.git
# Pass a resolved commit sha for a reproducible build. CI does this via
# `git ls-remote`, which also makes the layer cache correct: if upstream has
# not moved, the sha is unchanged and the whole clone layer is a cache hit.
ARG STRUDEL_REF=main
# Fallback branch. Fetching a bare sha needs the server to allow
# uploadPack.allowReachableSHA1InWant, which not every Forgejo instance does;
# if that is refused we deepen this branch instead and check the sha out of it.
ARG STRUDEL_BRANCH=main

RUN apt-get update \
 && apt-get install -y --no-install-recommends git ca-certificates \
 && rm -rf /var/lib/apt/lists/*

ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH
# pnpm, not npm: upstream's manifests use catalog: specifiers, which npm
# rejects outright and pnpm 8 cannot resolve. corepack's bundled default is
# pnpm 8 and upstream sets no packageManager field, so force the version.
RUN corepack enable \
 && (corepack install || corepack prepare pnpm@10 --activate) \
 && pnpm --version

WORKDIR /src

# init+fetch rather than `clone --branch`, so STRUDEL_REF accepts a branch,
# a tag, or a bare commit sha.
RUN git init --quiet upstream \
 && cd upstream \
 && git remote add origin "$STRUDEL_REPO" \
 && ( git fetch --depth 1 --quiet origin "$STRUDEL_REF" \
      || ( echo "fetch by ref failed, deepening $STRUDEL_BRANCH" \
           && git fetch --depth 100 --quiet origin "$STRUDEL_BRANCH" ) ) \
 && ( git checkout --quiet FETCH_HEAD 2>/dev/null \
      || git checkout --quiet "$STRUDEL_REF" ) \
 && git --no-pager log -1 --format='upstream %H %ci' \
 && rm -rf .git

COPY overlay ./overlay
COPY scripts/install.mjs ./scripts/install.mjs
RUN node scripts/install.mjs upstream

WORKDIR /src/upstream
RUN --mount=type=cache,id=pnpm-store,target=/pnpm/store \
    pnpm install --frozen-lockfile
# The --check gate in CI proves the anchors matched. This proves the result
# survived bundling: a silently-unapplied overlay would otherwise produce a
# perfectly working image with no sync in it.
RUN npm run build \
 && test -d website/dist \
 && if ! grep -rq 'strudel-github-token' website/dist/_astro/; then \
      echo 'FATAL: overlay is missing from the build output'; exit 1; \
    fi


FROM nginx:1.27-alpine AS runtime

ARG STRUDEL_REF=main
LABEL org.opencontainers.image.title="patternvault"
LABEL org.opencontainers.image.description="Unofficial build of the Strudel live coding REPL with GitHub-backed pattern storage. Not affiliated with or endorsed by the Strudel project."
LABEL org.opencontainers.image.source="https://github.com/therebelrobot/patternvault"
LABEL org.opencontainers.image.licenses="AGPL-3.0-or-later"
# AGPL corresponding source: upstream at the pinned ref, plus this repo's
# overlay. Both are public.
LABEL org.patternvault.upstream.repo="https://codeberg.org/uzu/strudel"
LABEL org.patternvault.upstream.ref="${STRUDEL_REF}"

COPY docker/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /src/upstream/website/dist /usr/share/nginx/html

EXPOSE 80

HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD wget -qO /dev/null http://127.0.0.1/healthz || exit 1
