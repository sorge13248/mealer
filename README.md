# Mealer Monorepo

Repository mono-repo con due applicazioni separate:

- frontend/: app Angular
- backend/: API NestJS (proxy Grocy + SQLite)
- ocr/: microservizio OCR self-hosted (PaddleOCR + FastAPI)

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

OCR service (self-hosted, no Docker):

```bash
npm run start:ocr
```

Il servizio usa l'interprete Python disponibile sul sistema e seleziona automaticamente
l'engine OCR:

- `paddle` se PaddleOCR e installabile/disponibile
- fallback `tesseract` tramite `pytesseract` in caso contrario

Puoi forzare l'engine con `OCR_ENGINE`:

```bash
OCR_ENGINE=tesseract npm run start:ocr
```

Shortcut npm:

```bash
npm run start:ocr:tesseract
npm run start:ocr:paddle
```

Per forzare un interprete specifico puoi usare `OCR_PYTHON_CMD`:

```bash
OCR_PYTHON_CMD=python3.11 npm run start:ocr
```

Shortcut opzionale dedicato Python 3.11:

```bash
npm run start:ocr:py311
```

Check rapido setup OCR locale:

```bash
npm run check:ocr
```

Check opzionale con Python 3.11:

```bash
npm run check:ocr:py311
```

## Build e test

```bash
npm run build
npm run test
```

## Docker produzione

Lo stack di produzione usa una singola immagine `mealer-app` (frontend Angular statico + backend NestJS) servita da Nginx con reverse proxy API su `/api`.

Vedi `docker-compose.yml` e `Dockerfile` alla root.

Lo stack ora include anche `ocr` (container `mealer-ocr`) usato dal backend come provider OCR locale primario, con fallback automatico a Tesseract interno backend.

Il frontend Angular carica `/config.json` a runtime.
Con `docker-compose` il file viene montato da `./config.json` verso `/usr/share/nginx/html/config.json`, quindi puoi cambiare le impostazioni senza rebuild dell'immagine.

## GitHub Actions (monorepo)

Le workflow sono alla root in `.github/workflows`:

- `docker-app-multiarch.yml`: build/publish immagine app unificata (`backend/**`, `frontend/**`, `Dockerfile`, `deploy/**`)
- `docker-ocr-multiarch.yml`: build/publish immagine OCR service (`ocr/**`)

Entrambe pubblicano su GHCR immagini multi-arch (`linux/amd64`, `linux/arm64`) e usano trigger `paths` per eseguire solo quando cambia la rispettiva app.
