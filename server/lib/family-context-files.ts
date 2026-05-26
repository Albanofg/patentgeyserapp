// Family context files — external reference documents (typically prior
// patents in the same product domain) uploaded once at the family level
// so every sibling in the family has access without re-uploading.
//
// Cost-control story:
//   - Heavy work (text extraction + one-line summary) runs EXACTLY ONCE
//     at upload time on the owning family.
//   - Every later per-turn QA prompt sees only the cached summary — never
//     the full extracted text.
//   - The AI helper fetches full extracted text via a dedicated tool only
//     when it genuinely needs to compare against a specific file.
//   - The raw file bytes never enter any AI prompt after upload; they only
//     ship back when the inventor explicitly downloads.
//
// Storage shape: file_bytes_b64 lives inline as base64 TEXT in postgres so
// no external blob store is required. Capped at 15 MB per file by the
// upload route.

import { and, desc, eq, isNull } from "drizzle-orm";
import { GoogleGenAI } from "@google/genai";
import { projectFamilyContextFiles, type ProjectFamilyContextFile } from "@shared/schema";
import { db } from "../db";

const MAX_FILE_BYTES = 15 * 1024 * 1024; // 15 MB

// Supported MIME types. Only PDF and DOCX — the two formats inventors actually
// have prior patent documents in. Anything else is rejected at upload time so
// we never sit on a file we can't extract.
const ACCEPTED_MIME_TYPES = new Set([
  "application/pdf",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
]);

const gemini = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY! });
const EXTRACT_MODEL = "gemini-2.5-flash";

export interface UploadInput {
  familyId: string;
  uploadedByUserId: string | null;
  uploadedByInventorsUserId: string | null;
  originalFilename: string;
  mimeType: string;
  fileBytesB64: string;
}

export interface ContextFileSummary {
  id: string;
  familyId: string;
  originalFilename: string;
  mimeType: string;
  byteSize: number;
  extractionStatus: string;
  extractionError: string | null;
  summary: string | null;
  createdAt: string | null;
  // Editable patent metadata, populated as the inventor fills it in.
  inventorNames: string[] | null;
  filedDate: string | null;
  status: string | null;
  applicationNumber: string | null;
  publicationNumber: string | null;
  assignee: string | null;
  jurisdiction: string | null;
  patentType: string | null;
  externalUrl: string | null;
  notes: string | null;
}

function toSummaryRow(row: ProjectFamilyContextFile): ContextFileSummary {
  return {
    id: row.id,
    familyId: row.familyId,
    originalFilename: row.originalFilename,
    mimeType: row.mimeType,
    byteSize: row.byteSize,
    extractionStatus: row.extractionStatus,
    extractionError: row.extractionError ?? null,
    summary: row.summary ?? null,
    createdAt: row.createdAt ? row.createdAt.toISOString() : null,
    inventorNames: row.inventorNames ?? null,
    filedDate: row.filedDate ?? null,
    status: row.status ?? null,
    applicationNumber: row.applicationNumber ?? null,
    publicationNumber: row.publicationNumber ?? null,
    assignee: row.assignee ?? null,
    jurisdiction: row.jurisdiction ?? null,
    patentType: row.patentType ?? null,
    externalUrl: row.externalUrl ?? null,
    notes: row.notes ?? null,
  };
}

export function validateUpload(input: { mimeType: string; fileBytesB64: string }): string | null {
  if (!ACCEPTED_MIME_TYPES.has(input.mimeType)) {
    return `Unsupported file type: ${input.mimeType}. Allowed: PDF, DOCX.`;
  }
  if (typeof input.fileBytesB64 !== "string" || input.fileBytesB64.length === 0) {
    return "File body is empty.";
  }
  // base64 expands ~1.33x; decoded size cap.
  const approxBytes = Math.floor((input.fileBytesB64.length * 3) / 4);
  if (approxBytes > MAX_FILE_BYTES) {
    return `File exceeds the ${Math.floor(MAX_FILE_BYTES / (1024 * 1024))} MB limit.`;
  }
  return null;
}

// Extract plain text and a one-line summary via a SINGLE Gemini call.
// For text/plain and text/markdown we skip the model and base64-decode
// directly — no AI cost at all.
async function extractTextAndSummarize(args: {
  mimeType: string;
  fileBytesB64: string;
  originalFilename: string;
}): Promise<{ ok: true; text: string; summary: string } | { ok: false; error: string }> {
  try {
    const prompt = [
      "You are extracting reference content from a previously-filed patent or",
      "patent-related document for use as context in a different patent project.",
      "",
      "Return JSON with two fields:",
      '  "text"    — the full, cleaned plain text of the document (no markup),',
      '  "summary" — ONE sentence (max 200 characters) describing what this',
      "             document is about, in plain language. No legal vocabulary.",
      "",
      `Filename: ${args.originalFilename}`,
    ].join("\n");

    const result = await gemini.models.generateContent({
      model: EXTRACT_MODEL,
      contents: [
        {
          role: "user",
          parts: [
            { inlineData: { mimeType: args.mimeType, data: args.fileBytesB64 } },
            { text: prompt },
          ],
        },
      ],
      config: {
        responseMimeType: "application/json",
        responseSchema: {
          type: "object",
          properties: {
            text: { type: "string" },
            summary: { type: "string" },
          },
          required: ["text", "summary"],
        },
      },
    });

    const raw = result.text ?? "";
    let parsed: { text?: string; summary?: string } = {};
    try { parsed = JSON.parse(raw); } catch { /* fall through */ }
    if (!parsed.text || !parsed.summary) {
      return { ok: false, error: "Model returned no text or summary." };
    }
    return { ok: true, text: parsed.text, summary: parsed.summary.slice(0, 240) };
  } catch (err: any) {
    return { ok: false, error: err?.message ?? String(err) };
  }
}

// Upload + extract + persist, in that order. Inserts the row with
// extraction_status='pending' first so the UI can show "processing..." and
// updates it to 'ok' or 'failed' once Gemini returns. Returns the final
// row summary.
export async function uploadFamilyContextFile(input: UploadInput): Promise<ContextFileSummary> {
  const approxBytes = Math.floor((input.fileBytesB64.length * 3) / 4);

  const [row] = await db
    .insert(projectFamilyContextFiles)
    .values({
      familyId: input.familyId,
      uploadedByUserId: input.uploadedByUserId,
      uploadedByInventorsUserId: input.uploadedByInventorsUserId,
      originalFilename: input.originalFilename,
      mimeType: input.mimeType,
      byteSize: approxBytes,
      fileBytesB64: input.fileBytesB64,
      extractionStatus: "pending",
    })
    .returning();

  const extract = await extractTextAndSummarize({
    mimeType: input.mimeType,
    fileBytesB64: input.fileBytesB64,
    originalFilename: input.originalFilename,
  });

  if (extract.ok) {
    const [updated] = await db
      .update(projectFamilyContextFiles)
      .set({
        extractedText: extract.text,
        summary: extract.summary,
        extractionStatus: "ok",
        updatedAt: new Date(),
      })
      .where(eq(projectFamilyContextFiles.id, row.id))
      .returning();
    return toSummaryRow(updated);
  } else {
    const [updated] = await db
      .update(projectFamilyContextFiles)
      .set({
        extractionStatus: "failed",
        extractionError: extract.error,
        updatedAt: new Date(),
      })
      .where(eq(projectFamilyContextFiles.id, row.id))
      .returning();
    return toSummaryRow(updated);
  }
}

export async function listFamilyContextFiles(familyId: string): Promise<ContextFileSummary[]> {
  // Select everything EXCEPT the heavy fields (file_bytes_b64, extracted_text).
  // Metadata is small enough that one row stays well under a KB.
  const rows = await db
    .select({
      id: projectFamilyContextFiles.id,
      familyId: projectFamilyContextFiles.familyId,
      originalFilename: projectFamilyContextFiles.originalFilename,
      mimeType: projectFamilyContextFiles.mimeType,
      byteSize: projectFamilyContextFiles.byteSize,
      extractionStatus: projectFamilyContextFiles.extractionStatus,
      extractionError: projectFamilyContextFiles.extractionError,
      summary: projectFamilyContextFiles.summary,
      createdAt: projectFamilyContextFiles.createdAt,
      inventorNames: projectFamilyContextFiles.inventorNames,
      filedDate: projectFamilyContextFiles.filedDate,
      status: projectFamilyContextFiles.status,
      applicationNumber: projectFamilyContextFiles.applicationNumber,
      publicationNumber: projectFamilyContextFiles.publicationNumber,
      assignee: projectFamilyContextFiles.assignee,
      jurisdiction: projectFamilyContextFiles.jurisdiction,
      patentType: projectFamilyContextFiles.patentType,
      externalUrl: projectFamilyContextFiles.externalUrl,
      notes: projectFamilyContextFiles.notes,
    })
    .from(projectFamilyContextFiles)
    .where(and(eq(projectFamilyContextFiles.familyId, familyId), isNull(projectFamilyContextFiles.deletedAt)))
    .orderBy(desc(projectFamilyContextFiles.createdAt));
  return rows.map((r) => ({
    id: r.id,
    familyId: r.familyId,
    originalFilename: r.originalFilename,
    mimeType: r.mimeType,
    byteSize: r.byteSize,
    extractionStatus: r.extractionStatus,
    extractionError: r.extractionError ?? null,
    summary: r.summary ?? null,
    createdAt: r.createdAt ? r.createdAt.toISOString() : null,
    inventorNames: r.inventorNames ?? null,
    filedDate: r.filedDate ?? null,
    status: r.status ?? null,
    applicationNumber: r.applicationNumber ?? null,
    publicationNumber: r.publicationNumber ?? null,
    assignee: r.assignee ?? null,
    jurisdiction: r.jurisdiction ?? null,
    patentType: r.patentType ?? null,
    externalUrl: r.externalUrl ?? null,
    notes: r.notes ?? null,
  }));
}

// Fetch only the extracted text. Used by the AI helper's fetch-by-id tool
// when the model decides it needs the full body of a specific file.
export async function getFamilyContextFileExtractedText(fileId: string): Promise<{ familyId: string; originalFilename: string; extractedText: string | null } | null> {
  const [row] = await db
    .select({
      familyId: projectFamilyContextFiles.familyId,
      originalFilename: projectFamilyContextFiles.originalFilename,
      extractedText: projectFamilyContextFiles.extractedText,
      deletedAt: projectFamilyContextFiles.deletedAt,
    })
    .from(projectFamilyContextFiles)
    .where(eq(projectFamilyContextFiles.id, fileId))
    .limit(1);
  if (!row || row.deletedAt) return null;
  return {
    familyId: row.familyId,
    originalFilename: row.originalFilename,
    extractedText: row.extractedText,
  };
}

// Fetch raw bytes for download. Authentication enforced at the route.
export async function getFamilyContextFileBytes(fileId: string): Promise<{ familyId: string; originalFilename: string; mimeType: string; fileBytesB64: string } | null> {
  const [row] = await db
    .select({
      familyId: projectFamilyContextFiles.familyId,
      originalFilename: projectFamilyContextFiles.originalFilename,
      mimeType: projectFamilyContextFiles.mimeType,
      fileBytesB64: projectFamilyContextFiles.fileBytesB64,
      deletedAt: projectFamilyContextFiles.deletedAt,
    })
    .from(projectFamilyContextFiles)
    .where(eq(projectFamilyContextFiles.id, fileId))
    .limit(1);
  if (!row || row.deletedAt) return null;
  return {
    familyId: row.familyId,
    originalFilename: row.originalFilename,
    mimeType: row.mimeType,
    fileBytesB64: row.fileBytesB64,
  };
}

export async function updateFamilyContextFileMetadata(
  fileId: string,
  patch: Record<string, any>,
): Promise<ContextFileSummary | null> {
  const clean: Record<string, any> = { updatedAt: new Date() };
  for (const [k, v] of Object.entries(patch)) {
    if (v !== undefined) clean[k] = v === "" ? null : v;
  }
  const [row] = await db
    .update(projectFamilyContextFiles)
    .set(clean)
    .where(eq(projectFamilyContextFiles.id, fileId))
    .returning();
  return row ? toSummaryRow(row) : null;
}

export async function softDeleteFamilyContextFile(fileId: string): Promise<void> {
  await db
    .update(projectFamilyContextFiles)
    .set({ deletedAt: new Date(), updatedAt: new Date() })
    .where(eq(projectFamilyContextFiles.id, fileId));
}

// Used by the QA assistant per-turn context builder.
// Returns one row per non-deleted file with just { id, filename, summary }.
// Cheap to ship into the prompt; never includes extracted_text.
export async function listFamilyContextFilesForPrompt(familyId: string): Promise<Array<{ id: string; filename: string; summary: string | null }>> {
  const rows = await db
    .select({
      id: projectFamilyContextFiles.id,
      filename: projectFamilyContextFiles.originalFilename,
      summary: projectFamilyContextFiles.summary,
    })
    .from(projectFamilyContextFiles)
    .where(and(eq(projectFamilyContextFiles.familyId, familyId), isNull(projectFamilyContextFiles.deletedAt)))
    .orderBy(desc(projectFamilyContextFiles.createdAt));
  return rows.map((r) => ({ id: r.id, filename: r.filename, summary: r.summary ?? null }));
}
