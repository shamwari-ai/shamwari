import json
import unittest
from pathlib import Path

import telemetry


class ByTier(unittest.TestCase):
    def test_matches_the_period_and_optionally_the_owner(self):
        p = telemetry.by_tier_pipeline("2026-10")
        self.assertEqual(p[0], {"$match": {"billingPeriod": "2026-10"}})
        p = telemetry.by_tier_pipeline("2026-10", "e1")
        self.assertEqual(p[0]["$match"]["ownerEntityId"], "e1")

    def test_tokens_are_always_summed_and_cost_only_where_priced(self):
        g = telemetry.by_tier_pipeline("2026-10")[1]["$group"]
        self.assertIn("input_tokens", g)
        self.assertIn("output_tokens", g)
        cond = json.dumps(g["cost_usd_estimate"])
        self.assertIn("$isNumber", cond)  # null is skipped, never counted as zero
        self.assertIn("unpriced_requests", g)

    def test_the_cost_field_is_the_estimate_not_a_billing_field(self):
        text = json.dumps(telemetry.by_tier_pipeline("2026-10"))
        self.assertIn("costUsdEstimate", text)
        self.assertNotIn('"$costUsd"', text)

    def test_shape_labels_the_cost_as_an_estimate(self):
        out = telemetry.shape(
            [
                {
                    "_id": {"reach": "r0", "routedTier": "economy", "inferencePath": "extractive"},
                    "requests": 3,
                    "input_tokens": 0,
                    "output_tokens": 0,
                    "cost_usd_estimate": 0.0,
                    "unpriced_requests": 3,
                }
            ]
        )
        self.assertIn("estimate", out["estimate"])
        self.assertEqual(out["rows"][0]["unpriced_requests"], 3)

    def test_price_table_matches_what_the_gateway_ships(self):
        t = json.loads((Path(__file__).parent.parent / "gateway" / "pricing.json").read_text())
        self.assertEqual(t["currency"], "USD")
        self.assertTrue(t["version"])


if __name__ == "__main__":
    unittest.main()
