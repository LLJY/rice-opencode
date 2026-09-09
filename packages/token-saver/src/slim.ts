/**
 * Pure slimming helpers for the token-saver plugin (V2-only).
 *
 * No OpenCode imports: deterministic, side-effect free, unit tested.
 * Description shortening is generic (no per-tool tables to drift); result
 * compaction truncates oversized outputs with a visible marker.
 */

/** Collapse whitespace runs; returns the shortened text and saved chars. */
export function collapseWhitespace(text: string): { text: string; saved: number } {
  const collapsed = text.replace(/[ \t]+/g, " ").replace(/\n{3,}/g, "\n\n").trim();
  return { text: collapsed, saved: Math.max(0, text.length - collapsed.length) };
}

/** Shorten a tool description generically. Returns null when already tight. */
export function shortenDescription(description: string, maxChars = 500): string | null {
  const { text } = collapseWhitespace(description);
  if (text.length <= maxChars) return text.length < description.length ? text : null;
  const cut = text.slice(0, maxChars);
  const lastSpace = cut.lastIndexOf(" ");
  return (lastSpace > maxChars * 0.6 ? cut.slice(0, lastSpace) : cut).trimEnd() + "…";
}

export interface CompactedResult {
  text: string;
  truncated: boolean;
}

/** Compact oversized tool-result text, marking truncation visibly. */
export function compactResultText(text: string, maxChars: number): CompactedResult {
  const { text: collapsed } = collapseWhitespace(text);
  if (collapsed.length <= maxChars) return { text: collapsed, truncated: false };
  const head = Math.ceil(maxChars * 0.7);
  const tail = maxChars - head;
  const compacted =
    collapsed.slice(0, head) +
    `\n…[token-saver: truncated ${collapsed.length - maxChars} chars]…\n` +
    collapsed.slice(collapsed.length - tail);
  return { text: compacted, truncated: true };
}
