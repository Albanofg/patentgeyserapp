// Active free RFC 3161 TSAs. Order matters for proof-package filenames
// (timestamp-response-1.tsr is providers[0], -2.tsr is providers[1], …).
//
// To add a TSA: append to this list. To remove: delete from this list. The
// checkpoint flow tries all in parallel and stores one row per success.

import type { TsaProvider } from "./tsq";

export const TSA_PROVIDERS: readonly TsaProvider[] = [
  {
    label: "freetsa",
    url: "https://freetsa.org/tsr",
    certUrl: "https://freetsa.org/files/tsa.crt",
  },
  {
    label: "dfn",
    url: "http://zeitstempel.dfn.de",
    // DFN does not publish a stable standalone cert URL — cert is embedded
    // in the response (certReq=TRUE) and is sufficient for verification.
  },
];
