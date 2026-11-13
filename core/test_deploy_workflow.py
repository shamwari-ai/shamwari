"""The deploy workflow references pinned actions and no secret value (#266).

Deploying on every release puts production credentials one `${{ secrets.X }}` away
from a workflow file. These checks keep that file honest without needing a YAML
parser (CI installs none): every action is pinned to a commit, the only secrets
referenced are the three the runbook tells the owner to provide, each only in the
step that needs it, nothing that looks like a credential is written in the file,
and every guard that stops a bad deploy is still there.

They are deliberately literal. A guard weakened by one edit (`exit "$missing"` to
`exit 0`, a dropped branch check, `npm ci` to `npm install`) must fail a test; the
mutation list in the PR for #266 was run against this file to prove it.
"""

import re
import unittest
from pathlib import Path

REPO = Path(__file__).parent.parent
WORKFLOW = REPO / ".github" / "workflows" / "deploy.yml"
RUNBOOK = REPO / "docs" / "core-fly-runbook.md"
FLY_TOML = REPO / "core" / "fly.toml"

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


def code() -> str:
    """The workflow without comments, so a name in a comment cannot satisfy or trip a check."""
    out = []
    for line in text().splitlines():
        if line.lstrip().startswith("#"):
            continue
        out.append(re.sub(r"\s+#.*$", "", line))
    return "\n".join(out)


def jobs() -> dict[str, str]:
    """Job name -> its text (comment-stripped), cut at the two-space-indented keys under `jobs:`."""
    body = code().split("\njobs:\n", 1)[1]
    parts = re.split(r"(?m)^  ([a-z][a-z0-9_-]*):\s*$", body)
    return {parts[i]: parts[i + 1] for i in range(1, len(parts), 2)}


def steps(job: str) -> list[str]:
    """The steps of a job, each as its own text."""
    body = jobs()[job].split("\n    steps:\n", 1)[1]
    return [s for s in re.split(r"(?m)^      - ", body) if s.strip()]


def uses_lines() -> list[str]:
    return [m.group(1).strip() for m in re.finditer(r"^\s*-?\s*uses:\s*(.+)$", code(), re.M)]


class DeployWorkflow(unittest.TestCase):
    def test_jobs_are_the_three_expected(self):
        self.assertEqual(set(jobs()), {"gate", "gateway", "core"})

    def test_deploy_commands(self):
        src = code()
        self.assertIn("npm ci", src)
        self.assertNotIn("npm install", src)
        self.assertIn("npx --no wrangler deploy", src)
        self.assertNotIn("--yes", src)
        self.assertRegex(
            src,
            r'flyctl deploy --app shamwari-core --ha=false --remote-only --env "SERVERS_API_URL=\$SERVERS_API_URL"',
        )
        self.assertNotIn("--no-public-ips", src)  # Core is public HTTPS on purpose

    def test_every_action_is_pinned_to_a_commit(self):
        uses = uses_lines()
        self.assertEqual(len(uses), 5, "expected 3 checkout/setup actions in the jobs plus 1 in gate and flyctl")
        for u in uses:
            self.assertRegex(u, r"^[\w./-]+@[0-9a-f]{40}$", f"not pinned by SHA: {u}")
        self.assertNotIn("docker://", code())

    def test_secrets_are_exactly_the_documented_forms(self):
        src = code()
        # Every mention of `secrets` is one of the three `${{ secrets.NAME }}` forms. A toJSON(secrets),
        # secrets['X'], secrets.OTHER or `secrets: inherit` is a different shape and fails here.
        exprs = [e for e in re.findall(r"\$\{\{.*?\}\}", src) if re.search(r"\bsecrets\b", e)]
        forms = [e for e in exprs if re.fullmatch(r"\$\{\{ secrets\.(FLY_API_TOKEN|CLOUDFLARE_API_TOKEN|CLOUDFLARE_ACCOUNT_ID) \}\}", e)]
        self.assertEqual(exprs, forms, "a secrets reference is not a plain ${{ secrets.NAME }}")
        self.assertNotRegex(src, r"(?m)^\s*secrets:", "secrets: inherit or a secrets block")
        forms = [re.search(r"secrets\.(\w+)", e).group(1) for e in forms]
        self.assertEqual(set(forms), SECRET_NAMES)
        # Gateway: the check step and the deploy step take both Cloudflare secrets. Core: the check and the deploy take the token.
        self.assertEqual(len(forms), 6)
        self.assertNotIn("github.token", src)
        self.assertNotIn("GITHUB_TOKEN", src)

    def test_secrets_reach_only_the_steps_that_need_them(self):
        needs_secrets = {
            "gateway": {"Require the Cloudflare secrets", "wrangler deploy"},
            "core": {"Require the Fly deploy token", "fly deploy"},
        }
        for job, allowed in needs_secrets.items():
            self.assertNotRegex(jobs()[job].split("\n    steps:\n", 1)[0], r"secrets", f"{job}: job-level secrets")
            seen = set()
            for step in steps(job):
                if "secrets." in step:
                    name = re.search(r"name:\s*(.+)", step).group(1).strip()
                    seen.add(name)
                    self.assertRegex(step, r"(?m)^        env:\n", f"{job}/{name}: secret outside a step env block")
            self.assertEqual(seen, allowed, f"{job}: secrets in the wrong steps")
        # Never beside code from the network: checkout, setup, dependency install.
        for job in ("gateway", "core"):
            for step in steps(job):
                if "uses:" in step or "npm ci" in step:
                    self.assertNotIn("secrets.", step)
        self.assertNotIn("secrets", jobs()["gate"])

    def test_no_secret_literal(self):
        src = code()
        for shape in CREDENTIAL_SHAPES:
            self.assertIsNone(re.search(shape, src), f"looks like a credential: {shape}")
        for name in SECRET_NAMES:
            for m in re.finditer(rf"^\s*{name}:\s*(.+)$", src, re.M):
                self.assertEqual(m.group(1).strip(), f"${{{{ secrets.{name} }}}}")

    def test_missing_secret_fails_the_job_by_name(self):
        gw = jobs()["gateway"]
        self.assertIn("for name in CLOUDFLARE_API_TOKEN CLOUDFLARE_ACCOUNT_ID; do", gw)
        self.assertIn('if [ -z "${!name}" ]; then', gw)
        self.assertIn("::error title=Gateway deploy failed::secret $name is not set", gw)
        self.assertIn("missing=0", gw)
        self.assertIn("missing=1", gw)
        self.assertIn('exit "$missing"', gw)
        core = jobs()["core"]
        self.assertIn('if [ -z "$FLY_API_TOKEN" ]; then', core)
        self.assertIn("::error title=Core deploy failed::secret FLY_API_TOKEN is not set", core)
        check = steps("core")[0]
        self.assertRegex(check, r'if \[ -z "\$FLY_API_TOKEN" \]; then\n(?:.*\n)*?\s+exit 1\n\s+fi')
        self.assertNotIn("continue-on-error", code())
        self.assertNotIn("|| true\n", code().replace("|| true)", ""))  # only the curl capture may swallow a status

    def test_each_deploy_is_independent_and_in_production(self):
        src = code()
        self.assertEqual(src.count("environment: production"), 2)
        self.assertNotIn("environment: production", jobs()["gate"])
        for job, group in (("gateway", "deploy-gateway-production"), ("core", "deploy-core-production")):
            self.assertRegex(jobs()[job], rf"group: {group}\n\s+cancel-in-progress: false")
            self.assertIn("needs: gate", jobs()[job])
        self.assertNotIn("cancel-in-progress: true", src)
        self.assertNotRegex(src, r"needs:\s*\[?\s*(core|gateway)\b")

    def test_minimal_permissions(self):
        src = code()
        self.assertRegex(src, r"(?m)^permissions:\n  contents: read\n")
        self.assertNotRegex(src, r"(?m)^\s+(contents|id-token|packages|actions|pull-requests|issues): write")
        self.assertEqual(src.count("permissions:"), 1)
        self.assertEqual(src.count("persist-credentials: false"), src.count("actions/checkout@"))

    def test_runs_only_after_green_ci_on_main(self):
        src = code()
        self.assertRegex(src, r"workflow_run:\n    workflows: \[CI\]\n    types: \[completed\]\n    branches: \[main\]")
        gate = jobs()["gate"]
        self.assertIn("github.event.workflow_run.conclusion == 'success'", gate)
        self.assertIn("github.event.workflow_run.event == 'push'", gate)
        self.assertIn("github.event_name == 'workflow_dispatch' && github.ref == 'refs/heads/main'", gate)
        # The gate refuses anything that is not this repository's main, a full SHA, and an ancestor of main.
        self.assertIn('[ "$HEAD_REPO" = "$THIS_REPO" ]', gate)
        self.assertIn('[ "$HEAD_BRANCH" = main ]', gate)
        self.assertIn("grep -Eq '^[0-9a-f]{40}$'", gate)
        self.assertIn('git merge-base --is-ancestor "$sha" origin/main', gate)
        self.assertIn("ref: main", gate)
        # The deploy jobs check out what the gate validated, never the triggering run's commit.
        for job in ("gateway", "core"):
            self.assertIn("ref: ${{ needs.gate.outputs.sha }}", jobs()[job])
        self.assertNotIn("workflow_run.head_sha }}", "\n".join(jobs()[j] for j in ("gateway", "core")))

    def test_health_checks_fail_the_job(self):
        for job, url in (("gateway", "https://api.shamwari.ai/health"), ("core", "https://shamwari-core.fly.dev/health")):
            j = jobs()[job]
            self.assertIn(f"HEALTH_URL: {url}", j)
            self.assertIn("for attempt in 1 2 3 4 5 6; do", j)
            self.assertIn('[ "$attempt" -lt 6 ] && sleep 10', j)
            self.assertIn("--max-time 10", j)
            self.assertIn('if [ "$code" = 200 ]; then', j)
            self.assertIn("did not answer 200", j)
            tail = j.rstrip().splitlines()[-1].strip()
            self.assertEqual(tail, "exit 1", f"{job}: the health check must end by failing the job")
            # The health check is the last step: it runs after the deploy, and nothing after it hides a failure.
            self.assertIn("Health check", steps(job)[-1])

    def test_servers_api_is_deploy_time_not_fly_toml(self):
        self.assertIn("SERVERS_API_URL: http://nyuchi-servers-api.internal:8081", jobs()["core"])
        live = [ln for ln in FLY_TOML.read_text(encoding="utf-8").splitlines() if not ln.lstrip().startswith("#")]
        self.assertFalse([ln for ln in live if "SERVERS_API_URL" in ln], "must not be set in fly.toml")

    def test_runbook_names_the_secrets_and_the_break_glass_path(self):
        rb = RUNBOOK.read_text(encoding="utf-8")
        for name in SECRET_NAMES:
            self.assertTrue(name in rb, f"runbook does not name {name}")
        self.assertIn("break-glass", rb.lower())


if __name__ == "__main__":
    unittest.main()
