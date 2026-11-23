-- Ground on Supabase with pgvector (owner, 2026-11-23: "build core on supabase for now, use pgvector").
--
-- Replaces Core's /ground/search (Fly + the Nyuchi API + Mongo knowledgeBase, which was never filled) with
-- functions in the Shamwari database. Applied to project shamwari_ai_db as migrations `ground_pgvector`, `ground_search_functions`,
-- `ground_search_public_key_platform_only` and `ground_caller_is_service_claims_only`; this file is their final state.
--
--   ground.chunks                 the embedded Ground passages (bge-m3, 1024 dims), in a schema the
--                                 REST API does not expose: nothing reads the table directly.
--   ground.needs_own_information  Core's personal.py rules, ported. All 36 cases in core/scope_cases.json
--                                 (the ones Core and the gateway run) agreed on the live database, 2026-11-23.
--   public.ground_search          what the gateway calls. Makes Core's Rule 1 checks itself, before it
--                                 reads anything, then hybrid search (vector + full text, reciprocal rank
--                                 fusion). Answers in Core's /ground/search shape. With the publishable key it
--                                 reads platform passages only; community passages need the secret key.
--   public.ground_ingest          writes chunks. Secret key (service_role) only.
--
-- Refusals are raised with SQLSTATE PTnnn, which the REST API returns as HTTP nnn, and the error code in
-- the message, so the gateway reads them the way it read Core's.

create extension if not exists vector with schema extensions;

create schema if not exists ground;
revoke all on schema ground from public, anon, authenticated;

create table if not exists ground.chunks (
  id              uuid primary key default gen_random_uuid(),
  document_id     uuid references public.documents(id) on delete set null,
  slug            text not null,
  chunk_index     integer not null,
  title           text not null,
  heading         text,
  citation        text,
  authority       text not null default '',
  resource_type   text not null default '',
  source_url      text,
  effective_from  date,
  language        text not null default 'en',
  scope           text not null default 'platform' check (scope in ('platform', 'community')),
  owner_entity_id text,
  content         text not null,
  embedding       extensions.vector(1024) not null,
  fts             tsvector generated always as (
                    to_tsvector('simple', coalesce(title, '') || ' ' || coalesce(heading, '') || ' ' || content)
                  ) stored,
  chunker         text not null,
  mind_eligible   boolean not null default false,
  is_active       boolean not null default true,
  superseded_by   uuid,
  created_at      timestamptz not null default now(),
  unique (slug, chunk_index),
  -- Community passages belong to someone; platform passages to no one.
  check ((scope = 'platform') = (owner_entity_id is null))
);

create index if not exists chunks_embedding_hnsw on ground.chunks
  using hnsw (embedding extensions.vector_cosine_ops) where is_active;
create index if not exists chunks_fts on ground.chunks using gin (fts);
create index if not exists chunks_slug on ground.chunks (slug) where is_active;

alter table ground.chunks enable row level security;
revoke all on all tables in schema ground from public, anon, authenticated;

-- RULE 1's second check, in the database. A port of core/personal.py (and gateway/src/personal.ts): a
-- question that needs the person's own information is personal scope, and must not be embedded by the
-- caller. Same normalisation (NFKC, zero-width characters, curly apostrophes, whitespace, case) and the
-- same rules, word-bounded the same way.
create or replace function ground.needs_own_information(p_text text)
returns boolean
language sql
immutable
parallel safe
set search_path = ''
as $fn$
  with t as (
    select regexp_replace(
             regexp_replace(
               regexp_replace(normalize(coalesce(p_text, ''), NFKC), $re$[​-‍⁠﻿]$re$, '', 'g'),
               $re$[‘’ʼ`]$re$, '''', 'g'),
             $re$\s+$re$, ' ', 'g') as raw
  ), n as (select lower(raw) as s from t)
  select
    -- English: possessives and first-person contractions.
    s ~ $re$(?<!\w)(?:my|mine|myself|our|ours|ourselves|i'm|i've|i'll|i'd|im|ive)(?!\w)$re$
    -- English: "I" followed by something about the speaker's own situation.
    or s ~ $re$(?<!\w)(?:i (?:am|was|own|owe|earn|paid|pay|receive|received|lost|bought|sold|saved|spent|uploaded))(?!\w)$re$
    -- English: a first-person verb near a number or currency.
    or s ~ $re$(?<!\w)(?:i (?:have|had|get|got|make|made|need) [^.?!]{0,20}?(?:\$|\d))(?!\w)$re$
    or s ~ $re$(?<!\w)(?:i get paid|i work (?:at|for|as))(?!\w)$re$
    or s ~ $re$(?<!\w)(?:(?:about|for|to|on|with|from) me)(?!\w)$re$
    -- English: things only the person holds.
    or s ~ $re$(?<!\w)(?:payslips?|bank statements?|medical records?)(?!\w)$re$
    -- Shona: possessive -ngu and "ini".
    or s ~ $re$(?<!\w)(?:(?:w|y|dz|ch|zv|r|v|kw|p|rw|tw|bw|sw)angu|ini)(?!\w)$re$
    -- Shona: first-person verbs.
    or s ~ $re$(?<!\w)(?:ndiri|ndine|nda[ck]a\w*|ndichi\w*|ndino\w*|ndiku\w*)(?!\w)$re$
    -- Ndebele: possessive -mi and "mina".
    or s ~ $re$(?<!\w)(?:(?:w|y|l|z|s|b|kw)ami|mina)(?!\w)$re$
    -- Ndebele: first-person verbs.
    or s ~ $re$(?<!\w)(?:ngine|ngikhokhile|ngisebenza|ngihlala|ngiyakhokha)(?!\w)$re$
  from n;
$fn$;

-- The publishable key reads platform passages only. Community passages belong to an owner, and an
-- owner_entity_id sent with the public key is not verified, so community scope needs the secret key
-- (service_role), which only the gateway holds after it has verified the caller. Only the request's claims count:
-- no login-name escape hatch, which could not be tested through the API.
create or replace function ground.caller_is_service()
returns boolean
language sql
stable
set search_path = ''
as $fn$
  select coalesce(nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role', '') = 'service_role';
$fn$;

create or replace function ground.guard_scope(p_scope text)
returns void
language plpgsql
stable
set search_path = ''
as $fn$
begin
  if p_scope = 'community' and not ground.caller_is_service() then
    raise exception 'scope_not_granted' using errcode = 'PT403',
      detail = 'Community passages need the secret key: the public key reads platform passages only.';
  end if;
end;
$fn$;

create or replace function public.ground_search(
  p_query                 text,
  p_embedding             extensions.vector(1024) default null,
  p_scope                 text default 'platform',
  p_destination           text default 'cloud',
  p_owner_entity_id       text default null,
  p_language              text default null,
  p_top_k                 integer default 5,
  p_needs_own_information boolean default false,
  p_granted_scopes        text[] default null
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $fn$
declare
  v_k      integer := least(greatest(coalesce(p_top_k, 5), 1), 20);
  v_needs  boolean;
  v_chunks jsonb;
begin
  if p_scope is null or p_scope not in ('platform', 'community', 'personal') then
    raise exception 'invalid_scope' using errcode = 'PT400', detail = 'scope must be platform, community or personal';
  end if;
  if p_destination is null or p_destination not in ('cloud', 'mind') then
    raise exception 'invalid_destination' using errcode = 'PT400', detail = 'destination must be cloud or mind';
  end if;

  -- RULE 1 (Core's resolve_scope): personal data is not sent to a cloud destination, and it is refused,
  -- not silently downgraded.
  if p_destination = 'cloud' and p_scope not in ('platform', 'community') then
    raise exception 'scope_requires_local_inference' using errcode = 'PT409',
      detail = 'Personal-layer data cannot be sent to an external provider. Route this request to Shamwari Mind on-device.';
  end if;

  perform ground.guard_scope(p_scope);
  -- A key may only ask for what it holds.
  if p_granted_scopes is not null and not (p_scope = any (p_granted_scopes)) then
    raise exception 'scope_not_granted' using errcode = 'PT403', detail = 'This key does not hold the scope it asked for.';
  end if;

  -- RULE 1, in the leak path: embedding is inference. A mind-destination query, or a question that needs
  -- the person's own information, must not arrive already embedded. Refused, not discarded, so a caller
  -- that has already leaked is seen.
  if p_destination = 'mind' and p_embedding is not null then
    raise exception 'edge_embedding_forbidden' using errcode = 'PT409',
      detail = 'A mind-destination query must not be embedded by the caller.';
  end if;
  v_needs := coalesce(p_needs_own_information, false) or ground.needs_own_information(p_query);
  if p_embedding is not null and v_needs then
    raise exception 'edge_embedding_forbidden' using errcode = 'PT409',
      detail = 'A question that needs the person''s own information must not be embedded by the caller.';
  end if;

  if p_scope = 'community' and p_owner_entity_id is null then
    raise exception 'owner_required' using errcode = 'PT400', detail = 'community scope needs owner_entity_id';
  end if;

  with eligible as (
    select c.* from ground.chunks c
    where c.is_active
      and c.scope = p_scope
      and (p_scope = 'platform' or c.owner_entity_id = p_owner_entity_id)
  ),
  vec as (
    select e.id, row_number() over (order by e.embedding operator(extensions.<=>) p_embedding) as r
    from eligible e
    where p_embedding is not null
    order by e.embedding operator(extensions.<=>) p_embedding
    limit 40
  ),
  q as (select websearch_to_tsquery('simple', coalesce(p_query, '')) as tq),
  lex as (
    select e.id, row_number() over (order by ts_rank_cd(e.fts, q.tq) desc) as r
    from eligible e, q
    where e.fts @@ q.tq
    order by ts_rank_cd(e.fts, q.tq) desc
    limit 40
  ),
  fused as (
    select id, sum(1.0 / (60 + r)) as score
    from (select id, r from vec union all select id, r from lex) u
    group by id
    order by score desc
    limit v_k
  )
  select coalesce(jsonb_agg(jsonb_build_object(
           'content', c.content,
           'heading', c.heading,
           'title', c.title,
           'citation', c.citation,
           'authority', c.authority,
           'resource_type', c.resource_type,
           'source_url', c.source_url,
           'effective_from', c.effective_from,
           'language', c.language,
           'scope', c.scope
         ) order by f.score desc), '[]'::jsonb)
    into v_chunks
  from fused f join ground.chunks c on c.id = f.id;

  return jsonb_build_object(
    'scope', p_scope,
    'hit', jsonb_array_length(v_chunks) > 0,
    'chunks', v_chunks,
    'needs_own_information', v_needs
  );
end;
$fn$;

-- Writes a batch of embedded chunks for one slug. With p_replace, the slug's earlier chunks are
-- deactivated in the same transaction (kept for the audit trail, never searched again).
create or replace function public.ground_ingest(p_rows jsonb, p_replace boolean default false)
returns integer
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_slugs text[];
  v_count integer;
begin
  if jsonb_typeof(p_rows) <> 'array' or jsonb_array_length(p_rows) = 0 then
    raise exception 'rows_required' using errcode = 'PT400';
  end if;
  select array_agg(distinct r->>'slug') into v_slugs from jsonb_array_elements(p_rows) r;
  if p_replace then
    update ground.chunks set is_active = false where slug = any (v_slugs) and is_active;
  end if;
  insert into ground.chunks (document_id, slug, chunk_index, title, heading, citation, authority, resource_type,
                             source_url, effective_from, language, scope, owner_entity_id, content, embedding,
                             chunker, mind_eligible)
  select nullif(r->>'document_id', '')::uuid, r->>'slug', (r->>'chunk_index')::integer, r->>'title', r->>'heading',
         r->>'citation', coalesce(r->>'authority', ''), coalesce(r->>'resource_type', ''), r->>'source_url',
         nullif(r->>'effective_from', '')::date, coalesce(r->>'language', 'en'), coalesce(r->>'scope', 'platform'),
         r->>'owner_entity_id', r->>'content', (r->'embedding')::text::extensions.vector(1024),
         r->>'chunker', coalesce((r->>'mind_eligible')::boolean, false)
  from jsonb_array_elements(p_rows) r
  on conflict (slug, chunk_index) do update set
    title = excluded.title, heading = excluded.heading, citation = excluded.citation, authority = excluded.authority,
    resource_type = excluded.resource_type, source_url = excluded.source_url, effective_from = excluded.effective_from,
    language = excluded.language, content = excluded.content, embedding = excluded.embedding,
    chunker = excluded.chunker, mind_eligible = excluded.mind_eligible, is_active = true, document_id = excluded.document_id;
  get diagnostics v_count = row_count;
  return v_count;
end;
$fn$;

revoke all on function ground.needs_own_information(text) from public, anon, authenticated;
revoke all on function ground.caller_is_service() from public, anon, authenticated;
revoke all on function ground.guard_scope(text) from public, anon, authenticated;
revoke all on function public.ground_search(text, extensions.vector, text, text, text, text, integer, boolean, text[]) from public;
grant execute on function public.ground_search(text, extensions.vector, text, text, text, text, integer, boolean, text[])
  to anon, service_role;
revoke all on function public.ground_ingest(jsonb, boolean) from public, anon, authenticated;
grant execute on function public.ground_ingest(jsonb, boolean) to service_role;
