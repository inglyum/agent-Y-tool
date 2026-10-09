# Deployment

## Docker Compose
```bash
cp .env.example .env   # compila, con INGLY_COOKIE_SECURE=true e INGLY_ENV=production
docker compose up -d --build
docker compose exec web python -m ingly create-user tua@email.it --role admin
```
`web` (API + dashboard) e `worker` (job) condividono il volume `/data` con il database SQLite.
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
- [ ] backup giornaliero: `python -m ingly backup /backup/ingly-$(date +%F).db` (cron) e prova di ripristino
- [ ] worker attivo (senza worker niente crawling, polling, retention, controllo token)
- [ ] webhook Meta puntati su `https://dominio/webhooks/meta`
- [ ] retention lead impostata e informativa privacy pubblicata sul sito INGLY

## Scalabilità
SQLite in WAL regge un'istanza web + un worker con il volume di una piccola attività. Per più worker
o più istanze, migra a PostgreSQL: lo schema è SQL standard tranne la tabella FTS5 (sostituibile con
`tsvector` o un motore di ricerca dedicato).
