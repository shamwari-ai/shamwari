"""The deploy config says what the running service reads, and nothing more.

Core holds the Mongo login and enforces rule 1, so the set of secrets it is
handed is the set a compromise would expose. These tests keep that set small and
keep the three places that describe it (the code, fly.toml, the runbook) from
drifting apart.
"""

import ast
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


def env_names_in(src: str) -> set[str]:
    """
    Every environment variable a module reads, found by parsing it: os.environ["X"],
    os.environ.get("X"), os.getenv("X"), and the same through `from os import environ`
    or `getenv`. Any quoting, any name. A read through a variable name rather than a
    literal is invisible to this, which is why serving code keeps its reads literal.
    """
    names: set[str] = set()

    def is_environ(node: ast.AST) -> bool:
        return (isinstance(node, ast.Attribute) and node.attr == "environ") or (
            isinstance(node, ast.Name) and node.id == "environ"
        )

    def literal(node: ast.AST | None) -> str | None:
        return node.value if isinstance(node, ast.Constant) and isinstance(node.value, str) else None

    for node in ast.walk(ast.parse(src)):
        if isinstance(node, ast.Subscript) and is_environ(node.value):
            if (n := literal(node.slice)) is not None:
                names.add(n)
        elif isinstance(node, ast.Call) and node.args:
            f = node.func
            reads = (
                (isinstance(f, ast.Attribute) and f.attr in {"get", "pop", "setdefault"} and is_environ(f.value))
                or (isinstance(f, ast.Attribute) and f.attr == "getenv")
                or (isinstance(f, ast.Name) and f.id == "getenv")
            )
            if reads and (n := literal(node.args[0])) is not None:
                names.add(n)
    return names


def env_names(path: Path) -> set[str]:
    return env_names_in(path.read_text())


class TheCheckSeesEveryWayToReadAVariable(unittest.TestCase):
    def test_every_form_is_found(self):
        src = (
            "import os\nfrom os import environ, getenv\n"
            "a = os.environ['CF_API_TOKEN']\nb = os.environ.get(\"S3_KEY_2\")\n"
            "c = os.getenv('SUPABASE_DB_URL')\nd = environ['X1']\ne = environ.get('Y2', '')\nf = getenv('Z3')\n"
        )
        self.assertEqual(
            env_names_in(src), {"CF_API_TOKEN", "S3_KEY_2", "SUPABASE_DB_URL", "X1", "Y2", "Z3"}
        )

    def test_a_string_that_is_not_a_read_is_not_found(self):
        self.assertEqual(env_names_in("x = 'CF_API_TOKEN'\nprint('SUPABASE_DB_URL')"), set())


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
            # On the one line that says so: a stray "ONLY" elsewhere must not satisfy it.
            lines = [ln for ln in header.splitlines() if name in ln]
            self.assertTrue(any("ONLY" in ln for ln in lines), f"{name} is not marked ONLY")

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
    def test_image_does_not_ship_the_ingest_script_or_test_helpers(self):
        """Core's image holds nothing that reads credentials Core must never be given."""
        copies = " ".join(
            ln for ln in (HERE / "Dockerfile").read_text().splitlines() if ln.startswith("COPY ")
        )
        for name in ("ingest_ground", "eval_ground", "fakes", "e2e_app"):
            self.assertNotIn(name, copies)
        # A wildcard would ship e2e_app (unauthenticated /__e2e/* routes) the day it is added.
        self.assertNotRegex(copies, r"\*|COPY \. ")

    def test_health_check_is_the_unauthenticated_route(self):
        toml = (HERE / "fly.toml").read_text()
        self.assertIn('path = "/health"', toml)

    def test_image_runs_as_non_root(self):
        df = (HERE / "Dockerfile").read_text()
        self.assertRegex(df, r"(?m)^USER core$")
        self.assertIn("--require-hashes", df)


if __name__ == "__main__":
    unittest.main()
