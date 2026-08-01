# Mealer Monorepo

Repository mono-repo con due applicazioni separate:

- frontend/: app Angular
- backend/: API NestJS (proxy Grocy + SQLite)

## Requisiti

- Node.js 22+
- npm 11+

## Installazione dipendenze (workspace)

```bash
npm install
```

## Avvio sviluppo

Backend:

```bash
npm run start:backend
```

Frontend:

```bash
npm run start:frontend
```

## Build e test

```bash
npm run build
npm run test
```

## Docker produzione

Vedi docker-compose.yml alla root e backend/Dockerfile.prod.

## GitHub Actions (monorepo)

Le workflow sono alla root in `.github/workflows`:

- `docker-frontend-multiarch.yml`: build/publish immagine frontend (`frontend/**`)
- `docker-backend-multiarch.yml`: build/publish immagine backend (`backend/**`)

Entrambe pubblicano su GHCR immagini multi-arch (`linux/amd64`, `linux/arm64`) e usano trigger `paths` per eseguire solo quando cambia la rispettiva app.
