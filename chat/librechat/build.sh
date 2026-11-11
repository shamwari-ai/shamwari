#!/usr/bin/env bash
# Build the Shamwari Chat image from the commit pinned in PIN.
# Usage: chat/librechat/build.sh [image-tag]
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
commit="$(sed -n 's/^commit=//p' "$here/PIN")"
base="$(sed -n 's/^base=//p' "$here/PIN")"
tag="${1:-shamwari-chat:local}"
# The Shamwari fork (docs/librechat.md). Its history contains the pinned upstream
# commit, and the commit check below is what makes this safe.
repo="https://github.com/shamwari-ai/librechat"
work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT

git init -q "$work/src"
# Full history without file contents, so the upstream base is always reachable however many
# fork commits sit above it; file contents are fetched on checkout.
git -C "$work/src" fetch -q --filter=blob:none "$repo" "$commit"
git -C "$work/src" checkout -q FETCH_HEAD
got="$(git -C "$work/src" rev-parse HEAD)"
[ "$got" = "$commit" ] || { echo "pinned commit mismatch: $got != $commit" >&2; exit 1; }

# The fork commit must sit on the upstream base, and the tag in PIN must name that base.
git -C "$work/src" merge-base --is-ancestor "$base" HEAD \
  || { echo "fork commit $commit is not built on upstream base $base" >&2; exit 1; }
rel="$(sed -n 's/^tag=//p' "$here/PIN")"
tagged="$(git ls-remote https://github.com/danny-avila/LibreChat "refs/tags/$rel^{}" "refs/tags/$rel" | tail -1 | cut -f1)"
[ "$tagged" = "$base" ] || { echo "tag $rel resolves to $tagged, not $base" >&2; exit 1; }

docker build -q -t "librechat-base:$commit" "$work/src"
docker build -t "$tag" --build-arg BASE_IMAGE="librechat-base:$commit" "$here"
