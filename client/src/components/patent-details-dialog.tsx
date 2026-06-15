// Shared "Project details" dialog. Used by:
//   - the dashboard, to edit a Project's metadata
//   - the family card, to edit an uploaded reference file's metadata
//
// The two callers differ only in:
//   - initial values (Project vs ContextFile)
//   - the save mutation (PATCH project vs PATCH context-file)
// All field rendering, validation, and submit handling live here.

import { useEffect, useMemo, useState } from "react";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

export interface PatentDetailsValues {
  title?: string | null;
  inventorNames?: string[] | null;
  filedDate?: string | null; // ISO date
  status?: "draft" | "filed" | "published" | "granted" | "converted" | "abandoned" | "expired" | null;
  applicationNumber?: string | null;
  publicationNumber?: string | null;
  assignee?: string | null;
  jurisdiction?: string | null;
  patentType?: "provisional" | "utility" | "design" | "plant" | "pct" | "other" | null;
  externalUrl?: string | null;
  notes?: string | null;
}

// "project" — this app's own work (provisional only). Trimmed field set:
//   no publication no., no jurisdiction (always USPTO), no type (always
//   provisional), no assignee, no external URL. Status enum reflects the
//   actual lifecycle of a provisional: draft → filed → converted / expired
//   / abandoned.
// "reference" — uploaded external documents (any patent type / status).
//   Keeps the full field set so cited prior art can carry its real metadata.
export type DetailsMode = "project" | "reference";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  // Whether to show the Title field. Projects always show it (it's the
  // dashboard card name). Reference files show it as an optional human-readable
  // title that falls back to the filename when blank.
  showTitle: boolean;
  mode: DetailsMode;
  // Heading text — "Edit Project details" / "Edit details — <filename>".
  title: string;
  description?: string;
  initial: PatentDetailsValues;
  saving?: boolean;
  onSave: (values: PatentDetailsValues) => void;
}

const PROJECT_STATUSES: Array<PatentDetailsValues["status"]> = ["draft", "filed", "converted", "abandoned", "expired"];
const REFERENCE_STATUSES: Array<PatentDetailsValues["status"]> = ["draft", "filed", "published", "granted", "abandoned"];
const TYPES: Array<PatentDetailsValues["patentType"]> = ["provisional", "utility", "design", "plant", "pct", "other"];

export function PatentDetailsDialog({
  open,
  onOpenChange,
  showTitle,
  mode,
  title,
  description,
  initial,
  saving,
  onSave,
}: Props) {
  const isProject = mode === "project";
  const statuses = isProject ? PROJECT_STATUSES : REFERENCE_STATUSES;
  const [values, setValues] = useState<PatentDetailsValues>(initial);

  // Reset local state every time the dialog opens with new initial values.
  useEffect(() => {
    if (open) setValues(initial);
  }, [open, initial]);

  const inventorsText = useMemo(
    () => (values.inventorNames ?? []).join(", "),
    [values.inventorNames],
  );

  function set<K extends keyof PatentDetailsValues>(k: K, v: PatentDetailsValues[K]) {
    setValues((prev) => ({ ...prev, [k]: v }));
  }

  function handleInventorsChange(raw: string) {
    const arr = raw
      .split(",")
      .map((s) => s.trim())
      .filter((s) => s.length > 0);
    set("inventorNames", arr.length ? arr : null);
  }

  function handleSubmit() {
    // Normalise empties to null so the server doesn't store empty strings.
    const out: PatentDetailsValues = {};
    for (const [k, v] of Object.entries(values) as Array<[keyof PatentDetailsValues, any]>) {
      if (v === undefined) continue;
      if (typeof v === "string" && v.trim() === "") {
        (out as any)[k] = null;
        continue;
      }
      if (Array.isArray(v) && v.length === 0) {
        (out as any)[k] = null;
        continue;
      }
      (out as any)[k] = v;
    }
    onSave(out);
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent data-testid="dialog-patent-details" className="max-w-2xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          {description && <DialogDescription>{description}</DialogDescription>}
        </DialogHeader>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-3 py-2">
          {showTitle && (
            <div className="sm:col-span-2 space-y-1">
              <Label htmlFor="pd-title">Title</Label>
              <Input
                id="pd-title"
                value={values.title ?? ""}
                onChange={(e) => set("title", e.target.value)}
                data-testid="pd-title"
              />
            </div>
          )}

          <div className="sm:col-span-2 space-y-1">
            <Label htmlFor="pd-inventors">Inventor name(s)</Label>
            <Input
              id="pd-inventors"
              placeholder="e.g., Alice Smith, Bob Jones"
              defaultValue={inventorsText}
              onBlur={(e) => handleInventorsChange(e.target.value)}
              data-testid="pd-inventors"
            />
            <p className="text-[11px] text-muted-foreground">Comma-separated.</p>
          </div>

          <div className="space-y-1">
            <Label htmlFor="pd-filed">Filed date</Label>
            <Input
              id="pd-filed"
              type="date"
              value={values.filedDate ?? ""}
              onChange={(e) => set("filedDate", e.target.value || null)}
              data-testid="pd-filed"
            />
          </div>

          <div className="space-y-1">
            <Label htmlFor="pd-status">Status</Label>
            <select
              id="pd-status"
              className="w-full border border-input rounded-md px-2 py-2 bg-background text-sm h-9"
              value={values.status ?? ""}
              onChange={(e) => set("status", (e.target.value || null) as PatentDetailsValues["status"])}
              data-testid="pd-status"
            >
              <option value="">—</option>
              {statuses.map((s) => <option key={s} value={s!}>{s}</option>)}
            </select>
          </div>

          <div className="space-y-1">
            <Label htmlFor="pd-app-no">Application number</Label>
            <Input
              id="pd-app-no"
              value={values.applicationNumber ?? ""}
              onChange={(e) => set("applicationNumber", e.target.value)}
              data-testid="pd-app-no"
            />
          </div>

          {/* The fields below are reference-only — they don't apply to a
              provisional in this app (no publication, single jurisdiction,
              always a provisional, etc). They render only for uploaded
              external documents. */}
          {!isProject && (
            <>
              <div className="space-y-1">
                <Label htmlFor="pd-type">Type</Label>
                <select
                  id="pd-type"
                  className="w-full border border-input rounded-md px-2 py-2 bg-background text-sm h-9"
                  value={values.patentType ?? ""}
                  onChange={(e) => set("patentType", (e.target.value || null) as PatentDetailsValues["patentType"])}
                  data-testid="pd-type"
                >
                  <option value="">—</option>
                  {TYPES.map((t) => <option key={t} value={t!}>{t}</option>)}
                </select>
              </div>

              <div className="space-y-1">
                <Label htmlFor="pd-jurisdiction">Jurisdiction</Label>
                <Input
                  id="pd-jurisdiction"
                  placeholder="e.g., USPTO, EPO, WIPO"
                  value={values.jurisdiction ?? ""}
                  onChange={(e) => set("jurisdiction", e.target.value)}
                  data-testid="pd-jurisdiction"
                />
              </div>

              <div className="space-y-1">
                <Label htmlFor="pd-pub-no">Publication number</Label>
                <Input
                  id="pd-pub-no"
                  value={values.publicationNumber ?? ""}
                  onChange={(e) => set("publicationNumber", e.target.value)}
                  data-testid="pd-pub-no"
                />
              </div>

              <div className="space-y-1">
                <Label htmlFor="pd-assignee">Assignee</Label>
                <Input
                  id="pd-assignee"
                  placeholder="Owning company / entity"
                  value={values.assignee ?? ""}
                  onChange={(e) => set("assignee", e.target.value)}
                  data-testid="pd-assignee"
                />
              </div>

              <div className="sm:col-span-2 space-y-1">
                <Label htmlFor="pd-url">External URL</Label>
                <Input
                  id="pd-url"
                  type="url"
                  placeholder="https://patents.google.com/…"
                  value={values.externalUrl ?? ""}
                  onChange={(e) => set("externalUrl", e.target.value)}
                  data-testid="pd-url"
                />
              </div>
            </>
          )}

          <div className="sm:col-span-2 space-y-1">
            <Label htmlFor="pd-notes">Notes</Label>
            <Textarea
              id="pd-notes"
              rows={3}
              placeholder="Anything else worth remembering about this Project."
              value={values.notes ?? ""}
              onChange={(e) => set("notes", e.target.value)}
              data-testid="pd-notes"
            />
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>Cancel</Button>
          <Button onClick={handleSubmit} disabled={saving} data-testid="pd-save">
            {saving ? <><Loader2 className="h-4 w-4 mr-2 animate-spin" />Saving…</> : "Save Changes"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
