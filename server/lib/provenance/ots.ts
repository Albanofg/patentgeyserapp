// OpenTimestamps client. Submits a 32-byte SHA-256 digest to one or more
// free public Bitcoin calendars and returns the raw .ots proof bytes from
// each. Each calendar produces an independently verifiable proof; we store
// every successful response so the daily anchor doesn't depend on a single
// calendar staying online.
//
// Wire format: POST <calendar>/digest with the raw 32-byte digest as body.
// Response is the binary OpenTimestamps proof (content-type
// application/vnd.opentimestamps.v1). We do not parse it — the standard
// `ots verify` CLI and the python-opentimestamps library both consume it
// directly. We store and ship the raw bytes.

const DEFAULT_TIMEOUT_MS = 15_000;

export interface OtsCalendar {
  label: string;
  url: string;        // base URL — `/digest` is appended
  timeoutMs?: number;
}

// Free, no-auth, no-account Bitcoin calendars maintained by the
// OpenTimestamps and Eternity Wall projects. Submitting to all three gives
// independent attestations.
export const OTS_CALENDARS: readonly OtsCalendar[] = [
  { label: "alice",   url: "https://alice.btc.calendar.opentimestamps.org" },
  { label: "bob",     url: "https://bob.btc.calendar.opentimestamps.org" },
  { label: "finney",  url: "https://finney.calendar.eternitywall.com" },
];

export interface OtsSubmitResult {
  label: string;
  url: string;
  proof: Uint8Array;        // raw .ots bytes
  digestHex: string;        // what we submitted
}

export async function submitDigestToCalendar(
  calendar: OtsCalendar,
  digest: Uint8Array,
): Promise<OtsSubmitResult> {
  if (digest.length !== 32) {
    throw new Error(`ots: digest must be 32 bytes, got ${digest.length}`);
  }
  const resp = await fetch(calendar.url + "/digest", {
    method: "POST",
    headers: {
      "Content-Type": "application/octet-stream",
      Accept: "application/octet-stream",
    },
    body: Buffer.from(digest),
    signal: AbortSignal.timeout(calendar.timeoutMs ?? DEFAULT_TIMEOUT_MS),
  });
  if (!resp.ok) {
    const errText = await resp.text().catch(() => "");
    throw new Error(`OTS ${calendar.label} HTTP ${resp.status}: ${errText.slice(0, 200)}`);
  }
  const proof = new Uint8Array(await resp.arrayBuffer());
  return {
    label: calendar.label,
    url: calendar.url,
    proof,
    digestHex: Buffer.from(digest).toString("hex"),
  };
}

export interface OtsAnchorResult {
  successes: OtsSubmitResult[];
  failures: { label: string; url: string; error: string }[];
}

// Submit the same digest to every configured calendar in parallel.
// Returns successes + failures so the caller can record a partial anchor
// (anchor is valid if ≥1 calendar succeeded).
export async function submitDigestToAllCalendars(digest: Uint8Array): Promise<OtsAnchorResult> {
  const results = await Promise.allSettled(
    OTS_CALENDARS.map((c) => submitDigestToCalendar(c, digest)),
  );
  const successes: OtsSubmitResult[] = [];
  const failures: { label: string; url: string; error: string }[] = [];
  results.forEach((r, i) => {
    const c = OTS_CALENDARS[i];
    if (r.status === "fulfilled") successes.push(r.value);
    else failures.push({ label: c.label, url: c.url, error: r.reason?.message || String(r.reason) });
  });
  return { successes, failures };
}
