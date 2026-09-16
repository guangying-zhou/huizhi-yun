#!/usr/bin/env python3
"""Incrementally ingest GitLab commits into repo_commits tables."""

from __future__ import annotations

import argparse
import hashlib
import hashlib
import datetime as dt
import json
import logging
import os
import sys
from dataclasses import dataclass, asdict, field
from typing import Dict, Iterable, Iterator, List, Optional, Sequence, Tuple
from urllib.parse import quote


PROGRESS_INTERVAL = max(1, int(os.environ.get("SYNC_PROGRESS_INTERVAL", "50")))

import requests

try:
    from server.python_service.config import Config
except ImportError:
    import sys
    sys.path.append(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))))
    from server.python_service.config import Config

try:
    import mysql.connector  # type: ignore
    from mysql.connector import IntegrityError  # type: ignore
except ImportError as exc:  # pragma: no cover - import guard
    raise SystemExit(
        "mysql-connector-python is required. Install via 'pip install mysql-connector-python'"
    ) from exc

    from server.python_service.config import Config

try:
    import mysql.connector  # type: ignore
    from mysql.connector import IntegrityError  # type: ignore
except ImportError as exc:  # pragma: no cover - import guard
    raise SystemExit(
        "mysql-connector-python is required. Install via 'pip install mysql-connector-python'"
    ) from exc

LOGGER = logging.getLogger(__name__)


@dataclass
@dataclass
class SyncConfig:
    gitlab_url: str
    gitlab_token: str
    db_host: str
    db_port: int
    db_user: str
    db_password: str
    db_name: str
    request_timeout: int = 30
    per_page: int = 100
    target_year: Optional[int] = None  # deprecated: no year filtering; always process all
    include_invalid: bool = False
    include_invalid: bool = False


@dataclass
class Repo:
    id: int
    repo_key: str
    project_id: int
    default_branch: Optional[str]


@dataclass
class CommitPayload:
    commit: Dict
    diffs: List[Dict]


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

    gitlab_url = _value("gitlab_url", "GITLAB_URL", Config.GITLAB_URL)
    gitlab_token = _value("gitlab_token", "GITLAB_TOKEN", Config.GITLAB_TOKEN)
    db_host = _value("db_host", "DB_HOST", Config.DB_HOST)
    db_port_raw = overrides.get("db_port", os.environ.get("DB_PORT", str(Config.DB_PORT)))
    db_user = _value("db_user", "DB_USER", Config.DB_USER)
    db_password = _value("db_password", "DB_PASSWORD", Config.DB_PASSWORD)
    db_name = _value("db_name", "DB_NAME", Config.DB_NAME)
    per_page = overrides.get("per_page")
    request_timeout = overrides.get("request_timeout")
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

    config = SyncConfig(
        gitlab_url=str(gitlab_url or "http://localhost"),
        gitlab_token=str(gitlab_token or ""),
        db_host=str(db_host or "127.0.0.1"),
        db_port=int(db_port_raw) if db_port_raw is not None else 3306,
        db_user=str(db_user or "root"),
        db_password=str(db_password or ""),
        db_name=str(db_name or "codeinsightdb"),
        per_page=int(per_page) if per_page is not None else 100,
        request_timeout=int(request_timeout)
        if request_timeout is not None
        else 30,
        target_year=target_year,
        include_invalid=include_invalid if include_invalid is not None else False,
    )

    if not config.gitlab_token:
        raise ValueError("GitLab token is required to sync commits")

    return config


# ---------------------------------------------------------------------------
# Database helpers
# ---------------------------------------------------------------------------


def list_repositories(
    connection,
    repo_ids: Optional[Sequence[int]] = None,
    *,
    include_invalid: bool = False,
) -> List[Repo]:
    # Always filter is_valid=1 unless explicitly overridden via include_invalid.
    base_query = (
        "SELECT id, repo_key, gitlab_project_id, default_branch "
        "FROM repo_catalog WHERE source_type='gitlab' AND gitlab_project_id IS NOT NULL"
    )
    params: List[object] = []
    if not include_invalid:
        base_query += " AND is_valid = 1"
    if repo_ids:
        placeholders = ",".join(["%s"] * len(repo_ids))
        base_query += f" AND id IN ({placeholders})"
        params.extend(repo_ids)
    cursor = connection.cursor()
    cursor.execute(base_query, params)
    repos = [
        Repo(
            id=row[0],
            repo_key=row[1],
            project_id=int(row[2]),
            default_branch=row[3],
        )
        for row in cursor.fetchall()
    ]
    cursor.close()
    return repos


def latest_stored_commit(connection, repo_id: int) -> Optional[dt.datetime]:
    cursor = connection.cursor()
    cursor.execute(
        "SELECT committed_at FROM repo_commits WHERE repo_catalog_id = %s "
        "ORDER BY committed_at DESC LIMIT 1",
        (repo_id,),
    )
    row = cursor.fetchone()
    cursor.close()
    if not row or row[0] is None:
        return None
    return row[0]


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


def fetch_project_commit_count(
    session: requests.Session,
    config: SyncConfig,
    repo: Repo,
) -> Optional[int]:
    base = config.gitlab_url.rstrip("/")
    url = f"{base}/api/v4/projects/{repo.project_id}/repository/commits"
    # Use all=true to get count across all branches
    params = {"per_page": "1", "all": "true"}
    response = session.get(url, params=params, timeout=config.request_timeout)
    # 404 is handled by caller
    if response.status_code != 200:
        response.raise_for_status()
    
    total_raw = response.headers.get("X-Total") or response.headers.get("X-Total-Count")
    if total_raw is None:
        return None
    try:
        return int(total_raw)
    except (TypeError, ValueError):
        LOGGER.warning("[%s] Unable to parse X-Total=%s", repo.repo_key, total_raw)
        return None


def latest_commit_for_year(connection, repo_id: int, year: int) -> Optional[dt.datetime]:
    cursor = connection.cursor()
    cursor.execute(
        "SELECT committed_at FROM repo_commits WHERE repo_catalog_id = %s AND commit_year = %s "
        "ORDER BY committed_at DESC LIMIT 1",
        (repo_id, year),
    )
    row = cursor.fetchone()
    cursor.close()
    if not row or row[0] is None:
        return None
    return row[0]


def commit_exists(connection, repo_id: int, revision: str) -> bool:
    cursor = connection.cursor()
    cursor.execute(
        "SELECT 1 FROM repo_commits WHERE repo_catalog_id=%s AND revision=%s LIMIT 1",
        (repo_id, revision),
    )
    row = cursor.fetchone()
    cursor.close()
    return bool(row)


def latest_commit_sequence(connection, repo_id: int) -> int:
    """Return the maximum commit_sequence for a repository, or 0 if none."""
    cursor = connection.cursor()
    cursor.execute(
        "SELECT MAX(commit_sequence) FROM repo_commits WHERE repo_catalog_id = %s",
        (repo_id,),
    )
    row = cursor.fetchone()
    cursor.close()
    return int(row[0]) if row and row[0] is not None else 0


def create_run(connection, repo: Optional[Repo], job_type: str, params: Optional[dict] = None) -> int:
    cursor = connection.cursor()
    cursor.execute(
        "INSERT INTO ingestion_runs (job_type, source_type, repo_catalog_id, repo_key, status, started_at, params) "
        "VALUES (%s, %s, %s, %s, 'running', NOW(6), %s)",
        (
            job_type,
            "gitlab",
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


def mark_repo_invalid(connection, repo: "Repo") -> None:
    """Mark a repo_catalog entry invalid (is_valid=0)."""
    cur = connection.cursor()
    try:
        cur.execute(
            "UPDATE repo_catalog SET is_valid=0, last_scanned_at=NOW(6) WHERE id=%s",
            (repo.id,),
        )
        connection.commit()
    finally:
        cur.close()


def store_commit(
    connection,
    session: requests.Session,
    config: SyncConfig,
    repo: Repo,
    payload: CommitPayload,
    commit_sequence: Optional[int] = None,
) -> Optional[dt.datetime]:
    commit = payload.commit
    diffs = payload.diffs

    committed_at = parse_gitlab_datetime(commit.get("committed_date") or commit.get("created_at"))

    cursor = connection.cursor()
    try:
        cursor.execute(
            "INSERT INTO repo_commits "
            "(repo_catalog_id, source_type, repo_key, revision, commit_sequence, parent_revisions, author_name, author_email, "
            "committer_name, committer_email, committed_at, title, message, "
            "files_added, lines_added, lines_deleted, lines_modified, raw_metadata) "
            "VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)",
            (
                repo.id,
                "gitlab",
                repo.repo_key,
                commit["id"],
                commit_sequence if commit_sequence is not None else 0,
                json.dumps(commit.get("parent_ids", []), ensure_ascii=False),
                commit.get("author_name"),
                commit.get("author_email"),
                commit.get("committer_name"),
                commit.get("committer_email"),
                committed_at,
                commit.get("title"),
                commit.get("message"),
                None, # files_added approximation or None? Gitlab API stats are lines usually.
                # Actually Gitlab commit stats are additions, deletions, total.
                # files_added is not directly provided in simple commit object usually, unless detailed.
                # But here we are just syncing metadata.
                # The original code passed None for files_added, files_deleted, files_modified.
                # So we pass None for files_added.
                commit.get("stats", {}).get("additions"),
                commit.get("stats", {}).get("deletions"),
                0, # lines_modified - gitlab doesn't give this directly
                json.dumps(asdict(payload), ensure_ascii=False)
            ),
        )
    except IntegrityError:
        connection.rollback()
        cursor.close()
        return None
    commit_id = cursor.lastrowid

    cursor.close()
    return committed_at






def update_repo_catalog(connection, repo: Repo, revision: str, committed_at: dt.datetime) -> None:
    cursor = connection.cursor()
    cursor.execute(
        "UPDATE repo_catalog SET latest_revision=%s, latest_commit_at=%s, last_scanned_at=NOW(6) "
        "WHERE id=%s",
        (revision, committed_at, repo.id),
    )
    cursor.close()


# ---------------------------------------------------------------------------
# GitLab helpers
# ---------------------------------------------------------------------------


def parse_gitlab_datetime(raw: Optional[str]) -> Optional[dt.datetime]:
    if not raw:
        return None
    cleaned = raw.replace("Z", "+00:00")
    try:
        aware = dt.datetime.fromisoformat(cleaned)
    except ValueError:
        LOGGER.warning("Unable to parse datetime: %s", raw)
        return None
    if aware.tzinfo is None:
        aware = aware.replace(tzinfo=dt.timezone.utc)
    return aware.astimezone().replace(tzinfo=None)


def _to_gitlab_iso(dt_value: dt.datetime) -> str:
    if dt_value.tzinfo is None:
        local_tz = dt.datetime.now().astimezone().tzinfo or dt.timezone.utc
        dt_value = dt_value.replace(tzinfo=local_tz)
    return dt_value.astimezone(dt.timezone.utc).isoformat().replace("+00:00", "Z")


def iter_commits(
    session: requests.Session,
    config: SyncConfig,
    repo: Repo,
    since_time: Optional[dt.datetime],
    until_time: Optional[dt.datetime],
) -> Iterator[Dict]:
    base = config.gitlab_url.rstrip("/")
    url = f"{base}/api/v4/projects/{repo.project_id}/repository/commits"
    params: Dict[str, str] = {
        "per_page": str(config.per_page),
        # "ref_name": repo.default_branch or "main",  <-- Removed to allow fetching from ALL refs
        "with_stats": "true",
        "all": "true",
    }
    if since_time:
        since_with_buffer = since_time - dt.timedelta(seconds=5)
        params["since"] = _to_gitlab_iso(since_with_buffer)
    if until_time:
        params["until"] = _to_gitlab_iso(until_time)

    page = 1
    while True:
        params["page"] = str(page)
        response = session.get(url, params=params, timeout=config.request_timeout)
        if response.status_code != 200:
            raise RuntimeError(
                f"GitLab API error {response.status_code}: {response.text[:200]}"
            )
        commits = response.json()
        if not commits:
            break
        for commit in commits:
            yield commit
        next_page = response.headers.get("X-Next-Page")
        if not next_page:
            break
        page = int(next_page)


def fetch_commit_payload(session: requests.Session, config: SyncConfig, repo: Repo, sha: str) -> CommitPayload:
    """Fetch commit metadata only (diffs are fetched by ingest script)."""
    base = config.gitlab_url.rstrip("/")
    detail_url = f"{base}/api/v4/projects/{repo.project_id}/repository/commits/{sha}"
    params = {"stats": "true"}
    detail_resp = session.get(detail_url, params=params, timeout=config.request_timeout)
    if detail_resp.status_code != 200:
        raise RuntimeError(
            f"Failed to fetch commit detail {sha}: {detail_resp.text[:200]}"
        )
    commit = detail_resp.json()
    # Note: diffs are not fetched here - they are fetched by ingest_commit_files.py
    return CommitPayload(commit=commit, diffs=[])


def fetch_gitlab_file_size(
    session: requests.Session,
    config: SyncConfig,
    project_id: int,
    path: Optional[str],
    ref: Optional[str],
    cache: Dict[Tuple[str, str], Optional[int]],
) -> Optional[int]:
    if not path or not ref:
        return None
    key = (ref, path)
    if key in cache:
        return cache[key]

    base = config.gitlab_url.rstrip("/")
    encoded_path = quote(path, safe="")
    url = f"{base}/api/v4/projects/{project_id}/repository/files/{encoded_path}"
    resp = session.get(url, params={"ref": ref}, timeout=config.request_timeout)
    if resp.status_code == 200:
        data = resp.json()
        size_val = data.get("size")
        cache[key] = size_val
        return size_val
    if resp.status_code == 404:
        cache[key] = None
        return None
    raise RuntimeError(
        f"Unable to fetch file size for {path}@{ref} (status {resp.status_code}): {resp.text[:200]}"
    )


def classify_change(diff: Dict) -> str:
    if diff.get("new_file"):
        return "A"
    if diff.get("deleted_file"):
        return "D"
    if diff.get("renamed_file"):
        return "R"
    return "M"


# ---------------------------------------------------------------------------
# Main logic
# ---------------------------------------------------------------------------


def load_config(argv: Optional[Iterable[str]] = None) -> SyncConfig:
    parser = argparse.ArgumentParser(description="Sync GitLab commits into database")
    parser.add_argument("--gitlab-url", default=os.environ.get("GITLAB_URL", "http://localhost"))
    parser.add_argument("--gitlab-token", default=os.environ.get("GITLAB_TOKEN"))
    parser.add_argument("--db-host", default=os.environ.get("DB_HOST", "127.0.0.1"))
    parser.add_argument("--db-port", type=int, default=int(os.environ.get("DB_PORT", "3306")))
    parser.add_argument("--db-user", default=os.environ.get("DB_USER", "root"))
    parser.add_argument("--db-password", default=os.environ.get("DB_PASSWORD", "Wiztek@1902"))
    parser.add_argument("--db-name", default=os.environ.get("DB_NAME", "codeinsightdb"))
    parser.add_argument("--log-level", default=os.environ.get("LOG_LEVEL", "INFO"))
    # Year argument removed: always sync across all years (incremental)
    parser.add_argument(
        "--include-invalid",
        action="store_true",
        help="Include repositories marked invalid",
    )

    args = parser.parse_args(list(argv) if argv is not None else None)

    logging.basicConfig(level=args.log_level.upper(), format="%(asctime)s %(levelname)s %(message)s")

    overrides = {
        "gitlab_url": args.gitlab_url,
        "gitlab_token": args.gitlab_token,
        "db_host": args.db_host,
        "db_port": args.db_port,
        "db_user": args.db_user,
        "db_password": args.db_password,
        "db_name": args.db_name,
    # no year filtering
        "include_invalid": args.include_invalid,
    }

    try:
        return config_from_environment(overrides)
    except ValueError as exc:
        parser.error(str(exc))


def main(argv: Optional[Iterable[str]] = None) -> int:
    config = load_config(argv)
    result = run(config)
    return 0 if result.total_commits_failed == 0 else 1


def run(config: SyncConfig, repo_catalog_ids: Optional[Sequence[int]] = None) -> SyncResult:
    session = requests.Session()
    session.headers.update({"PRIVATE-TOKEN": config.gitlab_token})

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
            "GitLab sync configuration resolved (include_invalid=%s, repo_filter=%s)",
            config.include_invalid,
            repo_catalog_ids or "all",
        )
        if repo_catalog_ids:
            LOGGER.info("Restricting GitLab sync to repo IDs: %s", list(repo_catalog_ids))
        elif not config.include_invalid:
            LOGGER.info("Sync limited to active GitLab repositories")
        repos = list_repositories(connection, repo_catalog_ids, include_invalid=config.include_invalid)
        LOGGER.info("Found %d GitLab repositories to sync", len(repos))
        if not repos:
            return SyncResult(
                repositories=[],
                total_commits_processed=0,
                total_commits_failed=0,
                run_ids=[],
            )
        # Year window removed

        for repo in repos:
            stats_year_value = dt.datetime.now().year
            LOGGER.info(
                "[%s] Starting sync (repo_id=%s)",
                repo.repo_key,
                repo.id,
            )
            commit_count_override: Optional[int] = None
            try:
                commit_count_override = fetch_project_commit_count(session, config, repo)
            except requests.HTTPError as exc:  # type: ignore[attr-defined]
                status = getattr(exc.response, "status_code", None)
                text = getattr(exc.response, "text", str(exc))
                if status == 404:
                    # Project not found: mark invalid and short-circuit this repository
                    run_id = create_run(connection, repo, "commit_sync", None)
                    run_ids.append(run_id)
                    insert_run_log(
                        connection,
                        run_id,
                        "WARNING",
                        "GitLab project not found — marking repository invalid",
                        {"status": status, "detail": (text[:200] if isinstance(text, str) else str(text))},
                    )
                    mark_repo_invalid(connection, repo)
                    finalize_run(connection, run_id, "success", 0, 0, None)
                    insert_run_log(connection, run_id, "INFO", "Sync completed", {"processed": 0, "failed": 0, "status": "success"})
                    # Move to next repo
                    repo_status = RepoSyncStatus(repo_key=repo.repo_key, status="success", processed_commits=0, failed_commits=0)
                    statuses.append(repo_status)
                    continue
                LOGGER.warning("[%s] Failed to fetch project statistics: %s", repo.repo_key, exc)
            except Exception as exc:  # pylint: disable=broad-except
                LOGGER.warning(
                    "[%s] Failed to fetch project statistics: %s",
                    repo.repo_key,
                    exc,
                )
            run_id = create_run(connection, repo, "commit_sync", None)
            run_ids.append(run_id)
            processed = 0
            failed = 0
            repo_status = RepoSyncStatus(
                repo_key=repo.repo_key,
                status="running",
                processed_commits=0,
                failed_commits=0,
                message=None,
            )
            try:
                since_time: Optional[dt.datetime]
                until_time: Optional[dt.datetime]
                # Always incremental since last stored commit; no year window
                since_time = latest_stored_commit(connection, repo.id)
                until_time = None
                log_since = since_time.isoformat() if since_time else "beginning"
                LOGGER.info(
                    "[%s] Fetching commits since %s",
                    repo.repo_key,
                    log_since,
                )
                insert_run_log(
                    connection,
                    run_id,
                    "INFO",
                    "Sync started",
                    {
                        "since": log_since,
                        "branch": repo.default_branch,
                    },
                )
                fetched_commits: List[CommitPayload] = []
                try:
                    for commit_summary in iter_commits(session, config, repo, since_time, until_time):
                        sha = commit_summary.get("id")
                        if not sha:
                            continue
                        if commit_exists(connection, repo.id, sha):
                            continue
                        try:
                            payload = fetch_commit_payload(session, config, repo, sha)
                        except Exception as exc:  # pylint: disable=broad-except
                            failed += 1
                            insert_run_log(
                                connection,
                                run_id,
                                "ERROR",
                                f"Failed to fetch commit {sha}",
                                {"error": str(exc)},
                            )
                            continue
                        fetched_commits.append(payload)
                except RuntimeError as exc:
                    msg = str(exc)
                    if "GitLab API error 404" in msg or "status 404" in msg or "404 Project Not Found" in msg:
                        insert_run_log(
                            connection,
                            run_id,
                            "WARNING",
                            "GitLab project unavailable (404) — marking repository invalid",
                            {"error": msg[:200]},
                        )
                        mark_repo_invalid(connection, repo)
                        finalize_run(connection, run_id, "success", 0, failed, None)
                        insert_run_log(
                            connection,
                            run_id,
                            "INFO",
                            "Sync completed",
                            {"processed": 0, "failed": failed, "status": "success"},
                        )
                        refresh_repo_commit_counters(connection, repo.id, stats_year_value)
                        connection.commit()
                        repo_status.status = "success"
                        repo_status.message = "Marked invalid due to 404"
                        continue
                    # Unknown runtime error: re-raise to outer handler
                    raise

                if not fetched_commits:
                    insert_run_log(
                        connection,
                        run_id,
                        "INFO",
                        "No new commits detected",
                        None,
                    )
                    finalize_run(connection, run_id, "success", 0, failed, None)
                    insert_run_log(
                        connection,
                        run_id,
                        "INFO",
                        "Sync completed",
                        {"processed": 0, "failed": failed, "status": "success"},
                    )
                    refresh_repo_commit_counters(
                        connection,
                        repo.id,
                        stats_year_value,
                        total_override=commit_count_override,
                    )
                    connection.commit()
                    repo_status.status = "success"
                    continue

                fetched_commits.sort(key=lambda item: parse_gitlab_datetime(item.commit.get("committed_date") or item.commit.get("created_at")) or dt.datetime.min)
                total = len(fetched_commits)
                LOGGER.info("[%s] Processing %d commits", repo.repo_key, total)
                insert_run_log(
                    connection,
                    run_id,
                    "INFO",
                    "Commits fetched",
                    {"count": total, "year": config.target_year},
                )

                latest_revision: Optional[str] = None
                latest_committed_at: Optional[dt.datetime] = None
                # obtain latest commit_sequence and increment for each stored commit in this batch
                seq = latest_commit_sequence(connection, repo.id)
                for payload in fetched_commits:
                    try:
                        seq += 1
                        committed_dt = store_commit(connection, session, config, repo, payload, commit_sequence=seq)
                        if committed_dt is None:
                            continue
                        latest_revision = payload.commit.get("id")
                        latest_committed_at = committed_dt
                        processed += 1
                        connection.commit()
                        if processed % PROGRESS_INTERVAL == 0 or processed == total:
                            LOGGER.info(
                                "[%s] Stored commit %s (%d/%d)",
                                repo.repo_key,
                                latest_revision,
                                processed,
                                total,
                            )
                            insert_run_log(
                                connection,
                                run_id,
                                "INFO",
                                "Commit stored",
                                {
                                    "revision": latest_revision,
                                    "processed": processed,
                                    "total": total,
                                },
                            )
                    except Exception as exc:  # pylint: disable=broad-except
                        failed += 1
                        connection.rollback()
                        insert_run_log(
                            connection,
                            run_id,
                            "ERROR",
                            f"Failed to store commit {payload.commit.get('id')}",
                            {"error": str(exc)},
                        )

                if processed and latest_revision and latest_committed_at:
                    update_repo_catalog(connection, repo, latest_revision, latest_committed_at)
                refresh_repo_commit_counters(
                    connection,
                    repo.id,
                    stats_year_value,
                    total_override=commit_count_override,
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
                        "latest_revision": latest_revision,
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
                        "year": config.target_year,
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
        LOGGER.info("GitLab commit sync complete")
    finally:
        connection.close()
        session.close()

    return SyncResult(
        repositories=statuses,
        total_commits_processed=total_processed,
        total_commits_failed=total_failed,
        run_ids=run_ids,
    )


def result_to_dict(result: SyncResult) -> Dict[str, object]:
    payload = asdict(result)
    payload["runIds"] = payload.pop("run_ids", [])
    return payload


if __name__ == "__main__":
    sys.exit(main())
