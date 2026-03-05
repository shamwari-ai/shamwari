FROM python:3.11-slim AS base

WORKDIR /app

# Install only production dependencies
COPY pyproject.toml README.md ./
RUN pip install --no-cache-dir .

# Copy application source
COPY src/ src/

EXPOSE 8000

CMD ["uvicorn", "src.main:app", "--host", "0.0.0.0", "--port", "8000"]
