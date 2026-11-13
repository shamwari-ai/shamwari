"""The deploy workflow references pinned actions and no secret value (#266).

Deploying on every release puts production credentials one `${{ secrets.X }}` away
from a workflow file. These checks keep that file honest without needing a YAML
parser (CI installs none): every action is pinned to a commit, the only secrets
referenced are the three the runbook tells the owner to provide, nothing that looks
like a credential is written in the file, and a missing secret fails the job.
"""

import re
import unittest
from pathlib import Path

REPO = Path(__file__).parent.parent
WORKFLOW = REPO / ".github" / "workflows" / "deploy.yml"
RUNBOOK = REPO / "docs" / "core-fly-runbook.md"

#: The only secrets the deploy may read. Names, never values.
SECRET_NAMES = {"FLY_API_TOKEN", "CLOUDFLARE_API_TOKEN", "CLOUDFLARE_ACCOUNT_ID"}

#: Shapes of real credentials: Fly (fo1_, FlyV1), Cloudflare/GitHub/AWS tokens, private keys, bearer values.
CREDENTIAL_SHAPES = [
    r"\bfo1_[A-Za-z0-9_-]{10,}",
    r"\bFlyV1\b",
    r"\bgh[pousr]_[A-Za-z0-9]{20,}",
    r"\bAKIA[0-9A-Z]{16}\b",
    r"-----BEGIN [A-Z ]*PRIVATE KEY-----",
    r"\bnyk_[A-Za-z0-9]+\.nys_[A-Za-z0-9]+",
    r"\b[0-9a-f]{32}\b",  # a Cloudflare account id or token-sized hex string
]


def text() -> str:
    return WORKFLOW.read_text(encoding="utf-8")


def uses_lines() -> list[str]:
    return [m.group(1).strip() for m in re.finditer(r"^\s*-?\s*uses:\s*(.+)$", text(), re.M)]


class DeployWorkflow(unittest.TestCase):
    def test_exists_and_deploys_both(self):
        src = text()
        self.assertIn("npx wrangler deploy", src)
        self.assertIn("flyctl deploy --app shamwari-core --ha=false", src)

    def test_every_action_is_pinned_to_a_commit(self):
        uses = uses_lines()
        self.assertTrue(uses, "no actions found; the parser is broken")
        for u in uses:
            self.assertRegex(u, r"^[\w./-]+@[0-9a-f]{40}\b", f"not pinned by SHA: {u}")

    def test_only_the_documented_secrets_are_referenced(self):
        used = set(re.findall(r"\$\{\{\s*secrets\.([A-Za-z0-9_]+)\s*\}\}", text()))
        self.assertEqual(used, SECRET_NAMES)
        self.assertNotIn("secrets: inherit", text())

    def test_no_secret_literal(self):
        # Strip comments: the header names the secrets, which is fine; values are not.
        code = "\n".join(re.sub(r"\s#.*$", "", ln) for ln in text().splitlines() if not ln.lstrip().startswith("#"))
        for shape in CREDENTIAL_SHAPES:
            self.assertIsNone(re.search(shape, code), f"looks like a credential: {shape}")
        for name in SECRET_NAMES:
            for m in re.finditer(rf"^\s*{name}:\s*(.+)$", code, re.M):
                self.assertEqual(m.group(1).strip(), f"${{{{ secrets.{name} }}}}")

    def test_missing_secret_fails_the_job(self):
        src = text()
        self.assertRegex(src, r"for name in CLOUDFLARE_API_TOKEN CLOUDFLARE_ACCOUNT_ID")
        self.assertRegex(src, r"::error[^\n]*secret \$name is not set")
        self.assertRegex(src, r"::error[^\n]*secret FLY_API_TOKEN is not set")
        # Each check step exits non-zero, and nothing in the file makes a step tolerate failure.
        self.assertNotIn("continue-on-error", src)
        self.assertGreaterEqual(len(re.findall(r"^\s+exit 1$", src, re.M)), 3)

    def test_each_deploy_is_independent_and_in_production(self):
        src = text()
        self.assertEqual(src.count("environment: production"), 2)
        for group in ("deploy-gateway-production", "deploy-core-production"):
            self.assertRegex(src, rf"group: {group}\n\s+cancel-in-progress: false")
        self.assertNotIn("cancel-in-progress: true", src)
        self.assertNotRegex(src, r"needs:\s*\[?\s*(core|gateway)\b")

    def test_minimal_permissions_and_no_token_in_checkout(self):
        src = text()
        self.assertRegex(src, r"(?m)^permissions:\n  contents: read\n")
        self.assertNotRegex(src, r"(?m)^\s+(contents|id-token|packages|actions): write")
        self.assertEqual(src.count("persist-credentials: false"), src.count("actions/checkout@"))

    def test_runs_only_after_green_ci_on_main(self):
        src = text()
        self.assertIn("workflows: [CI]", src)
        self.assertIn("branches: [main]", src)
        self.assertIn("github.event.workflow_run.conclusion == 'success'", src)
        self.assertIn("github.event.workflow_run.event == 'push'", src)
        self.assertIn("git merge-base --is-ancestor", src)

    def test_health_checks_fail_the_job(self):
        src = text()
        self.assertIn("https://api.shamwari.ai/health", src)
        self.assertIn("https://shamwari-core.fly.dev/health", src)
        self.assertEqual(src.count('[ "$code" = 200 ]'), 2)
        self.assertEqual(len(re.findall(r"did not answer 200", src)), 2)

    def test_servers_api_is_deploy_time_not_fly_toml(self):
        self.assertIn('--env "SERVERS_API_URL=$SERVERS_API_URL"', text())
        self.assertIn("http://nyuchi-servers-api.internal:8081", text())
        toml = (REPO / "core" / "fly.toml").read_text(encoding="utf-8")
        live = [ln for ln in toml.splitlines() if not ln.lstrip().startswith("#")]
        self.assertFalse([ln for ln in live if "SERVERS_API_URL" in ln], "must not be set in fly.toml")

    def test_runbook_names_the_secrets_and_the_break_glass_path(self):
        rb = RUNBOOK.read_text(encoding="utf-8")
        for name in SECRET_NAMES:
            self.assertTrue(name in rb, f"runbook does not name {name}")
        self.assertIn("break-glass", rb.lower())


if __name__ == "__main__":
    unittest.main()
