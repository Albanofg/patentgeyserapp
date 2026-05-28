/**
 * Env-variable accessors that fail loudly at boot rather than crashing
 * mid-request when a value is missing. Replace `process.env.X!` (which lies
 * to TypeScript and surfaces as a confusing runtime error somewhere deep) with
 * `requireEnv("X")` at module load time. If the variable is unset or blank,
 * the process throws with a clear message before serving any traffic.
 */

export function requireEnv(name: string): string {
  const raw = process.env[name];
  if (typeof raw !== "string" || raw.trim() === "") {
    throw new Error(
      `Missing required environment variable: ${name}. ` +
        `Set it in .env (local) and in your hosting provider's env config (production).`,
    );
  }
  return raw.trim();
}

/**
 * Comma-separated list variant. Use for env vars that hold N>=1 values such
 * as ADMIN_EMAILS. Throws if unset, blank, or contains only empty entries
 * after splitting.
 */
export function requireEnvList(name: string, separator: string = ","): string[] {
  const value = requireEnv(name);
  const parts = value
    .split(separator)
    .map((p) => p.trim())
    .filter((p) => p.length > 0);
  if (parts.length === 0) {
    throw new Error(
      `Environment variable ${name} is set but contains no valid entries ` +
        `after splitting on "${separator}".`,
    );
  }
  return parts;
}
