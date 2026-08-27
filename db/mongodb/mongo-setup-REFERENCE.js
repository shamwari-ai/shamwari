// ============================================================
// REFERENCE ONLY — DO NOT RUN
// An earlier draft. It proposes collections that already exist
// on the live cluster under different names, and indexes that
// were created differently. See CLAUDE.md for what is live.
// ============================================================

// Shamwari — MongoDB operational store setup
//
//   mongosh "mongodb+srv://...?retryWrites=true" --file mongo-setup.js
//
// Mongo holds the firehose: conversations, usage events, raw logs.
// Accounts, API keys, Ground and the curated training set live in Postgres.
// Idempotent — safe to rerun.

const DB = 'shamwari';
const db = db.getSiblingDB(DB);

function ensure(name, validator, options = {}) {
  const exists = db.getCollectionNames().includes(name);
  if (exists) {
    db.runCommand({ collMod: name, validator, validationLevel: 'moderate' });
    print(`updated validator: ${name}`);
  } else {
    db.createCollection(name, { validator, ...options });
    print(`created: ${name}`);
  }
}

// ---------------------------------------------------------------
// conversations — every exchange. Raw material for Mind.
//
// license_class is stamped at write time by the Worker. It is the ONLY
// gate on training eligibility and it cannot be reconstructed later.
// ---------------------------------------------------------------

ensure('conversations', {
  $jsonSchema: {
    bsonType: 'object',
    required: ['account_id', 'request_id', 'messages', 'license_class', 'created_at'],
    properties: {
      account_id:    { bsonType: 'string' },      // uuid from Postgres
      request_id:    { bsonType: 'string' },
      messages:      { bsonType: 'array' },
      response:      { bsonType: ['string', 'null'] },
      citations:     { bsonType: 'array' },
      language:      { bsonType: ['string', 'null'], enum: ['sn','nd','en','sn-en','nd-en', null] },
      teacher_model: { bsonType: ['string', 'null'] },
      license_class: { bsonType: 'string', enum: ['open_weight', 'restricted'] },
      tier:          { bsonType: 'string', enum: ['economy','standard','premium'] },
      grounded:      { bsonType: 'bool' },
      promoted:      { bsonType: 'bool' },        // pulled into Postgres yet
      created_at:    { bsonType: 'date' },
    },
  },
});

// The promotion job's query: unpromoted, open-weight, grounded, newest first.
db.conversations.createIndex(
  { license_class: 1, promoted: 1, created_at: -1 },
  { name: 'promotion_scan' },
);
db.conversations.createIndex({ account_id: 1, created_at: -1 }, { name: 'by_account' });
db.conversations.createIndex({ request_id: 1 }, { name: 'by_request', unique: true });

// Raw conversations are cheap to keep but not free. 400 days, then gone —
// anything worth keeping has been promoted to Postgres by then.
db.conversations.createIndex(
  { created_at: 1 },
  { name: 'ttl_400d', expireAfterSeconds: 60 * 60 * 24 * 400 },
);

// ---------------------------------------------------------------
// usage_events — metering. Append-only, high volume.
// ---------------------------------------------------------------

ensure('usage_events', {
  $jsonSchema: {
    bsonType: 'object',
    required: ['account_id', 'request_id', 'tier', 'provider', 'license_class', 'created_at'],
    properties: {
      account_id:     { bsonType: 'string' },
      api_key_id:     { bsonType: ['string', 'null'] },
      request_id:     { bsonType: 'string' },
      tier:           { bsonType: 'string', enum: ['economy','standard','premium'] },
      provider:       { bsonType: 'string' },
      model:          { bsonType: 'string' },
      license_class:  { bsonType: 'string', enum: ['open_weight','restricted'] },
      input_tokens:   { bsonType: 'int' },
      output_tokens:  { bsonType: 'int' },
      cost_usd:       { bsonType: ['double','int','null'] },
      cache_hit:      { bsonType: 'bool' },
      ground_hit:     { bsonType: 'bool' },
      latency_ms:     { bsonType: ['int','null'] },
      created_at:     { bsonType: 'date' },
    },
  },
});

db.usage_events.createIndex({ account_id: 1, created_at: -1 }, { name: 'billing_window' });
db.usage_events.createIndex({ created_at: -1 }, { name: 'recent' });
db.usage_events.createIndex({ provider: 1, created_at: -1 }, { name: 'by_provider' });

// ---------------------------------------------------------------
// ground_misses — queries Ground could not answer.
// This is the corpus roadmap, written by paying customers.
// ---------------------------------------------------------------

ensure('ground_misses', {
  $jsonSchema: {
    bsonType: 'object',
    required: ['query', 'created_at'],
    properties: {
      account_id: { bsonType: ['string','null'] },
      query:      { bsonType: 'string' },
      language:   { bsonType: ['string','null'] },
      best_score: { bsonType: ['double','int','null'] },
      created_at: { bsonType: 'date' },
    },
  },
});
db.ground_misses.createIndex({ created_at: -1 }, { name: 'recent' });

// ---------------------------------------------------------------
// Rolling token totals for quota enforcement. Refreshed by a cron
// consumer so the Worker never aggregates on the hot path.
// ---------------------------------------------------------------

ensure('account_rollups', {
  $jsonSchema: {
    bsonType: 'object',
    required: ['account_id', 'window_days', 'total_tokens', 'updated_at'],
    properties: {
      account_id:   { bsonType: 'string' },
      window_days:  { bsonType: 'int' },
      total_tokens: { bsonType: ['long','int'] },
      total_cost:   { bsonType: ['double','int','null'] },
      updated_at:   { bsonType: 'date' },
    },
  },
});
db.account_rollups.createIndex({ account_id: 1, window_days: 1 }, { name: 'lookup', unique: true });

print('');
print('shamwari mongo setup complete.');
print('collections: ' + db.getCollectionNames().join(', '));
