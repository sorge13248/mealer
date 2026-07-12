# Mealer

### Smart pantry browsing for Grocy, with category navigation and stock-priority views

Mealer is an Angular web app that connects to a Grocy instance and helps you browse products by macro category, check expiring/missing items, and inspect stock data with a fast visual workflow.

## Features

- Guided onboarding at first access with API URL and API key validation via `GET /api/system/info`
- Secure local secret storage in the browser (encrypted at rest via Web Crypto + IndexedDB)
- Home page grouped by `food_macrocategory`, including a virtual "Senza macrocategoria" section
- Dedicated macro-category page with product cards, score badges, stock details, and image loading states
- Dedicated volatile stock page for due, expired, and missing products
- API key interceptor and optional HTTP response caching
- Multi-architecture production container image build (`linux/amd64`, `linux/arm64`) via GitHub Actions

## Local development

### 1. Prerequisites

- Node.js `24.15.0` or newer supported by the current Angular CLI
- npm (bundled with Node.js)

If you use nvm:

```bash
source ~/.nvm/nvm.sh
nvm install 24.15.0
nvm use 24.15.0
```

### 2. Install dependencies

```bash
npm ci
```

### 3. Run the app

```bash
npm start
```

Open `http://localhost:4200`.

At first launch, the onboarding screen asks for:

- Grocy base URL
- Grocy API key

The values are validated before save, then stored locally in encrypted form.

### 4. Build and test

```bash
npm run build
npm test
```

## Production deployment

### Option A: Docker (recommended)

Build local image:

```bash
docker build -t mealer:prod .
```

Run container:

```bash
docker run --rm -p 8080:8080 mealer:prod
```

Notes:

- Runtime image uses `nginx:alpine`
- Container runs as non-root user
- App is served on port `8080`

### Option B: GitHub Actions + GHCR

Workflow file: `.github/workflows/docker-multiarch.yml`

On push to `main` (and on schedule/manual trigger), CI builds multi-arch images and publishes to GHCR:

- `ghcr.io/sorge13248/mealer:latest`
- additional tags based on branch/tag/sha

Pull example:

```bash
docker pull ghcr.io/sorge13248/mealer:latest
```

If the package is private, authenticate first:

```bash
docker login ghcr.io
```

## License

This project is licensed under the GNU General Public License v3.0.

See [LICENSE](LICENSE).
