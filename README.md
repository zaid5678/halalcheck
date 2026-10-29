# HalalCheck

HalalCheck helps Muslim consumers check food products. It offers three separate features:

- **Search a product**: find a product by name or brand.
- **Scan a barcode**: read a product barcode with your phone or laptop camera, or type it in.
- **Scan ingredients**: photograph an ingredients label, in any language. An AI vision model reads it, investigates where each ingredient may come from, and gives an informational halal assessment.

> **Product lookups are not connected yet.** The search and barcode screens, validation and API endpoints are in place, but no product data source is plugged in. Both product endpoints return `501 product_lookup_unavailable`, and the app shows a "coming soon" message. The barcode scanner shows the number it read. See [Connecting a product data source](#connecting-a-product-data-source).

**Scan ingredients gives informational guidance, not a religious ruling or a certification.** Its reasoning comes from what is printed on the label and from the AI model's general knowledge. Nothing is checked with manufacturers, certifiers or databases.

## Architecture

```
Browser (React SPA, Vercel)  ──HTTPS──▶  FastAPI (Render, Docker)  ──HTTPS──▶  OpenRouter
  search · barcode scanner                 /api/products/*            (vision model)
  ingredients photo + results              /api/ingredients/analyze
```

- **Frontend** (`frontend/`): React 19, TypeScript, Vite, Tailwind CSS v4, React Router. Barcode decoding runs on the device, using the browser's own detector where available and `@zxing/browser` otherwise.
- **Backend** (`backend/`): FastAPI, Pydantic, HTTPX and Pillow. The OpenRouter API key stays on the server and is never sent to the browser.

```
backend/app/
  main.py                 App setup, CORS, upload size guard, error handlers, /api/health
  config.py               All settings (environment variables)
  images.py               Upload validation, EXIF rotation, metadata stripping, resizing
  ai/prompt.py            Instructions given to the model
  ai/openrouter.py        OpenRouter chat-completions client and error mapping
  ai/schema.py            Pydantic model → strict JSON schema for structured outputs
  ai/analysis.py          Request building, JSON parsing, safeguards
  models/analysis.py      The structured result (validated with Pydantic)
  api/ingredients.py      POST /api/ingredients/analyze
  api/products.py         Product search and barcode endpoints (no data source yet)
  rate_limit.py           Per-IP limit on paid AI requests
frontend/src/
  pages/IngredientsPage.tsx         Photo → preview → analysis → results → correct and re-run
  components/AnalysisResult.tsx     Assessment, findings, certification, limitations
  components/IngredientsTextEditor  Correct the ingredients text and re-run
  components/PhotoPicker, CameraCapture, BarcodeScanner, …
```

## How Scan ingredients works

1. **Take or upload a photo.** On phones, "Take photo" opens the system camera. On computers it opens an in-page camera. The user previews the photo and can retake or replace it before submitting.
2. **Validate and prepare the image.** The backend accepts JPEG, PNG or WebP up to 10 MB and 40 megapixels, checking the actual file bytes. It rotates the image upright, scales it to at most 2048 px, and re-encodes it as JPEG. Re-encoding strips all metadata, including any GPS location, before the image leaves the server.
3. **Analyse.** The image and instructions go to the configured OpenRouter vision model, with a strict JSON schema requested through structured outputs. The instructions ([`backend/app/ai/prompt.py`](backend/app/ai/prompt.py)) tell the model to:
   - read the label in any language, keeping the original wording, translations and standard names;
   - investigate each ingredient's possible sources (pork, other animal, insect, plant, mineral, synthetic, microbial, alcohol), not just match keywords;
   - separate sources the label *states* from sources that can't be determined;
   - never invent aliases, E-number mappings, certification or external verification;
   - ask for a clearer photo instead of guessing when the label is unreadable.
4. **Validate the reply.** The model's JSON is validated with Pydantic. Code fences and stray prose around the JSON are tolerated, and harmless spelling variations of the categories are normalised. Truncated, malformed or incomplete replies are rejected with a clear error instead of being shown.
5. **Apply safeguards.** HalalCheck enforces rules whatever the model says. These rules can only make the result more cautious, and every change is shown to the user.
   - Any prohibited-source finding means the result is **Potentially non-halal**.
   - Any ingredient marked as a concern means the result can't be **Likely halal**.
   - Any ingredient with an unknown or unconfirmed source, an unreadable label, or no identified ingredients means the result can't be **Likely halal**; it becomes **Needs further investigation**.
   - An unreadable label means the confidence can't be "high".
6. **Show the results.** The app shows the overall status with a confidence level, a summary, prohibited findings and concerns. Each ingredient appears with its original text, translation, E-number and possible sources, and is labelled as evidence *from the label* or *AI general knowledge (not independently verified)*. Certification marks are shown exactly as seen, with a note that the app can't confirm a logo is genuine. Limitations and next steps follow.
7. **Correct and re-run.** The ingredients text the model read is editable. Users can fix misread words and re-run; the corrected text is treated as authoritative, and the photo is sent again for context such as certification marks.

The three overall results:

| Result | Meaning |
| --- | --- |
| **Likely halal** | No prohibited ingredients or unresolved material concerns were identified from the available evidence. Not a certification. |
| **Potentially non-halal** | A credible concern was identified, though the evidence may not be enough for a definitive ruling. |
| **Needs further investigation** | The label is incomplete or ambiguous, or one or more ingredients have an uncertain source. |

## Local setup

Requirements: **Python 3.11+**, **Node.js 20.19+**, and an **OpenRouter API key** (create one at <https://openrouter.ai/keys>).

### 1. Configure OpenRouter

Create `.env` in the repository root, or in `backend/`:

```bash
OPENROUTER_API_KEY=sk-or-v1-...
OPENROUTER_MODEL=anthropic/claude-sonnet-5.5
```

- `OPENROUTER_API_KEY` is required for Scan ingredients. `HALALCHECK_OPENROUTER_API_KEY` is also accepted. `.env` files are git-ignored, so the key is never committed. Never put the key in the frontend or in any `VITE_` variable, because those end up in the public website code.
- `OPENROUTER_MODEL` can be any OpenRouter model that accepts **image input** and supports **structured outputs**; check a model's page on openrouter.ai. Changing models needs no code changes. The default, `anthropic/claude-sonnet-5.5`, costs roughly 2–3 cents per scan. Cheaper options such as `anthropic/claude-haiku-5.5` cost a fraction of a cent, but may reason less carefully about ingredient sources.
- If a model doesn't support structured outputs, set `HALALCHECK_OPENROUTER_STRUCTURED_OUTPUTS=false`. The schema is then included in the instructions instead, and the reply is still validated.

Without a key, the rest of the app works, `/api/health` reports `"ai_configured": false`, and Scan ingredients shows "Analysis isn't available".

### 2. Backend

```bash
cd backend
python3 -m venv .venv
source .venv/bin/activate            # Windows: .venv\Scripts\activate
pip install -r requirements-dev.txt
uvicorn app.main:app --reload --port 8000
```

The API runs at http://localhost:8000, with interactive docs at http://localhost:8000/docs.

### 3. Frontend

```bash
cd frontend
npm install
npm run dev
```

Open http://localhost:5173. The dev server proxies `/api` to the backend on port 8000.

### Testing on a phone

Browsers only allow the camera on `localhost` or over HTTPS. On the same Wi-Fi network, run `DEV_HTTPS=true npm run dev` in `frontend/`, open the `https://<your-computer-ip>:5173` address Vite prints, and accept the certificate warning. Alternatively, deploy as described below and use the Vercel URL.

## Deployment: Vercel + Render (free tiers)

Deploy the backend first, because the frontend needs its URL.

### Backend on Render

1. In Render, choose **New → Blueprint** and select the repository. Render reads [`render.yaml`](render.yaml) and builds [`backend/Dockerfile`](backend/Dockerfile).
2. When prompted, set:
   - `HALALCHECK_CORS_ORIGINS`: your Vercel URL, for example `https://halalcheck.vercel.app`. Separate multiple URLs with commas.
   - `OPENROUTER_API_KEY`: your OpenRouter key. Render stores it as a secret.
3. `OPENROUTER_MODEL` is preset in `render.yaml`. Change it under **Environment** to try another model.
4. Check `https://<your-service>.onrender.com/api/health`. It should report `"ai_configured": true`.

### Frontend on Vercel

1. In Vercel, choose **Add New → Project** and import the repository, leaving **Root Directory** as the repository root. [`vercel.json`](vercel.json) handles the rest.
2. Add the environment variable `VITE_API_BASE_URL` with your Render URL, for example `https://halalcheck-api.onrender.com`. If you add it after deploying, redeploy.
3. Make sure `HALALCHECK_CORS_ORIGINS` on Render contains your Vercel URL.

### Caveats

- **Cold starts.** Render's free services sleep after about 15 minutes idle, and the first request then takes up to a minute. Analysis itself usually takes 15–40 seconds. The app shows progress and allows up to three minutes.
- **Costs.** Every scan or re-run is a paid OpenRouter request. The backend allows 30 analyses per IP address per hour (`HALALCHECK_ANALYSIS_RATE_LIMIT_PER_HOUR`; `0` disables the limit). The limit is held in memory, so it resets when the server restarts. Setting a credit limit on your OpenRouter key adds a hard cap.
- **Privacy.** Photos are sent to OpenRouter and the model provider for analysis. HalalCheck doesn't store them, and strips their metadata first.

## API

All errors share one shape: `{"error": {"code": "...", "message": "..."}}`. Messages are written to be shown to users.

| Endpoint | Description |
| --- | --- |
| `GET /api/health` | `{"status": "ok", "ai_configured": true}` |
| `POST /api/ingredients/analyze` | Multipart form with `image` (JPEG, PNG or WebP, up to 10 MB), `ingredients_text` (corrected text, up to 5000 characters), or both. Returns the structured analysis described in [`backend/app/models/analysis.py`](backend/app/models/analysis.py). |
| `GET /api/products/search?q=…` | Validates the query, then returns `501 product_lookup_unavailable`. |
| `GET /api/products/barcode/{barcode}` | Validates the barcode (8–14 digits), then returns `501 product_lookup_unavailable`. |

| Status | `error.code` | Meaning |
| --- | --- | --- |
| 400 | `invalid_request` | No photo or text, empty file, or text too long |
| 400 | `invalid_image` | Corrupt image, too small, or too many pixels |
| 413 | `image_too_large` | Upload over the size limit |
| 415 | `unsupported_image_type` | Not a JPEG, PNG or WebP image |
| 429 | `too_many_requests` | HalalCheck's per-IP scan limit reached |
| 429 | `ai_rate_limited` | OpenRouter or the provider is rate-limiting |
| 502 | `ai_request_rejected` | The model rejected the request |
| 502 | `ai_invalid_response` | The model's reply was malformed, incomplete or cut off |
| 503 | `ai_not_configured` | No API key, or OpenRouter rejected the key |
| 503 | `ai_unavailable` | OpenRouter unreachable, out of credits, or the model is unavailable or unsuitable |
| 504 | `ai_timeout` | The model took too long |
| 501 | `product_lookup_unavailable` | No product data source is connected yet |

## Connecting a product data source

Implement the `ProductLookup` protocol in `backend/app/services/products.py` (`search(query, page)` and `get_product(barcode)`, raising `ProductNotFoundError` for unknown barcodes), and return your implementation from `get_product_lookup()`. Map the source's data onto the existing models in `backend/app/models/product.py`. The frontend already handles results, details, missing fields and not-found barcodes. An earlier Open Food Facts implementation is in the git history at commit `b7e5298`.

## Tests and checks

```bash
# Backend: OpenRouter is mocked, so no API key or network access is needed.
cd backend
pytest
ruff check . && ruff format --check .
mypy app

# Frontend: camera and network calls are mocked.
cd frontend
npm test
npm run typecheck
npm run lint
npm run build
```

## Limitations

- **AI can be wrong.** It can misread small or curved text, mistranslate, or make mistakes about ingredient sources. Users should compare the extracted text with the packaging and correct it.
- **No external verification.** Nothing is checked with manufacturers, certifiers or ingredient databases, and the app says so on every result.
- **Scholarly differences.** Some ingredients, such as insect-derived carmine, are treated differently by different authorities. The model is told to note such differences rather than settle them.
- **HEIC files** chosen on a computer aren't accepted. iPhones convert photos to JPEG automatically when they're taken or chosen in the browser.
