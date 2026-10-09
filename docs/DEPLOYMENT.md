# Deployment

## Docker Compose
```bash
cp .env.example .env   # compila, con INGLY_COOKIE_SECURE=true e INGLY_ENV=production
docker compose up -d --build
docker compose exec web python -m ingly create-user tua@email.it --role admin
```
Servizi: `db` (PostgreSQL 16 con pgvector, immagine `pgvector/pgvector:pg16`), `web` (applica le migrazioni
e avvia API + dashboard), `worker` (job). Imposta `POSTGRES_PASSWORD` in `.env`.
Esponi `web` solo dietro un reverse proxy con HTTPS (Caddy, nginx, Traefik).

### Esempio Caddy
```
agent.tuodominio.it {
    reverse_proxy 127.0.0.1:8000
}
```

## Senza Docker (systemd)
Due unit: `python -m ingly serve --host 127.0.0.1 --port 8000` e `python -m ingly worker`,
con `EnvironmentFile=/etc/ingly.env` e utente di sistema dedicato.

## Checklist produzione
- [ ] HTTPS attivo e `INGLY_COOKIE_SECURE=true`
- [ ] `INGLY_TOKEN_ENCRYPTION_KEY` salvata in un secret manager (se la perdi i token vanno ricollegati)
- [ ] `.env` con permessi 600, mai in Git
- [ ] backup giornaliero: `docker compose exec web python -m ingly backup /data/ingly-$(date +%F).dump`
      (usa `pg_dump`), copiato fuori dal server; prova di ripristino con `python -m ingly restore <file>`
- [ ] worker attivo (senza worker niente crawling, polling, retention, controllo token)
- [ ] webhook Meta puntati su `https://dominio/webhooks/meta`
- [ ] retention lead impostata e informativa privacy pubblicata sul sito INGLY

## Scalabilità
Con PostgreSQL più worker possono girare insieme: i job sono prelevati con `FOR UPDATE SKIP LOCKED`.
SQLite è adatto solo a sviluppo e prove (un'istanza web + un worker).
