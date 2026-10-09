FROM python:3.11-slim
WORKDIR /app
# client PostgreSQL per pg_dump / pg_restore (backup)
RUN apt-get update && apt-get install -y --no-install-recommends postgresql-client && rm -rf /var/lib/apt/lists/*
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY ingly ./ingly
COPY knowledge ./knowledge
COPY evals ./evals
RUN useradd -r -u 10001 ingly && mkdir -p /data && chown ingly /data
USER ingly
ENV INGLY_DATABASE_PATH=/data/ingly.db
EXPOSE 8000
CMD ["python", "-m", "ingly", "serve", "--host", "0.0.0.0", "--port", "8000"]
