# Upstash Redis (KV) — 5-minute setup for `/digest`

The digest archive (Feature E) needs a small server-side keyed store. Vercel KV is now powered by Upstash; this guide uses the **Upstash native** path because it works whether you provision through the Vercel Marketplace or the Upstash console directly.

You'll end up with two env vars in your Vercel project:

```
UPSTASH_REDIS_REST_URL
UPSTASH_REDIS_REST_TOKEN
```

Once set, the cron will start persisting snapshots automatically on its next run and `/digest` will start showing data.

---

## Option A — Provision via Vercel Marketplace (recommended)

1. Go to your Vercel project: `https://vercel.com/psuncodes-projects/stocks-all-day`
2. Click the **Storage** tab in the project nav
3. Click **Create** → search the marketplace for **Upstash for Redis** → choose the **Free** plan (Hobby tier covers our use)
4. Pick a name (e.g. `swing-store`), region close to your Vercel deployment (`us-east-1` is fine for `iad1` Vercel)
5. Click **Create**
6. When prompted **"Connect to project?"** → check `stocks-all-day` → **Connect**

Vercel auto-injects the two env vars into your project. Done.

## Option B — Provision via Upstash console (portable)

1. Go to `https://console.upstash.com/redis` and sign in (GitHub login is easiest)
2. **Create Database** → name it `swing-store` → region matching your Vercel deployment → **Free** plan
3. On the database detail page, find the **REST API** section
4. Copy `UPSTASH_REDIS_REST_URL` and `UPSTASH_REDIS_REST_TOKEN`
5. In Vercel project settings → **Environment Variables**, add both for **Production** (and optionally Preview/Dev)

---

## Verify

After setup:

1. Trigger the cron once:

   ```bash
   curl -X POST https://trader.psunproduction.com/api/check-invalidations \
     -H "Authorization: Bearer $CRON_SECRET"
   ```

2. Wait for the response (it'll have `"digest": [...]`).
3. Visit `https://trader.psunproduction.com/digest` — today's snapshot should appear.

If `/digest` shows "Archive backend not configured", the env vars aren't reaching the deployed function. Common fixes:

- Confirm both vars are set in Vercel project settings → Environment Variables → **Production**
- Trigger a fresh deploy: push a no-op commit OR click **Redeploy** in the Vercel deployments tab. Env-var changes don't apply until the next build.

---

## What's stored

| Key | Type | Content |
|---|---|---|
| `digest:YYYY-MM-DD` | JSON | One day's snapshot — date, generatedAt, picks array |
| `digest:index` | Redis SET | All dates that have a snapshot |

Snapshots older than 60 days are auto-trimmed during each cron run.

## Costs

Free tier (hobby plan):
- 30,000 commands/month
- 256 MB max storage
- One database

Our usage: ~5 commands/day from cron + ~15 commands/visit on /digest. Roughly 200-500 commands/month at most. Well under the cap.

## Rotation

If you ever rotate the token (Upstash dashboard → database → reset token):
1. Copy the new token
2. Update `UPSTASH_REDIS_REST_TOKEN` in Vercel
3. Trigger a redeploy
