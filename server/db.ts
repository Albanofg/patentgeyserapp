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

export const db = drizzle({ client: pool, schema });
