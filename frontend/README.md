# Mealer Frontend (Angular)

Applicazione Angular per gestione dispensa e flusso spesa/scontrini, integrata con backend NestJS.

## Funzionalita principali

- Shell applicativa con menu principale persistente
- Area `Dispensa`:
  - riepilogo per macro-categorie
  - vista stock volatile (in scadenza/scaduti/mancanti)
  - pagina gestione dati prodotto con editing massivo, filtri, ricerca, ordinamento e paginazione
- Area `Spesa`:
  - dashboard insight spesa (trend temporali, top prodotti, filtri)
  - storico scontrini con dettaglio ed eliminazione
  - caricamento scontrino (PDF/foto), parsing, suggerimenti abbinamento, salvataggio mapping e prezzi
- Integrazione API backend:
  - proxy Grocy su `/grocy/*`
  - endpoint spesa su `/spesa/*`
- URL backend definito tramite environment Angular

## Routing principale

- `/` -> home
- `/dispensa`
- `/dispensa/macro-category/:macroCategory`
- `/dispensa/stock-volatile/:section`
- `/dispensa/gestione-dati`
- `/meal-planner`
- `/spesa/dashboard`
- `/spesa/carica-scontrino`

## Sviluppo locale

### Requisiti

- Node.js 24+
- npm

### Installazione

```bash
npm ci
```

### Avvio

```bash
npm start
```

App disponibile su `http://localhost:4200`.

Il frontend usa l'URL backend dagli environment Angular:

- sviluppo: `http://localhost:3000` (`src/environments/environment.ts`)
- produzione: `/api` (`src/environments/environment.prod.ts`)

## Build e test

```bash
npm run build
npm test
```

## Produzione

Il frontend viene incluso nell'immagine app unificata e servito da nginx su porta `8080`.
Le chiamate API passano in same-origin sotto `/api`.

## License

This project is licensed under the GNU Affero General Public License v3.0 only (AGPL-3.0-only).

Copyright (C) 2026 Francesco Sorge.

See [LICENSE](../LICENSE).
