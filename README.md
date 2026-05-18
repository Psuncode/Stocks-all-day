Swing Decision Engine (Demo)

A small Next.js demo app that runs a **rule-based swing-trading “decision engine”** over a mock universe and outputs **PASS / WATCH / TRADE**.

- It is designed to help you **pass instantly** (filter-first), not to predict.
- It ships with an optional **Gemini** integration for plain-English explanations (server-side only).

Not investment advice.

## Getting Started

First, run the development server:

```bash
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) with your browser.

The main UI lives at:

- `/scanner` — list view + filters + “Why blocked?” drawer
- `/symbol/[TICKER]` — gate-by-gate breakdown
- `/watchlist` — save tickers locally + refresh decisions
- `/settings` — Gemini + deploy notes

## Gemini (optional)

1. Copy env template:

```bash
cp .env.example .env.local
```

2. Set `GEMINI_API_KEY` in `.env.local`.

Gemini requests go through `app/api/gemini/route.ts` so the key stays on the server.

## Deploy (go live)

This is a standard Next.js app. The simplest “go live” path is Vercel:

1. Push this repo to GitHub.
2. Import it in Vercel.
3. (Optional) Set env vars:
   - `GEMINI_API_KEY`
   - `GEMINI_MODEL` (defaults to `gemini-1.5-flash`)

Note: the demo currently uses mock market data. If you want live market data, add a real data provider in `lib/data/provider.ts`.

You can start editing the page by modifying `app/page.tsx`. The page auto-updates as you edit the file.

This project uses [`next/font`](https://nextjs.org/docs/app/building-your-application/optimizing/fonts) to automatically optimize and load [Geist](https://vercel.com/font), a new font family for Vercel.

## Learn More

To learn more about Next.js, take a look at the following resources:

- [Next.js Documentation](https://nextjs.org/docs) - learn about Next.js features and API.
- [Learn Next.js](https://nextjs.org/learn) - an interactive Next.js tutorial.

You can check out [the Next.js GitHub repository](https://github.com/vercel/next.js) - your feedback and contributions are welcome!

## Deploy on Vercel

The easiest way to deploy your Next.js app is to use the [Vercel Platform](https://vercel.com/new?utm_medium=default-template&filter=next.js&utm_source=create-next-app&utm_campaign=create-next-app-readme) from the creators of Next.js.

Check out our [Next.js deployment documentation](https://nextjs.org/docs/app/building-your-application/deploying) for more details.
