// Lazy-load archiver v8.
//
// archiver v8 is pure ESM and exports named classes — `archiver(...)` no
// longer works at runtime; you construct via `new ZipArchive(opts)`. The
// module surface is declared in [server/types/archiver.d.ts], so this loader
// stays fully typed without `as any` casts.
//
// Why dynamic import: archiver pulls in zip + tar + zlib + async-queue glue.
// The proof-package endpoint is the only consumer, so we pay the load cost
// once on first use rather than at every server boot.

import type { ZipArchive } from "archiver";

export type { ZipArchive };

export interface ZipArchiveOptions {
  zlib?: { level?: number };
}

/**
 * Lazily import archiver and construct a ZipArchive. The instance exposes the
 * usual `.append / .pipe / .on('error') / .finalize()` API; see the ambient
 * declaration in server/types/archiver.d.ts for the typed surface.
 */
export async function createZipArchive(options?: ZipArchiveOptions): Promise<ZipArchive> {
  const { ZipArchive: ZipArchiveCtor } = await import("archiver");
  return new ZipArchiveCtor(options);
}
