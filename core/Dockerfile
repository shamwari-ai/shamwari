# Shamwari Core, interim Python deploy on Fly. The lock is resolved for
# CPython 3.11 on Linux (see requirements.in), so the base image matches it.
# Pinned by digest (the multi-arch index, read from Docker Hub on 2026-10-29) so a
# retagged image cannot change what we deploy. Move it deliberately, with the
# tag it came from, never by deleting the digest.
FROM python:3.11-slim@sha256:673719e071ecf27434fd2635bbd8d00f49f4fdd81f243143438a42ced8bedf60

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1

WORKDIR /app

# Hash-pinned install: pip refuses anything the lock does not describe.
COPY requirements.txt .
RUN pip install --require-hashes -r requirements.txt

# ingest_ground.py is deliberately NOT here: it reads database and Cloudflare
# credentials Core must never be given, and it runs from the operator's shell.
COPY main.py nyuchi_api.py ./

# Not root: Core enforces rule 1 and holds the data API key.
RUN useradd --system --uid 10001 --no-create-home core
USER core

EXPOSE 8000
CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8000", "--proxy-headers", "--forwarded-allow-ips", "*"]
