// Builds the Proof of Human Conception .docx for a project. Used by both
// the standalone export route (/export-pohc-docx) and the proof-package
// bundler so the file is byte-identical regardless of entry point.

import { storage } from "../storage";
import { getQALog } from "../modules/module0/qa-assistant";
import { listHumanInputs } from "../modules/human-inputs/ledger";

export interface PoHCDocxResult {
  buffer: Buffer;
  filename: string;
  projectTitle: string;
}

export async function buildPoHCDocx(projectId: string): Promise<PoHCDocxResult | null> {
  const project = await storage.getProject(projectId);
  if (!project) return null;

  const { Document, Packer, Paragraph, TextRun, HeadingLevel, AlignmentType } = await import("docx");

  const [logEntries, humanInputs] = await Promise.all([
    getQALog(projectId, true),
    listHumanInputs({ projectId }),
  ]);

  const RED = "C00000";
  const bodyFontSize = 22;

  const fmtDate = (d: any): string => {
    if (!d) return "";
    const dt = new Date(d);
    return Number.isNaN(dt.getTime()) ? "" : dt.toISOString();
  };

  const paragraphs: any[] = [];

  paragraphs.push(
    new Paragraph({
      alignment: AlignmentType.CENTER,
      spacing: { before: 0, after: 240 },
      children: [
        new TextRun({ text: "DO NOT UPLOAD THIS FILE WITH YOUR PATENT", bold: true, color: RED, size: 40 }),
      ],
    }),
    new Paragraph({
      alignment: AlignmentType.CENTER,
      spacing: { after: 480 },
      children: [
        new TextRun({
          text: "This is your private Proof of Human Conception record — inventorship evidence for your own files only.",
          color: RED,
          size: bodyFontSize,
          italics: true,
        }),
      ],
    }),
  );

  paragraphs.push(
    new Paragraph({
      heading: HeadingLevel.HEADING_1,
      spacing: { before: 200, after: 200 },
      children: [new TextRun({ text: `Proof of Human Conception — ${project.title || "Untitled"}` })],
    }),
    new Paragraph({
      spacing: { after: 240 },
      children: [
        new TextRun({ text: `Project ID: `, bold: true, size: bodyFontSize }),
        new TextRun({ text: project.id, size: bodyFontSize }),
        new TextRun({ text: `\nExported: `, bold: true, size: bodyFontSize, break: 1 }),
        new TextRun({ text: new Date().toISOString(), size: bodyFontSize }),
      ],
    }),
  );

  const formalEntries = logEntries.filter((e: any) => e?._source !== "human_inputs");
  paragraphs.push(
    new Paragraph({
      heading: HeadingLevel.HEADING_2,
      spacing: { before: 400, after: 200 },
      children: [new TextRun({ text: `1. Invention Log — AI Helper Captures (${formalEntries.length})` })],
    }),
  );
  if (formalEntries.length === 0) {
    paragraphs.push(new Paragraph({ children: [new TextRun({ text: "No AI Helper log entries captured.", italics: true, size: bodyFontSize })] }));
  } else {
    formalEntries.forEach((e: any, i: number) => {
      const tags = Array.isArray(e?.tags) ? e.tags.join(", ") : "";
      paragraphs.push(
        new Paragraph({
          spacing: { before: 240, after: 60 },
          children: [
            new TextRun({ text: `Entry ${i + 1}`, bold: true, size: bodyFontSize }),
            new TextRun({ text: `  ·  ${e.entryType || "unknown"}`, size: bodyFontSize - 2 }),
            new TextRun({ text: `  ·  captured ${fmtDate(e.capturedAt)}`, size: bodyFontSize - 2 }),
            ...(e.capturedAtTrail ? [new TextRun({ text: `  ·  ${e.capturedAtTrail}`, size: bodyFontSize - 2, italics: true })] : []),
            ...(tags ? [new TextRun({ text: `  ·  tags: ${tags}`, size: bodyFontSize - 2 })] : []),
          ],
        }),
        new Paragraph({
          spacing: { after: 120 },
          children: [new TextRun({ text: String(e.verbatimText || ""), size: bodyFontSize })],
        }),
      );
    });
  }

  paragraphs.push(
    new Paragraph({
      heading: HeadingLevel.HEADING_2,
      spacing: { before: 400, after: 200 },
      children: [new TextRun({ text: `2. Typed Inputs Across the Platform (${humanInputs.length})` })],
    }),
  );
  if (humanInputs.length === 0) {
    paragraphs.push(new Paragraph({ children: [new TextRun({ text: "No typed inputs captured.", italics: true, size: bodyFontSize })] }));
  } else {
    humanInputs.forEach((row: any, i: number) => {
      const tags = Array.isArray(row?.tags) ? row.tags.join(", ") : "";
      paragraphs.push(
        new Paragraph({
          spacing: { before: 240, after: 60 },
          children: [
            new TextRun({ text: `Input ${i + 1}`, bold: true, size: bodyFontSize }),
            new TextRun({ text: `  ·  source: ${row.source || "unknown"}`, size: bodyFontSize - 2 }),
            ...(row.conceptId ? [new TextRun({ text: `  ·  ${row.conceptId}`, size: bodyFontSize - 2 })] : []),
            new TextRun({ text: `  ·  updated ${fmtDate(row.updatedAt || row.createdAt)}`, size: bodyFontSize - 2 }),
            ...(tags ? [new TextRun({ text: `  ·  tags: ${tags}`, size: bodyFontSize - 2 })] : []),
          ],
        }),
        ...(row.promptText
          ? [
              new Paragraph({
                spacing: { after: 40 },
                children: [new TextRun({ text: `Q: ${row.promptText}`, italics: true, size: bodyFontSize - 2 })],
              }),
            ]
          : []),
        new Paragraph({
          spacing: { after: 120 },
          children: [new TextRun({ text: String(row.answerText || ""), size: bodyFontSize })],
        }),
      );
    });
  }

  const doc = new Document({ sections: [{ properties: {}, children: paragraphs }] });
  const buffer = await Packer.toBuffer(doc);
  const title = project.title || projectId;
  return {
    buffer,
    filename: `pohc-${title}.docx`,
    projectTitle: title,
  };
}
