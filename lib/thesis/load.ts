import fs from "node:fs/promises";
import path from "node:path";
import yaml from "js-yaml";
import { z } from "zod";
import { Watchlist } from "./schema";
import type { Watchlist as WatchlistT } from "./schema";

export type LoadError = {
  path: (string | number)[];
  message: string;
};

export type LoadResult = {
  watchlist: WatchlistT;
  errors: LoadError[];
  source: string;
};

const EMPTY: WatchlistT = { version: 1, risk_pct: 0.5, tickers: [] };

function resolvePath(): string {
  const env = process.env.WATCHLIST_PATH;
  if (env && env.length > 0) {
    return path.isAbsolute(env) ? env : path.join(process.cwd(), env);
  }
  return path.join(process.cwd(), "data", "watchlist.yaml");
}

export async function loadWatchlist(): Promise<LoadResult> {
  const filePath = resolvePath();
  let yamlText: string;
  try {
    yamlText = await fs.readFile(filePath, "utf-8");
  } catch (e) {
    const err = e as NodeJS.ErrnoException;
    if (err.code === "ENOENT") {
      return {
        watchlist: EMPTY,
        errors: [
          {
            path: [],
            message: `Watchlist file not found at ${filePath}. Create it or set WATCHLIST_PATH.`,
          },
        ],
        source: filePath,
      };
    }
    return {
      watchlist: EMPTY,
      errors: [{ path: [], message: `Read error: ${err.message}` }],
      source: filePath,
    };
  }

  let raw: unknown;
  try {
    raw = yaml.load(yamlText);
  } catch (e) {
    return {
      watchlist: EMPTY,
      errors: [
        {
          path: [],
          message: `YAML parse error: ${(e as Error).message}`,
        },
      ],
      source: filePath,
    };
  }

  const result = Watchlist.safeParse(raw);
  if (result.success) {
    return { watchlist: result.data, errors: [], source: filePath };
  }
  return {
    watchlist: EMPTY,
    errors: result.error.issues.map(zodIssueToError),
    source: filePath,
  };
}

function zodIssueToError(issue: z.ZodIssue): LoadError {
  return {
    path: issue.path.map((p) => (typeof p === "symbol" ? p.toString() : p)),
    message: issue.message,
  };
}
