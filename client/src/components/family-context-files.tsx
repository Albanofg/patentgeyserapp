// Family-level context files panel. Lives inside the expanded FamilyCard.
// Lets the inventor upload prior reference documents (PDF / DOCX / TXT / MD) once per
// family; every sibling sees the summaries and the AI helper can fetch
// full extracted text on demand.
//
// All heavy AI work (extraction + summary) runs ONCE on the server at
// upload time. This component just orchestrates the upload + render.

import { useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Loader2, Upload, FileText, Trash2, Download, AlertTriangle, Edit } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { PatentDetailsDialog, type PatentDetailsValues } from "@/components/patent-details-dialog";

interface ContextFile {
  id: string;
  familyId: string;
  originalFilename: string;
  title?: string | null;
  mimeType: string;
  byteSize: number;
  extractionStatus: "pending" | "ok" | "failed" | string;
  extractionError: string | null;
  summary: string | null;
  createdAt: string | null;
  inventorNames?: string[] | null;
  filedDate?: string | null;
  status?: string | null;
  applicationNumber?: string | null;
  publicationNumber?: string | null;
  assignee?: string | null;
  jurisdiction?: string | null;
  patentType?: string | null;
  externalUrl?: string | null;
  notes?: string | null;
}

const MAX_BYTES = 15 * 1024 * 1024; // matches server cap

const PDF_MIME = "application/pdf";
const DOCX_MIME = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";

// Some browsers report empty / generic MIME types for DOCX (e.g. "" or
// "application/octet-stream"), and Windows occasionally reports
// "application/msword" for .docx. Always trust the extension over file.type
// so the inventor's upload doesn't bounce because of a mime quirk.
function canonicalMime(file: File): string | null {
  const name = file.name.toLowerCase();
  if (name.endsWith(".pdf")) return PDF_MIME;
  if (name.endsWith(".docx")) return DOCX_MIME;
  if (file.type === PDF_MIME) return PDF_MIME;
  if (file.type === DOCX_MIME) return DOCX_MIME;
  return null;
}

function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result as string;
      // result is "data:<mime>;base64,<...>" — strip the prefix
      const comma = result.indexOf(",");
      resolve(comma >= 0 ? result.slice(comma + 1) : result);
    };
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

function fmtBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

interface Props {
  familyId: string;
}

export function FamilyContextFiles({ familyId }: Props) {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const inputRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [editingFile, setEditingFile] = useState<ContextFile | null>(null);

  const { data: files = [], isLoading } = useQuery<ContextFile[]>({
    queryKey: ["/api/families", familyId, "context-files"],
  });

  const uploadMutation = useMutation({
    mutationFn: async (file: File) => {
      const mime = canonicalMime(file);
      if (!mime) {
        throw new Error("Only PDF and DOCX files are accepted.");
      }
      if (file.size > MAX_BYTES) {
        throw new Error(`File exceeds the ${Math.floor(MAX_BYTES / 1024 / 1024)} MB limit.`);
      }
      const b64 = await fileToBase64(file);
      return await apiRequest<ContextFile>(
        "POST",
        `/api/families/${familyId}/context-files`,
        { originalFilename: file.name, mimeType: mime, fileBytesB64: b64 },
      );
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["/api/families", familyId, "context-files"] });
      if (data.extractionStatus === "failed") {
        toast({ title: "Uploaded — extraction failed", description: data.extractionError ?? "" });
      } else {
        toast({ title: "Uploaded", description: data.summary ?? data.originalFilename });
      }
    },
    onError: (err: Error) => toast({ title: "Upload failed", description: err.message }),
  });

  const updateMutation = useMutation({
    mutationFn: async ({ fileId, patch }: { fileId: string; patch: Record<string, any> }) => {
      return await apiRequest<ContextFile>(
        "PATCH",
        `/api/families/${familyId}/context-files/${fileId}`,
        patch,
      );
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/families", familyId, "context-files"] });
      setEditingFile(null);
      toast({ title: "Details saved" });
    },
    onError: (err: Error) => toast({ title: "Failed to save details", description: err.message }),
  });

  const deleteMutation = useMutation({
    mutationFn: async (fileId: string) => {
      await apiRequest("DELETE", `/api/families/${familyId}/context-files/${fileId}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/families", familyId, "context-files"] });
      toast({ title: "File removed" });
    },
    onError: (err: Error) => toast({ title: "Failed to remove file", description: err.message }),
  });

  const handlePick = () => inputRef.current?.click();

  const handleFiles = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const list = e.target.files;
    if (!list || list.length === 0) return;
    setBusy(true);
    try {
      // Process sequentially so the AI extraction calls don't all stampede.
      for (let i = 0; i < list.length; i++) {
        await uploadMutation.mutateAsync(list[i]);
      }
    } finally {
      setBusy(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  };

  return (
    <div className="border-t border-border px-4 pt-3 pb-3 bg-muted/20" data-snapshot-exclude="true">
      <div className="flex items-center justify-between gap-2 mb-2">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Reference files</p>
          <p className="text-[11px] text-muted-foreground">
            Upload previous documents to keep as context. The AI helper sees a one-line summary;
            it fetches the full text only when needed.
          </p>
        </div>
        <Button size="sm" variant="outline" onClick={handlePick} disabled={busy} data-testid={`upload-context-${familyId}`}>
          {busy ? <><Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" />Processing…</> : <><Upload className="h-3.5 w-3.5 mr-1" />Upload</>}
        </Button>
        <input
          ref={inputRef}
          type="file"
          multiple
          accept=".pdf,.docx,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
          className="hidden"
          onChange={handleFiles}
        />
      </div>

      {isLoading ? (
        <p className="text-xs text-muted-foreground">Loading files…</p>
      ) : files.length === 0 ? (
        <p className="text-xs text-muted-foreground">No reference files yet.</p>
      ) : null}

      <PatentDetailsDialog
        open={!!editingFile}
        onOpenChange={(o) => { if (!o && !updateMutation.isPending) setEditingFile(null); }}
        showTitle={true}
        mode="reference"
        title={editingFile ? `Edit details — ${editingFile.title || editingFile.originalFilename}` : "Edit details"}
        description="Fill in what you know about this reference file. Every field is optional."
        saving={updateMutation.isPending}
        initial={editingFile ? {
          title: editingFile.title ?? null,
          inventorNames: editingFile.inventorNames ?? null,
          filedDate: editingFile.filedDate ?? null,
          status: (editingFile.status as PatentDetailsValues["status"]) ?? null,
          applicationNumber: editingFile.applicationNumber ?? null,
          publicationNumber: editingFile.publicationNumber ?? null,
          assignee: editingFile.assignee ?? null,
          jurisdiction: editingFile.jurisdiction ?? null,
          patentType: (editingFile.patentType as PatentDetailsValues["patentType"]) ?? null,
          externalUrl: editingFile.externalUrl ?? null,
          notes: editingFile.notes ?? null,
        } : {}}
        onSave={(values) => {
          if (!editingFile) return;
          // Title is an optional human-readable name; persist it with the rest.
          updateMutation.mutate({ fileId: editingFile.id, patch: values });
        }}
      />

      {files.length > 0 && (
        <ul className="space-y-1">
          {files.map((f) => (
            <li key={f.id} className="flex items-start gap-2 px-2 py-1.5 rounded-md bg-background/60 border border-border">
              <FileText className="h-3.5 w-3.5 mt-0.5 text-muted-foreground flex-none" />
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-sm font-medium truncate">{f.title || f.originalFilename}</span>
                  {f.title && (
                    <span className="text-[11px] text-muted-foreground truncate">{f.originalFilename}</span>
                  )}
                  <Badge variant="outline" className="text-[10px]">{fmtBytes(f.byteSize)}</Badge>
                  {f.extractionStatus === "pending" && <Badge variant="outline" className="text-[10px]">extracting…</Badge>}
                  {f.extractionStatus === "failed" && (
                    <Badge variant="outline" className="text-[10px] border-amber-500/40 text-amber-700">
                      <AlertTriangle className="h-2.5 w-2.5 mr-0.5 inline" />extraction failed
                    </Badge>
                  )}
                </div>
                {f.summary && (
                  <p className="text-xs text-muted-foreground mt-0.5">{f.summary}</p>
                )}
                {f.extractionStatus === "failed" && f.extractionError && (
                  <p className="text-[11px] text-muted-foreground/70 mt-0.5">{f.extractionError}</p>
                )}
              </div>
              <div className="flex items-center gap-0.5 flex-none">
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-7 w-7 p-0"
                  onClick={() => setEditingFile(f)}
                  data-testid={`context-edit-${f.id}`}
                  title="Edit details"
                >
                  <Edit className="h-3.5 w-3.5" />
                </Button>
                <Button
                  asChild
                  size="sm"
                  variant="ghost"
                  className="h-7 w-7 p-0"
                  data-testid={`context-download-${f.id}`}
                >
                  <a href={`/api/families/${familyId}/context-files/${f.id}/download`} title="Download">
                    <Download className="h-3.5 w-3.5" />
                  </a>
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-7 w-7 p-0"
                  onClick={() => deleteMutation.mutate(f.id)}
                  disabled={deleteMutation.isPending}
                  data-testid={`context-delete-${f.id}`}
                  title="Remove"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </Button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
