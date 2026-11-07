#!/usr/bin/env bash
# Build the Shamwari Chat image from the commit pinned in PIN.
# Usage: chat/librechat/build.sh [image-tag]
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
commit="$(sed -n 's/^commit=//p' "$here/PIN")"
tag="${1:-shamwari-chat:local}"
work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT

git init -q "$work/src"
git -C "$work/src" fetch -q --depth 1 https://github.com/danny-avila/LibreChat "$commit"
git -C "$work/src" checkout -q FETCH_HEAD
got="$(git -C "$work/src" rev-parse HEAD)"
[ "$got" = "$commit" ] || { echo "pinned commit mismatch: $got != $commit" >&2; exit 1; }

docker build -q -t librechat-base:pinned "$work/src"
docker build -t "$tag" --build-arg BASE_IMAGE=librechat-base:pinned "$here"
