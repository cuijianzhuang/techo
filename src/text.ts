/* the words of a page without their marks: a line of them for somewhere else (the timeline's excerpt, a
   shared page's description). Kept the same as plainText in public/assets/render.js (a test compares them). */
const NETEASE_LINE = /^[ \t]*https?:\/\/(?:y\.)?music\.163\.com\/\S*song\S*[ \t]*$/gm;
export const plainText = (md: string) => md.replace(/```[\s\S]*?```/g, " ").replace(/^\s*\+{3,}\s*(?:贴页|拼贴|collage)?\s*$/gim, " ").replace(NETEASE_LINE, " ")
  .replace(/^\s*(#{1,3}\s+|[-*+]\s+(\[[ xX]\]\s+)?|\d+[.)]\s+|>\s?|[@＠]\d{1,2}[:：]\d{2}\s*)/gm, "")
  .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1").replace(/(\*\*|__|~~|==|`|\*)/g, "").replace(/[#＃][a-z]+/g, "").replace(/\s+/g, " ").trim();

/** the first `n` characters of it (whole characters, not halves of a pair): the timeline shows two lines of it */
export const excerpt = (md: string, n = 100) => [...plainText(md)].slice(0, n).join("");

/** does the body hold a card (a ``` block) or a NetEase link: what the shelf, the ticket folder and the bills read */
export const hasCards = (md: string) => md.includes("```") || /music\.163\.com|163cn\.tv/.test(md);

/** text for inside HTML */
export const escHtml = (s: string) => s.replace(/[&<>"']/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[ch]!);
