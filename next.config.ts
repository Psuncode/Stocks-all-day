import type { NextConfig } from "next";

/**
 * yahoo-finance2 transitively imports @deno/shim-deno which references
 * Node-only modules (fs/promises, etc). We only call yahoo-finance2 from
 * server routes (`runtime = "nodejs"`), but Next's bundler still tries
 * to trace those imports for client chunks. The combo below tells Next:
 *
 *   1) Don't try to webpack-bundle yahoo-finance2 / shim-deno at all on
 *      the server — load them as native node_modules at runtime.
 *   2) On the client bundle, alias all node-only modules to `false` so
 *      if they're ever pulled in by a stray import they're tree-shaken
 *      to a no-op.
 */
const nextConfig: NextConfig = {
  serverExternalPackages: ["yahoo-finance2", "@deno/shim-deno"],
  webpack: (config, { isServer }) => {
    if (!isServer) {
      config.resolve = config.resolve ?? {};
      config.resolve.fallback = {
        ...(config.resolve.fallback ?? {}),
        fs: false,
        "fs/promises": false,
        path: false,
        os: false,
        crypto: false,
        stream: false,
        http: false,
        https: false,
        net: false,
        tls: false,
        zlib: false,
        url: false,
        buffer: false,
        util: false,
        child_process: false,
        worker_threads: false,
        perf_hooks: false,
      };
    }
    return config;
  },
};

export default nextConfig;
