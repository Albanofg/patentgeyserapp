// Database connection setup using the javascript_database blueprint
import { Pool, neonConfig } from '@neondatabase/serverless';
import { drizzle } from 'drizzle-orm/neon-serverless';
import ws from "ws";
import * as schema from "@shared/schema";

neonConfig.webSocketConstructor = ws;

if (!process.env.DATABASE_URL) {
  throw new Error(
    "DATABASE_URL must be set. Did you forget to provision a database?",
  );
}

export const pool = new Pool({ 
  connectionString: process.env.DATABASE_URL,
  max: 10,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 10000,
});

// Handle pool errors gracefully to prevent crashes from Neon's idle connection termination
pool.on('error', (err: Error & { code?: string }) => {
  // Error code 57P01 is "terminating connection due to administrator command"
  // This is normal behavior from Neon serverless when connections go idle
  if (err.code === '57P01') {
    console.log('PG Pool: Connection terminated by server (idle timeout) - this is normal');
  } else {
    console.error('PG Pool error:', err);
  }
  // Don't throw - the pool will create new connections as needed
});

// ─── Retry-once on transient Neon connect timeouts ──────────────────────────
// The @neondatabase/serverless driver throws "timeout exceeded when trying to
// connect" when connection establishment exceeds connectionTimeoutMillis (10s
// above). In production we've seen this fire in cascades when:
//   - Neon compute auto-suspends and a wake-up cold-start hits the 10s window
//   - Brief Neon network blip / pgbouncer churn / maintenance
//   - Concurrent function spike with long-running AI calls holding connections
//
// One automatic retry after a small backoff makes these self-heal: the
// triggering attempt wakes the compute; the retry lands on a warm connection.
// We ONLY retry on this specific connect-timeout phrase — SQL-level errors
// (syntax, missing relation, FK violation, etc.) propagate unmodified so we
// never paper over an actual bug.
//
// Wraps pool.connect and pool.query so every drizzle path inherits it without
// any call-site changes. If this ever needs to be turned off, comment out the
// monkey-patch lines below; nothing else depends on them.
const TRANSIENT_CONNECT_PHRASE = "timeout exceeded when trying to connect";

function isTransientConnectError(err: unknown): boolean {
  if (!err) return false;
  const message = err instanceof Error ? err.message : String(err);
  return message.includes(TRANSIENT_CONNECT_PHRASE);
}

async function retryOnceOnTransientConnect<T>(op: () => Promise<T>, label: string): Promise<T> {
  try {
    return await op();
  } catch (err) {
    if (!isTransientConnectError(err)) throw err;
    console.warn(`[db] retrying ${label} after transient connect error`);
    // 300ms gives a waking Neon compute a moment to come online before the
    // second attempt. Empirically Neon cold-starts complete well under 1s
    // once the wake signal lands.
    await new Promise((resolve) => setTimeout(resolve, 300));
    return await op();
  }
}

// Cast the bound originals to a permissive shape — the real Pool.connect /
// Pool.query are overloaded (multiple call signatures) and TS refuses to
// `...spread` into overloaded methods. We pass the args through unchanged.
const originalPoolConnect = pool.connect.bind(pool) as (...args: any[]) => Promise<any>;
const originalPoolQuery = pool.query.bind(pool) as (...args: any[]) => Promise<any>;
(pool as any).connect = (...args: any[]) =>
  retryOnceOnTransientConnect(() => originalPoolConnect(...args), "pool.connect");
(pool as any).query = (...args: any[]) =>
  retryOnceOnTransientConnect(() => originalPoolQuery(...args), "pool.query");

export const db = drizzle({ client: pool, schema });
