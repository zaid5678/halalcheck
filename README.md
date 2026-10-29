# HalalCheck

HalalCheck helps Muslim consumers in the UK check whether food products are halal. It offers:

- **Search a product**: find a product by name or brand.
- **Scan a barcode**: look up a product with your phone or laptop camera, or by typing the barcode.
- **Photograph ingredients**: take or upload a photo of an ingredients label.
- **Halal check**: for a barcode or an ingredients photo, get a verdict of **halal**, **haram** or **doubtful**, with the ingredients behind it.

Verdicts are based on the listed ingredients only. They are not a fatwa or a halal certification.

## Architecture

```
Browser (React SPA, Vercel)    ──HTTPS──▶  FastAPI (Render, Docker)
  search · barcode scanner                  /api/products/*  → Open Food Facts
  ingredients photo                         /api/halal/*     → ingredient rules + LLM (OpenRouter)
```

- **Frontend** (`frontend/`): React 19, TypeScript, Vite, Tailwind CSS v4, React Router. Barcode decoding (`@zxing/browser`) runs on the device. The scanner and the in-page camera are only downloaded when someone opens them.
- **Backend** (`backend/`): FastAPI, Pydantic, HTTPX. Product data comes from Open Food Facts. Halal checks combine fixed ingredient rulings with an LLM (`openai/gpt-6.1-terra` via OpenRouter), which also reads ingredient photos.

```
backend/app/
  main.py                   App setup, CORS, upload size guard, error handlers, /api/health
  config.py                 All settings (env vars prefixed HALALCHECK_)
  errors.py                 AppError → {"error": {"code", "message"}} responses
  api/products.py           /api/products/search, /api/products/barcode/{barcode}
  api/halal.py              /api/halal/barcode/{barcode}, POST /api/halal/photo
  services/products.py      ProductLookup interface
  services/open_food_facts.py  Open Food Facts client and response mapping
  services/rules.py         Ingredient rules engine
  services/llm.py           OpenRouter client: reads label photos, reviews ingredients
  data/rulings.json         Ingredient rulings (haram / doubtful / halal) with reasons
frontend/src/
  pages/                    HomePage, ProductPage, IngredientsPage
  components/               ProductSearch, BarcodeScanner, PhotoPicker, CameraCapture,
                            ProductDetails, …
  services/                 api.ts (shared client), products.ts, ingredients.ts
  lib/                      barcode.ts, image.ts, camera.ts
```

### How halal checks work

1. **Ingredients.** For a barcode, the ingredients come from Open Food Facts. For a photo, the LLM reads the ingredients list from the image.
2. **Rules.** Every ingredient is matched against `data/rulings.json` (for example pork and E120 are haram; gelatine and E471 are doubtful unless their source is stated). Matching is on whole words, longest term first, so "halal beef gelatine" is not mistaken for "gelatine".
3. **LLM review.** If the rules found nothing haram, the LLM reviews the ingredients, using the same rulings as its standard, and can add concerns the rules missed.
4. **Verdict.** Any haram ingredient makes the product haram; otherwise any doubtful ingredient makes it doubtful; otherwise it is halal.

Safety rules:

- **Rule findings always stand.** The LLM can add concerns but can never loosen a ruling.
- **No ingredients means doubtful**, never halal.
- **If the LLM is unavailable**, barcode checks fall back to the rules alone and report `ai_checked: false`. Photo checks need the LLM and return `503 llm_unavailable`.
- **Final barcode verdicts are cached** in memory, so repeat scans are instant.

**Privacy.** Photos are processed in memory, sent to OpenRouter for reading, and never stored or logged by HalalCheck.

## Local setup

Requirements: **Python 3.11+** and **Node.js 20.19+**.

### 1. Backend

```bash
cd backend
python3 -m venv .venv
source .venv/bin/activate            # Windows: .venv\Scripts\activate
pip install -r requirements-dev.txt
uvicorn app.main:app --reload --port 8000
```

Put your OpenRouter key in `backend/.env` as `HALALCHECK_OPENROUTER_API_KEY=...` (see [`.env.example`](.env.example)). Without it, barcode checks use the rules only and photo checks return `503`.

The API runs at http://localhost:8000, with interactive docs at http://localhost:8000/docs.

### 2. Frontend

```bash
cd frontend
npm install
npm run dev
```

Open http://localhost:5173. The dev server proxies `/api` to the backend on port 8000.

### Testing on a phone

Browsers only allow the in-page camera on `localhost` or over HTTPS. To test on a phone on the same Wi-Fi network, run:

```bash
cd frontend
DEV_HTTPS=true npm run dev
```

Then open the `https://<your-computer-ip>:5173` address that Vite prints and accept the self-signed certificate warning.

On phones and tablets, "Take photo" opens the device's own camera app, which gives better focus and resolution. On computers it opens an in-page camera instead.

## Deployment: Vercel + Render (free tiers)

Deploy the backend first, because the frontend needs its URL.

### Backend on Render

1. In Render, choose **New → Blueprint** and select the repository. Render reads [`render.yaml`](render.yaml) and builds [`backend/Dockerfile`](backend/Dockerfile).
2. When prompted, set:
   - `HALALCHECK_CORS_ORIGINS` to your Vercel URL, for example `https://halalcheck.vercel.app`. You can add more URLs, separated by commas.
   - `HALALCHECK_OPENROUTER_API_KEY` to your OpenRouter key.
   - `HALALCHECK_OFF_USER_AGENT` to `HalalCheck/0.1 (<your contact email>)`, as Open Food Facts asks.
3. Once it's deployed, check `https://<your-service>.onrender.com/api/health`. It should report `{"status": "ok"}`.

### Frontend on Vercel

1. In Vercel, choose **Add New → Project** and import the repository. Leave **Root Directory** as the repository root. [`vercel.json`](vercel.json) sets the install and build commands, the output folder, single-page-app rewrites and headers.
2. Before deploying, add the environment variable `VITE_API_BASE_URL` with your Render URL as its value, for example `https://halalcheck-api.onrender.com`. If you add it after deploying, redeploy so the build picks it up.
3. Set `HALALCHECK_CORS_ORIGINS` on Render to your production Vercel URL.

Vercel serves the site over HTTPS, which the camera features need. Preview deployments get their own URLs. They can only call the API if you add those URLs to `HALALCHECK_CORS_ORIGINS`.

### Free-tier caveats

- **Cold starts.** Render's free web services sleep after about 15 minutes without traffic, and the first request then takes up to a minute. The app warns users when processing is slow, and allows up to two minutes before giving up.
- **Why the frontend calls Render directly.** Proxying `/api` through the frontend host would add another timeout limit, which a cold start plus a photo check can exceed. That's also why CORS must be configured on the backend.
- **The verdict cache resets** whenever the free instance sleeps or redeploys.

## API

All errors share one shape: `{"error": {"code": "...", "message": "..."}}`. Messages are written to be shown to users.

| Endpoint | Description |
| --- | --- |
| `GET /api/health` | `{"status": "ok"}` |
| `GET /api/products/search?q={query}&page={n}` | Search by name or brand. `q` must be 2–100 characters after sanitising. `page` is 1–100. Returns `{query, page, page_size, total, products: [{barcode, name, brands, image_url}]}`. |
| `GET /api/products/barcode/{barcode}` | Look up one product. The barcode must be 8–14 digits; spaces and hyphens are ignored. Returns `{barcode, name, brands, image_url, ingredients_text, categories, countries, labels, halal_labels, source_url}`. |
| `GET /api/halal/barcode/{barcode}` | Halal check for a product. Returns `{verdict, reasons: [{ingredient, ruling, note}], ingredients_text, ai_checked, product}`. |
| `POST /api/halal/photo` | Halal check for an ingredients photo: multipart form with an `image` field (JPEG, PNG or WebP, up to 10 MB). Returns the same shape with `product: null`. |

`verdict` and `ruling` are `halal`, `haram` or `doubtful`. `reasons` lists only haram and doubtful ingredients.

| Status | `error.code` | Meaning |
| --- | --- | --- |
| 400 | `invalid_request` | Missing upload, or an invalid query, barcode or page |
| 404 | `not_found` | Open Food Facts has no product with this barcode |
| 413 | `image_too_large` | Upload over the size limit |
| 415 | `unsupported_image_type` | Not a JPEG, PNG or WebP image |
| 422 | `unreadable_image` | No ingredients list could be read from the photo |
| 429 | `upstream_rate_limited` | Open Food Facts rate limit reached |
| 502 | `upstream_invalid_response` | Open Food Facts returned something unexpected |
| 503 | `upstream_unavailable` | Open Food Facts is down or unreachable |
| 503 | `llm_unavailable` | The LLM is unreachable, or no OpenRouter key is set |
| 504 | `upstream_timeout` | Open Food Facts didn't respond in time |

## Tests and checks

```bash
# Backend
cd backend
pytest                 # API, rules, LLM and upstream-failure tests. Network calls are mocked.
ruff check . && ruff format --check .
mypy app

# Frontend
cd frontend
npm test               # Vitest + Testing Library. Camera and network calls are mocked.
npm run typecheck
npm run lint
npm run build
```

## Limitations

- **Not a fatwa or certification.** Verdicts come from the listed ingredients. Whether meat was slaughtered correctly can't be told from ingredients, so meat is doubtful unless halal certification is stated.
- **Open Food Facts is crowd-sourced.** Many products have no ingredients, and some data is out of date. Without ingredients, the verdict is doubtful; use the photo check instead.
- **Halal labels are reported, not verified.** `halal_labels` lists labels that mention halal or a known certifier, as contributors recorded them.
- **Rate limits.** Open Food Facts allows about 100 product lookups and 10 searches per minute per client.
- **Speed.** Barcode checks that need the LLM take a few seconds; photo checks take around 10 seconds.
- **HEIC images.** HEIC files picked from a computer aren't accepted. iPhones convert photos to JPEG automatically when they're taken or chosen through the app.
