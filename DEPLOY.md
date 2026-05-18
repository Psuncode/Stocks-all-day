# Deploy Guide — trader.psunproduction.com

Target: deploy the Swing Workspace MVP to `https://trader.psunproduction.com`, hosted on Vercel, with a daily cron that DMs Slack on invalidations.

**Code repo:** `github.com/Psuncode/Stocks-all-day`
**Personal site:** `psunproduction.com` (untouched — only adds a subdomain)
**Hosting:** Vercel Hobby (free) tier
**Effort:** ~30 minutes if you have all the accounts ready

---

## Prerequisites (have these accounts/access)

- [ ] GitHub account with the repo `github.com/Psuncode/Stocks-all-day` created (can be empty)
- [ ] Vercel account (`vercel.com/signup` — use GitHub OAuth)
- [ ] Slack workspace where you can install apps (personal or team)
- [ ] Access to DNS records for `psunproduction.com` (registrar or DNS host)

---

## Step 1 — Push code to GitHub (5 min)

From the repo root:

```bash
cd "/Users/philipsun/Documents/Swing Trader Tool/swing-trader-demo"

# Set remote (only if not already set)
git remote add origin https://github.com/Psuncode/Stocks-all-day.git

# Push current main branch
git push -u origin main
```

If the GitHub repo is non-empty (e.g. has a README), force the push:

```bash
git push -u origin main --force
```

(Safe here — there's no upstream history we're overwriting that matters.)

---

## Step 2 — Create Slack incoming webhook (5 min)

Skip this if you already have one.

1. Go to `https://api.slack.com/apps` and click **Create New App** → **From scratch**
2. Name: `Swing Alerts` (or whatever). Workspace: your personal one.
3. In the app settings, click **Incoming Webhooks** → toggle **Activate Incoming Webhooks** on
4. Click **Add New Webhook to Workspace**
5. Pick the channel — recommended: **DM to yourself** (search "@yourself" in the channel picker), or create a `#swing-alerts` channel and pick that
6. Copy the webhook URL (`https://hooks.slack.com/services/T.../B.../...`) — keep it safe, treat it like a password

---

## Step 3 — Create the Vercel project (5 min)

1. Go to `https://vercel.com/new`
2. Import Git Repository → pick `Psuncode/Stocks-all-day`
3. **Important:** when Vercel asks for the **Root Directory**, set it to `swing-trader-demo` (this is the Next.js app subdirectory; the repo root holds CLAUDE.md and the archived Vite frontend)
4. Framework Preset: **Next.js** (auto-detected)
5. Build & Output settings: leave defaults
6. **Don't click Deploy yet** — set env vars first (Step 4)

---

## Step 4 — Set environment variables in Vercel (5 min)

In the same import screen, click **Environment Variables** and add each of these. All scoped to **Production, Preview, Development** unless noted:

| Variable | Value | Notes |
|---|---|---|
| `SLACK_WEBHOOK_URL` | `<your webhook URL from Step 2>` | Production only — don't leak to preview branches |
| `CRON_SECRET` | Generate with `openssl rand -hex 32` and paste | Production only |
| `ACCOUNT_EQUITY_USD` | `33000` | Adjust if your stock account size changes |
| `NEXT_PUBLIC_APP_URL` | `https://trader.psunproduction.com` | The eventual public URL; Slack message links use this |
| `GEMINI_API_KEY` | *(optional — your existing key, or leave blank)* | Powers Gemini explanations on `/symbol/[ticker]` |
| `WATCHLIST_PATH` | *(leave unset)* | Defaults to `data/watchlist.yaml` in the repo |

Generate `CRON_SECRET` locally:

```bash
openssl rand -hex 32
```

Click **Deploy**. First build takes ~2 minutes.

After deploy: confirm the temporary URL works — `https://stocks-all-day-<random>.vercel.app`. Visit `/scanner` and `/watchlist` to smoke-test.

---

## Step 5 — Add custom domain (5 min)

1. In the Vercel project, go to **Settings** → **Domains**
2. Add domain: `trader.psunproduction.com`
3. Vercel shows the DNS record you need to create. Two options:
   - **CNAME (recommended for subdomains):** `trader.psunproduction.com` → `cname.vercel-dns.com`
   - **A record:** point to Vercel's IP (Vercel will show the current one)
4. Go to wherever `psunproduction.com` is managed (registrar's DNS panel — Namecheap, Cloudflare, GoDaddy, etc.) and add the CNAME:

   | Type | Host | Value | TTL |
   |---|---|---|---|
   | CNAME | `trader` | `cname.vercel-dns.com` | 3600 (or auto) |

5. Back in Vercel, wait 1-5 minutes for DNS propagation. Vercel auto-provisions SSL.
6. Visit `https://trader.psunproduction.com` — should serve your app.

---

## Step 6 — Verify Vercel Cron is registered (2 min)

1. In the Vercel project: **Settings** → **Cron Jobs** (or **Logs** → **Cron Jobs** depending on UI version)
2. Confirm one cron is listed:
   - Path: `/api/check-invalidations`
   - Schedule: `5 21 * * 1-5` (= 21:05 UTC ≈ 16:05 ET, Mon-Fri)
3. Click **Run** (or the equivalent "manually trigger" button) to test now without waiting
4. Check the function logs — should see your request, a JSON response, and either a Slack message (if any rules fire) or a "no fires" log

---

## Step 7 — Live-fire test (5 min)

Confirm the whole loop end-to-end before you trust it.

1. In your local checkout, temporarily edit `data/watchlist.yaml`:
   - Change ANGX `thesis_type` from `catalyst` to `mixed` (so price rules are allowed)
   - Add a forced rule under `invalidation_rules`:
     ```yaml
     - id: forced_fire_test
       description: "deploy verification — fires immediately"
       signal: price_below
       level: 999
     ```
2. Commit + push:
   ```bash
   git add data/watchlist.yaml
   git commit -m "test: force-fire rule for deploy verification"
   git push
   ```
3. Wait for Vercel to deploy (~2 min). Then either:
   - Manually trigger the cron from Vercel dashboard
   - Or run: `curl -X POST https://trader.psunproduction.com/api/check-invalidations -H "Authorization: Bearer <CRON_SECRET>"`
4. **Expected:** Slack DM arrives within ~10 seconds with the forced fire bulleted, linking to `https://trader.psunproduction.com/symbol/ANGX`
5. **Caveat:** The 7-day dedup will suppress this fire if ANGX has closed below $999 on any of the last 7 sessions (it always has). To bypass, use a level just above the most recent close — e.g. `2.70` if ANGX last closed at 2.67. Adjust the level upward to a price the stock cleared in the last week, like `3.50`, to guarantee fire without suppression.
6. Once you've seen the Slack message: revert the test commit:
   ```bash
   git revert HEAD
   git push
   ```

---

## Step 8 — Link from psunproduction.com

Tell visitors the tool exists. Suggested copy for a project/venture section of your main site:

> **Swing Workspace** — a personal swing-trading decision engine.
> Tracks watchlist theses, fires alerts when invalidation conditions hit.
> [trader.psunproduction.com →](https://trader.psunproduction.com)

---

## Operating the tool (post-deploy)

### Daily edits

The watchlist is `data/watchlist.yaml` committed to git. To add/edit/drop tickers:

1. Edit the YAML in your Obsidian vault (or directly in the repo)
2. Commit + push
3. Vercel rebuilds in ~2 minutes; new state visible on `/watchlist`

The cron picks up the latest committed YAML on each daily run.

### Slack expectations

- **One DM per day max**, only if something fired
- Silence ≠ broken — silence means nothing crossed your invalidation thresholds
- If you want to confirm the cron is running, check Vercel **Cron Jobs** → **Logs** weekly during the Inara sprint

### When a fire arrives

1. Open the Slack message; click the ticker link → `/symbol/TICKER` shows full thesis + the rule that fired
2. Decide: was this the death of the thesis, or noise?
3. If thesis died: edit YAML, set `status: dropped`, add `dropped_at` + `dropped_reason`, push
4. If noise: edit the rule (raise threshold, change signal) and push
5. Both flows are git commits — your decision history is the commit log

### Killing the cron (post-Aug 17 if needed)

Remove `vercel.json` from the repo, push. Or in Vercel dashboard: **Settings** → **Cron Jobs** → disable.

---

## Troubleshooting

| Symptom | Likely cause | Fix |
|---|---|---|
| 401 on `/api/check-invalidations` | `CRON_SECRET` mismatch | Verify env var in Vercel matches what you pass in curl |
| Slack message never arrives | `SLACK_WEBHOOK_URL` unset or invalid | Check Vercel function logs; rotate webhook if leaked |
| Cron not running | Vercel hobby plan limits | Check **Cron Jobs** page; daily Mon-Fri is well within hobby limits |
| Domain shows Vercel error | DNS not propagated yet | Wait 5-10 min; verify CNAME with `dig trader.psunproduction.com` |
| Watchlist shows "no tickers" | YAML parse error or path mismatch | Check Vercel logs; confirm `data/watchlist.yaml` exists in the deployed bundle (it's in the repo, so it should) |
| Schema-errors banner on `/watchlist` | YAML has invalid fields | Banner shows what's wrong; fix in vault, push |

---

## Security notes

- Treat `SLACK_WEBHOOK_URL` and `CRON_SECRET` as secrets. They're in Vercel env vars, never in the repo.
- `data/watchlist.yaml` contains your trading theses — committed publicly to `Psuncode/Stocks-all-day`. If the repo is public, anyone can see what you're tracking. Make the repo **private** if that's a concern.
- The cron endpoint is auth-gated by `CRON_SECRET`. Vercel adds this header automatically; external callers without it get 401.
- `.env.local` is in `.gitignore` — never commit a real `SLACK_WEBHOOK_URL` to the repo.

---

## After deploy (the freeze)

Per `CLAUDE.md` strategic priorities: do not touch this repo between 2026-06-17 and 2026-08-17 unless production is broken. If you spot improvements during the Inara sprint, write them to `post-aug17-ideas.md` and close the laptop.
