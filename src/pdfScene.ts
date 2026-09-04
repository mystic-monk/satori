import { convertToExcalidrawElements } from "@excalidraw/excalidraw";
import type { BinaryFiles } from "@excalidraw/excalidraw/types";
import type { FileId } from "@excalidraw/excalidraw/element/types";
import type { PdfPage } from "./pdfImport";

// Vertical gap between stacked pages, in the same coordinate units as
// page width/height — scrolling down the Excalidraw canvas pages through
// the document, top to bottom.
const PAGE_GAP = 24;

// Kept in its own module, separate from pdfImport.ts, so App.tsx can
// dynamically import just this half (and only once someone actually
// finishes importing a PDF) — this is the half that pulls in
// @excalidraw/excalidraw, already lazy-loaded elsewhere (CanvasNote.tsx)
// for the same reason.
export function buildPdfScene(pages: PdfPage[]): string {
  const files: BinaryFiles = {};
  const skeleton: { type: "image"; x: number; y: number; width: number; height: number; fileId: FileId }[] = [];
  let y = 0;
  for (const page of pages) {
    const fileId = crypto.randomUUID() as unknown as FileId;
    files[fileId] = {
      mimeType: "image/jpeg",
      id: fileId,
      dataURL: page.dataUrl as unknown as BinaryFiles[string]["dataURL"],
      created: Date.now(),
    };
    skeleton.push({ type: "image", x: 0, y, width: page.width, height: page.height, fileId });
    y += page.height + PAGE_GAP;
  }
  const elements = convertToExcalidrawElements(skeleton);
  const scene = { type: "excalidraw", version: 2, elements, appState: {}, files };
  return JSON.stringify(scene, null, 2);
}
