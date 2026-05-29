// Type declarations for archiver v8. DefinitelyTyped (@types/archiver) maxes
// out at v7 — that package describes archiver's old callable function API,
// which v8 dropped. archiver v8 is pure ESM and exports named classes
// (Archiver, ZipArchive, TarArchive, JsonArchive) instead.
//
// This file describes the v8 surface the app actually uses (ZipArchive plus
// the inherited streaming/append/finalize methods). Removing the misleading
// @types/archiver dep in favor of this lets TypeScript stay strict at every
// call site without `as any` casts.
//
// Drop this file when archiver itself starts shipping .d.ts files, or when
// DefinitelyTyped publishes a real v8 types package. Widen the class shapes
// only when a new method is actually called by the app — keeping the surface
// minimal keeps every usage type-checked rather than `any`-soaked.

declare module "archiver" {
  import type { Writable } from "stream";

  export class Archiver extends Writable {
    on(event: "error", listener: (err: Error) => void): this;
    on(event: "end" | "close" | "finish" | "warning", listener: () => void): this;
    on(event: string, listener: (...args: any[]) => void): this;
    pipe<T extends NodeJS.WritableStream>(destination: T): T;
    append(
      source: string | Buffer | NodeJS.ReadableStream,
      data?: { name: string },
    ): this;
    finalize(): Promise<void>;
    pointer(): number;
    abort(): void;
  }

  export class ZipArchive extends Archiver {
    constructor(options?: { zlib?: { level?: number } });
  }

  export class TarArchive extends Archiver {
    constructor(options?: Record<string, unknown>);
  }

  export class JsonArchive extends Archiver {
    constructor(options?: Record<string, unknown>);
  }
}
