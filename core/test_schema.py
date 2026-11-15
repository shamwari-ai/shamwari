"""
The reference Supabase schema keeps rule 2's consent term (shamwari-ai/shamwari#291).

`db/supabase/01-base-schema.sql` is not run by Core, so nothing else would notice if
`conversations.mind_eligible` went back to being derived from licence alone. These tests
read the file and check the generated column needs both the licence and recorded consent,
and that consent defaults to no.
"""

import re
import unittest
from pathlib import Path

SCHEMA = Path(__file__).resolve().parent.parent / "db" / "supabase" / "01-base-schema.sql"


def _sql_without_comments() -> str:
    return re.sub(r"--[^\n]*", "", SCHEMA.read_text())


def _norm(s: str) -> str:
    return re.sub(r"\s+", " ", s).strip().lower()


class MindEligibleNeedsConsent(unittest.TestCase):
    def setUp(self):
        self.sql = _norm(_sql_without_comments())

    def test_every_mind_eligible_definition_requires_licence_and_consent(self):
        defs = re.findall(r"mind_eligible boolean generated always as \(([^;]*?)\) stored", self.sql)
        self.assertGreaterEqual(len(defs), 2, "the create and the upgrade path should both define it")
        for expr in defs:
            self.assertIn("license_class = 'open_weight'", expr)
            self.assertIn("training_consent", expr)
            self.assertNotIn(" or ", expr, "consent must be required, not one way to say yes")

    def test_consent_defaults_to_no(self):
        for m in re.findall(r"training_consent boolean[^,;]*", self.sql):
            self.assertIn("not null", m)
            self.assertIn("default false", m)

    def test_licence_alone_is_not_enough(self):
        self.assertNotIn(
            "generated always as (license_class = 'open_weight') stored",
            self.sql,
        )


if __name__ == "__main__":
    unittest.main()
