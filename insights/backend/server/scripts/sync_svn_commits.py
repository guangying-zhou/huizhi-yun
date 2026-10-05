#!/usr/bin/env python3
"""Incrementally ingest SVN commit history into repo_commits tables."""

from __future__ import annotations

import argparse
import datetime as dt
import json
import logging
import os
import subprocess

try:
    from server.python_service.config import Config
except ImportError:
    import sys
    sys.path.append(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))))
    from server.python_service.config import Config
import sys
from dataclasses import dataclass, asdict, field
import hashlib
from typing import Dict, Iterable, List, Optional, Sequence, Tuple


PROGRESS_INTERVAL = max(1, int(os.environ.get("SYNC_PROGRESS_INTERVAL", "50")))
DEFAULT_MAX_DIFF_BYTES = 512 * 1024

try:
    import mysql.connector  # type: ignore
except ImportError as exc:  # pragma: no cover - import guard
    raise SystemExit(
        "mysql-connector-python is required. Install via 'pip install mysql-connector-python'"
    ) from exc

LOGGER = logging.getLogger(__name__)
BINARY_EXTENSIONS = (".png", ".jpg", ".jpeg", ".gif", ".bmp", ".ico", ".zip", ".jar", ".war", ".class", ".pdf")


@dataclass
@dataclass
class SyncConfig:
    svn_root: str
    db_host: str
    db_port: int
    db_user: str
    db_password: str
    db_name: str
    target_year: Optional[int] = None
    max_diff_bytes: int = DEFAULT_MAX_DIFF_BYTES
    include_invalid: bool = False
    include_invalid: bool = False


@dataclass
class Repo:
    id: int
    repo_key: str
    repo_path: str


@dataclass
class CommitData:
    revision: str
    author: Optional[str]
    committed_at: dt.datetime
    title: Optional[str]
    message: Optional[str]
    files: List[Tuple[str, str]]  # (change_type, path)
    parent_revisions: List[str]
    diffs: Dict[str, FileDiff]


@dataclass
class FileDiff:
    text: Optional[str]
    is_truncated: bool = False


@dataclass
class RepoSyncStatus:
    repo_key: str
    status: str
    processed_commits: int
    failed_commits: int
    message: Optional[str] = None


@dataclass
class SyncResult:
    repositories: List[RepoSyncStatus]
    total_commits_processed: int
    total_commits_failed: int
    run_ids: List[int] = field(default_factory=list)


def _coerce_bool(value: Optional[object]) -> Optional[bool]:
    if value is None:
        return None
    if isinstance(value, bool):
        return value
    if isinstance(value, (int, float)):
        return bool(value)
    if isinstance(value, str):
        lowered = value.strip().lower()
        if lowered in {"1", "true", "yes", "on"}:
            return True
        if lowered in {"0", "false", "no", "off"}:
            return False
    return None


def config_from_environment(overrides: Optional[Dict[str, object]] = None) -> SyncConfig:
    overrides = overrides or {}

    def _value(key: str, env_key: str, default: Optional[str] = None) -> Optional[str]:
        value = overrides.get(key)
        if value is None:
            value = os.environ.get(env_key, default)
        return value

    svn_root = _value("svn_root", "SVN_ROOT_PATH", Config.SVN_ROOT_PATH)
    db_host = _value("db_host", "DB_HOST", Config.DB_HOST)
    db_port_raw = overrides.get("db_port", os.environ.get("DB_PORT", str(Config.DB_PORT)))
    db_user = _value("db_user", "DB_USER", Config.DB_USER)
    db_password = _value("db_password", "DB_PASSWORD", Config.DB_PASSWORD)
    db_name = _value("db_name", "DB_NAME", Config.DB_NAME)
    max_diff_bytes_raw = overrides.get("max_diff_bytes", os.environ.get("SVN_MAX_DIFF_BYTES"))
    max_diff_bytes = DEFAULT_MAX_DIFF_BYTES
    if max_diff_bytes_raw is not None:
        try:
            candidate = int(max_diff_bytes_raw)
            if candidate > 0:
                max_diff_bytes = candidate
        except (TypeError, ValueError):
            pass
    year_raw = overrides.get("year", os.environ.get("SYNC_YEAR"))
    include_invalid_raw = overrides.get("include_invalid", os.environ.get("SYNC_INCLUDE_INACTIVE"))
    include_invalid = _coerce_bool(include_invalid_raw)
    if include_invalid is None:
        include_invalid = Config.SYNC_INCLUDE_INACTIVE

    target_year: Optional[int] = None
    if year_raw:
        try:
            target_year = int(year_raw)
        except ValueError:
            pass

    return SyncConfig(
        svn_root=str(svn_root or "/home/wiztek/svn"),
        db_host=str(db_host or "127.0.0.1"),
        db_port=int(db_port_raw) if db_port_raw is not None else 3306,
        db_user=str(db_user or "root"),
        db_password=str(db_password or ""),
        db_name=str(db_name or "codeinsightdb"),
        target_year=target_year,
        max_diff_bytes=max_diff_bytes,
        include_invalid=include_invalid if include_invalid is not None else False,
    )


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def run_svnlook(repo_path: str, *args: str) -> str:
    cmd = ["svnlook", *args, repo_path]
    result = subprocess.run(
        cmd,
        check=True,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        text=True,
        encoding="utf-8",
        errors="replace",
    )
    return result.stdout.strip()


def svn_file_size(repo_path: str, revision: str, path: str) -> Optional[int]:
    if not path:
        return None
    cmd = ["svnlook", "filesize", "-r", revision, repo_path, path]
    try:
        result = subprocess.run(
            cmd,
            check=True,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
            encoding="utf-8",
            errors="replace",
        )
    except subprocess.CalledProcessError:
        return None
    output = result.stdout.strip()
    if not output:
        return None
    try:
        return int(output)
    except ValueError:
        return None


HEADER_PREFIXES = ("Index:", "Added:", "Modified:", "Deleted:")


def collect_svn_diffs(repo_path: str, revision: int, max_bytes: int) -> Dict[str, FileDiff]:
    """Stream svnlook diff output and truncate per-file payloads to avoid OOM."""
    cmd = ["svnlook", "diff", "-r", str(revision), repo_path]
    process = subprocess.Popen(
        cmd,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        text=True,
        encoding="utf-8",
        errors="replace",
        bufsize=1,
    )

    diffs: Dict[str, FileDiff] = {}
    current_path: Optional[str] = None
    current_lines: List[str] = []
    current_size = 0
    truncated = False
    limit = max(1024, max_bytes)

    def flush() -> None:
        nonlocal current_path, current_lines, truncated
        if current_path is None:
            return
        text = "".join(current_lines).rstrip("\n") if current_lines else None
        diffs[current_path] = FileDiff(text=text, is_truncated=truncated or text is None)
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
            # Always drain the stream even if truncated to avoid buffering
        flush()
    finally:
        if process.stdout:
            process.stdout.close()
    stderr_output = process.stderr.read() if process.stderr else ""
    returncode = process.wait()
    if process.stderr:
        process.stderr.close()
    if returncode != 0:
        raise subprocess.CalledProcessError(returncode, cmd, output=None, stderr=stderr_output)

    return diffs


def parse_svn_date(raw: str) -> dt.datetime:
    cleaned = raw.split(" (")[0].strip()
    aware = dt.datetime.strptime(cleaned, "%Y-%m-%d %H:%M:%S %z")
    return aware.astimezone().replace(tzinfo=None)


def find_first_revision_on_or_after(repo_path: str, target: dt.datetime, youngest: int) -> Optional[int]:
    low = 1
    high = youngest
    candidate: Optional[int] = None
    while low <= high:
        mid = (low + high) // 2
        mid_date = parse_svn_date(run_svnlook(repo_path, "date", "-r", str(mid)))
        if mid_date >= target:
            candidate = mid
            high = mid - 1
        else:
            low = mid + 1
    return candidate


def find_last_revision_before(repo_path: str, target: dt.datetime, youngest: int) -> Optional[int]:
    low = 1
    high = youngest
    candidate: Optional[int] = None
    while low <= high:
        mid = (low + high) // 2
        mid_date = parse_svn_date(run_svnlook(repo_path, "date", "-r", str(mid)))
        if mid_date < target:
            candidate = mid
            low = mid + 1
        else:
            high = mid - 1
    return candidate


def list_repositories(
    connection,
    repo_ids: Optional[Sequence[int]] = None,
    *,
    include_invalid: bool = False,
) -> List[Repo]:
    base_query = (
        "SELECT id, repo_key, repo_path FROM repo_catalog WHERE source_type = 'svn'"
        " AND repo_path IS NOT NULL"
    )
    params: List[object] = []
    # Always filter is_valid=1 unless explicitly overridden via include_invalid
    if not include_invalid:
        base_query += " AND is_valid = 1"
    if repo_ids:
        placeholders = ",".join(["%s"] * len(repo_ids))
        base_query += f" AND id IN ({placeholders})"
        params.extend(repo_ids)
    cursor = connection.cursor()
    cursor.execute(base_query, params)
    repos = [Repo(id=row[0], repo_key=row[1], repo_path=row[2]) for row in cursor.fetchall()]
    cursor.close()
    return repos


def latest_stored_revision(connection, repo_id: int) -> Optional[int]:
    cursor = connection.cursor()
    cursor.execute(
        "SELECT revision FROM repo_commits WHERE repo_catalog_id = %s "
        "ORDER BY CAST(revision AS UNSIGNED) DESC LIMIT 1",
        (repo_id,),
    )
    row = cursor.fetchone()
    cursor.close()
    if not row:
        return None
    try:
        return int(row[0])
    except (TypeError, ValueError):
        return None


def latest_revision_for_year(connection, repo_id: int, year: int) -> Optional[int]:
    cursor = connection.cursor()
    cursor.execute(
        "SELECT CAST(revision AS UNSIGNED) FROM repo_commits WHERE repo_catalog_id = %s AND commit_year = %s "
        "ORDER BY CAST(revision AS UNSIGNED) DESC LIMIT 1",
        (repo_id, year),
    )
    row = cursor.fetchone()
    cursor.close()
    if not row or row[0] is None:
        return None
    try:
        return int(row[0])
    except (TypeError, ValueError):
        return None


def count_repo_commits(connection, repo_id: int) -> int:
    cursor = connection.cursor()
    cursor.execute(
        "SELECT COUNT(*) FROM repo_commits WHERE repo_catalog_id = %s",
        (repo_id,),
    )
    row = cursor.fetchone()
    cursor.close()
    return int(row[0] or 0)


def count_repo_commits_for_year(connection, repo_id: int, year: int) -> int:
    cursor = connection.cursor()
    cursor.execute(
        "SELECT COUNT(*) FROM repo_commits WHERE repo_catalog_id = %s AND commit_year = %s",
        (repo_id, year),
    )
    row = cursor.fetchone()
    cursor.close()
    return int(row[0] or 0)


def refresh_repo_commit_counters(
    connection,
    repo_id: int,
    year: Optional[int],
    *,
    total_override: Optional[int] = None,
) -> None:
    total = total_override if total_override is not None else count_repo_commits(connection, repo_id)
    year_total = 0
    if year is not None:
        year_total = count_repo_commits_for_year(connection, repo_id, year)

    synced_count = count_repo_commits(connection, repo_id)

    cursor = connection.cursor()
    cursor.execute(
        "UPDATE repo_catalog SET total_commits=%s, current_commit_year=%s, current_year_commits=%s, synced_commits=%s "
        "WHERE id=%s",
        (total, year, year_total if year is not None else 0, synced_count, repo_id),
    )
    cursor.close()


def create_run(connection, repo: Optional[Repo], job_type: str, params: Optional[dict] = None) -> int:
    cursor = connection.cursor()
    cursor.execute(
        "INSERT INTO ingestion_runs (job_type, source_type, repo_catalog_id, repo_key, status, started_at, params) "
        "VALUES (%s, %s, %s, %s, 'running', NOW(6), %s)",
        (
            job_type,
            "svn",
            repo.id if repo else None,
            repo.repo_key if repo else None,
            json.dumps(params or {}, ensure_ascii=False),
        ),
    )
    run_id = cursor.lastrowid
    connection.commit()
    cursor.close()
    return run_id


def finalize_run(
    connection,
    run_id: int,
    status: str,
    processed: int,
    failed: int,
    error_message: Optional[str],
) -> None:
    cursor = connection.cursor()
    cursor.execute(
        "UPDATE ingestion_runs SET status=%s, finished_at=NOW(6), "
        "items_processed=%s, items_failed=%s, error_message=%s WHERE id=%s",
        (status, processed, failed, error_message, run_id),
    )
    connection.commit()
    cursor.close()


def insert_run_log(connection, run_id: int, level: str, message: str, context=None) -> None:
    if level.upper() == "DEBUG":
        return
    cursor = connection.cursor()
    cursor.execute(
        "INSERT INTO ingestion_run_logs (ingestion_run_id, log_level, message, context) "
        "VALUES (%s, %s, %s, %s)",
        (run_id, level, message, json.dumps(context, ensure_ascii=False) if context else None),
    )
    connection.commit()
    cursor.close()


def normalize_changed_path(raw_path: str) -> str:
    cleaned = (raw_path or "").strip()
    if cleaned.startswith("+ "):
        cleaned = cleaned[2:].strip()
    if "(from " in cleaned:
        cleaned = cleaned.split("(from ", 1)[0].strip()
    return cleaned


def fetch_commit(repo: Repo, revision: int, max_diff_bytes: int, *, include_diffs: bool = True) -> CommitData:
    author = run_svnlook(repo.repo_path, "author", "-r", str(revision)) or None
    date_raw = run_svnlook(repo.repo_path, "date", "-r", str(revision))
    committed_at = parse_svn_date(date_raw)
    message = run_svnlook(repo.repo_path, "log", "-r", str(revision)) or None
    title = None
    if message:
        title = message.splitlines()[0][:512]
    changed = run_svnlook(repo.repo_path, "changed", "-r", str(revision))
    files: List[Tuple[str, str]] = []
    for line in changed.splitlines():
        line = line.strip()
        if not line:
            continue
        parts = line.split(None, 1)
        if len(parts) == 1:
            change, path = parts[0], ""
        else:
            change, path = parts
        files.append((change[0], normalize_changed_path(path)))
    parent_rev = str(revision - 1) if revision > 0 else None
    parents = [parent_rev] if parent_rev else []
    file_diffs = collect_svn_diffs(repo.repo_path, revision, max_diff_bytes) if include_diffs else {}
    return CommitData(
        revision=str(revision),
        author=author,
        committed_at=committed_at,
        title=title,
        message=message,
        files=files,
        parent_revisions=parents,
        diffs=file_diffs,
    )


def store_commit_metadata(connection, repo: Repo, commit: CommitData) -> int:
    """Store only the commit row (Stage A: metadata). Returns new commit id."""
    cursor = connection.cursor()
    cursor.execute(
        "INSERT INTO repo_commits "
        "(repo_catalog_id, source_type, repo_key, revision, parent_revisions, author_name, committed_at, title, message, raw_metadata, "
        "files_added, lines_added, lines_deleted, lines_modified, commit_sequence) "
        "VALUES (%s, 'svn', %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)",
        (
            repo.id,
            repo.repo_key,
            commit.revision,
            json.dumps(commit.parent_revisions, ensure_ascii=False) if commit.parent_revisions else None,
            commit.author,
            commit.committed_at,
            commit.title,
            commit.message,
            None,
            None,
            None,
            None,
            None,
            commit.revision,  # Use revision as commit_sequence for SVN
        ),
    )
    commit_id = cursor.lastrowid
    cursor.close()
    return int(commit_id)


def update_repo_catalog(connection, repo: Repo, latest_rev: str, committed_at: dt.datetime) -> None:
    cursor = connection.cursor()
    cursor.execute(
        "UPDATE repo_catalog SET latest_revision=%s, latest_commit_at=%s, last_scanned_at=NOW(6) "
        "WHERE id=%s",
        (latest_rev, committed_at, repo.id),
    )
    cursor.close()


# ---------------------------------------------------------------------------
# Main logic
# ---------------------------------------------------------------------------


def load_config(argv: Optional[Iterable[str]] = None) -> SyncConfig:
    parser = argparse.ArgumentParser(description="Sync SVN commits into database")
    parser.add_argument(
        "--svn-root",
        default=os.environ.get("SVN_ROOT_PATH", "/home/wiztek/svn"),
        help="Root directory containing SVN repositories",
    )
    parser.add_argument("--db-host", default=os.environ.get("DB_HOST", "127.0.0.1"))
    parser.add_argument("--db-port", type=int, default=int(os.environ.get("DB_PORT", "3306")))
    parser.add_argument("--db-user", default=os.environ.get("DB_USER", "root"))
    parser.add_argument(
        "--db-password",
        default=os.environ.get("DB_PASSWORD", "Wiztek@1902"),
    )
    parser.add_argument("--db-name", default=os.environ.get("DB_NAME", "codeinsightdb"))
    parser.add_argument("--log-level", default=os.environ.get("LOG_LEVEL", "INFO"))
    parser.add_argument(
        "--max-diff-bytes",
        type=int,
        default=int(os.environ.get("SVN_MAX_DIFF_BYTES", str(DEFAULT_MAX_DIFF_BYTES))),
        help="Maximum diff payload retained per file when capturing svnlook diffs",
    )
    # Year argument removed: always sync across all years (incremental)
    parser.add_argument(
        "--include-invalid",
        action="store_true",
        help="Include repositories that are marked invalid",
    )

    args = parser.parse_args(list(argv) if argv is not None else None)

    try:
        from log_utils import configure_logging
    except ImportError:
        from server.scripts.log_utils import configure_logging

    configure_logging(args.log_level)

    overrides = {
        "svn_root": args.svn_root,
        "db_host": args.db_host,
        "db_port": args.db_port,
        "db_user": args.db_user,
        "db_password": args.db_password,
        "db_name": args.db_name,
        "max_diff_bytes": args.max_diff_bytes,
    # no year filtering
        "include_invalid": args.include_invalid,
    }

    return config_from_environment(overrides)


def main(argv: Optional[Iterable[str]] = None) -> int:
    config = load_config(argv)
    result = run(config)
    return 0 if result.total_commits_failed == 0 else 1


def run(config: SyncConfig, repo_catalog_ids: Optional[Sequence[int]] = None) -> SyncResult:
    connection = mysql.connector.connect(
        host=config.db_host,
        port=config.db_port,
        user=config.db_user,
        password=config.db_password,
        database=config.db_name,
        autocommit=False,
    )

    statuses: List[RepoSyncStatus] = []
    total_processed = 0
    total_failed = 0
    run_ids: List[int] = []

    try:
        LOGGER.info(
            "SVN sync configuration resolved (include_invalid=%s, repo_filter=%s)",
            config.include_invalid,
            repo_catalog_ids or "all",
        )
        if repo_catalog_ids:
            LOGGER.info("Restricting SVN sync to repo IDs: %s", list(repo_catalog_ids))
        elif not config.include_invalid:
            LOGGER.info("Sync limited to active SVN repositories")
        repos = list_repositories(connection, repo_catalog_ids, include_invalid=config.include_invalid)
        LOGGER.info("Found %d SVN repositories", len(repos))
        if not repos:
            return SyncResult(
                repositories=[],
                total_commits_processed=0,
                total_commits_failed=0,
                run_ids=[],
            )
        # Year window removed: always perform incremental sync since last stored revision

        for repo in repos:
            stats_year_value = dt.datetime.now().year
            LOGGER.info(
                "[%s] Starting sync (repo_id=%s)",
                repo.repo_key,
                repo.id,
            )
            repo_status = RepoSyncStatus(
                repo_key=repo.repo_key,
                status="skipped",
                processed_commits=0,
                failed_commits=0,
                message=None,
            )
            if not os.path.isdir(repo.repo_path):
                LOGGER.error("Repository path does not exist: %s", repo.repo_path)
                repo_status.status = "failed"
                repo_status.message = "Repository path missing"
                statuses.append(repo_status)
                continue
            run_id = create_run(connection, repo, "commit_sync", None)
            run_ids.append(run_id)
            processed = 0
            failed = 0
            try:
                latest_stored = latest_stored_revision(connection, repo.id)
                youngest = int(run_svnlook(repo.repo_path, "youngest"))
                start_rev = (latest_stored or 0) + 1
                end_rev = youngest
                if start_rev > end_rev:
                    insert_run_log(connection, run_id, "INFO", "No new revisions", {"youngest": youngest})
                    finalize_run(connection, run_id, "success", 0, 0, None)
                    insert_run_log(
                        connection,
                        run_id,
                        "INFO",
                        "Sync completed",
                        {"processed": 0, "failed": 0, "status": "success"},
                    )
                    refresh_repo_commit_counters(
                        connection,
                        repo.id,
                        stats_year_value,
                        total_override=youngest,
                    )
                    connection.commit()
                    repo_status.status = "success"
                    continue

                assert start_rev is not None and end_rev is not None
                total = end_rev - start_rev + 1
                LOGGER.info(
                    "[%s] Syncing revisions %d-%d (%d total)",
                    repo.repo_key,
                    start_rev,
                    end_rev,
                    total,
                )
                insert_run_log(
                    connection,
                    run_id,
                    "INFO",
                    "Sync started",
                    {
                        "start_revision": start_rev,
                        "end_revision": end_rev,
                        "total": total,
                    },
                )
                latest_revision_str: Optional[str] = None
                latest_commit_time: Optional[dt.datetime] = None
                for revision in range(start_rev, end_rev + 1):
                    try:
                        commit = fetch_commit(repo, revision, config.max_diff_bytes, include_diffs=False)
                        store_commit_metadata(connection, repo, commit)
                        processed += 1
                        latest_revision_str = commit.revision
                        latest_commit_time = commit.committed_at
                        connection.commit()
                        if processed % PROGRESS_INTERVAL == 0 or revision == end_rev:
                            LOGGER.info(
                                "[%s] Processed revision %s (%d/%d)",
                                repo.repo_key,
                                commit.revision,
                                processed,
                                total,
                            )
                            insert_run_log(
                                connection,
                                run_id,
                                "INFO",
                                "Revision processed",
                                {
                                    "revision": commit.revision,
                                    "processed": processed,
                                    "total": total,
                                },
                            )
                    except subprocess.CalledProcessError as exc:
                        failed += 1
                        connection.rollback()
                        insert_run_log(
                            connection,
                            run_id,
                            "ERROR",
                            f"svnlook failed for revision {revision}",
                            {"stderr": exc.stderr.strip(), "returncode": exc.returncode},
                        )
                    except Exception as exc:  # pylint: disable=broad-except
                        failed += 1
                        connection.rollback()
                        insert_run_log(
                            connection,
                            run_id,
                            "ERROR",
                            f"Error processing revision {revision}",
                            {"error": str(exc)},
                        )
                if processed and latest_revision_str and latest_commit_time:
                    update_repo_catalog(connection, repo, latest_revision_str, latest_commit_time)
                refresh_repo_commit_counters(
                    connection,
                    repo.id,
                    stats_year_value,
                    total_override=youngest,
                )
                connection.commit()
                status_text = "success" if failed == 0 else "failed"
                finalize_run(connection, run_id, status_text, processed, failed, None)
                insert_run_log(
                    connection,
                    run_id,
                    "INFO" if failed == 0 else "WARNING",
                    "Sync completed",
                    {
                        "processed": processed,
                        "failed": failed,
                        "latest_revision": latest_revision_str,
                        "status": status_text,
                    },
                )
                LOGGER.info(
                    "[%s] Sync finished: processed=%d failed=%d",
                    repo.repo_key,
                    processed,
                    failed,
                )
                repo_status.status = "success"
            except Exception as exc:  # pylint: disable=broad-except
                connection.rollback()
                failed += 1
                insert_run_log(
                    connection,
                    run_id,
                    "ERROR",
                    "Repository processing failed",
                    {"error": str(exc)},
                )
                finalize_run(connection, run_id, "failed", processed, failed, str(exc))
                insert_run_log(
                    connection,
                    run_id,
                    "ERROR",
                    "Sync completed with failure",
                    {
                        "processed": processed,
                        "failed": failed,
                        "status": "failed",
                        "error": str(exc),
                    },
                )
                repo_status.status = "failed"
                repo_status.message = str(exc)
            finally:
                repo_status.processed_commits = processed
                repo_status.failed_commits = failed
                statuses.append(repo_status)
                total_processed += processed
                total_failed += failed
        LOGGER.info("SVN commit sync complete")
    finally:
        connection.close()

    return SyncResult(
        repositories=statuses,
        total_commits_processed=total_processed,
        total_commits_failed=total_failed,
        run_ids=run_ids,
    )


# ---------------------------------------------------------------------------
# Stage B: files ingest with dedupe
# ---------------------------------------------------------------------------





def result_to_dict(result: SyncResult) -> Dict[str, object]:
    payload = asdict(result)
    payload["runIds"] = payload.pop("run_ids", [])
    return payload


if __name__ == "__main__":
    sys.exit(main())
