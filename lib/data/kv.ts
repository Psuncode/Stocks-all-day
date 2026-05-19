/**
 * Upstash Redis client wrapper for the digest archive (Feature E) and the
 * quick-watch store (Feature F).
 *
 * Setup is documented in KV-SETUP.md. Two env vars need to be set in Vercel
 * (auto-populated when you install the Upstash KV integration from the
 * Vercel marketplace OR set manually if you provision Upstash directly):
 *   - UPSTASH_REDIS_REST_URL
 *   - UPSTASH_REDIS_REST_TOKEN
 *
 * Failure-soft pattern: if the env vars are missing, getKv() returns null
 * and callers gracefully skip persistence (matching the Slack-failure
 * pattern in slack.ts). Cron never blocks on storage being unavailable.
 */

import { Redis } from "@upstash/redis";

let cached: Redis | null | undefined;

export function getKv(): Redis | null {
  if (cached !== undefined) return cached;
  // Vercel's Upstash KV integration injects KV_*-prefixed env vars; the
  // Upstash console-direct path uses UPSTASH_* prefixes. Accept either.
  const url =
    process.env.UPSTASH_REDIS_REST_URL ?? process.env.KV_REST_API_URL;
  const token =
    process.env.UPSTASH_REDIS_REST_TOKEN ?? process.env.KV_REST_API_TOKEN;
  if (!url || !token) {
    cached = null;
    return null;
  }
  cached = new Redis({ url, token });
  return cached;
}

export function kvAvailable(): boolean {
  return getKv() !== null;
}
