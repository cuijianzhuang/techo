import { UPLOADED_FONT } from "./entries";

/* What an uploaded font is (the routes are in fonts.ts): the kinds of file, how to tell one by its first bytes, and the
   list of them kept in the setting customFonts. Nothing here touches the database or R2. */

export const FONT_FILE = /^[0-9a-f-]{36}\.(woff2|woff|ttf|otf)$/;
export const FONT_KEY = /^fonts\/[0-9a-f-]{36}\.(woff2|woff|ttf|otf)$/;
export const TYPES: Record<string, string> = { woff2: "font/woff2", woff: "font/woff", ttf: "font/ttf", otf: "font/otf" };

export type UploadedFont = { id: string; name: string; key: string; size: number };

/** what a font file is, by its first bytes (its name and the type it is sent as say nothing) */
export function fontKind(b: Uint8Array): string | null {
  if (b.length < 12) return null;
  const tag = String.fromCharCode(b[0], b[1], b[2], b[3]);
  if (tag === "wOF2") return "woff2";
  if (tag === "wOFF") return "woff";
  if (tag === "OTTO") return "otf";
  if (tag === "true" || (b[0] === 0 && b[1] === 1 && b[2] === 0 && b[3] === 0)) return "ttf";
  return null;
}

export function parseFonts(json: string | undefined): UploadedFont[] {
  let list: unknown;
  try { list = JSON.parse(json || "[]"); } catch { return []; }
  if (!Array.isArray(list)) return [];
  return list.filter((f): f is UploadedFont => !!f && typeof f === "object" && UPLOADED_FONT.test(String((f as UploadedFont).id)) && FONT_KEY.test(String((f as UploadedFont).key)))
    .map((f) => ({ id: f.id, name: String(f.name || "字体"), key: f.key, size: Number(f.size) || 0 }));
}

