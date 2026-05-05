import { useEffect, useState } from "react";
import { Card } from "@/components/ui/card";
import { ThemeToggle } from "@/components/theme-toggle";
import logoUrl from "@/assets/geyser-logo.png";

export default function Buy() {
  // Server env-only. Fetch the embed URL once on mount via the public endpoint.
  const [embedUrl, setEmbedUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/public/embed-url")
      .then((r) => r.json())
      .then((data) => {
        if (data?.embedUrl) setEmbedUrl(data.embedUrl);
        else setError("Order form not yet configured. Please contact support.");
      })
      .catch(() => setError("Order form unavailable. Please try again later."));
  }, []);

  return (
    <div className="min-h-screen flex flex-col bg-background">
      <div className="flex items-center justify-between p-4">
        <img src={logoUrl} alt="Patent Geyser" className="h-8" />
        <ThemeToggle />
      </div>

      <main className="flex-1 flex items-start justify-center px-4 pb-12">
        <Card className="max-w-5xl w-full overflow-hidden">
          <div className="p-6 pb-3">
            <h1 className="text-xl font-semibold">Buy project credits</h1>
            <p className="text-sm text-muted-foreground">
              Each credit lets you create one project. Single or 5-pack bundle available.
            </p>
          </div>
          {/* Mirrors the dashboard buy-credits dialog: beige bg keeps the GHL form
              readable in both light and dark themes. */}
          <div className="bg-[#f5efe4] p-4">
            {error && (
              <p className="text-sm text-neutral-700">{error}</p>
            )}
            {!error && !embedUrl && (
              <p className="text-sm text-neutral-700">Loading order form…</p>
            )}
            {embedUrl && (
              <iframe
                src={embedUrl}
                title="Payment Form Patent Credits"
                className="w-full min-h-[70vh] border-none bg-transparent block"
              />
            )}
          </div>
        </Card>
      </main>
    </div>
  );
}
