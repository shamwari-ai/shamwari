#!/usr/bin/env bash
# ---------------------------------------------------------------
# Create and deploy the Shamwari AI Gateway dynamic route.
#
#   export CF_ACCOUNT_ID=...
#   export CF_API_TOKEN=...        # needs AI Gateway edit
#   ./scripts/create-dynamic-route.sh [gateway_id]
#
# Builds the route from gateway/dynamic-route.json in one pass:
# create → find the version → deploy it. Creating a route does not
# make it live, which is the step that is easy to miss by hand.
#
# The dashboard's Create dialog takes only a name and a template, so
# this is the path that does not involve wiring six nodes by hand.
# Dynamic Routing is in Beta; if a field is rejected, read the error —
# it names the field — and see gateway/README.md for the two whose
# shapes are not published upstream.
# ---------------------------------------------------------------
set -euo pipefail

GW="${1:-shamwari}"
SPEC="$(cd "$(dirname "$0")/.." && pwd)/gateway/dynamic-route.json"

for v in CF_ACCOUNT_ID CF_API_TOKEN; do
  [ -n "${!v:-}" ] || { echo "error: $v is not set" >&2; exit 1; }
done
[ -f "$SPEC" ] || { echo "error: $SPEC not found" >&2; exit 1; }
command -v jq >/dev/null || { echo "error: jq is required" >&2; exit 1; }

API="https://api.cloudflare.com/client/v4/accounts/$CF_ACCOUNT_ID/ai-gateway/gateways/$GW"
AUTH=(-H "Authorization: Bearer $CF_API_TOKEN" -H "Content-Type: application/json")

# Cloudflare returns 200 with success:false for domain errors, so check
# the body rather than trusting the status code.
check() {
  local body="$1" what="$2"
  if [ "$(jq -r '.success' <<<"$body")" != "true" ]; then
    echo "error: $what failed" >&2
    jq -r '.errors[]? | "  \(.code // "-"): \(.message)"' <<<"$body" >&2 || echo "$body" >&2
    exit 1
  fi
}

echo "==> gateway: $GW"
echo "==> spec:    $SPEC"

echo "==> creating route"
created=$(curl -sS -X POST "$API/routes" "${AUTH[@]}" --data @"$SPEC")
check "$created" "route create"
ROUTE=$(jq -r '.result.id' <<<"$created")
echo "    route id: $ROUTE"

echo "==> finding the version just created"
versions=$(curl -sS "$API/routes/$ROUTE/versions" "${AUTH[@]}")
check "$versions" "version list"
VERSION=$(jq -r '.result[0].id' <<<"$versions")
[ "$VERSION" != "null" ] || { echo "error: no version on the new route" >&2; exit 1; }
echo "    version id: $VERSION"

echo "==> deploying"
deployed=$(curl -sS -X POST "$API/routes/$ROUTE/deployments" "${AUTH[@]}" \
  -d "{\"version_id\":\"$VERSION\"}")
check "$deployed" "deployment"

NAME=$(jq -r '.name' "$SPEC")
cat << EOF

==> live. Call it with:

      model: "dynamic/$NAME"

    on https://gateway.ai.cloudflare.com/v1/$CF_ACCOUNT_ID/$GW/compat/chat/completions

==> now read the route back and copy the real shapes into the spec.
    properties.conditions and rate.key are the two fields whose JSON
    shape is not published upstream, so what the API stored is the
    authority, not gateway/dynamic-route.json:

      curl -sS "$API/routes/$ROUTE" \\
        -H "Authorization: Bearer \$CF_API_TOKEN" | jq '.result.elements'

==> the route will not branch until src/gateway.ts sends tier and
    ownerEntityId as AI Gateway custom metadata. Until then every
    request takes the false branch to economy.
EOF
