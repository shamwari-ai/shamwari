#!/usr/bin/env bash
# Build the Shamwari Chat image from the commit pinned in PIN.
# Usage: chat/librechat/build.sh [image-tag]
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
commit="$(sed -n 's/^commit=//p' "$here/PIN")"
tag="${1:-shamwari-chat:local}"
# The Shamwari fork (docs/librechat.md). Its history contains the pinned upstream
# commit, and the commit check below is what makes this safe.
repo="https://github.com/shamwari-ai/librechat"
work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT

git init -q "$work/src"
git -C "$work/src" fetch -q --depth 1 "$repo" "$commit"
git -C "$work/src" checkout -q FETCH_HEAD
got="$(git -C "$work/src" rev-parse HEAD)"
[ "$got" = "$commit" ] || { echo "pinned commit mismatch: $got != $commit" >&2; exit 1; }

# The tag in PIN is a label; make sure it names this commit.
rel="$(sed -n 's/^tag=//p' "$here/PIN")"
tagged="$(git ls-remote https://github.com/danny-avila/LibreChat "refs/tags/$rel^{}" "refs/tags/$rel" | tail -1 | cut -f1)"
[ "$tagged" = "$commit" ] || { echo "tag $rel resolves to $tagged, not $commit" >&2; exit 1; }

docker build -q -t "librechat-base:$commit" "$work/src"
docker build -t "$tag" --build-arg BASE_IMAGE="librechat-base:$commit" "$here"
