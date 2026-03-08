# SainzCal AI (Web)

Cal AI-style food scanner built with Next.js and Gemini 1.5 Flash.

## Local development

```bash
npm install
npm run dev
```

Open `http://localhost:3000`.

## Environment variable

Create `.env.local`:

```bash
GEMINI_API_KEY=your_gemini_api_key
```

The app uses `app/api/analyze/route.ts` as the Gemini integration endpoint.

## Local product index (optional, recommended)

If you downloaded the Open Food Facts dump to:

- `data/raw/off/en.openfoodfacts.org.products.csv.gz`

you can build a local barcode/name index:

```bash
npm run build:food-index
```

This generates:

- `data/index/off-food-index.v1.json`

When present, the API route uses it as first lookup for packaged products (barcode/text), then falls back to Open Food Facts online.

## Production build

```bash
npm run build
npm run start
```

## Deploy to Vercel

1. Push this repo to GitHub.
2. Import the repo in Vercel.
3. Set env var `GEMINI_API_KEY` in Project Settings -> Environment Variables.
4. Deploy.
