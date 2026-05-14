/**
 * Per-request usage attribution context.
 *
 * Set once at the route layer (via `runWithUsageContext`) and read by
 * `callAgent` so every AI invocation can be attributed back to a user,
 * project, and request without threading those values through every
 * module's function signature.
 *
 * If a call happens outside an HTTP request (e.g. a background script),
 * `getUsageContext()` returns null and rows fall back to the legacy
 * "(unattributed)" presentation. That's the same shape as before this
 * file existed — nothing breaks if no context is set.
 */

import { AsyncLocalStorage } from "node:async_hooks";

export interface UsageContext {
  userId?: string | null;
  userEmail?: string | null;
  projectId?: string | null;
  requestId?: string | null;
}

const storage = new AsyncLocalStorage<UsageContext>();

export function runWithUsageContext<T>(ctx: UsageContext, fn: () => Promise<T> | T): Promise<T> | T {
  return storage.run(ctx, fn);
}

export function getUsageContext(): UsageContext | null {
  return storage.getStore() ?? null;
}
