import { useEffect, useRef, useState } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ThemeToggle } from "@/components/theme-toggle";
import logoUrl from "@/assets/geyser-logo.png";

// Native EPD/NMI checkout. Card data is tokenized in-browser by Collect.js
// (loaded from secure.nmi.com) so we never see PAN/CVV on our servers.
// We forward full billing info to NMI for AVS + CVV checks — anti-fraud wall.

declare global {
  interface Window {
    CollectJS?: {
      configure: (cfg: Record<string, unknown>) => void;
      startPaymentRequest: () => void;
    };
  }
}

// Module-level (NOT useRef) so it survives React StrictMode's double-mount
// in dev. Calling CollectJS.configure() twice throws "too many fields".
let collectJsConfigured = false;

type PackId = "pack_1" | "pack_5";
const PACKS: { id: PackId; credits: number; price: string; note?: string }[] = [
  { id: "pack_1", credits: 1, price: "$299.00" },
  { id: "pack_5", credits: 5, price: "$1,160.00", note: "20% discount" },
];

type Buyer = {
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
  cardholderName: string;
  address: string;
  city: string;
  zip: string;
  country: string;
};

const EMPTY_BUYER: Buyer = {
  firstName: "",
  lastName: "",
  email: "",
  phone: "",
  cardholderName: "",
  address: "",
  city: "",
  zip: "",
  country: "US",
};

export default function Buy() {
  const [publicKey, setPublicKey] = useState<string | null>(null);
  const [configError, setConfigError] = useState<string | null>(null);
  const [collectReady, setCollectReady] = useState(false);

  const [packId, setPackId] = useState<PackId>("pack_1");
  const [buyer, setBuyer] = useState<Buyer>(EMPTY_BUYER);

  const [submitting, setSubmitting] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  // Collect.js callback runs globally — stash the in-flight submission so it
  // sees the latest values without re-registering on every render.
  const submissionRef = useRef<{ buyer: Buyer; packId: PackId } | null>(null);


  function setField<K extends keyof Buyer>(k: K, v: Buyer[K]) {
    setBuyer((b) => ({ ...b, [k]: v }));
  }

  useEffect(() => {
    fetch("/api/public/epd-config")
      .then((r) => r.json())
      .then((data) => {
        if (data?.publicKey) setPublicKey(data.publicKey);
        else setConfigError("Checkout is not yet configured. Please contact support.");
      })
      .catch(() => setConfigError("Checkout unavailable. Please try again later."));
  }, []);

  useEffect(() => {
    if (!publicKey) return;

    const doConfigure = () => {
      if (collectJsConfigured) {
        setCollectReady(true);
        return;
      }
      collectJsConfigured = true;
      // Collect.js auto-mounts iframes into elements with the default IDs
      // (#ccnumber, #ccexp, #cvv) when `data-variant="inline"` is on the
      // script tag. configure() accepts only `variant` + `callback` — passing
      // a `fields` object throws "You provided too many fields".
      window.CollectJS!.configure({
        variant: "inline",
        callback: (response: { token?: string }) => {
          const ctx = submissionRef.current;
          submissionRef.current = null;
          if (!response?.token || !ctx) {
            setSubmitting(false);
            setErrorMsg("Could not tokenize card. Check the details and try again.");
            return;
          }
          finishCheckout(ctx, response.token);
        },
      });
      setCollectReady(true);
    };

    // Collect.js attaches `window.CollectJS` asynchronously after the script's
    // own bootstrap, which can finish AFTER `script.onload` fires. So we poll.
    let attempts = 0;
    const waitForCollect = () => {
      if (window.CollectJS) {
        doConfigure();
        return;
      }
      if (attempts++ > 50) {
        setConfigError("Card form failed to initialize. Refresh the page.");
        return;
      }
      setTimeout(waitForCollect, 100);
    };

    const existing = document.querySelector<HTMLScriptElement>("script[data-collectjs]");
    if (existing) {
      waitForCollect();
      return;
    }
    const s = document.createElement("script");
    s.src = "https://secure.nmi.com/token/Collect.js";
    s.async = true;
    // Tokenization key only — NO data-variant. With data-variant set, Collect.js
    // auto-runs its own setup and our configure() call collides with it ("too
    // many fields"). JS-only configuration is the cleaner path.
    s.setAttribute("data-tokenization-key", publicKey);
    s.setAttribute("data-variant", "inline");
    s.setAttribute("data-collectjs", "1");
    s.onload = waitForCollect;
    s.onerror = () => setConfigError("Failed to load secure card form. Refresh and try again.");
    document.body.appendChild(s);
  }, [publicKey]);

  async function finishCheckout(
    ctx: { buyer: Buyer; packId: PackId },
    paymentToken: string,
  ) {
    try {
      const res = await fetch("/api/checkout/epd", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...ctx.buyer, packId: ctx.packId, paymentToken }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setErrorMsg(data?.message || "Payment failed.");
        setSubmitting(false);
        return;
      }
      window.location.href = data.redirectUrl || "/auth/login";
    } catch {
      setErrorMsg("Network error. Please try again.");
      setSubmitting(false);
    }
  }

  function validate(): string | null {
    const required: [keyof Buyer, string][] = [
      ["firstName", "First name"],
      ["lastName", "Last name"],
      ["email", "Email"],
      ["phone", "Phone number"],
      ["cardholderName", "Name on card"],
      ["address", "Billing address"],
      ["city", "City"],
      ["zip", "Zip code"],
      ["country", "Country"],
    ];
    for (const [k, label] of required) {
      if (!buyer[k] || !String(buyer[k]).trim()) return `${label} is required.`;
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(buyer.email)) return "Enter a valid email.";
    if (!/^[+\d][\d\s\-().]{6,}$/.test(buyer.phone)) return "Enter a valid phone number.";
    if (buyer.country.trim().length !== 2) return "Country must be a 2-letter code (e.g. US).";
    return null;
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setErrorMsg(null);
    if (!collectReady || !window.CollectJS) {
      setErrorMsg("Card form not ready yet. Wait a moment and try again.");
      return;
    }
    const v = validate();
    if (v) {
      setErrorMsg(v);
      return;
    }
    const trimmed: Buyer = Object.fromEntries(
      Object.entries(buyer).map(([k, v]) => [k, typeof v === "string" ? v.trim() : v]),
    ) as Buyer;
    trimmed.email = trimmed.email.toLowerCase();
    trimmed.country = trimmed.country.toUpperCase();
    submissionRef.current = { buyer: trimmed, packId };
    setSubmitting(true);
    window.CollectJS.startPaymentRequest();
  }

  const selectedPack = PACKS.find((p) => p.id === packId)!;
  const fieldClass = "h-10 rounded-md border border-input bg-background px-3 py-2";

  return (
    <div className="min-h-screen flex flex-col bg-background">
      <div className="flex items-center justify-between p-4">
        <img src={logoUrl} alt="Patent Geyser" className="h-8" />
        <ThemeToggle />
      </div>

      <main className="flex-1 flex items-start justify-center px-4 pb-12">
        <Card className="max-w-2xl w-full overflow-hidden">
          <div className="p-6 pb-3">
            <h1 className="text-2xl font-semibold">Welcome to Patent Geyser</h1>
            <p className="text-sm text-muted-foreground mt-1">
              Purchase credits to create your account. Each credit gives you one invention
              to run end-to-end through Patent Geyser, from raw idea to a provisional draft,
              complete with key concepts, prior-art analysis, and diagrams. After checkout you'll
              set your password and land straight in your dashboard with your credits ready
              to use.
            </p>
          </div>

          <form onSubmit={handleSubmit} className="p-6 pt-3 space-y-6">
            {/* Pack selector */}
            <div className="grid sm:grid-cols-2 gap-3">
              {PACKS.map((p) => {
                const selected = p.id === packId;
                return (
                  <button
                    type="button"
                    key={p.id}
                    onClick={() => setPackId(p.id)}
                    className={`text-left rounded-lg border p-4 transition ${
                      selected
                        ? "border-primary ring-2 ring-primary/30 bg-primary/5"
                        : "border-border hover:border-foreground/30"
                    }`}
                  >
                    <div className="font-medium">
                      {p.credits} Project Credit{p.credits === 1 ? "" : "s"}
                    </div>
                    <div className="text-lg font-semibold mt-1">{p.price}</div>
                    {p.note && (
                      <div className="text-xs text-muted-foreground mt-1">{p.note}</div>
                    )}
                  </button>
                );
              })}
            </div>

            {/* Contact */}
            <div className="space-y-3">
              <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">Your info</h2>
              <div className="grid sm:grid-cols-2 gap-3">
                <div>
                  <Label htmlFor="firstName">First name</Label>
                  <Input id="firstName" autoComplete="given-name" value={buyer.firstName} onChange={(e) => setField("firstName", e.target.value)} required />
                </div>
                <div>
                  <Label htmlFor="lastName">Last name</Label>
                  <Input id="lastName" autoComplete="family-name" value={buyer.lastName} onChange={(e) => setField("lastName", e.target.value)} required />
                </div>
              </div>
              <div className="grid sm:grid-cols-2 gap-3">
                <div>
                  <Label htmlFor="email">Email</Label>
                  <Input id="email" type="email" autoComplete="email" value={buyer.email} onChange={(e) => setField("email", e.target.value)} required />
                </div>
                <div>
                  <Label htmlFor="phone">Phone number</Label>
                  <Input id="phone" type="tel" autoComplete="tel" value={buyer.phone} onChange={(e) => setField("phone", e.target.value)} required />
                </div>
              </div>
            </div>

            {/* Card */}
            <div className="space-y-3">
              <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">Card details</h2>
              <div>
                <Label htmlFor="cardholderName">Name on card</Label>
                <Input id="cardholderName" autoComplete="cc-name" value={buyer.cardholderName} onChange={(e) => setField("cardholderName", e.target.value)} required />
              </div>
              <div>
                <Label>Card number</Label>
                <div id="ccnumber" className={fieldClass} />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label>Expiration (MM / YY)</Label>
                  <div id="ccexp" className={fieldClass} />
                </div>
                <div>
                  <Label>CSC / CVV</Label>
                  <div id="cvv" className={fieldClass} />
                </div>
              </div>
            </div>

            {/* Billing */}
            <div className="space-y-3">
              <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">Billing address</h2>
              <div>
                <Label htmlFor="address">Street address</Label>
                <Input id="address" autoComplete="address-line1" value={buyer.address} onChange={(e) => setField("address", e.target.value)} required />
              </div>
              <div className="grid sm:grid-cols-3 gap-3">
                <div>
                  <Label htmlFor="city">City</Label>
                  <Input id="city" autoComplete="address-level2" value={buyer.city} onChange={(e) => setField("city", e.target.value)} required />
                </div>
                <div>
                  <Label htmlFor="zip">Zip code</Label>
                  <Input id="zip" autoComplete="postal-code" value={buyer.zip} onChange={(e) => setField("zip", e.target.value)} required />
                </div>
                <div>
                  <Label htmlFor="country">Country</Label>
                  <Input id="country" autoComplete="country" maxLength={2} value={buyer.country} onChange={(e) => setField("country", e.target.value.toUpperCase())} placeholder="US" required />
                </div>
              </div>
            </div>

            {configError && <p className="text-sm text-destructive">{configError}</p>}
            {errorMsg && <p className="text-sm text-destructive">{errorMsg}</p>}

            <Button type="submit" className="w-full" disabled={submitting || !collectReady || !!configError}>
              {submitting ? "Processing…" : `Pay ${selectedPack.price}`}
            </Button>

            <p className="text-xs text-muted-foreground text-center">
              Card details are sent directly to our payment processor — they never touch our servers.
            </p>
          </form>
        </Card>
      </main>
    </div>
  );
}
