# Shamwari Core, interim Python deploy on Fly. The lock is resolved for
# CPython 3.11 on Linux (see requirements.in), so the base image matches it.
FROM python:3.11-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1

WORKDIR /app

# Hash-pinned install: pip refuses anything the lock does not describe.
COPY requirements.txt .
RUN pip install --require-hashes -r requirements.txt

COPY main.py replay.py telemetry.py usage_event_fields.json ingest_ground.py ./

# Not root: Core holds database credentials and enforces rule 1.
RUN useradd --system --uid 10001 --no-create-home core
USER core

EXPOSE 8000
CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8000", "--proxy-headers", "--forwarded-allow-ips", "*"]
