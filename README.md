# HalalCheck

HalalCheck helps Muslim consumers check food products. It currently offers three separate features:

- **Search a product**: find a product by name or brand.
- **Scan a barcode**: look up a product with your phone or laptop camera, or by typing the barcode.
- **Photograph ingredients**: take or upload a photo of an ingredients label. The app reads the text with OCR, and you can review, correct and copy it.

> **Product lookups are not connected yet.** The search and barcode screens, validation and API endpoints are in place, but no product data source is plugged in. Both endpoints return `501 product_lookup_unavailable`, and the app shows a "coming soon" message. See [Connecting a product data source](#connecting-a-product-data-source).

HalalCheck does **not** yet decide whether a product or ingredient is halal. It never produces a halal or haram verdict.

## Architecture

```
Browser (React SPA, Vercel)   ──HTTPS──▶  FastAPI (Render, Docker)
  search · barcode scanner                  /api/products/*        → product data source (not connected)
  ingredients photo + editor                /api/ingredients/extract → OpenCV + Tesseract OCR
```

- **Frontend** (`frontend/`): React 19, TypeScript, Vite, Tailwind CSS v4, React Router. Barcode decoding (`@zxing/browser`) runs on the device. The scanner and the in-page camera are only downloaded when someone opens them.
- **Backend** (`backend/`): FastAPI and Pydantic. OCR uses OpenCV for preprocessing and Tesseract (via `pytesseract`) for text recognition.

```
backend/app/
  main.py                   App setup, CORS, upload size guard, error handlers, /api/health
  config.py                 All settings (env vars prefixed HALALCHECK_)
  errors.py                 AppError → {"error": {"code", "message"}} responses
  api/products.py           /api/products/search, /api/products/barcode/{barcode}
  api/ingredients.py        POST /api/ingredients/extract
  services/products.py      ProductLookup interface (placeholder until a data source exists)
  ocr/image_io.py           Safe image decoding: format sniffing, size limits, EXIF rotation
  ocr/preprocessing.py      OpenCV steps: resize, deskew, denoise, contrast, binarise
  ocr/engine.py             OcrEngine interface and the Tesseract implementation
  ocr/service.py            Pipeline: preprocess → OCR → retry if poor → structured result
frontend/src/
  pages/                    HomePage, ProductPage, IngredientsPage
  components/               ProductSearch, BarcodeScanner, PhotoPicker, CameraCapture,
                            ExtractedIngredients, ProductDetails, …
  services/                 api.ts (shared client), products.ts, ingredients.ts
  lib/                      barcode.ts, image.ts, camera.ts
```

### How ingredients OCR works

1. **Upload checks.** The backend accepts JPEG, PNG or WebP up to 10 MB and 40 megapixels. It checks the file's actual bytes, not just its name or declared type.
2. **Decoding.** The image is decoded in memory and rotated upright using the photo's EXIF data. Transparent areas are placed on white.
3. **Preprocessing.** The image is resized so small print is legible, straightened if tilted by up to 20°, lightly denoised, and contrast-enhanced with CLAHE.
4. **OCR.** Tesseract reads the text. If confidence is low, the backend checks for a sideways or upside-down photo and tries again, then tries a black-and-white (adaptive threshold) version. It keeps the best result.
5. **Response.** The API returns the text exactly as recognised, along with the average confidence, a low-confidence flag, and a list of words to double-check. Nothing is corrected or invented: the user reviews and edits the text.

**Privacy.** Images are processed in memory and discarded when the response is sent. They are never written to permanent storage or logged.

The preprocessing steps and the OCR engine sit behind small interfaces (`preprocessing.STANDARD_STEPS`, `OcrEngine`). Either can be replaced, for example with a cloud OCR service, without changing the API.

## Local setup

Requirements: **Python 3.11+**, **Node.js 20.19+**, and **Tesseract 4 or newer**.

### 1. Install Tesseract

| OS | Command |
| --- | --- |
| macOS (Homebrew) | `brew install tesseract` |
| Ubuntu / Debian | `sudo apt-get install tesseract-ocr tesseract-ocr-eng tesseract-ocr-osd` |
| Fedora | `sudo dnf install tesseract tesseract-langpack-eng tesseract-osd` |
| Windows | Install from the [UB Mannheim builds](https://github.com/UB-Mannheim/tesseract/wiki), then set `HALALCHECK_TESSERACT_CMD=C:\Program Files\Tesseract-OCR\tesseract.exe` in `backend/.env` |

Check the installation with `tesseract --version` and `tesseract --list-langs`. You need at least `eng`, plus `osd` for detecting rotated photos. To read other languages, install their language packs (for example `tesseract-ocr-fra`) and set `HALALCHECK_OCR_LANGUAGES=eng+fra`.

The API still starts without Tesseract. In that case `/api/health` reports `"ocr_available": false`, and OCR requests return `503 ocr_unavailable`.

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

1. In Render, choose **New → Blueprint** and select the repository. Render reads [`render.yaml`](render.yaml) and builds [`backend/Dockerfile`](backend/Dockerfile). The Dockerfile installs Tesseract, which is why Render's plain Python runtime can't be used.
2. When prompted, set `HALALCHECK_CORS_ORIGINS` to your Vercel URL, for example `https://halalcheck.vercel.app`. You can add more URLs, separated by commas.
3. Once it's deployed, check `https://<your-service>.onrender.com/api/health`. It should report `"ocr_available": true`.

### Frontend on Vercel

1. In Vercel, choose **Add New → Project** and import the repository. Leave **Root Directory** as the repository root. [`vercel.json`](vercel.json) sets the install and build commands, the output folder, single-page-app rewrites and headers.
2. Before deploying, add the environment variable `VITE_API_BASE_URL` with your Render URL as its value, for example `https://halalcheck-api.onrender.com`. If you add it after deploying, redeploy so the build picks it up.
3. Set `HALALCHECK_CORS_ORIGINS` on Render to your production Vercel URL.

Vercel serves the site over HTTPS, which the camera features need. Preview deployments get their own URLs. They can only call the API if you add those URLs to `HALALCHECK_CORS_ORIGINS`.

### Free-tier caveats

- **Cold starts.** Render's free web services sleep after about 15 minutes without traffic, and the first request then takes up to a minute. The app warns users when processing is slow, and allows up to two minutes before giving up.
- **Limited resources.** The free instance has 512 MB of RAM and a fraction of a CPU, so OCR is noticeably slower than on a laptop. `render.yaml` sets `HALALCHECK_OCR_MAX_CONCURRENCY=1` so only one image is processed at a time.
- **Why the frontend calls Render directly.** Proxying `/api` through the frontend host would add another timeout limit, which a cold start plus OCR can exceed. That's also why CORS must be configured on the backend.

## API

All errors share one shape: `{"error": {"code": "...", "message": "..."}}`. Messages are written to be shown to users.

| Endpoint | Description |
| --- | --- |
| `GET /api/health` | `{"status": "ok", "ocr_available": true}` |
| `POST /api/ingredients/extract` | Multipart form with an `image` field (JPEG, PNG or WebP, up to 10 MB). Returns `{text, confidence, word_count, uncertain_words, low_confidence}`. |
| `GET /api/products/search?q={query}&page={n}` | Validates the query (2–100 characters), then returns `501 product_lookup_unavailable` until a data source is connected. |
| `GET /api/products/barcode/{barcode}` | Validates the barcode (8–14 digits), then returns `501 product_lookup_unavailable` until a data source is connected. |

| Status | `error.code` | Meaning |
| --- | --- | --- |
| 400 | `invalid_request` | Missing or empty upload, or an invalid query, barcode or page |
| 400 | `invalid_image` | Corrupt image, too small, or too many pixels |
| 413 | `image_too_large` | Upload over the size limit |
| 415 | `unsupported_image_type` | Not a JPEG, PNG or WebP image |
| 422 | `no_text_found` | OCR found no readable text |
| 500 | `ocr_failed` | Tesseract returned an error |
| 501 | `product_lookup_unavailable` | No product data source is connected yet |
| 503 | `ocr_unavailable` | Tesseract isn't installed or can't be run |
| 504 | `ocr_timeout` | OCR took longer than the configured timeout |

## Connecting a product data source

The frontend already handles search results, product details, missing fields and not-found barcodes. To connect a data source:

1. Implement the `ProductLookup` protocol in `backend/app/services/products.py`, with `search(query, page)` and `get_product(barcode)`. Raise `ProductNotFoundError` for unknown barcodes.
2. Return your implementation from `get_product_lookup()`.
3. Map the source's data onto the existing `Product` and `SearchResponse` models in `backend/app/models/product.py`. Keep barcodes as strings, and leave missing fields as `null` or empty.

An earlier Open Food Facts implementation is in the git history at commit `b7e5298`.

## Tests and checks

```bash
# Backend
cd backend
pytest                 # API, validation, preprocessing and OCR tests. Tests that use the real
                       # Tesseract binary are skipped automatically if it isn't installed.
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

- **OCR accuracy depends on the photo.** Curved, glossy, blurry or badly lit packaging produces mistakes, such as "£471" instead of "E471". Users should always compare the text with the label. The app flags uncertain words and low-confidence results.
- **Languages.** Only English is installed by default. Other languages need extra Tesseract language packs.
- **HEIC images.** HEIC files picked from a computer aren't accepted. iPhones convert photos to JPEG automatically when they're taken or chosen through the app.
- **No product lookups and no halal assessment yet.** Both are planned for later milestones.
