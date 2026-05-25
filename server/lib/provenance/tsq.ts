// Shared RFC 3161 TimeStampReq builder + generic POST client.
// Used by every TSA provider (FreeTSA, DFN, ...) so the ASN.1 lives in one
// place. The provider files only carry config (URL, cert URL, label).

import forge from "node-forge";

const SHA256_OID = "2.16.840.1.101.3.4.2.1";
const DEFAULT_TIMEOUT_MS = 15_000;

export interface StampResult {
  tsaUrl: string;
  tsaLabel: string;
  requestHash: string;          // hex of the hash we sent
  tsaResponse: Uint8Array;      // raw .tsr bytes
  tsaCert: Uint8Array | null;   // raw cert chain bytes (if provider exposed one)
}

// Build an RFC 3161 TimeStampReq for a SHA-256 hash.
// TimeStampReq ::= SEQUENCE { version, messageImprint, nonce, certReq=TRUE }
export function buildTimeStampReq(hashHex: string): Uint8Array {
  if (!/^[0-9a-f]{64}$/i.test(hashHex)) {
    throw new Error(`buildTimeStampReq: invalid sha256 hex "${hashHex.slice(0, 16)}…"`);
  }

  const asn1 = forge.asn1;
  const hashBytes = forge.util.hexToBytes(hashHex);

  const algorithmIdentifier = asn1.create(asn1.Class.UNIVERSAL, asn1.Type.SEQUENCE, true, [
    asn1.create(asn1.Class.UNIVERSAL, asn1.Type.OID, false, asn1.oidToDer(SHA256_OID).getBytes()),
    asn1.create(asn1.Class.UNIVERSAL, asn1.Type.NULL, false, ""),
  ]);

  const messageImprint = asn1.create(asn1.Class.UNIVERSAL, asn1.Type.SEQUENCE, true, [
    algorithmIdentifier,
    asn1.create(asn1.Class.UNIVERSAL, asn1.Type.OCTETSTRING, false, hashBytes),
  ]);

  const version = asn1.create(asn1.Class.UNIVERSAL, asn1.Type.INTEGER, false, String.fromCharCode(0x01));

  let nonce = forge.random.getBytesSync(8);
  if (nonce.charCodeAt(0) & 0x80) {
    nonce = String.fromCharCode(nonce.charCodeAt(0) & 0x7f) + nonce.slice(1);
  }
  const nonceAsn1 = asn1.create(asn1.Class.UNIVERSAL, asn1.Type.INTEGER, false, nonce);

  const certReqTrue = asn1.create(asn1.Class.UNIVERSAL, asn1.Type.BOOLEAN, false, String.fromCharCode(0xff));

  const req = asn1.create(asn1.Class.UNIVERSAL, asn1.Type.SEQUENCE, true, [
    version,
    messageImprint,
    nonceAsn1,
    certReqTrue,
  ]);

  const der = asn1.toDer(req).getBytes();
  return new Uint8Array(der.split("").map((c) => c.charCodeAt(0)));
}

export interface TsaProvider {
  label: string;          // short id, used in filenames and logs
  url: string;            // RFC 3161 endpoint
  certUrl?: string;       // optional standalone cert chain (PEM or DER)
  timeoutMs?: number;
}

// Per-process cert cache keyed by provider URL.
const certCache = new Map<string, Uint8Array>();

async function fetchProviderCert(provider: TsaProvider): Promise<Uint8Array | null> {
  if (!provider.certUrl) return null;
  const cached = certCache.get(provider.url);
  if (cached) return cached;
  try {
    const resp = await fetch(provider.certUrl, {
      signal: AbortSignal.timeout(provider.timeoutMs ?? DEFAULT_TIMEOUT_MS),
    });
    if (!resp.ok) return null;
    const buf = new Uint8Array(await resp.arrayBuffer());
    certCache.set(provider.url, buf);
    return buf;
  } catch {
    return null;
  }
}

// Submit a SHA-256 hex hash to a TSA and return the raw .tsr bytes plus the
// provider's cert chain (if it exposes one). Throws on network / HTTP error.
export async function requestTimestamp(provider: TsaProvider, hashHex: string): Promise<StampResult> {
  const reqBytes = buildTimeStampReq(hashHex);
  const resp = await fetch(provider.url, {
    method: "POST",
    headers: {
      "Content-Type": "application/timestamp-query",
      Accept: "application/timestamp-reply",
    },
    body: Buffer.from(reqBytes),
    signal: AbortSignal.timeout(provider.timeoutMs ?? DEFAULT_TIMEOUT_MS),
  });

  if (!resp.ok) {
    const errText = await resp.text().catch(() => "");
    throw new Error(`${provider.label} HTTP ${resp.status}: ${errText.slice(0, 200)}`);
  }

  const tsaResponse = new Uint8Array(await resp.arrayBuffer());
  const tsaCert = await fetchProviderCert(provider);

  return {
    tsaUrl: provider.url,
    tsaLabel: provider.label,
    requestHash: hashHex,
    tsaResponse,
    tsaCert,
  };
}
