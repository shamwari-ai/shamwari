"""
/auth/verify: the lookup is by key hash, the type is checked, every refusal looks alike.

The defect this pins: every Shamwari key shares the prefix `sk_shamwari_`, so a
prefix-only `find_one` returned an arbitrary key's document and a valid key was
refused whenever a second active key existed. Runs against an in-memory stand-in
for the two collections; nothing reaches Mongo.
"""

import hashlib
import os
import unittest
from datetime import datetime, timedelta, timezone

os.environ.setdefault("MONGODB_URI", "mongodb://placeholder")
os.environ["SHAMWARI_CORE_TOKEN"] = "worker-token"
os.environ["SHAMWARI_OPS_TOKEN"] = "ops-token"  # same as test_ops_auth: whichever imports main first sets it

try:
    from fastapi.testclient import TestClient

    import main

    SKIP = None
except Exception as e:  # noqa: BLE001 - any import problem means "deps not installed"
    main = None
    SKIP = f"core dependencies not installed: {e}"

PREFIX = "sk_shamwari_"


def digest(raw: str) -> str:
    return hashlib.sha256(raw.encode()).hexdigest()


class Collection:
    """find_one with equality on plain fields, in insertion order (like a collection scan)."""

    def __init__(self, docs):
        self.docs = docs
        self.queries = []

    async def find_one(self, query, projection=None):
        self.queries.append(query)
        for d in self.docs:
            if all(d.get(k) == v for k, v in query.items()):
                return d
        return None


class Db:
    def __init__(self, **cols):
        self.__dict__.update(cols)


class Client:
    def __init__(self, keys, entities):
        self.keys = Collection(keys)
        self.entities = Collection(entities)
        self.dbs = {"platform": Db(apiKeys=self.keys), "entity": Db(entities=self.entities)}

    def __getitem__(self, name):
        return self.dbs[name]


def key_doc(raw, _id, **over):
    return {
        "_id": _id,
        "keyPrefix": PREFIX,
        "keyHash": digest(raw),
        "isActive": True,
        "keyType": "shamwari",
        "ownerEntityId": f"e-{_id}",
        **over,
    }


@unittest.skipIf(SKIP, SKIP or "")
class VerifyKey(unittest.TestCase):
    def setUp(self):
        self.real = main.client
        self.addCleanup(setattr, main, "client", self.real)

    def use(self, keys):
        entities = [{"_id": k["ownerEntityId"], "tier": "pro", "monthlyTokenCap": 5000} for k in keys]
        main.client = Client(keys, entities)
        return TestClient(main.app, raise_server_exceptions=False)

    def verify(self, c, raw, token="worker-token"):
        return c.post(
            "/auth/verify",
            headers={"Authorization": f"Bearer {token}"},
            json={"key_prefix": PREFIX, "key_hash": digest(raw)},
        )

    def assertInvalid(self, r):
        self.assertEqual(r.status_code, 401, r.text)
        self.assertEqual(r.json(), {"detail": {"error": "invalid_key"}})

    def test_every_active_key_verifies_when_many_share_the_prefix(self):
        keys = [key_doc(f"sk_shamwari_secret{i}", f"k{i}") for i in range(3)]
        c = self.use(keys)
        for i in range(3):
            r = self.verify(c, f"sk_shamwari_secret{i}")
            self.assertEqual(r.status_code, 200, r.text)
            self.assertEqual(r.json()["api_key_id"], f"k{i}")
            self.assertEqual(r.json()["owner_entity_id"], f"e-k{i}")
            self.assertEqual(r.json()["key_type"], "shamwari")
            self.assertEqual(r.json()["tier"], "pro")
            self.assertEqual(r.json()["monthly_token_cap"], 5000)

    def test_the_lookup_is_by_hash_not_by_prefix_alone(self):
        keys = [key_doc("sk_shamwari_a", "k1"), key_doc("sk_shamwari_b", "k2")]
        c = self.use(keys)
        self.verify(c, "sk_shamwari_b")
        q = main.client.keys.queries[0]
        self.assertEqual(q["keyHash"], digest("sk_shamwari_b"))
        self.assertTrue(q["isActive"])

    def test_unknown_inactive_expired_and_malformed_are_the_same_answer(self):
        past = datetime.now(timezone.utc) - timedelta(days=1)
        c = self.use(
            [
                key_doc("sk_shamwari_off", "k1", isActive=False),
                key_doc("sk_shamwari_old", "k2", expiresAt=past),
            ]
        )
        for raw in ("sk_shamwari_nobody", "sk_shamwari_off", "sk_shamwari_old"):
            self.assertInvalid(self.verify(c, raw))
        r = c.post(
            "/auth/verify",
            headers={"Authorization": "Bearer worker-token"},
            json={"key_prefix": PREFIX, "key_hash": "not-a-digest"},
        )
        self.assertInvalid(r)

    def test_a_future_expiry_is_still_valid(self):
        future = datetime.now(timezone.utc) + timedelta(days=30)
        c = self.use([key_doc("sk_shamwari_ok", "k1", expiresAt=future)])
        self.assertEqual(self.verify(c, "sk_shamwari_ok").status_code, 200)

    def test_a_valid_key_of_another_type_is_refused_like_a_bad_key(self):
        c = self.use(
            [
                key_doc("sk_shamwari_std", "k1", keyType="standard"),
                key_doc("sk_shamwari_nul", "k2", keyType=None),
                {k: v for k, v in key_doc("sk_shamwari_gone", "k3").items() if k != "keyType"},
            ]
        )
        for raw in ("sk_shamwari_std", "sk_shamwari_nul", "sk_shamwari_gone"):
            self.assertInvalid(self.verify(c, raw))

    def test_a_refused_worker_token_is_not_the_body_of_a_bad_key(self):
        """The gateway caches a bad key; it must never cache Core refusing the Worker."""
        c = self.use([key_doc("sk_shamwari_ok", "k1")])
        r = self.verify(c, "sk_shamwari_ok", token="wrong")
        self.assertEqual(r.status_code, 401)
        self.assertNotEqual(r.json(), {"detail": {"error": "invalid_key"}})

    def test_a_missing_entity_gets_the_community_defaults(self):
        main.client = Client([key_doc("sk_shamwari_ok", "k1")], [])
        r = self.verify(TestClient(main.app), "sk_shamwari_ok")
        self.assertEqual(r.status_code, 200)
        self.assertEqual((r.json()["tier"], r.json()["monthly_token_cap"]), ("community", 100_000))


if __name__ == "__main__":
    unittest.main()
