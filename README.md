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

