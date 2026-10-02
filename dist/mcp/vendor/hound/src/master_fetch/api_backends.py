"""Specialized JSON-API search backends for Hound.

Three free, keyless JSON-API backends that search authoritative indexes directly,
complementing the 8 general HTML-scraping engines. Each fires only when the query
intent matches, runs in parallel with the general engines (zero added latency),
and merges into the same ranking pipeline.

Backends (all keyless, JSON response, no browser):
  - semantic_scholar: 200M+ papers, AI-powered relevance (research/factual intent)
  - github_api:       GitHub repo search, sorted by stars (code intent)
  - hackernews:       Hacker News/Algolia, tech community news (news/general/howto)

These backends address the gap where general search engines don't surface primary
sources: if DDG/Brave don't return the official NVIDIA forum thread, the
TechEmpower GitHub repo, or arXiv papers, no amount of reranking fixes it.
The API backends search those indexes directly.

Transport: httpx (already a core dep). No TLS fingerprint impersonation needed
for JSON APIs. Rate limits are generous and protected by the same circuit breaker
as the HTML backends (60s cooldown on 403/503).
"""

from __future__ import annotations

import json
import logging
from typing import Any
from urllib.parse import quote_plus

import httpx

from master_fetch.search_metasearch import (
    BaseSearchEngine,
    TextResult,
    MetaBlockedException,
    MetaTimeoutException,
    MetaSearchException,
    _PROXY,
)

logger = logging.getLogger("master-fetch.api_backends")

# Default per-backend result count. Enough to contribute to ranking without
# drowning out the general engines. The reranker + quality boost sort the merged
# set, so more from one backend is just noise.
_API_LIMIT = 5


class _SimpleHttpxClient:
    """Minimal httpx client for JSON API requests.

    No TLS fingerprint randomization or HTTP/2 SETTINGS patching — JSON APIs
    don't fingerprint like search engine SERPs do. Just clean HTTP with
    timeout, proxy support, and the same error mapping as the metasearch clients.
    """

    def __init__(self, proxy: str | None = None, timeout: int | None = 10) -> None:
        self._client = httpx.Client(
            proxy=proxy,
            timeout=timeout or 10,
            follow_redirects=True,
            headers={"Accept": "application/json"},
        )

    def request(self, method: str, url: str, **kwargs: Any) -> httpx.Response:
        try:
            return self._client.request(method, url, **kwargs)
        except httpx.TimeoutException as ex:
            raise MetaTimeoutException(f"API request timed out: {ex!r}") from ex
        except Exception as ex:
            raise MetaSearchException(f"{type(ex).__name__}: {ex!r}") from ex


class BaseAPIEngine(BaseSearchEngine):
    """Base class for JSON-API backends. Overrides search() to parse JSON
    instead of XPath-scraped HTML. Subclasses implement _build_params() and
    _parse_results()."""

    search_url: str  # the API endpoint URL

    def __init__(self, proxy: str | None = None, timeout: int | None = None,
                 *, verify: bool = True) -> None:
        # Use our own httpx client (no primp, no fingerprinting needed).
        self.http_client = _SimpleHttpxClient(
            proxy=proxy or _PROXY,
            timeout=timeout or 5,
        )
        self.results: list[Any] = []

    @property
    def result_type(self) -> type:
        return TextResult

    def _build_params(self, query: str) -> dict[str, Any]:
        """Build query-string params for the API request."""
        raise NotImplementedError

    def _parse_results(self, data: dict[str, Any]) -> list[TextResult]:
        """Parse the JSON response into TextResult objects."""
        raise NotImplementedError

    def search(self, query: str, region: str = "us-en", safesearch: str = "moderate",
               timelimit: str | None = None, page: int = 1, **kwargs: str
               ) -> list[TextResult] | None:
        """Make the API request and parse JSON results.

        Strips site:/-site: prefixes from the query (API backends don't support
        them; site filtering is applied post-query by multi_search on the URL).
        """
        # Strip site:/-site: prefixes that multi_search adds to the query
        # (API search endpoints don't understand them; the URL-level site filter
        # in multi_search handles the actual filtering).
        clean_query = _strip_site_prefixes(query)
        if not clean_query.strip():
            return None

        params = self._build_params(clean_query)
        try:
            resp = self.http_client.request("GET", self.search_url, params=params)
        except (MetaTimeoutException, MetaSearchException) as ex:
            logger.debug("%s request failed: %r", self.name, ex)
            return None

        if resp.status_code in (403, 429, 503):
            raise MetaBlockedException(f"HTTP {resp.status_code}")
        if resp.status_code != 200:
            logger.debug("%s returned HTTP %d", self.name, resp.status_code)
            return None

        try:
            data = json.loads(resp.text)
        except (json.JSONDecodeError, ValueError) as ex:
            logger.debug("%s JSON parse failed: %r", self.name, ex)
            return None

        if not isinstance(data, dict):
            return None

        try:
            results = self._parse_results(data)
        except Exception as ex:
            logger.debug("%s parse error: %r", self.name, ex)
            return None

        self.results = results
        return results if results else None


# ─── site: prefix stripping ──────────────────────────────────────────────────

import re as _re

_SITE_PREFIX_RE = _re.compile(r"\s*-?site:\S+\s*")


def _strip_site_prefixes(query: str) -> str:
    """Remove site:/-site: prefixes that multi_search adds for HTML engines.
    API backends don't support them; site filtering is done post-query on the URL."""
    cleaned = _SITE_PREFIX_RE.sub(" ", query).strip()
    return cleaned


# ─── Semantic Scholar (research/factual intent) ──────────────────────────────
# 200M+ papers, AI-powered relevance ranking, free, no key.
# Rate limit: 100 req / 5 min (shared unauthenticated pool).
# Surfaces primary sources: peer-reviewed papers, preprints, citations.

class SemanticScholarEngine(BaseAPIEngine):
    name = "semantic_scholar"
    provider = "semantic_scholar"
    search_url = "https://api.semanticscholar.org/graph/v1/paper/search"

    def _build_params(self, query: str) -> dict[str, Any]:
        return {
            "query": query,
            "limit": _API_LIMIT,
            "fields": "title,year,citationCount,authors,abstract,externalIds,url",
        }

    def _parse_results(self, data: dict[str, Any]) -> list[TextResult]:
        papers = data.get("data") or []
        results: list[TextResult] = []
        for p in papers:
            title = p.get("title", "")
            if not title:
                continue
            # Prefer the paper's direct URL, fall back to Semantic Scholar page.
            url = p.get("url", "")
            if not url:
                paper_id = p.get("paperId", "")
                if paper_id:
                    url = f"https://www.semanticscholar.org/paper/{paper_id}"
            if not url:
                continue
            # Build a rich snippet from abstract + metadata.
            parts: list[str] = []
            abstract = p.get("abstract", "")
            if abstract:
                parts.append(abstract[:300])
            year = p.get("year")
            if year:
                parts.append(f"Published: {year}")
            citations = p.get("citationCount")
            if citations is not None:
                parts.append(f"Citations: {citations}")
            authors = p.get("authors", [])
            if authors:
                author_names = [a.get("name", "") for a in authors[:3] if a.get("name")]
                if author_names:
                    parts.append(f"Authors: {', '.join(author_names)}")
            # Add DOI if available for authority signal.
            ext_ids = p.get("externalIds") or {}
            doi = ext_ids.get("DOI", "")
            if doi:
                parts.append(f"DOI: {doi}")
            snippet = " | ".join(parts) if parts else title
            results.append(TextResult(title=title, href=url, body=snippet))
        return results


# ─── GitHub Search (code intent) ─────────────────────────────────────────────
# Searches GitHub repos sorted by stars. Surfaces primary code sources.
# Rate limit: 10 req / min unauthenticated. Circuit breaker handles 403/429.

class GitHubSearchEngine(BaseAPIEngine):
    name = "github_api"
    provider = "github_api"
    search_url = "https://api.github.com/search/repositories"

    def __init__(self, proxy: str | None = None, timeout: int | None = None,
                 *, verify: bool = True) -> None:
        super().__init__(proxy=proxy, timeout=timeout, verify=verify)
        # GitHub API requires a User-Agent header.
        self.http_client._client.headers.update({
            "User-Agent": "hound-mcp/12.0 (https://github.com/dondai1234/master-fetch)",
            "Accept": "application/vnd.github+json",
        })

    def _build_params(self, query: str) -> dict[str, Any]:
        return {
            "q": query,
            "sort": "stars",
            "order": "desc",
            "per_page": _API_LIMIT,
        }

    def _parse_results(self, data: dict[str, Any]) -> list[TextResult]:
        items = data.get("items") or []
        results: list[TextResult] = []
        for item in items:
            full_name = item.get("full_name", "")
            html_url = item.get("html_url", "")
            if not html_url:
                continue
            title = full_name or item.get("name", "")
            # Build a rich snippet from repo metadata.
            parts: list[str] = []
            desc = item.get("description", "")
            if desc:
                parts.append(desc[:250])
            stars = item.get("stargazers_count", 0)
            if stars:
                parts.append(f"Stars: {stars:,}")
            lang = item.get("language", "")
            if lang:
                parts.append(f"Language: {lang}")
            topics = item.get("topics", [])
            if topics:
                parts.append(f"Topics: {', '.join(topics[:5])}")
            updated = item.get("updated_at", "")
            if updated:
                parts.append(f"Updated: {updated[:10]}")
            snippet = " | ".join(parts) if parts else title
            results.append(TextResult(title=title, href=html_url, body=snippet))
        return results


# ─── Hacker News / Algolia (news/general/howto intent) ───────────────────────
# Community-curated tech news/discussions. High signal-to-noise.
# Rate limit: ~10 req / sec — very generous.
# Surfaces forum/discussion threads that general engines miss.

class HackerNewsEngine(BaseAPIEngine):
    name = "hackernews"
    provider = "hackernews"
    search_url = "https://hn.algolia.com/api/v1/search"

    def _build_params(self, query: str) -> dict[str, Any]:
        return {
            "query": query,
            "tags": "story",
            "hitsPerPage": _API_LIMIT,
        }

    def _parse_results(self, data: dict[str, Any]) -> list[TextResult]:
        hits = data.get("hits") or []
        results: list[TextResult] = []
        for hit in hits:
            title = hit.get("title") or hit.get("story_text", "")
            if not title:
                continue
            # Prefer external URL, fall back to HN item page.
            url = hit.get("url", "")
            if not url:
                object_id = hit.get("objectID", "")
                if object_id:
                    url = f"https://news.ycombinator.com/item?id={object_id}"
            if not url:
                continue
            # Build snippet from points, comments, author.
            parts: list[str] = []
            points = hit.get("points")
            if points is not None:
                parts.append(f"Points: {points}")
            comments = hit.get("num_comments")
            if comments is not None:
                parts.append(f"Comments: {comments}")
            author = hit.get("author", "")
            if author:
                parts.append(f"Author: {author}")
            created = hit.get("created_at", "")
            if created:
                parts.append(f"Date: {created[:10]}")
            snippet = " | ".join(parts) if parts else title
            results.append(TextResult(title=title, href=url, body=snippet))
        return results
