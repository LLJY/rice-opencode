"""Bring Your Own Key (BYOK) search API configuration.

Loads search API keys from environment variables and a persistent config file.
Env vars take precedence over the config file (override, not merge).

Config file: ~/.hound/search_keys.json
Format:
  {
    "serper": ["key1", "key2"],
    "tavily": ["key1"],
    "exa": ["key1"],
    "firecrawl": ["key1"],
    "tinyfish": ["key1"]
  }

Env vars (comma-separated for multiple keys):
  HOUND_SEARCH_SERPER_KEYS=key1,key2
  HOUND_SEARCH_TAVILY_KEYS=key1
  HOUND_SEARCH_EXA_KEYS=key1
  HOUND_SEARCH_FIRECRAWL_KEYS=key1
  HOUND_SEARCH_TINYFISH_KEYS=key1

Supported providers (canonical names, used everywhere):
  serper, tavily, exa, firecrawl, tinyfish
"""

from __future__ import annotations

import json
import logging
import os
from pathlib import Path
from typing import Any

logger = logging.getLogger(__name__)

# Canonical provider names (lowercase, stable).
BYOK_PROVIDERS = ("serper", "tavily", "exa", "firecrawl", "tinyfish")

# Env var name for each provider.
_ENV_VAR_MAP: dict[str, str] = {
    "serper": "HOUND_SEARCH_SERPER_KEYS",
    "tavily": "HOUND_SEARCH_TAVILY_KEYS",
    "exa": "HOUND_SEARCH_EXA_KEYS",
    "firecrawl": "HOUND_SEARCH_FIRECRAWL_KEYS",
    "tinyfish": "HOUND_SEARCH_TINYFISH_KEYS",
}


def _config_path() -> Path:
    """Return the path to ~/.hound/search_keys.json."""
    home = Path.home()
    return home / ".hound" / "search_keys.json"


def _read_config_file() -> dict[str, list[str]]:
    """Read the config file. Returns empty dict if missing or malformed."""
    path = _config_path()
    if not path.exists():
        return {}
    try:
        with open(path, encoding="utf-8") as f:
            data = json.load(f)
        if not isinstance(data, dict):
            logger.warning("search_keys.json is not a dict; ignoring")
            return {}
        # Validate: each value must be a list of strings.
        result: dict[str, list[str]] = {}
        for provider, keys in data.items():
            if provider not in BYOK_PROVIDERS:
                logger.warning("Unknown provider '%s' in search_keys.json; skipping", provider)
                continue
            if isinstance(keys, str):
                result[provider] = [keys]
            elif isinstance(keys, list) and all(isinstance(k, str) for k in keys):
                result[provider] = [k.strip() for k in keys if k.strip()]
            else:
                logger.warning("Invalid keys for '%s' in search_keys.json; skipping", provider)
        return result
    except (json.JSONDecodeError, OSError) as ex:
        logger.warning("Failed to read search_keys.json: %r", ex)
        return {}


def _read_env_vars() -> dict[str, list[str]]:
    """Read keys from environment variables. Returns empty dict if none set."""
    result: dict[str, list[str]] = {}
    for provider, env_var in _ENV_VAR_MAP.items():
        raw = os.environ.get(env_var, "").strip()
        if not raw:
            continue
        keys = [k.strip() for k in raw.split(",") if k.strip()]
        if keys:
            result[provider] = keys
    return result


def load_byok_keys() -> dict[str, list[str]]:
    """Load BYOK keys from env vars (priority) + config file (fallback).

    Env vars override the config file entirely for any provider that has
    env vars set. Providers without env vars fall back to config file keys.
    Returns dict: {provider: [key1, key2, ...]}, only providers with >=1 key.
    """
    env_keys = _read_env_vars()
    file_keys = _read_config_file()
    merged: dict[str, list[str]] = {}
    for provider in BYOK_PROVIDERS:
        if provider in env_keys:
            merged[provider] = env_keys[provider]
        elif provider in file_keys:
            merged[provider] = file_keys[provider]
    return merged


def has_byok_keys() -> bool:
    """Check if any BYOK keys are configured (env or config file)."""
    return bool(load_byok_keys())


def save_byok_keys(keys: dict[str, list[str]]) -> None:
    """Write keys to the config file. Creates ~/.hound/ if needed.

    Only writes known providers with non-empty key lists. Existing keys for
    providers not in the input are preserved (merge).
    """
    path = _config_path()
    path.parent.mkdir(parents=True, exist_ok=True)
    # Merge with existing config file keys (preserve providers not in input).
    existing = _read_config_file()
    for provider in BYOK_PROVIDERS:
        if provider in keys and keys[provider]:
            existing[provider] = keys[provider]
        elif provider in keys and not keys[provider]:
            # Empty list = remove this provider.
            existing.pop(provider, None)
    with open(path, "w", encoding="utf-8") as f:
        json.dump(existing, f, indent=2, sort_keys=True)
    # Best-effort: restrict file permissions on Unix (no-op on Windows).
    try:
        os.chmod(path, 0o600)
    except OSError:
        pass


def add_key(provider: str, key: str) -> None:
    """Add a single key to a provider. Creates the provider if new."""
    provider = provider.lower().strip()
    if provider not in BYOK_PROVIDERS:
        raise ValueError(f"Unknown provider '{provider}'. Supported: {', '.join(BYOK_PROVIDERS)}")
    key = key.strip()
    if not key:
        raise ValueError("Key cannot be empty")
    keys = _read_config_file()
    if provider not in keys:
        keys[provider] = []
    if key not in keys[provider]:
        keys[provider].append(key)
    save_byok_keys(keys)


def remove_key(provider: str, index: int | None = None) -> int:
    """Remove a key from a provider. If index is None, removes ALL keys for that provider.
    Returns the number of keys removed."""
    provider = provider.lower().strip()
    if provider not in BYOK_PROVIDERS:
        raise ValueError(f"Unknown provider '{provider}'. Supported: {', '.join(BYOK_PROVIDERS)}")
    keys = _read_config_file()
    if provider not in keys:
        return 0
    if index is None:
        removed = len(keys[provider])
        keys[provider] = []  # empty list signals removal to save_byok_keys
    else:
        if index < 0 or index >= len(keys[provider]):
            raise IndexError(f"Index {index} out of range (provider has {len(keys[provider])} keys)")
        removed = 1
        keys[provider].pop(index)
        if not keys[provider]:
            keys[provider] = []  # empty list signals removal to save_byok_keys
    save_byok_keys(keys)
    return removed


def clear_all_keys() -> int:
    """Remove all BYOK keys from the config file. Returns count removed."""
    keys = _read_config_file()
    count = sum(len(v) for v in keys.values())
    if count:
        save_byok_keys({p: [] for p in keys})  # empty lists = remove
    return count


def redact_key(key: str) -> str:
    """Redact a key for display. Shows first 8 + last 4 chars."""
    if len(key) <= 12:
        return key[:4] + "..." + key[-4:] if len(key) > 8 else "***"
    return key[:8] + "..." + key[-4:]


def list_keys() -> dict[str, list[str]]:
    """List all configured keys (raw, not redacted). For internal use."""
    return load_byok_keys()
