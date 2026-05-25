// Back-compat shim. The original single-TSA client now lives in tsq.ts +
// tsa-providers.ts. Kept so anything that still imports stampHash() works.

import { requestTimestamp, type StampResult } from "./tsq";
import { TSA_PROVIDERS } from "./tsa-providers";

const FREETSA = TSA_PROVIDERS.find((p) => p.label === "freetsa")!;

export type { StampResult };

export async function stampHash(hashHex: string): Promise<StampResult> {
  return requestTimestamp(FREETSA, hashHex);
}
