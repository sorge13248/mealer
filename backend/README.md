# Mealer Backend (NestJS)

API NestJS per integrazione Grocy, gestione scontrini e insight spesa.

## Cosa fa il backend

- Proxy sicuro verso Grocy (`/grocy/*`) con API key gestita lato server
- Endpoint per lettura/modifica prodotti Grocy e userfields
- Proxy immagini prodotto Grocy
- Redirect a pagine Grocy utili dal frontend
- Parsing scontrini PDF/foto (`/spesa/receipt/parse`)
- Matching prodotti con storico mapping (`/spesa/match/candidates`, `/spesa/mappings`)
- Persistenza scontrini e serie storica prezzi (`/spesa/receipt/save`)
- Insight spesa con aggregazioni temporali (`/spesa/insights`)

## Moduli principali

- `src/grocy`: proxy Grocy
- `src/spesa`: parsing, matching, persistenza e insight
- `src/spesa/receipt-parsers`: parser PDF/foto e orchestrazione OCR

## Endpoint principali

Grocy:

- `GET /grocy/products`
- `GET /grocy/stock`
- `GET /grocy/stock/volatile`
- `POST /grocy/stock/products/:productId/consume`
- `PUT /grocy/objects/:entity/:objectId`
- `PUT /grocy/userfields/:entity/:objectId`
- `GET /grocy/files/productpictures/:encodedFileName`
- `GET /grocy/product/:productId` (redirect)
- `GET /grocy/products-page` (redirect)
- `GET /grocy/product-new-page` (redirect)

Spesa:

- `POST /spesa/receipt/parse`
- `POST /spesa/match/candidates`
- `POST /spesa/mappings`
- `POST /spesa/receipt/save`
- `GET /spesa/receipts?page=1&pageSize=10`
- `GET /spesa/receipts/:receiptId`
- `DELETE /spesa/receipts/:receiptId`
- `GET /spesa/insights?days=180&productIds=1,2,3`

## OCR self-hosted

Il backend usa una pipeline OCR locale con fallback:

- orchestratore: `ReceiptOcrEngineService`
- provider primario: HTTP self-hosted (`selfhosted-http`)
- fallback: Tesseract locale (`tesseract`)

Variabili OCR:

- `OCR_PROVIDER_ORDER` (default: `selfhosted-http,tesseract`)
- `OCR_HTTP_ENABLED` (default: `true`)
- `OCR_HTTP_URL` (default: `http://mealer-ocr:8000/ocr/receipt/base64`)
- `OCR_HTTP_TIMEOUT_MS` (default: `45000`)

Parsing PDF:

- PDF con text layer: parser dedicato
- PDF scansionati (es. Adobe Scan): OCR su render pagina (`pdftoppm`), fallback su immagini embedded

## Database

SQLite via TypeORM (`better-sqlite3`).

Configurazione DB:

- `DB_PATH` (default: `mealer.sqlite`)
- `DB_AUTO_LOAD_ENTITIES` (default: `true`)
- `DB_SYNCHRONIZE` (default: `false`)
- `DB_LOGGING` (default: `false`)

Il modulo Spesa inizializza una struttura normalizzata per:

- store
- prodotti Grocy snapshot
- prodotti normalizzati da scontrino
- mapping store+prodotto
- scontrini
- righe scontrino e punti prezzo

Le migrazioni iniziali sono idempotenti e gestite all'avvio del modulo.

## Configurazione ambiente

Grocy:

- `GROCY_BASE_URL` (required)
- `GROCY_API_KEY` (required)
- `GROCY_TIMEOUT_MS` (default: `10000`)

CORS:

- `CORS_ALLOWED_ORIGINS`

Formati supportati:

- JSON array: `["https://app.example.com","https://www.app.example.com"]`
- stringa separata da virgola: `https://app.example.com,https://www.app.example.com`

Quando avvii il backend da `backend/`, il loader env prova prima `../.env` (root repo), poi `backend/.env`.

## Sviluppo locale

```bash
npm install
npm run start:dev
```

## Test

```bash
npm run test
npm run test:e2e
npm run test:cov
```

## Deployment

Il backend viene deployato nell'immagine app unificata a livello root repository.
Vedi `../Dockerfile` e `../docker-compose.yml`.

## Licenza

Questo modulo e rilasciato sotto **GNU Affero General Public License v3.0 only (AGPL-3.0-only)**.

Copyright (C) 2026 Francesco Sorge.

Vedi [LICENSE](../LICENSE).
