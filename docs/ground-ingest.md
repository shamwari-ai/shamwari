# Ground ingest: the Constitution, and how to add the next source

Tracking: #17. Code: `core/ingest_ground.py`, `core/eval_ground.py`.
Nothing here fetches a source. You supply a text file; the script chunks it,
embeds it and writes it. That keeps the licence decision with you.

## Where the Constitution text comes from

Checked 2026-10-31. **No source's terms were read or confirmed by the build
session, and no text is committed to this repo.**

| Source                                                                                    | Status                                                                                                                                                                                          |
| ----------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Parliament of Zimbabwe, `parlzim.gov.zw/constitution-of-zimbabwe/` (the Act's PDF, ~3 MB) | **Use this.** The primary publisher. The page is behind a bot challenge for scripts, which I did not work around: download it in a browser, and read the site's terms of use before you ingest. |
| ZimLII (`zimlii.org`)                                                                     | **Blocked** until its terms are read (`CLAUDE.md`). Its copy is also the consolidated text including the 2017 amendment.                                                                        |
| Veritas Zimbabwe                                                                          | **Blocked**: partnership first. Not used.                                                                                                                                                       |
| Wikisource                                                                                | Incomplete (only the first pages of the scan are transcribed). Not used.                                                                                                                        |
| WIPO Lex, ILO NATLEX                                                                      | Could not be retrieved by script (bot challenge or HTML in place of the PDF). Not used.                                                                                                         |
| ZIMSEC                                                                                    | **Never.** Licence agreement required.                                                                                                                                                          |

Recording the licence: the `corpus_sources.license` value for "Constitution of
Zimbabwe" is what `run_ingest` copies into the audit record. Set it to what you
actually found (publisher, page, date read) before you ingest.

### Turn the PDF into text

```bash
pdftotext -layout Constitution-of-Zimbabwe-Amendment_No_20_-_14-05-2013.pdf constitution-2013.txt
```

Keep the file outside the repo (`.gitignore` does not cover it). Then look at
what the chunker will cite, with no credentials and no network:

```bash
cd core
python ingest_ground.py --dry-run --file ../constitution-2013.txt \
  --cite-as "Constitution of Zimbabwe (2013)"
```

Check that the sections run in order from `s 1` with no gaps, that the Declaration
of Rights cites as `s 4x`-`s 8x`, and that the schedules cite as
`First Schedule, para N` and so on. If the layout
of your conversion differs and a heading is missed, the section is merged into the
one before it: that shows up here, before anything is written.

### The text is the 2013 enactment, not today's law

`Amendment (No. 20) Act 2013` is what the owner approved. The Constitution has been
amended since (Amendment No. 1 of 2017, No. 2 of 2021) and Parliament's site lists a
2026 Amendment Bill. Every chunk is stamped `effectiveFrom: 2013-05-22`, and the
evaluation questions avoid the provisions those amendments touched, but **an answer
that turns on a provision amended after 2013 can be out of date**. To add an
amendment, ingest it as its own document with its own `--slug` and
`--effective-from`; to retire superseded text use `--replace` on the old slug (soft:
`isActive=false`, `supersededBy` set, nothing deleted). Answers must never present
the 2013 text as current without that caveat; the system prompt already tells the
model to say where a figure must be verified.

## Ingest

Credentials live in your own shell, never on the Core Fly app:

```bash
export SUPABASE_DB_URL=...   # from your secret manager
export MONGODB_URI=...
export CF_ACCOUNT_ID=...
export CF_API_TOKEN=...      # Workers AI read only
```

```bash
cd core
python ingest_ground.py --source "Constitution of Zimbabwe" \
  --file ../constitution-2013.txt \
  --title "Constitution of Zimbabwe Amendment (No. 20) Act 2013" \
  --slug constitution-2013 --effective-from 2013-05-22 --dataset zw-law-v1
```

What it refuses, and does not warn and continue past:

- A source that is not `is_approved` and `ground_eligible` (exit before any embedding).
- A wrong vector size (not 1024): nothing is written, anywhere.
- A `--slug` that already has active chunks: it stops. `--replace` writes the new
  text first and retires the old second, so a failure leaves the old text serving.

All embedding happens before the first write, so a failure part-way leaves no
half-ingested document.

## Prove it works: the citation evaluation

```bash
cd core
python eval_ground.py --fixture                       # offline; synthetic corpus
python eval_ground.py --verify-labels --text ../constitution-2013.txt   # run this ONCE
python eval_ground.py --text ../constitution-2013.txt  # your text, keyword baseline
SHAMWARI_CORE_TOKEN=... python eval_ground.py --core-url https://shamwari-core.fly.dev --k 6
```

34 questions, each with the section numbers that count as a correct citation. The
score is hit-rate at 1, 3 and k plus mean reciprocal rank.

- **`--verify-labels` first.** The labels were written from the 2013 text, not
  checked against your file. The command checks every expected section exists and
  contains its evidence phrase, and names the ones that do not. Fix the label, not
  the retriever, when a label is wrong.
- **`--fixture`** runs in CI as the offline regression gate (hit@6 must be 1.0). It
  proves the harness and the chunker's citations, and says nothing about retrieval
  quality on the real law.
- **`--text`** is the keyword floor on the real text. The real store should beat it.
- **`--core-url`** is the number that matters: the real store through Core, platform
  scope. With `CF_ACCOUNT_ID` and `CF_API_TOKEN` set it embeds each question as the
  Worker does; without them it scores the keyword half and says so.

Record the first real score and keep it: `--baseline` fails a run that scores below
a JSON file of accepted numbers, so every later corpus, chunker, model or index
change is compared against it.

## Rollback

Soft only: re-run with `--replace` and the corrected file, or set `isActive` to
false on a slug in Atlas (owner action). Nothing in the repo deletes a chunk.

## The end-to-end contract test

`scripts/e2e.sh` runs the real Worker code (`gateway/test/e2e.test.ts`) against a real
Core process (`core/e2e_app.py`: Core's own app over an in-memory store holding the
fixture corpus and one chunk that must never be served), with a fake model that
answers from the system prompt it is sent. It runs in CI and needs no network or
credentials. It proves:

- A platform-scope question comes back with `s 56 Equality and non-discrimination`,
  the authority and the effective date in the response, and the same section in the
  prompt the model saw.
- Another entity's chunk that matches the question exactly is never served.
- A personal-scope request is a 409 `scope_requires_local_inference` with **zero**
  provider calls, **zero** embedding calls, zero store reads and zero queue messages,
  including when `MIND_AVAILABLE` is `true`. `/v1/ground/context` with Mind available
  retrieves without embedding the question at the edge.
- Core refuses the same requests on its own, without the Worker's help.
- `licenseClass` and `trainingEligible` are stamped from the model that actually
  served: an open-weight model is trainable, a substituted unlisted one is
  `restricted` and not, and Core independently refuses a restricted row marked
  trainable.

Each guard was checked by breaking it. It uses a fake store and a fake model, so it
says nothing about Atlas scoring or a real model's wording.

**Found while writing it:** with a question vector, `$vectorSearch` returns the nearest
chunks however irrelevant, so an off-topic question is still "grounded" and is handed
unrelated sections to cite (`it.todo` in the test). Core has no relevance floor; setting
one needs real Atlas scores, so it is left for the first real-store evaluation.
