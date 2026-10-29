# HalalCheck

HalalCheck helps Muslim consumers look up food products. With this first milestone you can:

- **Search** for products by name or brand
- **Scan** a barcode with your phone or laptop camera
- **Type a barcode** when scanning isn't possible
- **View product details**: name, brand, image, ingredients, categories, countries, labels, and any halal certification labels recorded for the product

All product data comes from [Open Food Facts](https://world.openfoodfacts.org/). HalalCheck does **not** yet decide whether a product is halal. It shows certification labels exactly as the source records them. When there is no halal data, the app says so and doesn't treat that as a negative result.

## Architecture

```
Browser (React SPA)  ──/api──▶  FastAPI backend  ──HTTPS──▶  Open Food Facts
  search · scanner · details     validation · mapping         product API v2
  @zxing/browser (on device)     error handling · CORS        search service
```

- **Frontend** (`frontend/`): React 19, TypeScript, Vite, Tailwind CSS v4, React Router, `@zxing/browser`. Barcode decoding runs entirely in the browser. The scanner code loads only when someone opens the scanner.
- **Backend** (`backend/`): FastAPI, Pydantic, HTTPX. The backend validates input, calls Open Food Facts and maps its raw responses into a small, stable product model. It also returns consistent errors to the frontend.

```
backend/
  app/
    main.py                     App setup, CORS, error handlers, /api/health
    config.py                   All settings (env vars prefixed HALALCHECK_)
    validation.py               Barcode and search-query sanitisation
    api/products.py             /api/products/search and /api/products/barcode/{barcode}
    services/open_food_facts.py Open Food Facts client and response mapping
    models/product.py           Public response models
  tests/                        Pytest suite, upstream fully mocked
frontend/
  src/
    pages/                      HomePage (search, scan, manual entry), ProductPage
    components/                 ProductSearch, SearchResults, ProductCard, BarcodeScanner,
                                ManualBarcodeEntry, ProductDetails, …
    services/products.ts        Typed API client
    lib/barcode.ts              Barcode validation (barcodes are always strings)
    hooks/useRequest.ts         Cancellable data loading with retry
```

## Getting started

Requirements: **Python 3.11+** and **Node.js 20.19+** (or 22.12+).

### 1. Backend

```bash
cd backend
python3 -m venv .venv
source .venv/bin/activate            # Windows: .venv\Scripts\activate
pip install -r requirements-dev.txt
uvicorn app.main:app --reload --port 8000
```

The API runs at http://localhost:8000, with interactive docs at http://localhost:8000/docs.

### 2. Frontend

In a second terminal:

```bash
cd frontend
npm install
npm run dev
```

Open http://localhost:5173. The Vite dev server proxies `/api` to the backend on port 8000.

### Configuration

Every setting has a working default. To change one, copy `.env.example` to `backend/.env` or `frontend/.env` and edit the values. Before deploying, set `HALALCHECK_OFF_USER_AGENT` to include a real contact email, as Open Food Facts asks.

### Scanning on a phone

Browsers only allow camera access on `localhost` or over HTTPS. To test on a phone on the same Wi-Fi network:

```bash
cd frontend
DEV_HTTPS=true npm run dev
```

Open the `https://<your-computer-ip>:5173` address that Vite prints. Your phone will warn about the self-signed certificate; accept it to continue. API calls still go through the dev proxy, so the backend can stay on plain HTTP. In production, serve the frontend over HTTPS.

## API

All error responses share one shape: `{"error": {"code": "...", "message": "..."}}`.

| Endpoint | Description |
| --- | --- |
| `GET /api/health` | `{"status": "ok"}` |
| `GET /api/products/search?q={query}&page={n}` | Search by name or brand. `q` must be 2–100 characters after sanitising. `page` is 1–100. Returns `{query, page, page_size, total, products: [{barcode, name, brands, image_url}]}`. |
| `GET /api/products/barcode/{barcode}` | Look up one product. The barcode must be 8–14 digits; spaces and hyphens are ignored. Returns `{barcode, name, brands, image_url, ingredients_text, categories, countries, labels, halal_labels, source_url}`. |

| Status | `error.code` | Meaning |
| --- | --- | --- |
| 400 | `invalid_request` | Invalid query, barcode or page |
| 404 | `not_found` | Open Food Facts has no product with this barcode |
| 429 | `upstream_rate_limited` | Open Food Facts rate limit reached |
| 502 | `upstream_invalid_response` | Open Food Facts returned something unexpected, such as HTML |
| 503 | `upstream_unavailable` | Open Food Facts is down or unreachable |
| 504 | `upstream_timeout` | Open Food Facts didn't respond in time |

Fields can be `null` or empty lists. The API never fills them in with guessed values.

## Tests and checks

```bash
# Backend
cd backend
pytest                 # API, mapping, validation and upstream-failure tests (no network)
ruff check . && ruff format --check .
mypy app

# Frontend
cd frontend
npm test               # Vitest + Testing Library (scanner tests mock the camera)
npm run typecheck
npm run lint
npm run build
```

## Data limitations

- **Open Food Facts is crowd-sourced.** Many products have no image, ingredients or labels, and some data is out of date or only in the original language.
- **Halal labels are reported, not verified.** `halal_labels` lists labels that mention halal or a known halal certifier (for example "Halal" or "Contrôle de la mosquée de …"), exactly as contributors recorded them. An empty list means *no information*, not *not halal*.
- **Search.** Search uses Open Food Facts' [search service](https://search.openfoodfacts.org/docs). If that service fails, the backend falls back to the legacy `cgi/search.pl` endpoint. Results are limited to 100 pages.
- **Rate limits.** Open Food Facts allows about 100 product lookups and 10 searches per minute per client. That's why search runs only when you submit, not on every keystroke. A production deployment with real traffic would need caching.
- **Barcodes.** The scanner reads EAN-13, EAN-8, UPC-A and UPC-E codes. Barcodes are always handled as strings so leading zeros are kept.

## Not in this milestone

Halal/haram decisions, ingredient analysis, user accounts and favourites are planned for later milestones.
