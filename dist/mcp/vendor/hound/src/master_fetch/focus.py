"""Query-focused content filtering for smart_fetch and include_content.

When the agent passes ``focus="..."``, the extracted markdown is filtered to
the blocks (paragraphs / headings / tables / lists / code) most relevant to the
query, so the agent loads less context on long pages. Inspired by Crawl4AI's
BM25ContentFilter, enhanced with heading-aware boosting + table/code preservation.

Design choice: focus runs **post-cache**. The full extracted text is cached
once per URL; different focus queries are just different views over the same
cached content, so focusing never causes a re-fetch and two different focuses
on the same URL share one cache entry. Filtering happens inside
``_apply_chunking`` (the universal final wrapper), so it applies to live
fetches, cache hits, and bulk results alike.

Three improvements over plain BM25:

1. **Heading-aware boosting**: When a markdown heading contains query terms,
   ALL blocks under that heading (until the next heading) get a 1.5x score boost.
   Headings define topic boundaries - if a heading says "Model Architecture"
   and the query mentions "architecture", content under that heading is relevant
   even if individual paragraphs don't contain the exact word "architecture".
   No other search tool does this.

2. **Table/code preservation**: Tables and code blocks get BM25-underweighted
   (table cells are short tokens, code has unusual token distribution). But they
   are HIGH-VALUE for factual queries. Tables and code blocks containing ANY
   query term are always kept, regardless of BM25 score. This prevents losing
   the actual data table while keeping prose paragraphs that discuss it.

3. **BM25 (k1=1.5, b=0.75)** with always-positive IDF (the ``+1`` inside the log)
   so a block with a single query-term occurrence gets a positive score and is
   kept at the default threshold. A heading immediately preceding a kept block is
   preserved for context. If nothing clears the threshold, the closest blocks are
   kept so the agent gets something to judge instead of an empty page.
"""

from __future__ import annotations

import math
import re

_TOKEN_RE = re.compile(r"[a-z0-9]+")

# Minimal stopword set for focus queries (not the full search.py set - focus
# queries are already short, just remove the most common noise tokens).
_FOCUS_STOPWORDS = frozenset({
    "the", "and", "for", "with", "from", "that", "this", "are", "was", "were",
    "has", "have", "had", "you", "your", "its", "our", "not", "but", "can",
    "will", "into", "via", "using", "use", "how", "what", "when", "why", "who",
    "which", "about", "also", "more", "most", "than", "then", "them", "they",
    "their", "there", "here", "such", "each", "other", "some", "any", "all",
    "one", "two", "new", "get", "got", "may", "might", "could", "should",
    "would", "does", "did", "done", "been", "being", "very", "just", "like",
    "over", "time", "since", "been",
})


def _tokens(text: str) -> list[str]:
    return [t for t in _TOKEN_RE.findall((text or "").lower())
            if len(t) >= 2 and t not in _FOCUS_STOPWORDS]


def _is_heading(block: str) -> bool:
    """True if the block's first non-blank line is a markdown heading."""
    for line in block.splitlines():
        if line.strip():
            return line.lstrip().startswith("#")
    return False


def _is_table(block: str) -> bool:
    """Detect markdown tables: 2+ lines where >=50% contain pipe chars."""
    lines = [l for l in block.strip().splitlines() if l.strip()]
    if len(lines) < 2:
        return False
    pipe_count = sum(1 for l in lines if "|" in l)
    return pipe_count >= len(lines) * 0.5


def _is_code(block: str) -> bool:
    """Detect code blocks: fenced (```) or consistently indented."""
    stripped = block.strip()
    if stripped.startswith("```"):
        return True
    lines = block.splitlines()
    non_blank = [l for l in lines if l.strip()]
    if not non_blank or len(non_blank) < 2:
        return False
    indented = sum(1 for l in non_blank if l.startswith("    ") or l.startswith("\t"))
    return indented >= len(non_blank) * 0.8


def _split_blocks(text: str) -> list[str]:
    """Split markdown into blocks separated by blank lines. A block is a
    heading, paragraph, table, or list - kept verbatim (order preserved)."""
    blocks: list[str] = []
    current: list[str] = []
    for line in text.splitlines():
        if line.strip() == "":
            if current:
                blocks.append("\n".join(current))
                current = []
        else:
            current.append(line)
    if current:
        blocks.append("\n".join(current))
    return blocks


def _heading_level(block: str) -> int:
    """Return heading level (1-6) or 0 if not a heading."""
    for line in block.splitlines():
        if line.strip():
            stripped = line.lstrip()
            if stripped.startswith("#"):
                return min(stripped.count("#", 0, 6), 6)
            return 0
    return 0


def focus_content(
    text: str,
    query: str,
    threshold: float = 1.0,
    k1: float = 1.5,
    b: float = 0.75,
    fallback_top: int = 5,
) -> str:
    """Return the blocks of ``text`` most relevant to ``query`` (heading-aware BM25).

    If ``query`` is empty, the text has <= 1 block, or the query yields no
    usable terms, the original text is returned unchanged (focus is a no-op).

    Three-pass selection:
    1. BM25 score each block against query terms
    2. Boost blocks under headings that contain query terms (heading-aware)
    3. Always keep tables/code blocks containing any query term (preservation)
    Then keep blocks above threshold + heading context, or fallback to top-N.
    """
    if not query or not text or not text.strip():
        return text
    blocks = _split_blocks(text)
    if len(blocks) <= 1:
        return text
    qterms = set(_tokens(query))
    if not qterms:
        return text

    block_tokens = [_tokens(bl) for bl in blocks]
    n = len(blocks)
    avgdl = (sum(len(t) for t in block_tokens) / n) if n else 0.0 or 1.0
    if avgdl == 0:
        avgdl = 1.0

    # Document frequency per term (across blocks).
    df: dict[str, int] = {}
    for toks in block_tokens:
        for t in set(toks):
            df[t] = df.get(t, 0) + 1

    def idf(term: str) -> float:
        d = df.get(term, 0)
        # +1 inside the log keeps IDF positive (BM25+ flavor) so a single
        # occurrence always scores > 0.
        return math.log((n - d + 0.5) / (d + 0.5) + 1)

    def score(i: int) -> float:
        toks = block_tokens[i]
        if not toks:
            return 0.0
        tf: dict[str, int] = {}
        for t in toks:
            tf[t] = tf.get(t, 0) + 1
        dl = len(toks)
        s = 0.0
        denom_len = k1 * (1 - b + b * dl / avgdl)
        for term in qterms:
            f = tf.get(term)
            if f:
                s += idf(term) * (f * (k1 + 1)) / (f + denom_len)
        return s

    scores = [score(i) for i in range(n)]

    # ── Pass 2: heading-aware boosting ──────────────────────────────────
    # When a heading contains query terms, boost all blocks under it until
    # the next heading at the same or higher level. Headings define topic
    # boundaries - content under a matching heading is topically relevant
    # even if individual paragraphs don't contain exact query terms.
    for i in range(n):
        if not _is_heading(blocks[i]):
            continue
        heading_tokens = set(_tokens(blocks[i]))
        if not heading_tokens & qterms:
            continue
        h_level = _heading_level(blocks[i])
        scores[i] *= 1.5  # boost the heading itself
        # Boost all following blocks until next heading at same/higher level
        for j in range(i + 1, n):
            if _is_heading(blocks[j]) and _heading_level(blocks[j]) <= h_level:
                break
            scores[j] *= 1.5  # boost blocks under matching heading

    # ── Pass 3: table/code preservation ─────────────────────────────────
    # Tables and code blocks are high-value but BM25-underweighted. If they
    # contain ANY query term, always keep them regardless of BM25 score.
    preserved: set[int] = set()
    for i in range(n):
        if _is_table(blocks[i]) or _is_code(blocks[i]):
            if set(block_tokens[i]) & qterms:
                preserved.add(i)

    # ── Selection: threshold + preserved + heading context ──────────────
    keep = [i for i in range(n) if scores[i] >= threshold]
    keep_set = set(keep) | preserved

    if not keep_set:
        # Nothing cleared threshold and no preserved blocks - keep the closest
        # blocks so the agent has something to judge rather than an empty response.
        keep = sorted(range(n), key=lambda i: scores[i], reverse=True)[:fallback_top]
        keep_set = set(keep)

    # Preserve a heading immediately preceding a kept non-heading block.
    for i in list(keep_set):
        if i > 0 and _is_heading(blocks[i - 1]) and not _is_heading(blocks[i]):
            keep_set.add(i - 1)

    kept = "\n\n".join(blocks[i] for i in range(n) if i in keep_set)
    header = (
        f"[Focus: {query!r}; showing {len(keep_set)} of {n} blocks "
        f"by heading-aware BM25 relevance. Pass focus='' for the full page.]"
    )
    return header + "\n\n" + kept
