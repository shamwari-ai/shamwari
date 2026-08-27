-- ============================================================
-- REFERENCE ONLY — DO NOT RUN
-- An earlier draft. The live schema was applied via Supabase
-- migrations and differs from this file. See CLAUDE.md.
-- Read the live schema before changing anything.
-- ============================================================

-- Shamwari — Postgres additions for the split datastore
-- Run AFTER schema.sql. Idempotent.
--
-- Postgres now holds: accounts, api_keys, Ground corpus, and the
-- CURATED training set. MongoDB holds conversations and usage events.
--
-- Drop the conversations and usage_events tables only once the Mongo
-- sink is confirmed working end to end. Keep them until then.

-- ---------------------------------------------------------------
-- Curated training corpus for Shamwari Mind
-- ---------------------------------------------------------------

create table if not exists training_examples (
  id              uuid primary key default gen_random_uuid(),

  -- Provenance. Non-negotiable, non-nullable.
  source          text not null
                  check (source in ('conversation','synthetic','human_authored','corpus_derived')),
  source_ref      text,                      -- Mongo _id, or Ground source slug
  teacher_model   text,                      -- 'moonshot/kimi-k3', 'qwen/qwen3-32b-instruct'
  license_class   text not null default 'open_weight'
                  check (license_class = 'open_weight'),
  -- The CHECK is the enforcement. A restricted row cannot physically
  -- enter this table. Anthropic and OpenAI terms bar using their outputs
  -- to train competing models; this makes that a schema constraint
  -- rather than something a person has to remember.

  language        text not null              -- sn | nd | en | sn-en | nd-en
                  check (language in ('sn','nd','en','sn-en','nd-en')),
  domain          text not null,             -- law | tax | agriculture | health | education | general
  prompt          text not null,
  completion      text not null,
  grounded_on     uuid[] default '{}',       -- ground_sources.id referenced

  -- Annotation
  status          text not null default 'pending'
                  check (status in ('pending','approved','rejected','needs_edit')),
  annotator_id    uuid,
  annotator_note  text,
  quality_score   smallint check (quality_score between 1 and 5),
  reviewed_at     timestamptz,

  -- Set membership
  split           text check (split in ('train','eval','holdout')),
  dataset_version text,                      -- 'mind-v0.1'

  created_at      timestamptz not null default now()
);

create index if not exists te_status_idx   on training_examples(status, created_at desc);
create index if not exists te_release_idx  on training_examples(dataset_version, split)
  where status = 'approved';
create index if not exists te_lang_dom_idx on training_examples(language, domain)
  where status = 'approved';

-- Which Mongo documents have already been pulled across. Prevents
-- double-promotion when the promotion job reruns.
create table if not exists promotion_log (
  mongo_id     text primary key,
  promoted_at  timestamptz not null default now(),
  outcome      text not null
               check (outcome in ('promoted','skipped_restricted','skipped_low_signal','skipped_duplicate'))
);

-- Annotators. Paid work, tracked properly.
create table if not exists annotators (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  email       text unique,
  languages   text[] not null default '{}',
  domains     text[] not null default '{}',
  active      boolean not null default true,
  created_at  timestamptz not null default now()
);

-- ---------------------------------------------------------------
-- Release view. This is what the training pipeline reads.
-- It cannot return a restricted example, because one cannot exist.
-- ---------------------------------------------------------------

create or replace view mind_training_set as
select
  id, language, domain, prompt, completion,
  teacher_model, dataset_version, split, quality_score
from training_examples
where status = 'approved'
  and license_class = 'open_weight'
  and split is not null;

-- Corpus coverage — what to annotate next.
create or replace view annotation_gaps as
select
  language,
  domain,
  count(*) filter (where status = 'approved') as approved,
  count(*) filter (where status = 'pending')  as pending
from training_examples
group by language, domain
order by approved asc;

alter table training_examples enable row level security;
alter table annotators        enable row level security;
alter table promotion_log     enable row level security;
