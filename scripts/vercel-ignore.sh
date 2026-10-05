#!/usr/bin/env bash
# Vercel's "Ignored Build Step" (vercel.json ignoreCommand; Vercel caps that field at 256 characters,
# so the logic lives here). Exit 0 skips the build, exit 1 builds.
# Builds when the commit message says [deploy], when the previous deployed commit is unknown, or
# when anything the site is built from changed since it.
# While a .deploy-hold file exists nothing deploys (it held the live site during the Splidev rebuild).
[ -e .deploy-hold ] && exit 0
git log -1 --format=%B | grep -q '\[deploy\]' && exit 1
[ -n "$VERCEL_GIT_PREVIOUS_SHA" ] || exit 1
git cat-file -e "$VERCEL_GIT_PREVIOUS_SHA" 2>/dev/null || exit 1
git diff --quiet "$VERCEL_GIT_PREVIOUS_SHA" HEAD -- src public package.json package-lock.json \
  next.config.mjs tailwind.config.ts postcss.config.js tsconfig.json .npmrc .vercelignore vercel.json \
  scripts/vercel-ignore.sh
