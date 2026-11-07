# Shamwari Chat image: our config over a LibreChat build of the PINNED commit.
#
# BASE_IMAGE has no default on purpose: there is no floating tag to fall back to.
# build.sh builds it from the commit in PIN and verifies the checkout first. (The
# project's ghcr image for v0.8.8 was not in its tag list when this was written,
# so building from the verified commit is the pin.)
ARG BASE_IMAGE
FROM ${BASE_IMAGE}

COPY librechat.yaml /app/librechat.yaml
