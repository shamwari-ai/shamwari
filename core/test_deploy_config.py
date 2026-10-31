"""The deploy config says what the running service reads, and nothing more.

Core holds the Mongo login and enforces rule 1, so the set of secrets it is
handed is the set a compromise would expose. These tests keep that set small and
keep the three places that describe it (the code, fly.toml, the runbook) from
drifting apart.
"""

import re
import unittest
from pathlib import Path

HERE = Path(__file__).parent
REPO = HERE.parent

#: Read while serving. Everything else Core is configured with is a bug.
SERVING = {
    "MONGODB_URI",
    "SHAMWARI_CORE_TOKEN",
    "SHAMWARI_OPS_TOKEN",
    "SERVERS_API_URL",
    "SERVERS_API_TOKEN",
    "SERVERS_API_INTERNAL_KEY",
}
#: Ingest-only: a Supabase login and a Cloudflare token. Never on the Fly app.
INGEST_ONLY = {"SUPABASE_DB_URL", "CF_ACCOUNT_ID", "CF_API_TOKEN"}


def env_names(path: Path) -> set[str]:
    src = path.read_text()
    return set(re.findall(r'os\.environ(?:\.get)?[\[(]\s*"([A-Z_]+)"', src))


class SecretsMatchTheCode(unittest.TestCase):
    def test_serving_code_reads_exactly_the_documented_secrets(self):
        read: set[str] = set()
        for py in ("main.py", "replay.py", "telemetry.py"):
            read |= env_names(HERE / py)
        self.assertEqual(read, SERVING, "serving code reads an undocumented variable")

    def test_serving_code_never_reads_ingest_credentials(self):
        for py in ("main.py", "replay.py", "telemetry.py"):
            self.assertFalse(env_names(HERE / py) & INGEST_ONLY, py)

    def test_fly_toml_lists_every_serving_secret_and_marks_ingest_ones(self):
        toml = (HERE / "fly.toml").read_text()
        header = toml[: toml.index("app =")]
        for name in SERVING:
            self.assertIn(name, header)
        for name in INGEST_ONLY:
            self.assertIn(name, header)
            self.assertRegex(header, r"(?s)" + name + r".*ONLY")

    def test_runbook_names_every_secret(self):
        runbook = (REPO / "docs" / "core-fly-runbook.md").read_text()
        for name in SERVING | INGEST_ONLY:
            self.assertIn(name, runbook)


class NoSecretValues(unittest.TestCase):
    def test_fly_toml_has_no_assignment_of_a_secret(self):
        for line in (HERE / "fly.toml").read_text().splitlines():
            if line.lstrip().startswith("#"):
                continue
            for name in SERVING | INGEST_ONLY:
                self.assertNotIn(name, line)

    def test_runbook_never_prints_a_secret(self):
        """No `echo`/`printenv`/`env` of a secret, and no `fly secrets set NAME=value` on argv."""
        runbook = (REPO / "docs" / "core-fly-runbook.md").read_text()
        code = "\n".join(re.findall(r"```(?:bash|sh)\n(.*?)```", runbook, re.S))
        self.assertTrue(code, "runbook has no command blocks; the check is broken")
        for name in SERVING | INGEST_ONLY:
            self.assertNotRegex(code, rf"echo[^\n]*\${{?{name}", name)
            self.assertNotRegex(code, rf"fly secrets set[^\n]*{name}=", name)
        self.assertNotRegex(code, r"(?m)^\s*(printenv|env)\s*$")
        self.assertNotRegex(code, r"set -x")


class Machine(unittest.TestCase):
    def test_health_check_is_the_unauthenticated_route(self):
        toml = (HERE / "fly.toml").read_text()
        self.assertIn('path = "/health"', toml)

    def test_image_runs_as_non_root(self):
        df = (HERE / "Dockerfile").read_text()
        self.assertRegex(df, r"(?m)^USER core$")
        self.assertIn("--require-hashes", df)


if __name__ == "__main__":
    unittest.main()
