# Mealer Monorepo

Monorepo per la gestione dispensa/spesa integrata con Grocy.

## Moduli

- `frontend/`: app Angular (UI dispensa, dashboard spesa, caricamento scontrini)
- `backend/`: API NestJS (proxy Grocy, parsing scontrini, persistenza SQLite)
- `ocr/`: microservizio OCR HTTP self-hosted (FastAPI)

## Funzionalita principali

- Navigazione unica con menu principale: `Dispensa`, `Meal planner`, `Spesa`
- Dispensa con vista per macro-categoria e vista stock volatile
- Gestione dati prodotti (`/dispensa/gestione-dati`) con modifica massiva di:
	- nome prodotto
	- parent product
	- macro-categoria
	- rating `yuka_score`
	- preferenza `tastes_good`
- Proxy Grocy esteso:
	- update oggetti (`PUT /grocy/objects/:entity/:id`)
	- update userfields (`PUT /grocy/userfields/:entity/:id`)
	- proxy immagini prodotti (`GET /grocy/files/productpictures/:encodedFileName`)
	- redirect a pagine Grocy (`/grocy/product/:id`, `/grocy/products-page`, `/grocy/product-new-page`)
- Flusso scontrini completo:
	- parsing PDF/foto
	- suggerimenti abbinamento prodotto
	- salvataggio mapping storico
	- salvataggio scontrino/prezzi
	- dashboard insight, storico, dettaglio ed eliminazione scontrini
- OCR a provider multipli con fallback automatico (`selfhosted-http` -> `tesseract`)

## Requisiti

- Node.js 22+
- npm 11+
- Python 3.10+ (per servizio OCR locale senza Docker)

## Installazione dipendenze

```bash
npm install
```

## Avvio sviluppo

Backend NestJS:

```bash
npm run start:backend
```

Frontend Angular:

```bash
npm run start:frontend
```

OCR locale (opzionale in sviluppo):

```bash
npm run start:ocr
```

Note OCR locale:

- engine automatico: `paddle` se disponibile, altrimenti fallback `tesseract`
- forzatura engine: `OCR_ENGINE=tesseract npm run start:ocr`
- shortcut:

```bash
npm run start:ocr:tesseract
npm run start:ocr:paddle
```

- interprete Python specifico: `OCR_PYTHON_CMD=python3.11 npm run start:ocr`
- check setup:

```bash
npm run check:ocr
```

## Build e test

```bash
npm run build
npm run test
```

## Configurazione runtime frontend

Il frontend non usa piu `config.json` per cambiare l'URL API.
L'endpoint backend e definito staticamente negli environment Angular:

- sviluppo: `http://localhost:3000`
- produzione: `/api`

## Docker produzione

Lo stack di produzione usa un'immagine unificata `mealer-app`:

- frontend statico servito da Nginx
- backend NestJS dietro reverse proxy su `/api`

Lo stack include anche `mealer-ocr`, usato come provider OCR primario dal backend.

File principali:

- `Dockerfile`
- `docker-compose.yml`
- `deploy/nginx.unified.conf`

## CI/CD GitHub Actions

Workflow principali in `.github/workflows`:

- `docker-app-multiarch.yml`: build/publish immagine app unificata
- `docker-ocr-multiarch.yml`: build/publish immagine OCR

Entrambe pubblicano immagini multi-arch (`linux/amd64`, `linux/arm64`) su GHCR e usano trigger a path per evitare build non necessarie.

## Licenza

Questo progetto e rilasciato sotto **GNU Affero General Public License v3.0 only (AGPL-3.0-only)**.

Copyright (C) 2026 Francesco Sorge.

Vedi [LICENSE](LICENSE).
