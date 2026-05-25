// Canonical JSON serializer. Produces a deterministic string for any JSON-
// compatible value so the same logical payload always hashes to the same
// bytes regardless of source-key order or whitespace.
//
// Rules:
//   - Objects: keys sorted lexicographically.
//   - Arrays: order preserved (semantic order matters).
//   - Strings, numbers, booleans, null: standard JSON.
//   - undefined: dropped from objects (matches JSON.stringify); becomes null
//     inside arrays so array index positions are preserved.
//   - Functions / Symbols / BigInts / Dates: not supported (throw).

export function canonicalize(value: unknown): string {
  return JSON.stringify(canonicalForm(value));
}

function canonicalForm(value: unknown): unknown {
  if (value === null) return null;
  const t = typeof value;
  if (t === "string" || t === "boolean") return value;
  if (t === "number") {
    if (!Number.isFinite(value as number)) {
      throw new Error("canonicalize: non-finite number is not JSON-safe");
    }
    return value;
  }
  if (t === "undefined") return null;
  if (Array.isArray(value)) {
    return value.map((v) => (v === undefined ? null : canonicalForm(v)));
  }
  if (t === "object") {
    const obj = value as Record<string, unknown>;
    const keys = Object.keys(obj).filter((k) => obj[k] !== undefined).sort();
    const out: Record<string, unknown> = {};
    for (const k of keys) out[k] = canonicalForm(obj[k]);
    return out;
  }
  throw new Error(`canonicalize: unsupported type "${t}"`);
}
