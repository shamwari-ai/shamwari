-- Shamwari Cloud — Supabase schema (phase one)
-- Run in Supabase SQL editor. Idempotent.

create extension if not exists vector;
create extension if not exists pgcrypto;

-- ---------------------------------------------------------------
-- Accounts & API keys
-- ---------------------------------------------------------------

create table if not exists accounts (
  id            uuid primary key default gen_random_uuid(),
  name          text not null,
  email         text not null unique,
  country       text default 'ZW',
  tier          text not null default 'community'
                check (tier in ('community','developer','business','sovereign')),
  monthly_token_cap bigint default 100000,
  created_at    timestamptz not null default now()
);

create table if not exists api_keys (
  id          uuid primary key default gen_random_uuid(),
  account_id  uuid not null references accounts(id) on delete cascade,
  key_hash    text not null unique,        -- sha256 of the raw key; raw is never stored
  key_prefix  text not null,               -- first 12 chars, for display
  label       text,
  revoked_at  timestamptz,
  last_used_at timestamptz,
  created_at  timestamptz not null default now()
);
create index if not exists api_keys_hash_idx on api_keys(key_hash) where revoked_at is null;

-- ---------------------------------------------------------------
-- Usage metering + training-data provenance
--   license_class gates Mind eligibility. Enforced at read time in
--   the training pipeline, never by human review.
-- ---------------------------------------------------------------

create table if not exists usage_events (
  id              bigserial primary key,
  account_id      uuid not null references accounts(id) on delete cascade,
  api_key_id      uuid references api_keys(id) on delete set null,
  request_id      text not null,
  tier            text not null,            -- economy | standard | premium
  provider        text not null,            -- qwen | moonshot | anthropic | openai
  model           text not null,
  license_class   text not null
                  check (license_class in ('open_weight','restricted')),
  input_tokens    int not null default 0,
  output_tokens   int not null default 0,
  cost_usd        numeric(12,6) not null default 0,
  cache_hit       boolean not null default false,
  ground_hit      boolean not null default false,
  latency_ms      int,
  created_at      timestamptz not null default now()
);
create index if not exists usage_account_time_idx on usage_events(account_id, created_at desc);
create index if not exists usage_license_idx on usage_events(license_class, created_at desc);

-- Conversation log. Mind training candidates come from here, filtered
-- to license_class = 'open_weight' only.
create table if not exists conversations (
  id            uuid primary key default gen_random_uuid(),
  account_id    uuid not null references accounts(id) on delete cascade,
  request_id    text not null,
  language      text,                       -- sn | nd | en | mixed
  messages      jsonb not null,
  response      text,
  citations     jsonb,
  teacher_model text,
  license_class text not null
                check (license_class in ('open_weight','restricted')),
  mind_eligible boolean generated always as (license_class = 'open_weight') stored,
  created_at    timestamptz not null default now()
);
create index if not exists conv_mind_idx on conversations(mind_eligible, created_at desc);

-- ---------------------------------------------------------------
-- Shamwari Ground — retrieval corpus
--   Lives in Postgres so it can be deployed inside a customer's
--   own infrastructure for the Sovereign tier.
-- ---------------------------------------------------------------

create table if not exists ground_sources (
  id            uuid primary key default gen_random_uuid(),
  slug          text not null unique,       -- 'constitution-2013', 'zimra-paye-2026'
  title         text not null,
  authority     text not null,              -- 'Parliament of Zimbabwe', 'ZIMRA', 'RBZ'
  doc_type      text not null,              -- act | si | policy | tariff | guideline | statistic
  jurisdiction  text not null default 'ZW',
  source_url    text,
  license_note  text not null,              -- reuse basis. Never null. Never guessed.
  effective_from date,
  superseded_by uuid references ground_sources(id),
  last_checked_at timestamptz,
  created_at    timestamptz not null default now()
);

-- 1024 dims matches bge-m3. Change if you change embedding models.
create table if not exists ground_chunks (
  id          bigserial primary key,
  source_id   uuid not null references ground_sources(id) on delete cascade,
  ordinal     int not null,
  heading     text,                          -- 'Section 56', 'Part IV'
  content     text not null,
  token_count int,
  embedding   vector(1024),
  created_at  timestamptz not null default now()
);
create index if not exists ground_chunks_source_idx on ground_chunks(source_id, ordinal);
create index if not exists ground_chunks_vec_idx
  on ground_chunks using hnsw (embedding vector_cosine_ops);

-- Queries Ground could not answer. This is the corpus roadmap,
-- written by paying customers instead of by guesswork.
create table if not exists ground_misses (
  id          bigserial primary key,
  account_id  uuid references accounts(id) on delete set null,
  query       text not null,
  language    text,
  best_score  real,
  created_at  timestamptz not null default now()
);

-- ---------------------------------------------------------------
-- Retrieval function. Called by the Worker over RPC so the vector
-- query stays in the database.
-- ---------------------------------------------------------------

create or replace function ground_search(
  query_embedding vector(1024),
  match_count int default 6,
  min_score real default 0.30
)
returns table (
  chunk_id    bigint,
  content     text,
  heading     text,
  title       text,
  authority   text,
  doc_type    text,
  source_url  text,
  effective_from date,
  score       real
)
language sql stable
as $$
  select
    c.id,
    c.content,
    c.heading,
    s.title,
    s.authority,
    s.doc_type,
    s.source_url,
    s.effective_from,
    (1 - (c.embedding <=> query_embedding))::real as score
  from ground_chunks c
  join ground_sources s on s.id = c.source_id
  where s.superseded_by is null                       -- never cite repealed law
    and (1 - (c.embedding <=> query_embedding)) > min_score
  order by c.embedding <=> query_embedding
  limit match_count;
$$;

-- ---------------------------------------------------------------
-- RLS: the Worker uses the service role, so lock everything down
-- and let the Worker be the only path in.
-- ---------------------------------------------------------------

alter table accounts      enable row level security;
alter table api_keys      enable row level security;
alter table usage_events  enable row level security;
alter table conversations enable row level security;
alter table ground_misses enable row level security;
-- ground_sources / ground_chunks left readable for a future public
-- corpus browser. Add policies when that ships.
