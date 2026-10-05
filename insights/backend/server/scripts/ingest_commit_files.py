#!/usr/bin/env python3
"""Global files ingestion (Stage B) across all sources (GitLab + SVN).

Reads commits with files_ingested=0 ordered by committed_at,id, populates
repo_commit_files + repo_commit_diffs. Deduplication is handled by a separate
deduplicate_repo_files.py script after ingestion.

Job logged in ingestion_runs with job_type=commit_files_ingest and progress logs in ingestion_run_logs.
"""
from __future__ import annotations

import argparse
import base64
import datetime as dt
import hashlib
import json
import logging
import os
import subprocess
import time
import sys
from dataclasses import dataclass, field
from typing import Dict, Iterable, List, Optional, Sequence, Set, Tuple
from typing import Dict, Iterable, List, Optional, Sequence, Set, Tuple, Any
from concurrent.futures import ThreadPoolExecutor, Future
import threading
from urllib.parse import quote

PROGRESS_INTERVAL = max(1, int(os.environ.get("FILES_INGEST_PROGRESS_INTERVAL", "50")))
COMMIT_BATCH_SIZE = max(1, int(os.environ.get("FILES_INGEST_COMMIT_BATCH", "10")))  # Commit every N records
DEFAULT_BATCH_SIZE = 200  # Increased from 50 for better throughput
DEFAULT_MAX_DIFF_BYTES = 512 * 1024  # For SVN diffs streaming/truncation
GITLAB_TIMEOUT = int(os.environ.get("FILES_INGEST_TIMEOUT", "120"))

LOGGER = logging.getLogger(__name__)
RUN_START_TIME: Optional[float] = None
LOG_BATCH_SIZE = max(1, int(os.environ.get("FILES_INGEST_LOG_BATCH", "50")))  # Increased from 20
LOG_BUFFER: List[Tuple[int, str, str, Optional[str]]] = []
LOG_BUFFER_LOCK = threading.Lock()

try:
    import mysql.connector  # type: ignore
    from mysql.connector import errors as mysql_errors  # type: ignore
except ImportError as exc:
    raise SystemExit("mysql-connector-python required. pip install mysql-connector-python") from exc

import requests

try:
    from server.python_service.config import Config as ServerConfig
except ImportError:
    import sys
    sys.path.append(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))))
    from server.python_service.config import Config as ServerConfig

try:
    from diff_utils import DiffSummary, looks_binary, summarize_unified_diff
except ModuleNotFoundError:
    from server.scripts.diff_utils import DiffSummary, looks_binary, summarize_unified_diff

# BINARY_EXTENSIONS = (".png", ".jpg", ".jpeg", ".gif", ".bmp", ".ico", ".zip", ".rar", ".jar", ".war", ".class", ".pdf")

# ---------------------------------------------------------------------------
# Data Classes
# ---------------------------------------------------------------------------
@dataclass
class FileChange:
    # Data from the diff
    path_raw: str
    old_path: str
    new_path: str
    change_type: str
    diff_text: Optional[str]

    # Computed metadata
    repo_file_id: Optional[int] = None
    file_name: str = ""
    category: str = "unknown"
    can_line_count: int = 0
    is_text_candidate: bool = False
    is_truncated: bool = False

    # Size and content hash
    bytes_before: Optional[int] = None
    bytes_after: Optional[int] = None
    repo_file_bytes: Optional[int] = None
    content_hash: Optional[str] = None

    # Line changes
    lines_added: Optional[int] = None
    lines_deleted: Optional[int] = None
    replacements: Optional[int] = None
    lines: Optional[int] = None

    # Duplicate info
    is_duplicate: bool = False
    duplicate_of_file_id: Optional[int] = None
    duplicate_reason: Optional[str] = None

# ---------------------------------------------------------------------------
# Config
# ---------------------------------------------------------------------------

@dataclass
class IngestConfig:
    db_host: str
    db_port: int
    db_user: str
    db_password: str
    db_name: str
    gitlab_url: Optional[str]
    gitlab_token: Optional[str]
    batch_size: int = DEFAULT_BATCH_SIZE
    include_invalid: bool = False
    svn_max_diff_bytes: int = DEFAULT_MAX_DIFF_BYTES
    triggered_by: Optional[str] = None
    repo_catalog_id: Optional[int] = None
    filter_gitlab_project_id: Optional[int] = None
    dry_run: bool = False
    repo_catalog_id: Optional[int] = None
    filter_gitlab_project_id: Optional[int] = None
    max_workers: Optional[int] = None
    http_pool_multiplier: Optional[float] = None
    svn_max_concurrency: Optional[int] = None
    save_diffs: bool = True


@dataclass
class SharedIngestResources:
    file_type_map: Dict[str, Dict]
    trackable_categories: Set[str]
    max_hash_size: int
    banned_rules_cache: Dict[int, List[Dict]]
    gitlab_size_cache: Dict[Tuple[int, str, str], Optional[int]] = field(default_factory=dict)
    svn_size_cache: Dict[Tuple[str, str, str], Optional[int]] = field(default_factory=dict)
    size_cache_lock: threading.Lock = field(default_factory=threading.Lock)
    # Cache/Metrics counters
    gitlab_cache_hits: int = 0
    gitlab_cache_misses: int = 0
    gitlab_size_fetches: int = 0
    svn_cache_hits: int = 0
    svn_cache_misses: int = 0
    svn_size_fetches: int = 0
    svn_cat_cache: Dict[Tuple[str, str, str], Optional[bytes]] = field(default_factory=dict)
    svn_cat_cache_hits: int = 0
    svn_cat_cache_misses: int = 0
    svn_cat_fetches: int = 0
    svn_cat_failures: int = 0
    repo_files_cache_hits: int = 0
    repo_files_cache_misses: int = 0
    metrics_lock: threading.Lock = field(default_factory=threading.Lock)
    repo_files_cache: Dict[int, Dict[str, Dict]] = field(default_factory=dict)
    executor: Optional[ThreadPoolExecutor] = None
    svn_semaphore: Optional[threading.Semaphore] = None
    svn_semaphore_waits: int = 0
    # Track active held semaphore count and peak for visibility
    svn_active_count: int = 0
    # Run-wide peak (retained for summary) and per-heartbeat interval peak
    svn_active_peak_run: int = 0
    svn_active_peak_interval: int = 0
    # Store initial configured max concurrency for reporting
    svn_semaphore_limit: Optional[int] = None
    # Whether to persist diff_text into repo_commit_diffs
    save_diffs: bool = True


def _normalize_size(value: Optional[Any]) -> Optional[int]:
    if value is None:
        return None
    try:
        return int(value)
    except (TypeError, ValueError):
        return None


def clear_commit_caches(shared: SharedIngestResources) -> None:
    """Release per-commit heavy caches to避免内存堆积."""
    try:
        shared.svn_cat_cache.clear()
    except Exception:
        pass


def _cache_gitlab_size(shared: SharedIngestResources, project_id: int, ref: Optional[str], path: Optional[str], value: Optional[Any]) -> Optional[int]:
    normalized = _normalize_size(value)
    key = (project_id, ref or "", path or "")
    with shared.size_cache_lock:
        shared.gitlab_size_cache[key] = normalized
    return normalized

def load_config(argv: Optional[Iterable[str]] = None) -> IngestConfig:
    parser = argparse.ArgumentParser(description="Global commit files ingestion")
    parser.add_argument("--db-host", default=os.environ.get("DB_HOST", ServerConfig.DB_HOST))
    parser.add_argument("--db-port", type=int, default=int(os.environ.get("DB_PORT", str(ServerConfig.DB_PORT))))
    parser.add_argument("--db-user", default=os.environ.get("DB_USER", ServerConfig.DB_USER))
    parser.add_argument("--db-password", default=os.environ.get("DB_PASSWORD", ServerConfig.DB_PASSWORD))
    parser.add_argument("--db-name", default=os.environ.get("DB_NAME", ServerConfig.DB_NAME))
    parser.add_argument("--gitlab-url", default=os.environ.get("GITLAB_URL", ServerConfig.GITLAB_URL))
    parser.add_argument("--gitlab-token", default=os.environ.get("GITLAB_TOKEN", ServerConfig.GITLAB_TOKEN))
    parser.add_argument("--batch-size", type=int, default=int(os.environ.get("FILES_BATCH_SIZE", str(DEFAULT_BATCH_SIZE))))
    parser.add_argument("--include-invalid", action="store_true", help="Include invalid repositories")
    parser.add_argument("--svn-max-diff-bytes", type=int, default=int(os.environ.get("SVN_MAX_DIFF_BYTES", str(DEFAULT_MAX_DIFF_BYTES))))
    parser.add_argument("--log-level", default=os.environ.get("LOG_LEVEL", "DEBUG"))
    parser.add_argument("--triggered-by", default=os.environ.get("TRIGGERED_BY"))
    parser.add_argument("--repo-catalog-id", type=int, default=None, help="Process only commits for this repo_catalog.id")
    parser.add_argument("--gitlab-project-id", type=int, default=None, help="Process only commits for this gitlab_project_id")
    parser.add_argument("--dry-run", action="store_true", help="Run without writing to the DB (no ingestion_runs, no updates) for testing")
    parser.add_argument("--max-workers", type=int, default=None, help="Max concurrent workers for size prefetch and HTTP requests. Defaults to cpu_count*2 or env FILES_INGEST_MAX_WORKERS")
    parser.add_argument("--http-pool-multiplier", type=float, default=None, help="Multiplier for HTTP session connection pool sizes relative to max-workers. Defaults to env FILES_INGEST_HTTP_POOL_MULTIPLIER or 2.0")
    parser.add_argument("--svn-max-concurrency", type=int, default=1, help="Max concurrent svnlook processes for SVN operations. Defaults to half of max-workers, bounded 1..8 or env FILES_INGEST_SVN_MAX_CONCURRENCY.")
    parser.add_argument("--save-diffs", action="store_true", help="Enable storing diff_text into repo_commit_diffs (default: False)")

    args = parser.parse_args(list(argv) if argv is not None else None)

    try:
        from log_utils import configure_logging
    except ImportError:
        from server.scripts.log_utils import configure_logging

    configure_logging(args.log_level)

    svn_arg_value = args.svn_max_concurrency if args.svn_max_concurrency is not None else (int(os.environ.get('FILES_INGEST_SVN_MAX_CONCURRENCY')) if os.environ.get('FILES_INGEST_SVN_MAX_CONCURRENCY') else None)
    return IngestConfig(
        db_host=args.db_host,
        db_port=args.db_port,
        db_user=args.db_user,
        db_password=args.db_password,
        db_name=args.db_name,
        gitlab_url=args.gitlab_url,
        gitlab_token=args.gitlab_token,
        batch_size=args.batch_size,
        include_invalid=args.include_invalid,
        svn_max_diff_bytes=args.svn_max_diff_bytes,
        triggered_by=args.triggered_by,
        repo_catalog_id=args.repo_catalog_id,
        # Pass on max_workers (None means default)
    **({} if args.max_workers is None else {"max_workers": args.max_workers}),
    **({} if args.http_pool_multiplier is None else {"http_pool_multiplier": args.http_pool_multiplier}),
    **({} if svn_arg_value is None else {"svn_max_concurrency": svn_arg_value}),
        filter_gitlab_project_id=args.gitlab_project_id,
        dry_run=args.dry_run,
        save_diffs=args.save_diffs,
    )


def build_shared_resources(connection, max_workers: Optional[int] = None, svn_max_concurrency: Optional[int] = None, save_diffs: bool = True) -> SharedIngestResources:
    # Create an executor sized conservatively; allow override via env or CLI arg
    env_workers = os.environ.get("FILES_INGEST_MAX_WORKERS")
    if max_workers is None:
        try:
            default_workers = int(env_workers) if env_workers is not None else max(4, (os.cpu_count() or 1) * 2)
        except Exception:
            default_workers = max(4, (os.cpu_count() or 1) * 2)
    else:
        default_workers = max(1, int(max_workers))
    executor = ThreadPoolExecutor(max_workers=default_workers)
    # SVN concurrency is optionally computed after creating SharedIngestResources; semaphore will be set later
    shared = SharedIngestResources(
        file_type_map=_load_file_type_catalog(connection),
        trackable_categories=_get_trackable_categories(connection),
        max_hash_size=_get_max_hash_file_size(connection),
        banned_rules_cache={},
        gitlab_size_cache={},
        svn_size_cache={},
        size_cache_lock=threading.Lock(),
        repo_files_cache={},
        # metrics counters start at 0 by default
        gitlab_cache_hits=0,
        gitlab_cache_misses=0,
        gitlab_size_fetches=0,
        svn_cache_hits=0,
        svn_cache_misses=0,
        svn_size_fetches=0,
        repo_files_cache_hits=0,
        repo_files_cache_misses=0,
        metrics_lock=threading.Lock(),
        executor=executor,
        save_diffs=save_diffs,
    )

    # Initialize SVN semaphore based on svn_max_concurrency or a conservative default relative to executor
    try:
        if svn_max_concurrency is not None:
            size = max(1, int(svn_max_concurrency))
        else:
            # Default to half of executor workers, bounded 1..8
            size = max(1, min(8, max(1, int((executor._max_workers or 4) // 2))))
    except Exception:
        size = 4
    try:
        shared.svn_semaphore = threading.Semaphore(size)
        shared.svn_semaphore_limit = size
    except Exception:
        shared.svn_semaphore = None
    return shared

# ---------------------------------------------------------------------------
# Shared helpers
# ---------------------------------------------------------------------------

def _sha256_hex(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()

def _load_file_type_catalog(connection) -> Dict[str, Dict]:
    """Load global file_type_catalog into a dict keyed by extension (lowercase, no leading dot).

    Returns mapping: ext -> { 'category': str, 'can_line_count': int }
    Falls back to empty dict when table missing.
    """
    cur = connection.cursor()
    mapping: Dict[str, Dict] = {}
    try:
        try:
            cur.execute("SELECT extension, category, can_line_count FROM file_type_catalog")
            for r in cur.fetchall():
                ext = (r[0] or "").lower().lstrip('.')
                mapping[ext] = {"category": r[1] or "unknown", "can_line_count": int(r[2] or 0)}
        except Exception:
            # Table might not exist yet; caller will treat unknowns as fallback
            mapping = {}
    finally:
        cur.close()
    return mapping


def _get_max_hash_file_size(connection) -> int:
    """Return maximum byte size for which we compute content hash. Falls back to 1MB."""
    val = _get_system_param(connection, "maximum_hash_file_size")
    try:
        return int(val) if val is not None else 1_048_576
    except Exception:
        return 1_048_576


def ensure_repo_files_cache(connection, repo_catalog_id: int, shared: SharedIngestResources) -> Dict[str, Dict]:
        """Load a mapping of current_file_path -> {id,is_deleted,bytes} into shared cache for a repo.

        This avoids repeated SELECTs per-file for high-volume repositories.
        """
        cache = shared.repo_files_cache.get(repo_catalog_id)
        if cache is not None:
            try:
                with shared.metrics_lock:
                    shared.repo_files_cache_hits += 1
            except Exception:
                pass
            return cache
        cur = connection.cursor()
        try:
            cur.execute("SELECT current_file_path, id, is_deleted, bytes FROM repo_files WHERE repo_catalog_id=%s", (repo_catalog_id,))
            rows = cur.fetchall()
            mapping: Dict[str, Dict] = {}
            for r in rows:
                path = r[0]
                mapping[path] = {"id": int(r[1]), "is_deleted": bool(r[2]) if r[2] is not None else False, "bytes": int(r[3]) if r[3] is not None else None}
            try:
                with shared.metrics_lock:
                    shared.repo_files_cache_misses += 1
            except Exception:
                pass
            shared.repo_files_cache[repo_catalog_id] = mapping
            return mapping
        finally:
            cur.close()


def _get_gitlab_size_worker(session: requests.Session, base: str, project_id: int, path: str, ref: str, shared: SharedIngestResources) -> Optional[int]:
    try:
        size = fetch_gitlab_file_size(session, base, project_id, path, ref, {})
        normalized = _cache_gitlab_size(shared, project_id, ref, path, size)
        try:
            with shared.metrics_lock:
                shared.gitlab_size_fetches += 1
        except Exception:
            pass
        return normalized
    except Exception:
        return None


def _get_gitlab_content_worker(session: requests.Session, base: str, project_id: int, path: str, ref: str) -> Optional[Tuple[bytes, Optional[int]]]:
    """Fetch file content and size from GitLab API.

    Returns:
        Tuple of (content_bytes, size) on success, None on failure
    """
    try:
        encoded_path = quote(path, safe="")
        meta_url = f"{base}/api/v4/projects/{project_id}/repository/files/{encoded_path}"
        file_resp = session.get(meta_url, params={"ref": ref}, timeout=GITLAB_TIMEOUT)
        if file_resp.status_code == 200:
            meta = file_resp.json()
            raw_bytes = None
            size_val = None
            if isinstance(meta.get("content"), str):
                raw_bytes = base64.b64decode(meta["content"])
            size_val = meta.get("size")
            return (raw_bytes, size_val) if raw_bytes else None
        return None
    except Exception:
        return None


def _get_gitlab_size_concurrent(session: requests.Session, base: str, project_id: int, path: str, ref: str, shared: SharedIngestResources, *, force_refresh: bool = False) -> Optional[int]:
    key = (project_id, ref or "", path or "")
    cached: Optional[int] = None
    cache_has_entry = False
    with shared.size_cache_lock:
        if key in shared.gitlab_size_cache:
            cache_has_entry = True
            cached = shared.gitlab_size_cache[key]
    if cache_has_entry and cached is not None and not force_refresh:
        try:
            with shared.metrics_lock:
                shared.gitlab_cache_hits += 1
        except Exception:
            pass
        return cached
    if cache_has_entry and cached is None and not force_refresh:
        # Known miss; avoid hammering the API repeatedly.
        try:
            with shared.metrics_lock:
                shared.gitlab_cache_hits += 1
        except Exception:
            pass
        return None
    try:
        with shared.metrics_lock:
            shared.gitlab_cache_misses += 1
    except Exception:
        pass
    if shared.executor:
        fut: Future = shared.executor.submit(_get_gitlab_size_worker, session, base, project_id, path, ref, shared)
        try:
            return fut.result(timeout=GITLAB_TIMEOUT)
        except Exception:
            return None
    return _get_gitlab_size_worker(session, base, project_id, path, ref, shared)


def _get_svn_size_worker(repo_path: str, revision: str, path: str, shared: SharedIngestResources) -> Optional[int]:
    key = (repo_path, revision, path)
    sem = getattr(shared, 'svn_semaphore', None)
    acquired = False
    size = None
    try:
        if sem is not None:
            try:
                acquired = sem.acquire(blocking=False)
            except Exception:
                acquired = False
            if not acquired:
                try:
                    with shared.metrics_lock:
                        shared.svn_semaphore_waits += 1
                except Exception:
                    pass
                sem.acquire()
                acquired = True
        # If acquired, increment active count and update peak
        if sem is not None and acquired:
            try:
                with shared.metrics_lock:
                    shared.svn_active_count += 1
                    if shared.svn_active_count > shared.svn_active_peak_run:
                        shared.svn_active_peak_run = shared.svn_active_count
                    if shared.svn_active_count > shared.svn_active_peak_interval:
                        shared.svn_active_peak_interval = shared.svn_active_count
            except Exception:
                pass
        size = svn_file_size(repo_path, revision, path)
        with shared.size_cache_lock:
            shared.svn_size_cache[key] = size
        try:
            with shared.metrics_lock:
                shared.svn_size_fetches += 1
        except Exception:
            pass
        return size
    except Exception:
        return None
    finally:
        if sem is not None and acquired:
            try:
                # Update active count metrics when releasing
                try:
                    with shared.metrics_lock:
                        shared.svn_active_count -= 1 if shared.svn_active_count > 0 else 0
                except Exception:
                    pass
                try:
                    sem.release()
                except Exception:
                    pass
            except Exception:
                pass


def _get_svn_size_concurrent(repo_path: str, revision: str, path: str, shared: SharedIngestResources) -> Optional[int]:
        key = (repo_path, revision, path)
        with shared.size_cache_lock:
            if key in shared.svn_size_cache:
                try:
                    with shared.metrics_lock:
                        shared.svn_cache_hits += 1
                except Exception:
                    pass
                return shared.svn_size_cache[key]
        try:
            with shared.metrics_lock:
                shared.svn_cache_misses += 1
        except Exception:
            pass
        if shared.executor:
            fut: Future = shared.executor.submit(_get_svn_size_worker, repo_path, revision, path, shared)
            try:
                return fut.result(timeout=60)
            except Exception:
                return None
        else:
            return _get_svn_size_worker(repo_path, revision, path, shared)


def _get_svn_cat_worker(repo_path: str, revision: str, path: str, shared: SharedIngestResources) -> Optional[bytes]:
    key = (repo_path, revision or "", path or "")
    sem = getattr(shared, 'svn_semaphore', None)
    acquired = False
    raw = None
    try:
        if sem is not None:
            try:
                acquired = sem.acquire(blocking=False)
            except Exception:
                acquired = False
            if not acquired:
                try:
                    with shared.metrics_lock:
                        shared.svn_semaphore_waits += 1
                except Exception:
                    pass
                sem.acquire()
                acquired = True
        # Track active count and peak
        if sem is not None and acquired:
            try:
                with shared.metrics_lock:
                    shared.svn_active_count += 1
                    if shared.svn_active_count > shared.svn_active_peak_run:
                        shared.svn_active_peak_run = shared.svn_active_count
                    if shared.svn_active_count > shared.svn_active_peak_interval:
                        shared.svn_active_peak_interval = shared.svn_active_count
            except Exception:
                pass
        raw = svn_cat_bytes(repo_path, revision, path)
        with shared.size_cache_lock:
            shared.svn_cat_cache[key] = raw
        try:
            with shared.metrics_lock:
                shared.svn_cat_fetches += 1
        except Exception:
            pass
        return raw
    except Exception:
        try:
            with shared.metrics_lock:
                shared.svn_cat_failures += 1
        except Exception:
            pass
        return None
    finally:
        if sem is not None and acquired:
            try:
                try:
                    with shared.metrics_lock:
                        shared.svn_active_count -= 1 if shared.svn_active_count > 0 else 0
                except Exception:
                    pass
                try:
                    sem.release()
                except Exception:
                    pass
            except Exception:
                pass


def _get_svn_cat_concurrent(repo_path: str, revision: str, path: str, shared: SharedIngestResources) -> Optional[bytes]:
    key = (repo_path, revision or "", path or "")
    with shared.size_cache_lock:
        if key in shared.svn_cat_cache:
            try:
                with shared.metrics_lock:
                    shared.svn_cat_cache_hits += 1
            except Exception:
                pass
            return shared.svn_cat_cache[key]
    try:
        with shared.metrics_lock:
            shared.svn_cat_cache_misses += 1
    except Exception:
        pass
    if shared.executor:
        fut: Future = shared.executor.submit(_get_svn_cat_worker, repo_path, revision, path, shared)
        try:
            return fut.result(timeout=60)
        except Exception:
            try:
                with shared.metrics_lock:
                    shared.svn_cat_failures += 1
            except Exception:
                pass
            return None
    else:
        return _get_svn_cat_worker(repo_path, revision, path, shared)

# ---------------------------------------------------------------------------
# GitLab specific
# ---------------------------------------------------------------------------

def classify_change(diff: Dict) -> str:
    if diff.get("new_file"):
        return "A"
    if diff.get("deleted_file"):
        return "D"
    if diff.get("renamed_file"):
        return "R"
    return "M"


def fetch_gitlab_commit_and_diffs(session: requests.Session, base: str, project_id: int, sha: str, per_page: int = 100) -> Tuple[Dict, List[Dict]]:
    detail_url = f"{base}/api/v4/projects/{project_id}/repository/commits/{sha}"
    resp = session.get(detail_url, params={"stats": "true"}, timeout=GITLAB_TIMEOUT)
    if resp.status_code != 200:
        raise RuntimeError(f"Commit detail fetch failed {sha}: {resp.text[:200]}")
    commit = resp.json()
    diff_url = f"{detail_url}/diff"
    diffs: List[Dict] = []
    page = 1
    while True:
        dresp = session.get(diff_url, params={"per_page": per_page, "page": page}, timeout=GITLAB_TIMEOUT)
        if dresp.status_code != 200:
            raise RuntimeError(f"Commit diff fetch failed {sha}: {dresp.text[:200]}")
        chunk = dresp.json()
        if not isinstance(chunk, list) or not chunk:
            break
        diffs.extend(chunk)
        nxt = dresp.headers.get("X-Next-Page")
        if not nxt:
            break
        page = int(nxt)
    return commit, diffs


def fetch_gitlab_file_size(session: requests.Session, base: str, project_id: int, path: Optional[str], ref: Optional[str], cache: Dict[Tuple[str, str], Optional[int]]) -> Optional[int]:
    if not path or not ref:
        return None
    key = (ref, path)
    if key in cache:
        return cache[key]
    encoded = quote(path, safe="")
    url = f"{base}/api/v4/projects/{project_id}/repository/files/{encoded}"
    resp = session.get(url, params={"ref": ref}, timeout=GITLAB_TIMEOUT)
    if resp.status_code == 200:
        data = resp.json()
        size_val = data.get("size")
        cache[key] = size_val
        return size_val
    if resp.status_code == 404:
        cache[key] = None
        return None
    raise RuntimeError(f"File size fetch failed {path}@{ref}: {resp.status_code} {resp.text[:200]}")

# ---------------------------------------------------------------------------
# SVN specific
# ---------------------------------------------------------------------------

def run_svnlook(repo_path: str, *args: str) -> str:
    cmd = ["svnlook", *args, repo_path]
    proc = subprocess.run(cmd, check=True, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True, encoding="utf-8", errors="replace")
    return proc.stdout.strip()


def run_svnlook_bytes(repo_path: str, *args: str) -> bytes:
    cmd = ["svnlook", *args, repo_path]
    proc = subprocess.run(cmd, check=True, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
    return proc.stdout


def svn_file_size(repo_path: str, revision: str, path: str) -> Optional[int]:
    if not path:
        return None
    cmd = ["svnlook", "filesize", "-r", revision, repo_path, path]
    try:
        # Add timeout to prevent hanging indefinitely
        proc = subprocess.run(cmd, check=True, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True, encoding="utf-8", errors="replace", timeout=20)
    except (subprocess.CalledProcessError, subprocess.TimeoutExpired):
        return None
    out = proc.stdout.strip()
    if not out:
        return None
    try:
        return int(out)
    except ValueError:
        return None

def svn_cat_bytes(repo_path: str, revision: str, path: str) -> bytes:
    """Return file content at given revision using svnlook cat.

    svnlook syntax requires REPOS_PATH before PATH: svnlook cat -r REV REPOS_PATH PATH
    """
    cmd = ["svnlook", "cat", "-r", str(revision), repo_path, path]
    try:
        # Add timeout to prevent hanging indefinitely
        proc = subprocess.run(cmd, check=True, stdout=subprocess.PIPE, stderr=subprocess.PIPE, timeout=50)
        return proc.stdout
    except (subprocess.CalledProcessError, subprocess.TimeoutExpired):
        return b""

HEADER_PREFIXES = ("Index:", "Added:", "Modified:", "Deleted:")

def normalize_changed_path(raw_path: str) -> str:
    cleaned = (raw_path or "").strip()
    if cleaned.startswith("+ "):
        cleaned = cleaned[2:].strip()
    if "(from " in cleaned:
        cleaned = cleaned.split("(from ", 1)[0].strip()
    return cleaned


def collect_svn_diffs(repo_path: str, revision: int, max_bytes: int) -> Dict[str, str]:
    cmd = ["svnlook", "diff", "-r", str(revision), repo_path]
    process = subprocess.Popen(cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True, encoding="utf-8", errors="replace", bufsize=1)
    diffs: Dict[str, str] = {}
    current_path: Optional[str] = None
    current_lines: List[str] = []
    current_size = 0
    truncated = False
    limit = max(1024, max_bytes)

    def flush():
        nonlocal current_path, current_lines, truncated
        if current_path is None:
            return
        text = "".join(current_lines).rstrip("\n") if current_lines else None
        diffs[current_path] = text if text is not None else None
        current_path = None
        current_lines = []
        truncated = False

    try:
        assert process.stdout is not None
        for line in process.stdout:
            header_matched = None
            for prefix in HEADER_PREFIXES:
                if line.startswith(prefix):
                    header_matched = prefix
                    break
            if header_matched or line.startswith("Property changes on: "):
                flush()
                raw_path = line.split(":", 1)[1].strip() if ":" in line else line.strip()
                current_path = normalize_changed_path(raw_path)
                current_lines = [line]
                current_size = len(line)
                truncated = False
                continue
            if current_path is None:
                continue
            if not truncated:
                if current_size + len(line) <= limit:
                    current_lines.append(line)
                    current_size += len(line)
                else:
                    truncated = True
        flush()
    finally:
        if process.stdout:
            process.stdout.close()
    _stderr = process.stderr.read() if process.stderr else ""
    returncode = process.wait()
    if process.stderr:
        process.stderr.close()
    if returncode != 0:
        raise subprocess.CalledProcessError(returncode, cmd, output=None, stderr=_stderr)
    return diffs

# Infer SVN change code from the first header line of a diff block
def _classify_svn_code_from_diff_header(diff_text: Optional[str]) -> str:
    if not diff_text:
        return "M"
    first = diff_text.splitlines()[0] if diff_text else ""
    if first.startswith("Added:"):
        return "A"
    if first.startswith("Deleted:"):
        return "D"
    # "Modified:" 或 "Index:" 视作修改
    return "M"

# ---------------------------------------------------------------------------
# Database run helpers
# ---------------------------------------------------------------------------

def create_run(connection, params: Dict, triggered_by: Optional[str]) -> int:
    cursor = connection.cursor()
    cursor.execute(
        "INSERT INTO ingestion_runs (job_type, source_type, status, started_at, params, triggered_by) VALUES ('commit_files_ingest','mixed','running',NOW(6),%s,%s)",
        (json.dumps(params, ensure_ascii=False), triggered_by),
    )
    run_id = cursor.lastrowid
    connection.commit()
    cursor.close()
    return run_id


def finalize_run(connection, run_id: int, status: str, processed: int, failed: int, error_message: Optional[str]) -> None:
    cursor = connection.cursor()
    cursor.execute(
        "UPDATE ingestion_runs SET status=%s, finished_at=NOW(6), items_processed=%s, items_failed=%s, error_message=%s WHERE id=%s",
        (status, processed, failed, error_message, run_id),
    )
    connection.commit()
    cursor.close()


def insert_run_log(connection, run_id: int, level: str, message: str, context: Optional[Dict] = None) -> None:
    cursor = connection.cursor()
    cursor.execute(
        "INSERT INTO ingestion_run_logs (ingestion_run_id, log_level, message, context) VALUES (%s,%s,%s,%s)",
        (run_id, level, message, json.dumps(context, ensure_ascii=False) if context else None),
    )
    cursor.close()


def flush_log_buffer(connection, *, force: bool = False) -> None:
    """Batch-insert buffered run logs to reduce commit频次; commit由外部控制."""
    global LOG_BUFFER
    if connection is None or not LOG_BUFFER:
        return
    with LOG_BUFFER_LOCK:
        if not LOG_BUFFER:
            return
        if not force and len(LOG_BUFFER) < LOG_BATCH_SIZE:
            return
        rows = LOG_BUFFER[:]
        LOG_BUFFER = []
    try:
        cursor = connection.cursor()
        cursor.executemany(
            "INSERT INTO ingestion_run_logs (ingestion_run_id, log_level, message, context) VALUES (%s,%s,%s,%s)",
            rows,
        )
        cursor.close()
    except Exception:
        # Best-effort; buffer already cleared to avoid膨胀
        pass

def log_message(connection, run_id: int, level: str, message: str, context: Optional[Dict] = None) -> None:
    global RUN_START_TIME
    if RUN_START_TIME is not None:
        ctx = dict(context) if context else {}
        elapsed = time.perf_counter() - RUN_START_TIME
        ctx.setdefault("elapsed_seconds", round(elapsed, 2))
    else:
        ctx = context
    """Mirror logs to console and DB run logs."""
    level_upper = (level or "INFO").upper()
    lvl_map = {
        "DEBUG": logging.DEBUG,
        "INFO": logging.INFO,
        "WARNING": logging.WARNING,
        "ERROR": logging.ERROR,
        "CRITICAL": logging.CRITICAL,
    }
    py_level = lvl_map.get(level_upper, logging.INFO)
    try:
        if ctx:
            LOGGER.log(py_level, "%s | %s", message, json.dumps(ctx, ensure_ascii=False))
        else:
            LOGGER.log(py_level, "%s", message)
    except Exception:
        # Console logging should not break execution
        pass
    try:
        # DEBUG 日志仅控制台输出，不入库
        if connection is not None and run_id and run_id > 0 and level_upper != "DEBUG":
            record = (run_id, level_upper, message, json.dumps(ctx, ensure_ascii=False) if ctx else None)
            do_flush = False
            with LOG_BUFFER_LOCK:
                LOG_BUFFER.append(record)
                if len(LOG_BUFFER) >= LOG_BATCH_SIZE:
                    do_flush = True
            if do_flush:
                flush_log_buffer(connection, force=True)
    except Exception:
        # DB logging failures should not break execution
        pass

def _get_system_param(connection, key: str) -> Optional[str]:
    cur = connection.cursor()
    try:
        cur.execute("SELECT param_value FROM system_parameters WHERE param_key=%s", (key,))
        row = cur.fetchone()
        return row[0] if row else None
    finally:
        cur.close()


def _commit_paths_match_banned(connection, paths: Sequence[str]) -> Tuple[bool, Dict]:
    """Return (is_banned, details) for a list of file paths in a commit.

    details includes: matched_count, total_bytes (when known), examples(list).
    Matching logic: split directories_banned system parameter by comma and treat each
    token as a path-segment to match exactly. A path is considered banned when any
    path segment equals a token (e.g. 'node_modules', '.git', 'tmp').
    """
    raw = _get_system_param(connection, "directories_banned") or ""
    tokens = [t.strip() for t in raw.split(",") if t and t.strip()]
    if not tokens:
        return False, {"matched_count": 0, "total_bytes": 0, "examples": []}
    tok_set = set(tokens)
    matched = []
    total_bytes = 0
    examples: List[str] = []
    for p in paths:
        if not p:
            continue
        # Normalize and split into segments
        norm = p.strip().strip("/")
        segs = [s for s in norm.split("/") if s != ""]
        hit = False
        for s in segs:
            if s in tok_set:
                hit = True
                break
        if hit:
            matched.append(p)
            if len(examples) < 10:
                examples.append(p)
    return (len(matched) > 0, {"matched_count": len(matched), "total_bytes": total_bytes, "examples": examples})


def _load_banned_rules(connection, repo_catalog_id: Optional[int]) -> List[Dict]:
    """Load active banned-directory rules from repo_banned_directory_catalog.

    Returns list of dicts with keys: id, name, match_type, pattern, repo_catalog_id, priority
    Falls back to system_parameters.directories_banned (segment tokens) when table empty.
    """
    cur = connection.cursor()
    rules: List[Dict] = []
    try:
        try:
            # Load global and repo-specific active rules ordered by priority
            cur.execute(
                "SELECT id, name, match_type, pattern, repo_catalog_id, priority FROM repo_banned_directory_catalog WHERE is_active=1 AND (repo_catalog_id IS NULL OR repo_catalog_id=%s) ORDER BY repo_catalog_id DESC, priority ASC",
                (repo_catalog_id,),
            )
            rows = cur.fetchall()
            for r in rows:
                rules.append({
                    "id": int(r[0]),
                    "name": r[1],
                    "match_type": r[2],
                    "pattern": r[3],
                    "repo_catalog_id": r[4],
                    "priority": int(r[5]) if r[5] is not None else 100,
                })
        except Exception:
            # Table may not exist yet; fall back to system parameter
            raw = _get_system_param(connection, "directories_banned") or ""
            tokens = [t.strip() for t in raw.split(",") if t and t.strip()]
            for t in tokens:
                rules.append({"id": None, "name": t, "match_type": "segment", "pattern": t, "repo_catalog_id": None, "priority": 100})
    finally:
        cur.close()
    return rules


def _get_banned_rules_cached(connection, repo_catalog_id: Optional[int], cache: Dict[int, List[Dict]]) -> List[Dict]:
    key = repo_catalog_id if repo_catalog_id is not None else -1
    rules = cache.get(key)
    if rules is None:
        rules = _load_banned_rules(connection, repo_catalog_id)
        cache[key] = rules
    return rules


def _match_banned_rule_for_path(path: str, rules: List[Dict]) -> Optional[Tuple[Dict, str]]:
    """Return (rule, matched_directory_path) if path matches a rule.

    matched_directory_path is the repository-relative directory path that contains
    the banned segment (for 'segment') or the prefix (for 'prefix').
    """
    if not path:
        return None
    norm = path.strip().lstrip("./").strip("/")
    segs = [s for s in norm.split("/") if s != ""]
    for rule in rules:
        mtype = rule.get("match_type", "segment")
        pat = rule.get("pattern") or ""
        if mtype == "segment":
            # find first segment that equals pattern
            for i, s in enumerate(segs):
                if s == pat:
                    matched_dir = "/".join(segs[: i + 1])
                    return rule, matched_dir
        elif mtype == "prefix":
            # pattern is a path prefix relative to repo root
            if norm == pat or norm.startswith(pat.rstrip("/") + "/") or norm.startswith(pat + "/"):
                return rule, pat.rstrip("/")
        elif mtype == "glob":
            # Use fnmatch for glob pattern matching on each segment and path
            import fnmatch
            # Try matching pattern against each segment
            for i, s in enumerate(segs):
                if fnmatch.fnmatch(s, pat):
                    matched_dir = "/".join(segs[: i + 1])
                    return rule, matched_dir
            # Also try matching against path prefix patterns
            for i in range(len(segs)):
                partial = "/".join(segs[:i + 1])
                if fnmatch.fnmatch(partial, pat):
                    return rule, partial
        elif mtype == "regex":
            try:
                import re

                m = re.search(pat, norm)
                if m:
                    # matched span; capture directory up to match start
                    start = m.start()
                    # find slash before start
                    prefix = norm[:start]
                    matched_dir = prefix.rstrip("/")
                    return rule, matched_dir or pat
            except Exception:
                pass
    return None

def _set_system_param(connection, key: str, value: str, description: Optional[str] = None) -> None:
    cur = connection.cursor()
    try:
        cur.execute(
            "INSERT INTO system_parameters (param_key, param_value, description) VALUES (%s,%s,%s) "
            "ON DUPLICATE KEY UPDATE param_value=VALUES(param_value)",
            (key, value, description),
        )
        connection.commit()
    finally:
        cur.close()

STOP_PARAM_KEY = "commit_files_ingest_stop"

def stop_requested(connection) -> bool:
    try:
        val = _get_system_param(connection, STOP_PARAM_KEY)
        return (val is not None) and (str(val).strip() == '1')
    except Exception:
        return False

def clear_stop_request(connection) -> None:
    try:
        _set_system_param(connection, STOP_PARAM_KEY, '0', 'Flag to request Stage B (commit files ingest) stop')
    except Exception:
        pass

def is_connection_lost(exc: Exception) -> bool:
    msg = str(exc).lower()
    if isinstance(exc, (mysql_errors.OperationalError, mysql_errors.InterfaceError)):
        return ("lost connection" in msg) or ("server has gone away" in msg)
    return False

def reconnect_db(connection, config: "IngestConfig"):
    try:
        try:
            connection.close()
        except Exception:
            pass
        return mysql.connector.connect(
            host=config.db_host,
            port=config.db_port,
            user=config.db_user,
            password=config.db_password,
            database=config.db_name,
            autocommit=False,
        )
    except Exception as e:
        raise

# ---------------------------------------------------------------------------
# Defensive helpers
# ---------------------------------------------------------------------------

def _sanitize_diff_text(diff_text: Optional[str]) -> Optional[str]:
    """Remove characters that can confuse the MySQL parser (e.g. NUL) even though
    we use parametrized queries. Also enforce a hard upper bound (1MB) to avoid
    pathological memory usage / max_allowed_packet surprises for extremely large
    diffs that slipped truncation logic. Returns possibly truncated text.
    """
    if diff_text is None:
        return None
    # Normalize newlines and strip problematic control chars (keep \n and \t)
    cleaned = diff_text.replace('\r\n', '\n').replace('\r', '\n')
    # Remove NUL and other control characters that can confuse parsers or connectors
    cleaned = ''.join(ch for ch in cleaned if (ch == '\n' or ch == '\t' or ord(ch) >= 32))
    # Hard cap
    max_len = 1_000_000
    if len(cleaned) > max_len:
        cleaned = cleaned[:max_len] + "\n[TRUNCATED_AFTER_1MB]"
    return cleaned

def _insert_commit_diff_prepared(connection, file_row_id: int, diff_text: Optional[str], is_truncated_flag: int) -> None:
    """Insert into repo_commit_diffs using a prepared cursor to avoid any SQL parsing
    pitfalls with large or special-character-heavy diff payloads. Encodes text as UTF-8 bytes.
    """
    # Convert to bytes for robust transport; None stays None
    payload = diff_text.encode('utf-8') if isinstance(diff_text, str) else None
    pcursor = connection.cursor(prepared=True)
    try:
        sql = (
            "INSERT IGNORE INTO repo_commit_diffs (repo_commit_file_id, diff_text, is_truncated) "
            "VALUES (%s,%s,%s)"
        )
        pcursor.execute(sql, (file_row_id, payload, is_truncated_flag))
    finally:
        pcursor.close()


def _insert_commit_diffs_batch(connection, diffs_to_insert: List[Tuple[int, Optional[str], int]]) -> None:
    """Batch insert diffs using a single prepared cursor for better performance.

    Args:
        diffs_to_insert: List of (file_row_id, diff_text, is_truncated_flag) tuples
    """
    if not diffs_to_insert:
        return

    # Convert to bytes for robust transport
    batch_data = []
    for file_row_id, diff_text, is_truncated_flag in diffs_to_insert:
        payload = diff_text.encode('utf-8') if isinstance(diff_text, str) else None
        batch_data.append((file_row_id, payload, is_truncated_flag))

    pcursor = connection.cursor(prepared=True)
    try:
        sql = (
            "INSERT IGNORE INTO repo_commit_diffs (repo_commit_file_id, diff_text, is_truncated) "
            "VALUES (%s,%s,%s)"
        )
        pcursor.executemany(sql, batch_data)
    finally:
        pcursor.close()


def _get_trackable_categories(connection) -> set[str]:
    """Return a set of lowercased file categories to track in repo_files."""
    raw = _get_system_param(connection, "trackable_file_categories") or "'code','document'"
    # Return a set of lowercased category names
    return {c.strip().lower() for c in raw.replace("'", "").split(",") if c and c.strip()}


# ---------------------------------------------------------------------------
# Ingestion logic per source
# ---------------------------------------------------------------------------

def _purge_commit_files(connection, commit_id: int) -> None:
    """Remove any previously inserted files/diffs for a commit to make ingest idempotent.

    This prevents UNIQUE KEY (repo_commit_id, file_path(255)) collisions when a prior run
    partially inserted rows but did not mark files_ingested=1.
    """
    cur = connection.cursor()
    # repo_commit_diffs has ON DELETE CASCADE via FK on repo_commit_file_id
    cur.execute("DELETE FROM repo_commit_files WHERE repo_commit_id=%s", (commit_id,))
    cur.close()

def ingest_gitlab_commit_files(connection, session: requests.Session, base: str, commit_row: tuple, run_id: int, shared: SharedIngestResources, config: "IngestConfig") -> None:
    commit_id, repo_catalog_id, revision, committed_at, project_id, default_branch = commit_row
    # Fetch detail + diffs (batch update)
    try:
        commit_json, diffs = fetch_gitlab_commit_and_diffs(session, base, int(project_id), revision, per_page=100)
    except RuntimeError as e:
        if "404" in str(e):
            log_message(connection, run_id, "WARNING", f"Commit {revision} not found (404), deleting from DB", {"commit_id": commit_id})
            cursor = connection.cursor()
            cursor.execute("DELETE FROM repo_commits WHERE id=%s", (commit_id,))
            connection.commit()
            cursor.close()
            return
        raise e

    cursor = connection.cursor()
    # Ensure idempotency in case of partial prior inserts
    _purge_commit_files(connection, commit_id)

    # Load shared resources and caches
    rules = _get_banned_rules_cached(connection, repo_catalog_id, shared.banned_rules_cache)
    file_type_map = shared.file_type_map
    max_hash_size = shared.max_hash_size
    trackable_cats = shared.trackable_categories
    repo_files_local_cache: Optional[Dict[str, Dict]] = {}
    if trackable_cats:
        repo_files_local_cache = ensure_repo_files_cache(connection, repo_catalog_id, shared)

    # Prepare for processing
    parent_ids = commit_json.get("parent_ids") or []
    parent_ref = parent_ids[0] if parent_ids else None
    current_ref = commit_json.get("id")
    # Use shared gitlab size cache across the run to avoid duplicate API calls
    gitlab_size_keys_to_fetch: Set[Tuple[int, str, str]] = set()

    # --- Loop 1: Collect file data and items for bulk queries ---
    files_to_process: List[FileChange] = []
    # Track banned directory summaries for this commit: path -> {count, total_bytes, sample_paths, banned_directory_id}
    banned_dirs_map: Dict[str, Dict[str, object]] = {}
    # Set of known banned directory prefixes for fast subdirectory lookup
    known_banned_prefixes: Set[str] = set()

    for diff in diffs:
        path_raw = diff.get("new_path") or diff.get("old_path") or ""
        if not path_raw:
            continue


        # Filter out submodules (mode 160000) which appear as directories
        if diff.get("a_mode") == "160000" or diff.get("b_mode") == "160000":
            continue

        # Normalize path for prefix matching
        path_normalized = path_raw.strip().lstrip("./").strip("/")

        # Fast path: check if this file is under an already-known banned directory
        matched_prefix = None
        for banned_prefix in known_banned_prefixes:
            if path_normalized == banned_prefix or path_normalized.startswith(banned_prefix + "/"):
                matched_prefix = banned_prefix
                break

        if matched_prefix is not None:
            # File is in a known banned directory, skip rule matching
            entry = banned_dirs_map.get(matched_prefix)
            if entry is not None:
                entry["count"] += 1
                if len(entry["samples"]) < 10:
                    entry["samples"].append(path_raw)
            continue

        # Full rule matching if not in a known banned directory
        m = _match_banned_rule_for_path(path_raw, rules)
        if m is not None:
            rule, matched_dir = m
            # Increment count for matched_dir
            entry = banned_dirs_map.get(matched_dir)
            if entry is None:
                entry = {"count": 0, "total_bytes": 0, "samples": [], "banned_directory_id": rule.get("id") if rule else None}
                banned_dirs_map[matched_dir] = entry
                # Add to known prefixes for fast subdirectory lookup
                known_banned_prefixes.add(matched_dir)
            entry["count"] += 1
            # attempt to include bytes info if present later; leave 0 if unknown
            # store a few sample paths for debugging
            if len(entry["samples"]) < 10:
                entry["samples"].append(path_raw)
            # skip writing this file into repo_commit_files (preserves original behavior)
            continue

        change = FileChange(
            path_raw=path_raw,
            old_path=diff.get("old_path") or path_raw,
            new_path=diff.get("new_path") or path_raw,
            change_type=classify_change(diff),
            diff_text=diff.get("diff"),
        )
        change.file_name = change.path_raw.split("/")[-1][:255]
        change.is_truncated = bool(diff.get("overflow") or diff.get("too_large"))

        # Determine file type
        ext = ""
        if change.file_name and "." in change.file_name and not change.file_name.startswith("."):
            ext = change.file_name.rsplit('.', 1)[-1].lower()
        ft = file_type_map.get(ext)
        if ft:
            change.category = ft.get("category") or "unknown"
            change.can_line_count = int(ft.get("can_line_count", 0))

        change.is_text_candidate = True if change.can_line_count == 1 else False
        # Fallback for nameless files removed as per requirement: unknown types stay unknown


        # Collect file size keys; actual fetch later in parallel
        if change.change_type != 'D' and current_ref:
            key = (int(project_id), current_ref or "", change.new_path or "")
            if key not in shared.gitlab_size_cache:
                gitlab_size_keys_to_fetch.add(key)
        if change.change_type != 'A' and parent_ref:
            key = (int(project_id), parent_ref or "", change.old_path or "")
            if key not in shared.gitlab_size_cache:
                gitlab_size_keys_to_fetch.add(key)
        change.repo_file_bytes = change.bytes_after if change.change_type != 'D' else change.bytes_before

        files_to_process.append(change)

    # --- Parallel content fetch for computing content_hash ---
    # Collect files that need content hash computation
    content_fetch_requests: List[Tuple[FileChange, str]] = []  # (change, path)
    for change in files_to_process:
        if change.is_text_candidate:
            use_name_size_only = change.category in ("banned", "ignore", "unknown") or (change.bytes_after is not None and change.bytes_after > max_hash_size)
            if not use_name_size_only and change.change_type != "D" and current_ref:
                content_fetch_requests.append((change, change.path_raw))

    # Parallel fetch content using ThreadPoolExecutor
    if content_fetch_requests and shared.executor:
        content_futures: Dict[str, Tuple[FileChange, Future]] = {}
        for change, path in content_fetch_requests:
            fut = shared.executor.submit(_get_gitlab_content_worker, session, base, int(project_id), path, current_ref)
            content_futures[path] = (change, fut)

        # Collect results and update changes
        for path, (change, fut) in content_futures.items():
            try:
                result = fut.result(timeout=GITLAB_TIMEOUT)
                if result:
                    raw_bytes, size_val = result
                    if raw_bytes:
                        change.content_hash = _sha256_hex(raw_bytes)
                        try:
                            change.lines = len(raw_bytes.splitlines())
                        except Exception:
                            pass
                    if size_val is not None:
                        cached_size = _cache_gitlab_size(shared, int(project_id), current_ref, change.new_path or change.path_raw, size_val)
                        if cached_size is not None:
                            change.bytes_after = change.bytes_after or cached_size
            except Exception:
                # Content fetch failed, skip hash computation for this file
                pass
    elif content_fetch_requests:
        # Fallback to serial fetch if no executor
        for change, path in content_fetch_requests:
            try:
                result = _get_gitlab_content_worker(session, base, int(project_id), path, current_ref)
                if result:
                    raw_bytes, size_val = result
                    if raw_bytes:
                        change.content_hash = _sha256_hex(raw_bytes)
                        try:
                            change.lines = len(raw_bytes.splitlines())
                        except Exception:
                            pass
                    if size_val is not None:
                        cached_size = _cache_gitlab_size(shared, int(project_id), current_ref, change.new_path or change.path_raw, size_val)
                        if cached_size is not None:
                            change.bytes_after = change.bytes_after or cached_size
            except Exception:
                pass

    # Remove any size keys that were already hydrated via content fetch to avoid duplicate API calls
    if gitlab_size_keys_to_fetch:
        try:
            with shared.size_cache_lock:
                gitlab_size_keys_to_fetch = {
                    k for k in gitlab_size_keys_to_fetch
                    if k not in shared.gitlab_size_cache
                }
        except Exception:
            pass

    # --- Loop 2: Finalize and Prepare Bulk Insert ---
    # Prefetch gitlab sizes concurrently for missing keys
    if gitlab_size_keys_to_fetch and shared.executor:
        futures: Dict[Tuple[int, str, str], Future] = {}
        for (proj, ref, pth) in gitlab_size_keys_to_fetch:
            if not pth:
                continue
            fut = shared.executor.submit(_get_gitlab_size_worker, session, base, proj, pth, ref, shared)
            futures[(proj, ref, pth)] = fut
        for k, f in futures.items():
            try:
                f.result(timeout=GITLAB_TIMEOUT)
            except Exception:
                # log and continue, individual retrieval later will fallback to sync fetch
                log_message(connection, run_id, "WARNING", "GitLab size fetch failed for key", {"key": k})
    # Hydrate byte sizes for each change现在仅从缓存读取，避免重复远程请求
    missing_after_hydration: List[str] = []
    missing_before_hydration: List[str] = []
    for change in files_to_process:
        if change.change_type != 'D' and current_ref:
            key = (int(project_id), current_ref or "", change.new_path or "")
            with shared.size_cache_lock:
                cached = shared.gitlab_size_cache.get(key)
            change.bytes_after = _normalize_size(cached)
            if change.bytes_after is None:
                missing_after_hydration.append(change.path_raw)
        if change.change_type != 'A' and parent_ref:
            key = (int(project_id), parent_ref or "", change.old_path or "")
            with shared.size_cache_lock:
                cached_before = shared.gitlab_size_cache.get(key)
            change.bytes_before = _normalize_size(cached_before)
            # Fallback to repo_files cache (previous known bytes) when GitLab size missing
            if change.bytes_before is None and change.category in trackable_cats and repo_files_local_cache:
                try:
                    entry = repo_files_local_cache.get(change.old_path[:1024])
                    if entry and entry.get("bytes") is not None:
                        change.bytes_before = int(entry.get("bytes"))
                except Exception:
                    pass
            if change.bytes_before is None:
                missing_before_hydration.append(change.path_raw)
        change.repo_file_bytes = change.bytes_after if change.change_type != 'D' else change.bytes_before

    if missing_after_hydration:
        log_message(
            connection,
            run_id,
            "WARNING",
            "GitLab bytes_after missing after hydration",
            {"commit_id": commit_id, "count": len(missing_after_hydration), "sample_paths": missing_after_hydration[:5]},
        )
    if missing_before_hydration:
        log_message(
            connection,
            run_id,
            "INFO",
            "GitLab bytes_before missing after hydration",
            {"commit_id": commit_id, "count": len(missing_before_hydration), "sample_paths": missing_before_hydration[:5]},
        )

    commit_files_to_insert = []
    seen_prefix255 = set()

    # Aggregators for commit stats
    stats = {
        "added": 0, "deleted": 0, "modified": 0,
        "code_added": 0, "code_deleted": 0, "code_modified": 0,
        "lines_added": 0, "lines_deleted": 0, "lines_modified": 0,
        "computed_files": 0,
        "dupe_code": 0, "dupe_binary": 0, "dupe_lines": 0, "dupe_bytes": 0,
        "binary_added": 0, "binary_deleted": 0, "binary_modified": 0, "binary_bytes_delta": 0
    }

    # Batch updates for repo_files
    repo_files_to_upsert: List[Tuple] = []
    repo_files_to_delete: List[Tuple] = []
    repo_files_to_rename: List[Tuple] = []

    missing_after_final: List[str] = []
    missing_before_final: List[str] = []
    for change in files_to_process:
        # 不再进行额外的 GitLab size 远程请求，只根据前面 hydration 得到的结果更新统计
        if change.change_type != 'D' and change.bytes_after is None:
            missing_after_final.append(change.path_raw)
        if change.change_type != 'A' and change.bytes_before is None:
            missing_before_final.append(change.path_raw)
        change.repo_file_bytes = change.bytes_after if change.change_type != 'D' else change.bytes_before

        # Prepare updates for repo_files table for trackable files
        if change.category in trackable_cats:
            old_path_for_rename = change.old_path if change.change_type == "R" else None
            lookup_path = (old_path_for_rename or change.path_raw or "")[:1024]

            # Resolve existing entry from cache
            repo_file_id: Optional[int] = None
            is_currently_deleted: bool = False
            if repo_files_local_cache is not None and lookup_path:
                entry = repo_files_local_cache.get(lookup_path)
                if entry:
                    repo_file_id = entry.get("id")
                    is_currently_deleted = entry.get("is_deleted", False)

            file_name = change.path_raw.split("/")[-1][:255]
            file_extension = None
            if "." in file_name and not file_name.startswith("."):
                parts = file_name.rsplit('.', 1)
                if len(parts) > 1:
                    file_extension = parts[1].lower()

            # Decide which bulk update list to add to
            if change.change_type == "D":
                if repo_file_id and not is_currently_deleted:
                    repo_files_to_delete.append((commit_id, committed_at, change.repo_file_bytes, repo_file_id))
            elif change.change_type == "R":
                target_path_exists = False
                target_entry = None
                if repo_files_local_cache:
                    target_entry = repo_files_local_cache.get(change.path_raw[:1024])
                    if target_entry:
                        target_path_exists = True

                if repo_file_id and not target_path_exists:
                    repo_files_to_rename.append((change.path_raw[:1024], file_name, file_extension, commit_id, committed_at, change.repo_file_bytes, repo_file_id))
                elif repo_file_id and target_path_exists:
                    # Target path exists (e.g. was deleted previously), so we cannot rename directly due to unique constraint.
                    # Instead, mark the old file as deleted and upsert the new path (which revives the existing record).
                    repo_files_to_delete.append((commit_id, committed_at, change.repo_file_bytes, repo_file_id))
                    repo_files_to_upsert.append((repo_catalog_id, change.path_raw[:1024], file_name, file_extension, change.category, commit_id, committed_at, commit_id, committed_at, change.repo_file_bytes, 0, change.lines))
                    # Important: Update change.repo_file_id to the ID of the target file so subsequent logic uses the correct ID
                    if target_entry:
                        change.repo_file_id = target_entry["id"]
                else: # Renamed file not found at old path, treat as an ADD
                    repo_files_to_upsert.append((repo_catalog_id, change.path_raw[:1024], file_name, file_extension, change.category, commit_id, committed_at, commit_id, committed_at, change.repo_file_bytes, 0, change.lines))
            else: # Add or Modify
                repo_files_to_upsert.append((repo_catalog_id, change.path_raw[:1024], file_name, file_extension, change.category, commit_id, committed_at, commit_id, committed_at, change.repo_file_bytes, 0, change.lines))

        # 提交内不再标记重复
        change.is_duplicate = False
        change.duplicate_of_file_id = None
        change.duplicate_reason = None

        # Skip deduplication for renamed files
        if change.change_type == 'R':
            change.is_duplicate = False
            change.duplicate_reason = None

        # Finalize line counts
        change.is_truncated = bool(change.is_truncated)
        if change.diff_text and change.is_text_candidate and not change.is_truncated:
            summary = summarize_unified_diff(change.diff_text)
            if summary.lines_added is not None:
                change.lines_added = summary.lines_added
                change.lines_deleted = summary.lines_deleted
                change.replacements = summary.replacements
                # Normalize based on change_type:
                # - Deleted files (D) cannot have lines_added
                # - New files (A) cannot have lines_deleted
                if change.change_type == "D":
                    change.lines_added = 0
                    change.replacements = 0
                elif change.change_type == "A":
                    change.lines_deleted = 0
                    change.replacements = 0
            else:
                change.is_truncated = True
        elif not change.is_text_candidate:
            change.is_truncated = True

        # Update stats
        if change.change_type == "A": stats["added"] += 1
        elif change.change_type == "D": stats["deleted"] += 1
        else: stats["modified"] += 1

        if change.lines_added is not None:
            stats["lines_added"] += change.lines_added
            # Only count lines_deleted from Modified/Renamed files, not from completely Deleted files
            if change.change_type != "D":
                stats["lines_deleted"] += change.lines_deleted
            stats["lines_modified"] += change.replacements
            stats["computed_files"] += 1

        # Code files stats (can_line_count == 1)
        if change.can_line_count == 1:
            if change.change_type == "A": stats["code_added"] += 1
            elif change.change_type == "D": stats["code_deleted"] += 1
            else: stats["code_modified"] += 1

        # Binary stats
        if change.can_line_count == 0:
            if change.change_type == "A": stats["binary_added"] += 1
            elif change.change_type == "D": stats["binary_deleted"] += 1
            else: stats["binary_modified"] += 1

            b_after = change.bytes_after or 0
            b_before = change.bytes_before or 0
            stats["binary_bytes_delta"] += (b_after - b_before)

        # Prepare for insertion
        truncated_path = change.path_raw[:1024]
        prefix_key = truncated_path[:255].casefold()
        if prefix_key in seen_prefix255:
            log_message(connection, run_id, "WARNING", "Skip duplicate file path by 255-prefix (gitlab)", {"commit_id": commit_id, "path_prefix": prefix_key})
            continue
        seen_prefix255.add(prefix_key)

        # Do not persist content_hash if this row is already a hash-duplicate
        stored_hash = None
        if not (change.is_duplicate and change.duplicate_reason == "hash"):
            stored_hash = change.content_hash

        commit_files_to_insert.append((
            commit_id, change.repo_file_id, truncated_path, change.change_type,
            change.lines_added, change.lines_deleted, change.replacements,
            change.bytes_before, change.bytes_after, change.can_line_count,
            change.category, stored_hash, 1 if change.is_duplicate else 0,
            change.duplicate_of_file_id, change.duplicate_reason,
            repo_catalog_id, change.lines
        ))

    # --- Execute Bulk Updates for repo_files ---
    try:
        if repo_files_to_upsert:
            cursor.executemany(
                """
                INSERT INTO repo_files (repo_catalog_id, current_file_path, file_name, file_extension, file_type, created_in_commit_id, created_time, last_modified_in_commit_id, updated_time, bytes, is_deleted, file_lines)
                VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
                ON DUPLICATE KEY UPDATE
                    last_modified_in_commit_id = VALUES(last_modified_in_commit_id),
                    updated_time = VALUES(updated_time),
                    bytes = VALUES(bytes),
                    is_deleted = 0,
                    deleted_in_commit_id = NULL,
                    deleted_time = NULL,
                    created_time = COALESCE(created_time, VALUES(created_time)),
                    updated_at = NOW(6),
                    file_lines = VALUES(file_lines)
                """,
                repo_files_to_upsert
            )
        if repo_files_to_delete:
            cursor.executemany(
                "UPDATE repo_files SET is_deleted = 1, deleted_in_commit_id = %s, deleted_time = %s, bytes = %s, updated_at = NOW(6) WHERE id = %s",
                repo_files_to_delete
            )
        if repo_files_to_rename:
            cursor.executemany(
                "UPDATE repo_files SET current_file_path=%s, file_name=%s, file_extension=%s, last_modified_in_commit_id=%s, updated_time=%s, bytes=%s, updated_at=NOW(6) WHERE id=%s",
                repo_files_to_rename
            )
        # After updates, we need to get the repo_file_id for newly inserted files
        # and update the local cache for the next commit in the batch.
        if repo_files_local_cache is not None:
            # Refresh cache for all changed paths in this commit
            all_changed_paths = {c.path_raw[:1024] for c in files_to_process if c.category in trackable_cats} | \
                                {c.old_path[:1024] for c in files_to_process if c.category in trackable_cats and c.change_type == 'R'}
            if all_changed_paths:
                placeholders = ",".join(["%s"] * len(all_changed_paths))
                cursor.execute(f"SELECT id, current_file_path, is_deleted, bytes FROM repo_files WHERE repo_catalog_id=%s AND current_file_path IN ({placeholders})", [repo_catalog_id] + list(all_changed_paths))
                for r_id, r_path, r_deleted, r_bytes in cursor.fetchall():
                    repo_files_local_cache[r_path] = {"id": r_id, "is_deleted": bool(r_deleted), "bytes": r_bytes}
    except Exception as e:
        log_message(connection, run_id, "WARNING", "Failed to bulk update repo_files for commit", {"commit_id": commit_id, "error": str(e)})


    if missing_after_final:
        log_message(
            connection,
            run_id,
            "ERROR",
            "GitLab bytes_after still missing before insert",
            {"commit_id": commit_id, "count": len(missing_after_final), "sample_paths": missing_after_final[:5]},
        )
    if missing_before_final:
        log_message(
            connection,
            run_id,
            "WARNING",
            "GitLab bytes_before still missing before insert",
            {"commit_id": commit_id, "count": len(missing_before_final), "sample_paths": missing_before_final[:5]},
        )

    # --- Bulk Insert `repo_commit_files` ---
    # First, we must resolve repo_file_id for all changes now that repo_files is up to date
    for change in files_to_process:
        if change.category in trackable_cats and change.repo_file_id is None:
            path_key = change.path_raw[:1024]
            if repo_files_local_cache and path_key in repo_files_local_cache:
                change.repo_file_id = repo_files_local_cache[path_key].get("id")

    # Re-build the insertion list with the resolved repo_file_id
    changes_by_path = {c.path_raw[:1024]: c for c in files_to_process}
    commit_files_to_insert_final = []
    for params in commit_files_to_insert:
        path = params[2]
        change_obj = changes_by_path.get(path)
        if change_obj:
            new_params = list(params)
            new_params[1] = change_obj.repo_file_id
            commit_files_to_insert_final.append(tuple(new_params))
        else:
            commit_files_to_insert_final.append(params)

    # In-memory counts of banned/unknown type files among inserted rows
    banned_type_files = 0
    banned_type_bytes = 0
    for row in commit_files_to_insert_final:
        try:
            ft = row[10]
        except Exception:
            ft = None
        if ft in ("banned", "unknown"):
            banned_type_files += 1
            try:
                banned_type_bytes += int(row[8] or 0)
            except Exception:
                pass


    if commit_files_to_insert_final:
        # Debug-only snapshot; INFO 级别下避免大量日志 IO
        try:
            sample_snapshot = []
            for row in commit_files_to_insert_final[:5]:
                sample_snapshot.append({
                    "file_path": row[2],
                    "change_type": row[3],
                    "bytes_before": row[7],
                    "bytes_after": row[8],
                })
            log_message(
                connection,
                run_id,
                "DEBUG",
                "GitLab commit file bytes snapshot",
                {
                    "commit_id": commit_id,
                    "total_files": len(commit_files_to_insert_final),
                    "sample": sample_snapshot,
                },
            )
        except Exception:
            pass
        cursor.executemany(
            "INSERT IGNORE INTO repo_commit_files (repo_commit_id, repo_file_id, file_path, change_type, lines_added, lines_deleted, lines_modified, bytes_before, bytes_after, can_line_count, file_type, content_hash, is_duplicate, duplicate_of_file_id, duplicate_reason, repo_catalog_id, file_lines) "
            "VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)",
            commit_files_to_insert_final
        )

    # --- Get IDs and Insert Diffs (Memory-Safe) ---
    # Re-fetch the rows we just inserted to get their IDs
    inserted_files_map: Dict[str, int] = {}
    if commit_files_to_insert_final:
        cursor.execute(
            "SELECT id, file_path FROM repo_commit_files WHERE repo_commit_id=%s",
            (commit_id,)
        )
        for file_id, file_path in cursor.fetchall():
            inserted_files_map[file_path] = file_id

    # Collect diffs for batch insertion
    diffs_to_insert: List[Tuple[int, Optional[str], int]] = []
    for change in files_to_process:
        # 仅在开启 save_diffs 且为非重复文本文件时存 diff
        store_diff = shared.save_diffs and change.is_text_candidate

        if store_diff:
            file_row_id = inserted_files_map.get(change.path_raw[:1024])
            if file_row_id:
                safe_diff = _sanitize_diff_text(change.diff_text)
                diffs_to_insert.append((file_row_id, safe_diff, 1 if change.is_truncated else 0))

    # Batch insert all diffs at once
    if diffs_to_insert:
        _insert_commit_diffs_batch(connection, diffs_to_insert)

    # --- Finalize commit stats (including banned counts) ---
    # Insert per-commit banned directories summary FIRST (so the SELECT below can read it)
    try:
        if banned_dirs_map:
            inserts = []
            for bd_path, info in banned_dirs_map.items():
                inserts.append((commit_id, repo_catalog_id, bd_path, info.get("banned_directory_id"), int(info.get("count", 0)), int(info.get("total_bytes", 0)), json.dumps(info.get("samples", []), ensure_ascii=False)))
            cursor.executemany(
                "INSERT INTO repo_commit_banned_directories (repo_commit_id, repo_catalog_id, banned_directory_path, banned_directory_id, files_unexpected, banned_total_bytes, sample_paths) VALUES (%s,%s,%s,%s,%s,%s,%s) ON DUPLICATE KEY UPDATE files_unexpected=VALUES(files_unexpected), banned_total_bytes=VALUES(banned_total_bytes), sample_paths=VALUES(sample_paths), updated_at=NOW(6)",
                inserts,
            )
    except Exception:
        # Non-fatal — continue and compute totals using existing tables
        pass

    # Compute banned counts in memory to avoid extra DB round-trips
    directories_banned = len(banned_dirs_map)
    banned_dir_files = 0
    banned_dir_bytes = 0
    for info in banned_dirs_map.values():
        try:
            banned_dir_files += int(info.get("count", 0) or 0)
            banned_dir_bytes += int(info.get("total_bytes", 0) or 0)
        except Exception:
            pass

    # Total banned bytes = banned directories bytes + banned/unknown type bytes
    # NOTE: We store them separately in repo_commits to avoid double counting in aggregation
    # files_unexpected in repo_commits will ONLY contain banned_type_files
    # files_in_banned_directories will contain banned_dir_files
    total_unexcepted_bytes = banned_dir_bytes + banned_type_bytes

    cursor.execute(
        "UPDATE repo_commits SET files_added=%s, code_files_added=%s, code_files_deleted=%s, code_files_modified=%s, lines_added=COALESCE(%s, lines_added), lines_deleted=COALESCE(%s, lines_deleted), lines_modified=COALESCE(%s, lines_modified), code_files_duplicated=%s, binary_files_duplicated=%s, duplicate_files_bytes=%s, directories_banned=%s, files_unexpected=%s, files_in_banned_directories=%s, unexcepted_files_bytes=%s, binary_files_added=%s, binary_files_deleted=%s, binary_files_modified=%s, binary_bytes_added=%s, files_ingested=1 WHERE id=%s",
        (
            stats["added"],
            stats["code_added"], stats["code_deleted"], stats["code_modified"],
            stats["lines_added"] if stats["computed_files"] > 0 else None,
            stats["lines_deleted"] if stats["computed_files"] > 0 else None,
            stats["lines_modified"] if stats["computed_files"] > 0 else None,
            stats["dupe_code"], stats["dupe_binary"], stats["dupe_bytes"],
            directories_banned, banned_type_files, banned_dir_files, total_unexcepted_bytes,
            stats["binary_added"], stats["binary_deleted"], stats["binary_modified"], stats["binary_bytes_delta"],
            commit_id,
        ),
    )
    # NOTE: We deliberately do NOT auto-create org_persons here to keep ingest performance
    # optimal. Author / person canonicalization and creation is handled by
    # `aggregate_stats.py` pre-processing (ensure_person_exists) which runs as part
    # of the stats aggregation pipeline and will set first_commit_at for newly
    # created persons. This avoids extra INSERTs during high-throughput ingest
    # operations which could impact overall ingestion throughput.
    clear_commit_caches(shared)
    cursor.close()


def ingest_svn_commit_files(connection, commit_row: tuple, max_diff_bytes: int, run_id: int, shared: SharedIngestResources, config: "IngestConfig") -> None:
    commit_id, repo_catalog_id, revision, committed_at, repo_path = commit_row

    # Setup
    cursor = connection.cursor()
    _purge_commit_files(connection, commit_id)
    file_type_map = shared.file_type_map
    max_hash_size = shared.max_hash_size
    trackable_cats = shared.trackable_categories
    rules = _get_banned_rules_cached(connection, repo_catalog_id, shared.banned_rules_cache)
    # Local cache for repo_files (if trackable)
    repo_files_local_cache: Optional[Dict[str, Dict]] = {}
    if trackable_cats:
        repo_files_local_cache = ensure_repo_files_cache(connection, repo_catalog_id, shared)
    # Keys to prefetch svn sizes and cat bytes in parallel during loop 1
    svn_size_keys_to_fetch: Set[Tuple[str, str, str]] = set()
    svn_cat_keys_to_fetch: Set[Tuple[str, str, str]] = set()
    svn_cat_map: Dict[Tuple[str, str, str], List[FileChange]] = {}

    # Get changed files and diffs in parallel
    changed = ""
    diffs_map: Dict[str, str] = {}

    if shared.executor:
        # Run both operations in parallel
        changed_future = shared.executor.submit(lambda: run_svnlook(repo_path, "changed", "-r", str(revision)))
        diffs_future = shared.executor.submit(lambda: collect_svn_diffs(repo_path, int(revision), max_diff_bytes))
        try:
            changed = changed_future.result(timeout=60)
        except Exception:
            changed = ""
        try:
            diffs_map = diffs_future.result(timeout=120)
        except Exception:
            diffs_map = {}
    else:
        # Fallback to serial execution
        try:
            changed = run_svnlook(repo_path, "changed", "-r", str(revision))
        except Exception:
            changed = ""
        try:
            diffs_map = collect_svn_diffs(repo_path, int(revision), max_diff_bytes)
        except Exception:
            diffs_map = {}

    # Consolidate changed files list
    precedence = {"D": 4, "A": 3, "R": 2, "M": 1}
    agg: Dict[str, str] = {}
    for line in changed.splitlines():
        if not line.strip(): continue
        parts = line.split(None, 1)
        code, p = (parts[0][:1], parts[1]) if len(parts) > 1 else (parts[0][:1], "")
        path_clean = normalize_changed_path(p)
        if not path_clean: continue
        if agg.get(path_clean) is None or precedence.get(code, 0) >= precedence.get(agg[path_clean], 0):
            agg[path_clean] = code

    changed_files: List[Tuple[str, str]] = list(agg.items())
    if not changed_files and diffs_map:
        changed_files = [( _classify_svn_code_from_diff_header(dtext), path) for path, dtext in diffs_map.items() if path and not path.endswith("/")]

    # --- Loop 1: Collect file data and items for bulk queries ---
    files_to_process: List[FileChange] = []

    prev_rev_str = str(int(revision) - 1) if revision and int(revision) > 0 else None

    # Track banned directory summaries for this commit
    banned_dirs_map: Dict[str, Dict[str, object]] = {}
    # Set of known banned directory prefixes for fast subdirectory lookup
    known_banned_prefixes: Set[str] = set()

    for path_clean, change_code in changed_files:
        if not path_clean or path_clean.endswith("/"):
            continue

        # Fast path: check if this file is under an already-known banned directory
        matched_prefix = None
        for banned_prefix in known_banned_prefixes:
            if path_clean == banned_prefix or path_clean.startswith(banned_prefix + "/"):
                matched_prefix = banned_prefix
                break

        if matched_prefix is not None:
            # File is in a known banned directory, skip rule matching
            entry = banned_dirs_map.get(matched_prefix)
            if entry is not None:
                entry["count"] += 1
                if len(entry["samples"]) < 10:
                    entry["samples"].append(path_clean)
            continue

        # Full rule matching if not in a known banned directory
        m = _match_banned_rule_for_path(path_clean, rules)
        if m is not None:
            rule, matched_dir = m
            entry = banned_dirs_map.get(matched_dir)
            if entry is None:
                entry = {"count": 0, "total_bytes": 0, "samples": [], "banned_directory_id": rule.get("id") if rule else None}
                banned_dirs_map[matched_dir] = entry
                # Add to known prefixes for fast subdirectory lookup
                known_banned_prefixes.add(matched_dir)
            entry["count"] += 1
            if len(entry["samples"]) < 10:
                entry["samples"].append(path_clean)
            # preserve skip behavior for banned files
            continue

        change = FileChange(
            path_raw=path_clean,
            old_path=path_clean,
            new_path=path_clean,
            change_type=change_code,
            diff_text=diffs_map.get(path_clean),
        )
        change.file_name = change.path_raw.split("/")[-1][:255]

        # Determine file type
        ext = ""
        if change.file_name and "." in change.file_name and not change.file_name.startswith("."):
            ext = change.file_name.rsplit('.', 1)[-1].lower()
        ft = file_type_map.get(ext)
        if ft:
            change.category = ft.get("category") or "unknown"
            change.can_line_count = int(ft.get("can_line_count", 0))

        change.is_text_candidate = True if change.can_line_count == 1 else False
        # Fallback for nameless files removed as per requirement: unknown types stay unknown


        # Collect size keys for later concurrent fetch
        if change.change_type != 'D':
            key = (repo_path, str(revision), change.path_raw or "")
            if key not in shared.svn_size_cache:
                svn_size_keys_to_fetch.add(key)
        if change.change_type != 'A' and prev_rev_str:
            # If previous bytes are already known from repo_files cache, skip prev-rev filesize fetch
            have_prev_bytes = False
            if change.category in trackable_cats and repo_files_local_cache:
                try:
                    entry = repo_files_local_cache.get(change.path_raw[:1024])
                    if entry and entry.get("bytes") is not None:
                        have_prev_bytes = True
                except Exception:
                    pass
            if not have_prev_bytes:
                key = (repo_path, prev_rev_str, change.path_raw or "")
                if key not in shared.svn_size_cache:
                    svn_size_keys_to_fetch.add(key)
        change.repo_file_bytes = change.bytes_after if change.change_type != 'D' else change.bytes_before

        files_to_process.append(change)
        # 保留可哈希文本的 content_hash，跳过提交内去重
        if change.is_text_candidate:
            use_name_size_only = change.category in ("banned", "ignore", "unknown") or (change.bytes_after is not None and change.bytes_after > max_hash_size)
            if not use_name_size_only and change.change_type != "D":
                raw_bytes: Optional[bytes] = None
                key = (repo_path, str(revision), change.path_raw or "")
                with shared.size_cache_lock:
                    if key in shared.svn_cat_cache:
                        try:
                            with shared.metrics_lock:
                                shared.svn_cat_cache_hits += 1
                        except Exception:
                            pass
                        raw_bytes = shared.svn_cat_cache.get(key)
                    else:
                        try:
                            with shared.metrics_lock:
                                shared.svn_cat_cache_misses += 1
                        except Exception:
                            pass
                        svn_cat_keys_to_fetch.add(key)
                        svn_cat_map.setdefault(key, []).append(change)
                if raw_bytes:
                    change.content_hash = _sha256_hex(raw_bytes)

    # Prefetch svn cat bytes concurrently for missing keys
    if svn_cat_keys_to_fetch and shared.executor:
        keys_list = list(svn_cat_keys_to_fetch)
        batch_size = 50
        total_batches = (len(keys_list) + batch_size - 1) // batch_size
        for i in range(0, len(keys_list), batch_size):
            batch_idx = i // batch_size + 1
            if batch_idx % 5 == 0 or batch_idx == 1 or batch_idx == total_batches:
                log_message(connection, run_id, "DEBUG", f"Fetching SVN content batch {batch_idx}/{total_batches} ({len(keys_list)} items total)", {"commit_id": commit_id})
            batch = keys_list[i : i + batch_size]
            cat_futures: Dict[Tuple[str, str, str], Future] = {}
            for key in batch:
                repo_path_k, rev_k, path_k = key
                if not path_k:
                    continue
                cat_futures[key] = shared.executor.submit(_get_svn_cat_worker, repo_path_k, rev_k, path_k, shared)
            for k, f in cat_futures.items():
                try:
                    f.result(timeout=60)
                except Exception:
                    log_message(connection, run_id, "WARNING", "SVN cat fetch failed for key", {"key": k})
                    try:
                        with shared.metrics_lock:
                            shared.svn_cat_failures += 1
                    except Exception:
                        pass
    elif svn_cat_keys_to_fetch:
        # No executor: fetch synchronously
        for key in svn_cat_keys_to_fetch:
            repo_path_k, rev_k, path_k = key
            try:
                _get_svn_cat_worker(repo_path_k, rev_k, path_k, shared)
            except Exception:
                log_message(connection, run_id, "WARNING", "SVN cat fetch failed for key", {"key": key})
                try:
                    with shared.metrics_lock:
                        shared.svn_cat_failures += 1
                except Exception:
                    pass

        # (no-executor branch handled above); we'll run a unified assignment below as well

    # Remove current-revision filesize fetches when cat succeeded, to reduce svnlook load
    if svn_size_keys_to_fetch:
        current_rev_str = str(revision)
        to_remove: Set[Tuple[str, str, str]] = set()
        try:
            with shared.size_cache_lock:
                for k in svn_size_keys_to_fetch:
                    repo_path_k, rev_k, path_k = k
                    if rev_k == current_rev_str:
                        raw = shared.svn_cat_cache.get(k)
                        if raw and raw != b"":
                            to_remove.add(k)
        except Exception:
            to_remove = set()
        if to_remove:
            svn_size_keys_to_fetch.difference_update(to_remove)

    # Prefetch svn sizes concurrently for remaining keys
    if svn_size_keys_to_fetch and shared.executor:
        keys_list = list(svn_size_keys_to_fetch)
        batch_size = 50
        total_batches = (len(keys_list) + batch_size - 1) // batch_size
        for i in range(0, len(keys_list), batch_size):
            batch_idx = i // batch_size + 1
            if batch_idx % 5 == 0 or batch_idx == 1 or batch_idx == total_batches:
                log_message(connection, run_id, "DEBUG", f"Fetching SVN sizes batch {batch_idx}/{total_batches} ({len(keys_list)} items total)", {"commit_id": commit_id})
            batch = keys_list[i : i + batch_size]
            futures: Dict[Tuple[str, str, str], Future] = {}
            for key in batch:
                repo_path_k, rev_k, path_k = key
                if not path_k:
                    continue
                fut = shared.executor.submit(_get_svn_size_worker, repo_path_k, rev_k, path_k, shared)
                futures[key] = fut
            for k, f in futures.items():
                try:
                    f.result(timeout=30)
                except Exception:
                    log_message(connection, run_id, "WARNING", "SVN size fetch failed for key", {"key": k})

    # Assign pre-fetched svn cat bytes (compute content_hash)
    if svn_cat_map:
        for key, changes in svn_cat_map.items():
            try:
                with shared.size_cache_lock:
                    raw = shared.svn_cat_cache.get(key)
            except Exception:
                raw = None
            if raw:
                try:
                    h = _sha256_hex(raw)
                except Exception:
                    h = None
                if h:
                    for ch in changes:
                        ch.content_hash = h
                        # Calculate lines if text candidate
                        try:
                            ch.lines = len(raw.splitlines())
                        except Exception:
                            pass

    # Hydrate byte sizes for each change now that caches are primed (SVN，仅从缓存读取，避免重复 svnlook 调用)
    missing_after_hydration: List[str] = []
    missing_before_hydration: List[str] = []
    for change in files_to_process:
        # bytes_after from current revision
        if change.change_type != 'D':
            key_after = (repo_path, str(revision), change.path_raw or "")
            raw_after = None
            if change.is_text_candidate:
                try:
                    with shared.size_cache_lock:
                        raw_after = shared.svn_cat_cache.get(key_after)
                except Exception:
                    raw_after = None
            if raw_after and raw_after != b"":
                change.bytes_after = len(raw_after)
            else:
                with shared.size_cache_lock:
                    cached_after = shared.svn_size_cache.get(key_after)
                change.bytes_after = _normalize_size(cached_after)
            if change.bytes_after is None:
                missing_after_hydration.append(change.path_raw)
        # bytes_before from previous revision
        if change.change_type != 'A' and prev_rev_str:
            key_before = (repo_path, prev_rev_str, change.path_raw or "")
            with shared.size_cache_lock:
                cached_before = shared.svn_size_cache.get(key_before)
            change.bytes_before = _normalize_size(cached_before)
            # Fallback to repo_files cache (previous known bytes) when prev-rev size missing
            if change.bytes_before is None and change.category in trackable_cats and repo_files_local_cache:
                try:
                    entry = repo_files_local_cache.get(change.path_raw[:1024])
                    if entry and entry.get("bytes") is not None:
                        change.bytes_before = int(entry.get("bytes"))
                except Exception:
                    pass
            if change.bytes_before is None:
                missing_before_hydration.append(change.path_raw)
        change.repo_file_bytes = change.bytes_after if change.change_type != 'D' else change.bytes_before

    if missing_after_hydration:
        log_message(connection, run_id, "WARNING", "SVN bytes_after missing after hydration", {"commit_id": commit_id, "count": len(missing_after_hydration), "sample_paths": missing_after_hydration[:5]})
    if missing_before_hydration:
        log_message(connection, run_id, "DEBUG", "SVN bytes_before missing after hydration", {"commit_id": commit_id, "count": len(missing_before_hydration), "sample_paths": missing_before_hydration[:5]})

    # --- Loop 2: Finalize and Prepare Bulk Insert ---
    commit_files_to_insert = []
    seen_prefix255 = set()
    stats = {
        "added": 0, "deleted": 0, "modified": 0,
        "code_added": 0, "code_deleted": 0, "code_modified": 0,
        "lines_added": 0, "lines_deleted": 0, "lines_modified": 0,
        "computed_files": 0,
        "dupe_code": 0, "dupe_binary": 0, "dupe_lines": 0, "dupe_bytes": 0,
        "binary_added": 0, "binary_deleted": 0, "binary_modified": 0, "binary_bytes_delta": 0
    }

    # Batch updates for repo_files
    repo_files_to_upsert: List[Tuple] = []
    repo_files_to_delete: List[Tuple] = []

    for change in files_to_process:
        # Prepare updates for repo_files table for trackable files
        if change.category in trackable_cats:
            lookup_path = (change.path_raw or "")[:1024]

            repo_file_id: Optional[int] = None
            is_currently_deleted: bool = False
            if repo_files_local_cache is not None and lookup_path:
                entry = repo_files_local_cache.get(lookup_path)
                if entry:
                    repo_file_id = entry.get("id")
                    is_currently_deleted = entry.get("is_deleted", False)

            file_name = change.path_raw.split("/")[-1][:255]
            file_extension = None
            if "." in file_name and not file_name.startswith("."):
                parts = file_name.rsplit('.', 1)
                if len(parts) > 1:
                    file_extension = parts[1].lower()

            if change.change_type == "D":
                if repo_file_id and not is_currently_deleted:
                    repo_files_to_delete.append((commit_id, committed_at, change.repo_file_bytes, repo_file_id))
            else: # Add or Modify
                repo_files_to_upsert.append((repo_catalog_id, lookup_path, file_name, file_extension, change.category, commit_id, committed_at, commit_id, committed_at, change.repo_file_bytes, 0, change.lines))

        change.is_duplicate = False
        change.duplicate_of_file_id = None
        change.duplicate_reason = None

        # Finalize line counts
        if change.diff_text and change.is_text_candidate:
            summary = summarize_unified_diff(change.diff_text)
            if summary.lines_added is not None:
                change.lines_added, change.lines_deleted, change.replacements = summary.lines_added, summary.lines_deleted, summary.replacements
                # Normalize based on change_type:
                # - Deleted files (D) cannot have lines_added
                # - New files (A) cannot have lines_deleted
                if change.change_type == "D":
                    change.lines_added = 0
                    change.replacements = 0
                elif change.change_type == "A":
                    change.lines_deleted = 0
                    change.replacements = 0
            else:
                change.is_truncated = True
        elif not change.is_text_candidate:
            change.is_truncated = True

        # Update stats
        if change.change_type == "A": stats["added"] += 1
        elif change.change_type == "D": stats["deleted"] += 1
        else: stats["modified"] += 1

        if change.lines_added is not None:
            stats["lines_added"] += change.lines_added
            # Only count lines_deleted from Modified/Renamed files, not from completely Deleted files
            if change.change_type != "D":
                stats["lines_deleted"] += change.lines_deleted
            stats["lines_modified"] += change.replacements
            stats["computed_files"] += 1

        # Code files stats (can_line_count == 1)
        if change.can_line_count == 1:
            if change.change_type == "A": stats["code_added"] += 1
            elif change.change_type == "D": stats["code_deleted"] += 1
            else: stats["code_modified"] += 1

        # Binary stats
        if change.can_line_count == 0:
            if change.change_type == "A": stats["binary_added"] += 1
            elif change.change_type == "D": stats["binary_deleted"] += 1
            else: stats["binary_modified"] += 1

            b_after = change.bytes_after or 0
            b_before = change.bytes_before or 0
            stats["binary_bytes_delta"] += (b_after - b_before)

        # Prepare for insertion
        truncated_path = change.path_raw[:1024]
        prefix_key = truncated_path[:255].casefold()
        if prefix_key in seen_prefix255:
            continue
        seen_prefix255.add(prefix_key)

        stored_hash = None
        if not (change.is_duplicate and change.duplicate_reason == "hash"):
            stored_hash = change.content_hash

        commit_files_to_insert.append((
            commit_id, change.repo_file_id, truncated_path, change.change_type,
            change.lines_added, change.lines_deleted, change.replacements,
            change.bytes_before, change.bytes_after, change.can_line_count,
            change.category, stored_hash, 1 if change.is_duplicate else 0,
            change.duplicate_of_file_id, change.duplicate_reason,
            repo_catalog_id, change.lines
        ))

    # --- Execute Bulk Updates for repo_files (SVN) ---
    try:
        if repo_files_to_upsert:
            cursor.executemany(
                """
                INSERT INTO repo_files (repo_catalog_id, current_file_path, file_name, file_extension, file_type, created_in_commit_id, created_time, last_modified_in_commit_id, updated_time, bytes, is_deleted, file_lines)
                VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
                ON DUPLICATE KEY UPDATE
                    last_modified_in_commit_id = VALUES(last_modified_in_commit_id),
                    updated_time = VALUES(updated_time),
                    bytes = VALUES(bytes),
                    is_deleted = 0,
                    deleted_in_commit_id = NULL,
                    deleted_time = NULL,
                    created_time = COALESCE(created_time, VALUES(created_time)),
                    updated_at = NOW(6),
                    file_lines = VALUES(file_lines)
                """,
                repo_files_to_upsert
            )
        if repo_files_to_delete:
            cursor.executemany(
                "UPDATE repo_files SET is_deleted = 1, deleted_in_commit_id = %s, deleted_time = %s, bytes = %s, updated_at = NOW(6) WHERE id = %s",
                repo_files_to_delete
            )
        # Refresh cache for all changed paths in this commit
        if repo_files_local_cache is not None:
            all_changed_paths = {c.path_raw[:1024] for c in files_to_process if c.category in trackable_cats}
            if all_changed_paths:
                placeholders = ",".join(["%s"] * len(all_changed_paths))
                cursor.execute(f"SELECT id, current_file_path, is_deleted, bytes FROM repo_files WHERE repo_catalog_id=%s AND current_file_path IN ({placeholders})", [repo_catalog_id] + list(all_changed_paths))
                for r_id, r_path, r_deleted, r_bytes in cursor.fetchall():
                    repo_files_local_cache[r_path] = {"id": r_id, "is_deleted": bool(r_deleted), "bytes": r_bytes}
    except Exception:
        log_message(connection, run_id, "WARNING", "Failed to bulk update repo_files for svn commit", {"commit_id": commit_id})

    # --- Bulk Insert and Diff Processing ---
    # Resolve repo_file_id for all changes now that repo_files is up to date
    for change in files_to_process:
        if change.category in trackable_cats and change.repo_file_id is None:
            path_key = change.path_raw[:1024]
            if repo_files_local_cache and path_key in repo_files_local_cache:
                change.repo_file_id = repo_files_local_cache[path_key].get("id")

    # Re-build the insertion list with the resolved repo_file_id
    changes_by_path = {c.path_raw[:1024]: c for c in files_to_process}
    commit_files_to_insert_final = []
    for params in commit_files_to_insert:
        path = params[2]
        change_obj = changes_by_path.get(path)
        if change_obj:
            new_params = list(params)
            new_params[1] = change_obj.repo_file_id
            commit_files_to_insert_final.append(tuple(new_params))
        else:
            commit_files_to_insert_final.append(params)

    # In-memory counts of banned/unknown type files among inserted rows
    banned_type_files = 0
    banned_type_bytes = 0
    for row in commit_files_to_insert_final:
        try:
            ft = row[10]
        except Exception:
            ft = None
        if ft in ("banned", "unknown"):
            banned_type_files += 1
            try:
                banned_type_bytes += int(row[8] or 0)
            except Exception:
                pass

    if commit_files_to_insert_final:
        cursor.executemany(
            "INSERT IGNORE INTO repo_commit_files (repo_commit_id, repo_file_id, file_path, change_type, lines_added, lines_deleted, lines_modified, bytes_before, bytes_after, can_line_count, file_type, content_hash, is_duplicate, duplicate_of_file_id, duplicate_reason, repo_catalog_id, file_lines) "
            "VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)",
            commit_files_to_insert_final
        )

    inserted_files_map: Dict[str, int] = {}
    if commit_files_to_insert_final:
        cursor.execute(
            "SELECT id, file_path FROM repo_commit_files WHERE repo_commit_id=%s",
            (commit_id,)
        )
        for file_id, file_path in cursor.fetchall():
            inserted_files_map[file_path] = file_id

    # Collect diffs for batch insertion
    diffs_to_insert: List[Tuple[int, Optional[str], int]] = []
    for change in files_to_process:
        store_diff = shared.save_diffs and change.is_text_candidate
        if store_diff:
            file_row_id = inserted_files_map.get(change.path_raw[:1024])
            if file_row_id:
                safe_diff = _sanitize_diff_text(change.diff_text)
                diffs_to_insert.append((file_row_id, safe_diff, 1 if change.is_truncated else 0))

    # Batch insert all diffs at once
    if diffs_to_insert:
        _insert_commit_diffs_batch(connection, diffs_to_insert)

    # --- Finalize commit stats (including banned counts) ---
    # Calculate directories_banned and files_unexpected
    # Insert per-commit banned directories summary (so aggregations can count banned files)
    try:
        if banned_dirs_map:
            inserts = []
            for bd_path, info in banned_dirs_map.items():
                inserts.append((commit_id, repo_catalog_id, bd_path, info.get("banned_directory_id"), int(info.get("count", 0)), int(info.get("total_bytes", 0)), json.dumps(info.get("samples", []), ensure_ascii=False)))
            cursor.executemany(
                "INSERT INTO repo_commit_banned_directories (repo_commit_id, repo_catalog_id, banned_directory_path, banned_directory_id, files_unexpected, banned_total_bytes, sample_paths) VALUES (%s,%s,%s,%s,%s,%s,%s) ON DUPLICATE KEY UPDATE files_unexpected=VALUES(files_unexpected), banned_total_bytes=VALUES(banned_total_bytes), sample_paths=VALUES(sample_paths), updated_at=NOW(6)",
                inserts,
            )
    except Exception:
        pass

    # Compute banned counts in memory to avoid extra DB round-trips
    directories_banned = len(banned_dirs_map)
    banned_dir_files = 0
    banned_dir_bytes = 0
    for info in banned_dirs_map.values():
        try:
            banned_dir_files += int(info.get("count", 0) or 0)
            banned_dir_bytes += int(info.get("total_bytes", 0) or 0)
        except Exception:
            pass

    # Total banned files = files in banned directories + banned/unknown type files
    # files_unexpected in repo_commits will ONLY contain banned_type_files
    # files_in_banned_directories will contain banned_dir_files
    total_unexcepted_bytes = banned_dir_bytes + banned_type_bytes

    # Calculate Quality Scores (Pre-calculation for single UPDATE)
    # Submission Quality
    numerator = stats["added"] + stats["code_modified"] + stats["binary_modified"]
    denominator = numerator + directories_banned + banned_type_files + stats["dupe_code"] + stats["dupe_binary"]

    score_submission = 100.0
    if denominator > 0:
        score_submission = (numerator / denominator) * 100.0

    # Code Quality
    total_lines = (stats["lines_added"] or 0) + (stats["lines_deleted"] or 0) + (stats["lines_modified"] or 0)
    score_code = max(0, 100.0 - abs(50.0 - total_lines) * 0.2)

    cursor.execute(
        "UPDATE repo_commits SET files_added=%s, code_files_added=%s, code_files_deleted=%s, code_files_modified=%s, lines_added=COALESCE(%s, lines_added), lines_deleted=COALESCE(%s, lines_deleted), lines_modified=COALESCE(%s, lines_modified), code_files_duplicated=%s, binary_files_duplicated=%s, duplicate_files_bytes=%s, directories_banned=%s, files_unexpected=%s, files_in_banned_directories=%s, unexcepted_files_bytes=%s, binary_files_added=%s, binary_files_deleted=%s, binary_files_modified=%s, binary_bytes_added=%s, score_submission_quality=%s, score_code_quality=%s, files_ingested=1 WHERE id=%s",
        (
            stats["added"],
            stats["code_added"], stats["code_deleted"], stats["code_modified"],
            stats["lines_added"] if stats["computed_files"] > 0 else None,
            stats["lines_deleted"] if stats["computed_files"] > 0 else None,
            stats["lines_modified"] if stats["computed_files"] > 0 else None,
            stats["dupe_code"], stats["dupe_binary"], stats["dupe_bytes"],
            directories_banned, banned_type_files, banned_dir_files, total_unexcepted_bytes,
            stats["binary_added"], stats["binary_deleted"], stats["binary_modified"], stats["binary_bytes_delta"],
            score_submission, score_code,
            commit_id,
        ),
    )
    clear_commit_caches(shared)
    cursor.close()

# ---------------------------------------------------------------------------
# Orchestration
# ---------------------------------------------------------------------------

def main(argv: Optional[Iterable[str]] = None) -> int:
    config = load_config(argv)
    connection = mysql.connector.connect(
        host=config.db_host,
        port=config.db_port,
        user=config.db_user,
        password=config.db_password,
        database=config.db_name,
        autocommit=False,
    )


    # If dry-run is requested, patch commit to no-op so we do not persist writes
    real_commit = None
    if config.dry_run:
        try:
            real_commit = connection.commit
            connection.commit = lambda *a, **k: None
        except Exception:
            real_commit = None

    global RUN_START_TIME
    RUN_START_TIME = time.perf_counter()

    params = {"batch_size": config.batch_size, "include_invalid": config.include_invalid, "repo_catalog_id": config.repo_catalog_id, "filter_gitlab_project_id": config.filter_gitlab_project_id}
    if config.dry_run:
        run_id = -1
        log_message(connection, run_id, "INFO", "Global files ingest started (dry-run)", {**params, "triggered_by": config.triggered_by})
    else:
        run_id = create_run(connection, params, config.triggered_by)
        log_message(connection, run_id, "INFO", "Global files ingest started", {**params, "triggered_by": config.triggered_by})

    gitlab_session: Optional[requests.Session] = None
    gitlab_base: Optional[str] = None
    if config.gitlab_url and config.gitlab_token:
        gitlab_session = requests.Session()
        gitlab_session.headers.update({"PRIVATE-TOKEN": config.gitlab_token})
        gitlab_base = config.gitlab_url.rstrip("/")
        try:
            from requests.adapters import HTTPAdapter
            # tune pool size to shared executor size if provided
            # we'll set adapter in main after building shared (fallback later)
        except Exception:
            pass
    else:
        log_message(connection, run_id, "INFO", "GitLab disabled (missing url/token)")

    shared = build_shared_resources(connection, config.max_workers, config.svn_max_concurrency, save_diffs=config.save_diffs)
    # After building shared resources, adjust GitLab session pool if present
    if gitlab_session and shared and shared.executor:
        try:
            from requests.adapters import HTTPAdapter
            max_workers_val = shared.executor._max_workers
            # Allow tuning pool size vs. max workers to avoid dropping connections under high concurrency
            try:
                multiplier = float(config.http_pool_multiplier) if config.http_pool_multiplier is not None else float(os.environ.get("FILES_INGEST_HTTP_POOL_MULTIPLIER", "2.0"))
            except Exception:
                multiplier = 2.0
            # compute pool sizes with safety caps
            pool_maxsize = max(4, min(200, int(max_workers_val * multiplier)))
            pool_connections = max(4, min(200, int(max_workers_val * multiplier)))
            adapter = HTTPAdapter(pool_connections=pool_connections, pool_maxsize=pool_maxsize, pool_block=True, max_retries=3)
            gitlab_session.mount('http://', adapter)
            gitlab_session.mount('https://', adapter)
        except Exception:
            # Best-effort; ignore errors
            pass

    processed = 0
    failed = 0
    failed_commit_ids: Set[int] = set()
    # Initial progress snapshot: total matching commits and already ingested
    total_matching = 0
    already_done_start = 0
    try:
        cursor = connection.cursor()
        where = "WHERE "
        if gitlab_session and gitlab_base:
            where += "(r.source_type='gitlab' OR r.source_type='svn') "
        else:
            where += "r.source_type='svn' "
        if not config.include_invalid:
            where += "AND r.is_valid = 1 "
        base = "FROM repo_commits c JOIN repo_catalog r ON r.id=c.repo_catalog_id " + where
        cursor.execute(f"SELECT COUNT(*) {base}")
        row = cursor.fetchone()
        total_matching = int(row[0]) if row else 0
        cursor.execute(f"SELECT COUNT(*) {base} AND c.files_ingested=1")
        row = cursor.fetchone()
        already_done_start = int(row[0]) if row else 0
        cursor.close()
        progress_pct = (already_done_start * 100.0 / total_matching) if total_matching > 0 else 0.0
        # Include current SVN concurrency metrics in progress init for visibility
        try:
            metrics_ctx = {}
            if shared is not None:
                try:
                    with shared.metrics_lock:
                        metrics_ctx["svn_active_count"] = shared.svn_active_count
                        metrics_ctx["svn_active_peak_interval"] = shared.svn_active_peak_interval
                        metrics_ctx["svn_active_peak_run"] = shared.svn_active_peak_run
                except Exception:
                    pass
            log_message(connection, run_id, "INFO", "Progress init", {
                "total_commits": total_matching,
                "already_ingested": already_done_start,
                "remaining": max(0, total_matching - already_done_start),
                "progress_percent": round(progress_pct, 2),
                **metrics_ctx,
            })
        except Exception:
            # Fallback to original progress init without metrics if anything goes wrong
            log_message(connection, run_id, "INFO", "Progress init", {
                "total_commits": total_matching,
                "already_ingested": already_done_start,
                "remaining": max(0, total_matching - already_done_start),
                "progress_percent": round(progress_pct, 2),
            })
    except Exception as exc:
        if is_connection_lost(exc):
            log_message(connection, run_id, "WARNING", "DB connection lost during progress init; reconnecting")
            connection = reconnect_db(connection, config)
            time.sleep(0.5)
        else:
            raise

    is_stopped = False
    last_repo_id = None
    try:
        while True:
            # Check global stop flag before fetching next page
            if stop_requested(connection):
                log_message(connection, run_id, "WARNING", "Stop requested via system_parameters; stopping before next batch")
                flush_log_buffer(connection, force=True)
                finalize_run(connection, run_id, "stopped", processed, failed, "stop requested")
                clear_stop_request(connection)
                is_stopped = True
                break
            # Fetch a page of commits to process
            try:
                cursor = connection.cursor()
                query = (
                "SELECT c.id, c.repo_catalog_id, c.revision, c.committed_at, r.source_type, r.gitlab_project_id, r.default_branch, r.repo_path "
                "FROM repo_commits c JOIN repo_catalog r ON r.id=c.repo_catalog_id "
                "WHERE c.files_ingested=0 "
                )
                # Only include sources that are properly configured
                if gitlab_session and gitlab_base:
                    query += "AND (r.source_type='gitlab' OR r.source_type='svn') "
                else:
                    query += "AND r.source_type='svn' "
                if not config.include_invalid:
                    query += "AND r.is_valid = 1 "
                # Optional filters
                if config.repo_catalog_id is not None:
                    query += "AND r.id = %s "
                if config.filter_gitlab_project_id is not None:
                    query += "AND r.gitlab_project_id = %s "
                params: List[Any] = []
                if failed_commit_ids:
                    placeholders = ",".join(["%s"] * len(failed_commit_ids))
                    query += f"AND c.id NOT IN ({placeholders}) "
                    params.extend(sorted(failed_commit_ids))
                query += "ORDER BY c.repo_catalog_id ASC, c.committed_at ASC, c.id ASC LIMIT %s"
                # Append filter parameters last in the same order as above
                # Append repo filters first (they correspond to earlier %s placeholders),
                # then append the batch size param which corresponds to the LIMIT placeholder.
                if config.repo_catalog_id is not None:
                    params.append(config.repo_catalog_id)
                if config.filter_gitlab_project_id is not None:
                    params.append(config.filter_gitlab_project_id)
                params.append(config.batch_size)
                cursor.execute(query, params)
                rows = cursor.fetchall()
                cursor.close()
            except Exception as exc:
                if is_connection_lost(exc):
                    log_message(connection, run_id, "WARNING", "DB connection lost during fetch; reconnecting", {"skip_ids": len(failed_commit_ids)})
                    connection = reconnect_db(connection, config)
                    time.sleep(0.5)
                    continue  # retry fetch loop
                else:
                    raise
            if not rows:
                break
            for row in rows:
                commit_id, repo_catalog_id, revision, committed_at, source_type, gitlab_project_id, default_branch, repo_path = row

                # Optimization: Clear cache when switching repositories (since we order by repo now)
                if last_repo_id is not None and last_repo_id != repo_catalog_id:
                     if shared and shared.repo_files_cache:
                         shared.repo_files_cache.pop(last_repo_id, None)
                last_repo_id = repo_catalog_id
                try:
                    if source_type == "gitlab":
                        if not gitlab_session or not gitlab_base:
                            # Skip GitLab commits when not configured instead of counting as failure
                            log_message(connection, run_id, "WARNING", "Skip gitlab commit (session not configured)", {"commit_id": commit_id})
                            continue
                        if gitlab_project_id is None:
                            raise RuntimeError("Missing gitlab_project_id")
                        # Retry loop for GitLab ingestion
                        max_retries = 3
                        for attempt in range(max_retries):
                            try:
                                ingest_gitlab_commit_files(
                                    connection,
                                    gitlab_session,
                                    gitlab_base,
                                    (commit_id, repo_catalog_id, revision, committed_at, gitlab_project_id, default_branch),
                                    run_id,
                                    shared,
                                    config,
                                )
                                # Note: commit() is now done in batches, not per-record
                                break
                            except mysql.connector.errors.DatabaseError as db_err:
                                if db_err.errno == 1205 and attempt < max_retries - 1:
                                    log_message(connection, run_id, "WARNING", f"Lock wait timeout (GitLab), retrying {attempt+1}/{max_retries}", {"commit_id": commit_id})
                                    connection.rollback()
                                    time.sleep(2)
                                    continue
                                else:
                                    raise
                            except Exception as exc:
                                if is_connection_lost(exc) and attempt < max_retries - 1:
                                    log_message(connection, run_id, "WARNING", "DB connection lost during gitlab commit; reconnect and retry", {"commit_id": commit_id})
                                    connection = reconnect_db(connection, config)
                                    time.sleep(0.5)
                                    continue
                                else:
                                    raise
                    elif source_type == "svn":
                        if not repo_path:
                            raise RuntimeError("Missing repo_path for SVN")
                        # Retry loop for SVN ingestion
                        max_retries = 3
                        for attempt in range(max_retries):
                            try:
                                ingest_svn_commit_files(
                                    connection,
                                    (commit_id, repo_catalog_id, revision, committed_at, repo_path),
                                    config.svn_max_diff_bytes,
                                    run_id,
                                    shared,
                                    config,
                                )
                                # Note: commit() is now done in batches, not per-record
                                break
                            except mysql.connector.errors.DatabaseError as db_err:
                                if db_err.errno == 1205 and attempt < max_retries - 1:
                                    log_message(connection, run_id, "WARNING", f"Lock wait timeout (SVN), retrying {attempt+1}/{max_retries}", {"commit_id": commit_id})
                                    connection.rollback()
                                    time.sleep(2)
                                    continue
                                else:
                                    raise
                            except Exception as exc:
                                if is_connection_lost(exc) and attempt < max_retries - 1:
                                    log_message(connection, run_id, "WARNING", "DB connection lost during svn commit; reconnect and retry", {"commit_id": commit_id})
                                    connection = reconnect_db(connection, config)
                                    time.sleep(0.5)
                                    continue
                                else:
                                    raise
                    else:
                        raise RuntimeError(f"Unsupported source_type={source_type}")

                    processed += 1

                    # Batch commit logic: commit every COMMIT_BATCH_SIZE records
                    if processed % COMMIT_BATCH_SIZE == 0:
                        try:
                            connection.commit()
                        except Exception as commit_exc:
                            log_message(connection, run_id, "WARNING", f"Batch commit failed after {COMMIT_BATCH_SIZE} records, rolling back", {"error": str(commit_exc)})
                            try:
                                connection.rollback()
                            except Exception:
                                pass
                            # Mark recent commits as potentially failed
                            failed += 1
                            failed_commit_ids.add(commit_id)
                except Exception as exc:  # pragma: no cover - broad safeguard
                    failed += 1
                    failed_commit_ids.add(commit_id)
                    log_message(
                        connection,
                        run_id,
                        "ERROR",
                        "Commit files ingest failed",
                        {"commit_id": commit_id, "source_type": source_type, "error": str(exc)},
                    )
                if processed % PROGRESS_INTERVAL == 0:
                    processed_total = already_done_start + processed
                    pct = (processed_total * 100.0 / total_matching) if total_matching > 0 else 0.0
                    pretty_total = f"{pct:.1f}%({processed_total}/{total_matching})" if total_matching > 0 else str(processed_total)
                    # Add svn_active metrics to periodic progress heartbeat and flush interval peak
                    try:
                        metrics_ctx = {}
                        if shared is not None:
                            try:
                                with shared.metrics_lock:
                                    metrics_ctx["svn_active_count"] = shared.svn_active_count
                                    metrics_ctx["svn_active_peak_interval"] = shared.svn_active_peak_interval
                                    metrics_ctx["svn_active_peak_run"] = shared.svn_active_peak_run
                            except Exception:
                                pass
                        log_message(connection, run_id, "INFO", "Progress", {
                            "processed_this_run": processed,
                            "processed_total": pretty_total,
                            "failed": failed,
                            # **metrics_ctx,
                        })
                        # Reset interval peak after logging so next heartbeat captures a fresh interval
                        try:
                            if shared is not None:
                                with shared.metrics_lock:
                                    shared.svn_active_peak_interval = 0
                        except Exception:
                            pass
                    except Exception:
                        # Fallback to the original minimal progress message in case of issues
                        log_message(connection, run_id, "INFO", "Progress", {
                            "processed_this_run": processed,
                            "processed_total": pretty_total,
                            "failed": failed,
                        })
                    # Early stop check at progress heartbeat granularity
                    if stop_requested(connection):
                        log_message(connection, run_id, "WARNING", "Stop requested; exiting after current commit")
                        break
            try:
                flush_log_buffer(connection, force=True)
                connection.commit()
            except Exception as exc:
                if is_connection_lost(exc):
                    log_message(connection, run_id, "WARNING", "DB connection lost during commit; reconnecting and reprocessing page", {"processed": processed, "failed": failed})
                    connection = reconnect_db(connection, config)
                    time.sleep(0.5)
                    continue
                else:
                    raise
            # Stop check after each committed page
            if stop_requested(connection):
                log_message(connection, run_id, "WARNING", "Stop requested; exiting after committed page")
                flush_log_buffer(connection, force=True)
                finalize_run(connection, run_id, "stopped", processed, failed, "stop requested")
                clear_stop_request(connection)
                break
        # When loop exits without explicit stop, finalize as success/failed
        if not stop_requested(connection):
            flush_log_buffer(connection, force=True)

            # Auto-trigger deduplication if finished successfully
            if not is_stopped:
                dedupe_ok = True
                if failed == 0:
                    try:
                        if run_id:
                            insert_run_log(connection, run_id, "INFO", "Starting auto-deduplication")
                        dedupe_ok = run_deduplication(config, run_id)
                        if run_id:
                            insert_run_log(
                                connection,
                                run_id,
                                "INFO" if dedupe_ok else "ERROR",
                                "Auto-deduplication completed" if dedupe_ok else "Auto-deduplication failed; please rerun deduplicate_repo_files.py manually",
                            )
                    except Exception as exc:
                        dedupe_ok = False
                        if run_id:
                            insert_run_log(connection, run_id, "ERROR", "Auto-deduplication raised exception", {"error": str(exc)})

                # Mark ingestion as completed only if dedupe succeeded (or was skipped due to failures/stops).
                if failed == 0 and dedupe_ok:
                    try:
                        _set_system_param(connection, "ingestion_completed", "true", "Flag indicating if ingestion and deduplication are completed")
                    except Exception as e:
                        LOGGER.error(f"Failed to update ingestion_completed param: {e}")

                status = "success" if failed == 0 and dedupe_ok else "failed"
                error_message = None if status == "success" else (f"{failed} failed" if failed > 0 else "auto deduplication failed")
                finalize_run(connection, run_id, status, processed, failed, error_message)
        processed_total = already_done_start + processed
        pct = (processed_total * 100.0 / total_matching) if total_matching > 0 else 0.0
        log_message(connection, run_id, "INFO", "Global files ingest completed", {
            "processed_this_run": processed,
            "processed_total": processed_total,
            "failed": failed,
            "total_commits": total_matching,
            "progress_percent": round(pct, 2),
        })
        try:
            # Add a summary of cache / HTTP metrics to help tuning
            metrics_payload = {
                "gitlab_cache_hits": shared.gitlab_cache_hits,
                "gitlab_cache_misses": shared.gitlab_cache_misses,
                "gitlab_size_fetches": shared.gitlab_size_fetches,
                "svn_cache_hits": shared.svn_cache_hits,
                "svn_cache_misses": shared.svn_cache_misses,
                "svn_size_fetches": shared.svn_size_fetches,
                "svn_cat_cache_hits": shared.svn_cat_cache_hits,
                "svn_cat_cache_misses": shared.svn_cat_cache_misses,
                "svn_cat_fetches": shared.svn_cat_fetches,
                "svn_cat_failures": shared.svn_cat_failures,
                "svn_semaphore_waits": shared.svn_semaphore_waits,
                "svn_max_concurrency": shared.svn_semaphore_limit,
                "svn_active_peak_run": shared.svn_active_peak_run,
                "svn_active_peak_interval": shared.svn_active_peak_interval,
                "repo_files_cache_hits": shared.repo_files_cache_hits,
                "repo_files_cache_misses": shared.repo_files_cache_misses,
            }
            log_message(connection, run_id, "INFO", "Ingest metrics summary", metrics_payload)
        except Exception:
            pass

        # Always try to update repo stats at the end of a run
        try:
            run_repo_stats_update(config)
        except Exception:
            pass

        # Flush any buffered run logs at the very end
        try:
            flush_log_buffer(connection, force=True)
            connection.commit()
        except Exception:
            pass
    except Exception as exc:  # pragma: no cover
        connection.rollback()
        finalize_run(connection, run_id, "failed", processed, failed, str(exc))
        log_message(connection, run_id, "ERROR", "Global files ingest aborted", {"error": str(exc)})
        raise
    finally:
        if gitlab_session:
            gitlab_session.close()
        if shared and shared.executor:
            try:
                shared.executor.shutdown(wait=False)
            except Exception:
                pass
        # If dry-run, explicitly rollback any uncommitted changes and restore commit
        try:
            if config.dry_run:
                try:
                    connection.rollback()
                except Exception:
                    pass
                if real_commit:
                    try:
                        connection.commit = real_commit
                    except Exception:
                        pass
        except Exception:
            pass
        connection.close()



    return 0 if failed == 0 else 1


def run_deduplication(config: IngestConfig, run_id: Optional[int] = None) -> bool:
    """Run the deduplication script automatically after ingestion.

    Returns True on success, False on failure. Failure does not raise so the
    caller can decide how to finalize the Stage B run.
    """
    LOGGER.info("Starting auto-deduplication...")
    try:
        # Construct command relative to this script
        script_dir = os.path.dirname(os.path.abspath(__file__))
        dedupe_script = os.path.join(script_dir, "deduplicate_repo_files.py")

        cmd = [
            sys.executable,
            dedupe_script,
            "--db-host", config.db_host,
            "--db-port", str(config.db_port),
            "--db-user", config.db_user,
            "--db-password", config.db_password,
            "--db-name", config.db_name,
            "--triggered-by", "auto_after_ingest"
        ]
        if run_id:
            cmd.extend(["--run-id", str(run_id)])

        # Run synchronously
        subprocess.run(cmd, check=True)
        LOGGER.info("Auto-deduplication completed successfully.")
        return True
    except subprocess.CalledProcessError as e:
        LOGGER.error(f"Auto-deduplication failed with exit code {e.returncode}")
        return False
    except Exception as e:
        LOGGER.error(f"Auto-deduplication failed: {e}")
        return False


def run_repo_stats_update(config: IngestConfig) -> bool:
    """Trigger the repo stats update via API or direct DB call if local.
    Since we are in the script, we can just run the SQL directly to avoid API round-trip issues.
    """
    LOGGER.info("Starting repo stats update...")
    try:
        connection = mysql.connector.connect(
            host=config.db_host,
            port=config.db_port,
            user=config.db_user,
            password=config.db_password,
            database=config.db_name,
            autocommit=True,
        )
        try:
            cursor = connection.cursor()
            query = """
            UPDATE repo_catalog r
            JOIN (
                SELECT repo_catalog_id, COUNT(*) as cnt
                FROM repo_commits
                WHERE files_ingested = 1
                GROUP BY repo_catalog_id
            ) c ON r.id = c.repo_catalog_id
            SET r.ingested_commits = c.cnt
            WHERE r.is_valid = 1
            """
            cursor.execute(query)
            LOGGER.info(f"Repo stats updated. Rows affected: {cursor.rowcount}")
        finally:
            connection.close()
        return True
    except Exception as e:
        LOGGER.error(f"Repo stats update failed: {e}")
        return False


if __name__ == "__main__":
    sys.exit(main())
