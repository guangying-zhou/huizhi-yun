#!/usr/bin/env python3
"""Unified repository catalog scanner.

Reads active sources from repo_sources table and scans each based on source_type.
Supports GitLab (API) and SVN (filesystem) sources.
"""

from __future__ import annotations

import argparse
import datetime as dt
import json
import logging
import os
import subprocess
import sys
from dataclasses import dataclass, asdict, field
from typing import Dict, Iterable, Iterator, List, Optional

import requests
from requests.adapters import HTTPAdapter
from urllib3.util.retry import Retry

try:
    from server.python_service.config import Config as AppConfig
except ImportError:
    sys.path.append(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))))
    from server.python_service.config import Config as AppConfig

try:
    import mysql.connector
except ImportError as exc:
    raise SystemExit("mysql-connector-python required: pip install mysql-connector-python") from exc


LOGGER = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# Data Classes
# ---------------------------------------------------------------------------

@dataclass
class RepoSource:
    """Represents a row from repo_sources table."""
    id: int
    source_name: str
    source_type: str  # GITLAB, SVN, GIT, GITHUB, GITEE
    repos_base: Optional[str]
    credential_ref: Optional[str]

    @property
    def credential(self) -> Optional[str]:
        """Resolve credential_ref to actual value via Config."""
        return AppConfig.get_credential(self.credential_ref) if self.credential_ref else None


@dataclass
class RepoRecord:
    """Represents a repository to be upserted into repo_catalog."""
    repo_key: str
    name: str
    source_type: str
    repo_source_id: int
    repo_path: Optional[str] = None
    description: Optional[str] = None
    default_branch: Optional[str] = None
    repo_created_at: Optional[dt.datetime] = None
    latest_revision: Optional[str] = None
    latest_commit_at: Optional[dt.datetime] = None
    visibility: Optional[str] = None
    gitlab_project_id: Optional[int] = None
    extra: Optional[Dict] = None
    scan_status: str = "pending"
    failure_reason: Optional[str] = None


@dataclass
class SourceScanStatus:
    source_id: int
    source_name: str
    source_type: str
    status: str
    processed: int
    succeeded: int
    failed: int
    updated_repo_ids: List[int] = field(default_factory=list)


@dataclass
class ScanResult:
    sources: List[SourceScanStatus]
    total_processed: int
    total_succeeded: int
    total_failed: int
    run_id: Optional[int] = None


@dataclass
class ScriptConfig:
    db_host: str
    db_port: int
    db_user: str
    db_password: str
    db_name: str
    source_id: Optional[int] = None
    source_type: Optional[str] = None
    per_page: int = 100
    request_timeout: int = 30


# ---------------------------------------------------------------------------
# Database Helpers
# ---------------------------------------------------------------------------

def get_connection(config: ScriptConfig):
    return mysql.connector.connect(
        host=config.db_host,
        port=config.db_port,
        user=config.db_user,
        password=config.db_password,
        database=config.db_name,
        autocommit=False,
    )


def fetch_active_sources(connection, source_id: Optional[int] = None, source_type: Optional[str] = None) -> List[RepoSource]:
    """Load active sources from repo_sources table."""
    query = """
        SELECT id, source_name, source_type, repos_base, credential_ref
        FROM repo_sources
        WHERE is_active = 1 AND sync_enabled = 1
    """
    params: List = []
    if source_id is not None:
        query += " AND id = %s"
        params.append(source_id)
    if source_type is not None:
        query += " AND source_type = %s"
        params.append(source_type.upper())

    cursor = connection.cursor()
    cursor.execute(query, params)
    rows = cursor.fetchall()
    cursor.close()

    return [
        RepoSource(
            id=row[0],
            source_name=row[1],
            source_type=row[2],
            repos_base=row[3],
            credential_ref=row[4],
        )
        for row in rows
    ]


def create_run(connection, source: Optional[RepoSource], job_type: str = "catalog_scan") -> int:
    cursor = connection.cursor()
    params = json.dumps(
        {"source_id": source.id if source else None, "source_name": source.source_name if source else "all"},
        ensure_ascii=False,
    )
    cursor.execute(
        "INSERT INTO ingestion_runs (job_type, source_type, status, started_at, params) "
        "VALUES (%s, %s, 'running', NOW(6), %s)",
        (job_type, source.source_type.lower() if source else "mixed", params),
    )
    run_id = cursor.lastrowid
    connection.commit()
    cursor.close()
    return run_id


def insert_run_log(connection, run_id: int, level: str, message: str, context: Optional[dict] = None) -> None:
    if level.upper() == "DEBUG":
        return
    cursor = connection.cursor()
    cursor.execute(
        "INSERT INTO ingestion_run_logs (ingestion_run_id, log_level, message, context) VALUES (%s, %s, %s, %s)",
        (run_id, level, message, json.dumps(context, ensure_ascii=False) if context else None),
    )
    connection.commit()
    cursor.close()


def finalize_run(connection, run_id: int, status: str, processed: int, succeeded: int, failed: int, error_message: Optional[str]) -> None:
    cursor = connection.cursor()
    cursor.execute(
        "UPDATE ingestion_runs SET status=%s, finished_at=NOW(6), items_total=%s, items_processed=%s, items_failed=%s, error_message=%s WHERE id=%s",
        (status, processed, succeeded, failed, error_message, run_id),
    )
    connection.commit()
    cursor.close()


def update_source_last_synced(connection, source_id: int) -> None:
    """Update last_synced_at timestamp for a repo_source after scanning."""
    cursor = connection.cursor()
    cursor.execute(
        "UPDATE repo_sources SET last_synced_at = NOW(6) WHERE id = %s",
        (source_id,),
    )
    connection.commit()
    cursor.close()


def fetch_repo_catalog_id(connection, source_type: str, repo_key: str) -> Optional[int]:
    cursor = connection.cursor()
    cursor.execute(
        "SELECT id FROM repo_catalog WHERE source_type=%s AND repo_key=%s LIMIT 1",
        (source_type.lower(), repo_key),
    )
    row = cursor.fetchone()
    cursor.close()
    return int(row[0]) if row else None


def existing_revision_map(connection, source_type: str) -> Dict[str, str]:
    cursor = connection.cursor()
    cursor.execute(
        "SELECT repo_key, latest_revision FROM repo_catalog WHERE source_type = %s",
        (source_type.lower(),),
    )
    rows = cursor.fetchall()
    cursor.close()
    return {row[0]: row[1] for row in rows if row[1] is not None}


def upsert_repo(connection, record: RepoRecord) -> None:
    """Insert or update a repo_catalog row."""
    cursor = connection.cursor()

    # Check if exists
    cursor.execute(
        "SELECT id FROM repo_catalog WHERE source_type=%s AND repo_key=%s",
        (record.source_type.lower(), record.repo_key),
    )
    row = cursor.fetchone()

    if row:
        # Update
        sql = """
            UPDATE repo_catalog SET
                name = %s,
                description = %s,
                default_branch = %s,
                repo_created_at = COALESCE(%s, repo_created_at),
                latest_revision = COALESCE(%s, latest_revision),
                latest_commit_at = COALESCE(%s, latest_commit_at),
                last_scanned_at = NOW(6),
                scan_status = %s,
                failure_reason = %s,
                repo_path = %s,
                gitlab_project_id = %s,
                visibility = %s,
                extra = %s,
                repo_source_id = %s
            WHERE id = %s
        """
        cursor.execute(sql, (
            record.name,
            record.description,
            record.default_branch,
            record.repo_created_at,
            record.latest_revision,
            record.latest_commit_at,
            record.scan_status,
            record.failure_reason,
            record.repo_path,
            record.gitlab_project_id,
            record.visibility,
            json.dumps(record.extra, ensure_ascii=False) if record.extra else None,
            record.repo_source_id,
            row[0],
        ))
    else:
        # Insert
        sql = """
            INSERT INTO repo_catalog
            (source_type, repo_key, name, description, default_branch, repo_created_at,
             latest_revision, latest_commit_at, last_scanned_at, scan_status, failure_reason,
             repo_path, gitlab_project_id, visibility, extra, repo_source_id, is_valid)
            VALUES (%s, %s, %s, %s, %s, %s, %s, %s, NOW(6), %s, %s, %s, %s, %s, %s, %s, 1)
        """
        cursor.execute(sql, (
            record.source_type.lower(),
            record.repo_key,
            record.name,
            record.description,
            record.default_branch,
            record.repo_created_at,
            record.latest_revision,
            record.latest_commit_at,
            record.scan_status,
            record.failure_reason,
            record.repo_path,
            record.gitlab_project_id,
            record.visibility,
            json.dumps(record.extra, ensure_ascii=False) if record.extra else None,
            record.repo_source_id,
        ))
    cursor.close()


def load_thresholds(connection) -> tuple:
    """Load minimum_commits and minimum_days from system_parameters."""
    cursor = connection.cursor()
    cursor.execute(
        "SELECT param_key, param_value FROM system_parameters WHERE param_key IN ('minimum_commits','minimum_days')"
    )
    rows = cursor.fetchall()
    cursor.close()
    min_commits, min_days = 10, 30
    for key, value in rows:
        try:
            if key == "minimum_commits":
                min_commits = int(value)
            elif key == "minimum_days":
                min_days = int(value)
        except Exception:
            pass
    return min_commits, min_days


def compute_is_valid(now: dt.datetime, min_commits: int, min_days: int, repo_created_at, latest_commit_at, total_commits) -> int:
    return 1  # Always valid per user request


def update_repo_validity(connection, repo_catalog_id: Optional[int], now: dt.datetime, thresholds: tuple) -> None:
    if repo_catalog_id is None:
        return
    min_commits, min_days = thresholds
    cursor = connection.cursor()
    cursor.execute(
        "SELECT repo_created_at, latest_commit_at, total_commits FROM repo_catalog WHERE id = %s",
        (repo_catalog_id,),
    )
    row = cursor.fetchone()
    if row:
        is_valid = compute_is_valid(now, min_commits, min_days, row[0], row[1], row[2])
        cursor.execute("UPDATE repo_catalog SET is_valid = %s WHERE id = %s", (is_valid, repo_catalog_id))
    cursor.close()


# ---------------------------------------------------------------------------
# GitLab Scanner
# ---------------------------------------------------------------------------

def parse_iso_datetime(raw: Optional[str]) -> Optional[dt.datetime]:
    if not raw:
        return None
    cleaned = raw.replace("Z", "+00:00")
    try:
        aware = dt.datetime.fromisoformat(cleaned)
    except ValueError:
        return None
    if aware.tzinfo is None:
        aware = aware.replace(tzinfo=dt.timezone.utc)
    return aware.astimezone().replace(tzinfo=None)


def iter_gitlab_projects(session: requests.Session, base_url: str, group_id: Optional[str], per_page: int, timeout: int) -> Iterator[dict]:
    """Iterate over GitLab projects."""
    base = base_url.rstrip("/")
    if group_id:
        url = f"{base}/api/v4/groups/{group_id}/projects"
        params = {"include_subgroups": "true", "per_page": per_page, "statistics": "true"}
    else:
        url = f"{base}/api/v4/projects"
        params = {"membership": "true", "per_page": per_page, "statistics": "true"}

    page = 1
    while True:
        params["page"] = page
        response = session.get(url, params=params, timeout=timeout)
        if response.status_code != 200:
            raise RuntimeError(f"GitLab API error {response.status_code}: {response.text[:200]}")
        projects = response.json()
        if not projects:
            break
        for project in projects:
            yield project
        next_page = response.headers.get("X-Next-Page")
        if not next_page:
            break
        page = int(next_page)


def fetch_gitlab_commit_and_count(session: requests.Session, base_url: str, project_id: int, branch: Optional[str], timeout: int) -> tuple:
    """Fetch latest commit and total count for a GitLab project."""
    base = base_url.rstrip("/")
    url = f"{base}/api/v4/projects/{project_id}/repository/commits"
    params = {"per_page": 1, "all": "true"}
    # Valid keys are 'per_page' and 'all'. We do NOT set 'ref_name' so we get global stats.
    # if branch:
    #    params["ref_name"] = branch
    response = session.get(url, params=params, timeout=timeout)
    if response.status_code != 200:
        return None, None
    total_raw = response.headers.get("X-Total") or response.headers.get("X-Total-Count")
    total_commits = int(total_raw) if total_raw else None
    data = response.json()
    if isinstance(data, list) and data:
        return data[0], total_commits
    return None, total_commits


def _resolve_gitlab_user_dept(connection, session, base_url: str, gitlab_user_id: int, cache: dict) -> Optional[int]:
    """Resolve a GitLab user ID to an org_departments.id via Account uid mapping."""
    if gitlab_user_id in cache:
        return cache[gitlab_user_id]

    dept_id = None
    try:
        base = base_url.rstrip("/")
        resp = session.get(f"{base}/api/v4/users/{gitlab_user_id}", timeout=10)
        if resp.status_code == 200:
            username = resp.json().get("username")
            if username:
                dept_id = _lookup_dept_by_username(connection, username)
    except Exception:
        pass

    cache[gitlab_user_id] = dept_id
    return dept_id


def _lookup_dept_by_username(connection, username: str) -> Optional[int]:
    """Look up department_id from org_persons by username or account_uid."""
    cursor = connection.cursor()
    cursor.execute(
        "SELECT department_id FROM org_persons WHERE account_uid = %s OR username = %s LIMIT 1",
        (username, username),
    )
    row = cursor.fetchone()
    cursor.close()
    return row[0] if row and row[0] else None


def _resolve_project_owner_dept(connection, session, base_url: str, project_id: int, cache: dict) -> Optional[int]:
    """Resolve a GitLab project's owner (access_level=50) to an org_departments.id.

    Fetches project members, finds the Owner (excluding bot), then looks up their department.
    """
    cache_key = f"proj_{project_id}"
    if cache_key in cache:
        return cache[cache_key]

    dept_id = None
    bot_username = AppConfig.GITLAB_BOT_USERNAME
    try:
        base = base_url.rstrip("/")
        resp = session.get(f"{base}/api/v4/projects/{project_id}/members/all", params={"per_page": 100}, timeout=15)
        if resp.status_code == 200:
            members = resp.json()
            # Find Owner (access_level=50), excluding bot
            owner = next(
                (m for m in members if m.get("access_level") == 50 and m.get("username") != bot_username),
                None
            )
            if owner:
                username = owner.get("username")
                if username:
                    dept_id = _lookup_dept_by_username(connection, username)
                    LOGGER.debug("Project %s owner=%s dept_id=%s", project_id, username, dept_id)
    except Exception as exc:
        LOGGER.debug("Failed to resolve owner for project %s: %s", project_id, exc)

    cache[cache_key] = dept_id
    return dept_id


def scan_gitlab_source(connection, source: RepoSource, config: ScriptConfig, run_id: int) -> SourceScanStatus:
    """Scan a GitLab source."""
    LOGGER.info("[%s] Starting GitLab scan: %s", source.source_name, source.repos_base)

    credential = source.credential
    if not credential:
        LOGGER.error("[%s] No credential found for %s", source.source_name, source.credential_ref)
        return SourceScanStatus(
            source_id=source.id, source_name=source.source_name, source_type=source.source_type,
            status="failed", processed=0, succeeded=0, failed=0
        )

    session = requests.Session()
    session.headers.update({"PRIVATE-TOKEN": credential})
    retry_strategy = Retry(total=3, status_forcelist=[429, 500, 502, 503, 504], backoff_factor=1)
    adapter = HTTPAdapter(max_retries=retry_strategy)
    session.mount("http://", adapter)
    session.mount("https://", adapter)

    processed, succeeded, failed = 0, 0, 0
    updated_repo_ids: List[int] = []
    thresholds = load_thresholds(connection)
    prev_map = existing_revision_map(connection, "gitlab")

    # Try to get group_id from extra config or use Config default
    group_id = AppConfig.GITLAB_GROUP_ID or None

    # Cache for GitLab user ID -> department_id mapping
    _user_dept_cache: Dict[int, Optional[int]] = {}

    try:
        for project in iter_gitlab_projects(session, source.repos_base, group_id, config.per_page, config.request_timeout):
            repo_key = project.get("path_with_namespace") or str(project["id"])
            processed += 1

            try:
                record = RepoRecord(
                    repo_key=repo_key,
                    name=project.get("name") or repo_key,
                    source_type="gitlab",
                    repo_source_id=source.id,
                    gitlab_project_id=project["id"],
                    description=project.get("description"),
                    default_branch=project.get("default_branch"),
                    visibility=project.get("visibility"),
                    repo_path=project.get("ssh_url_to_repo") or project.get("http_url_to_repo"),
                    repo_created_at=parse_iso_datetime(project.get("created_at")),
                    extra={"web_url": project.get("web_url"), "namespace": project.get("namespace", {}).get("full_path")},
                )

                commit, total_commits = fetch_gitlab_commit_and_count(
                    session, source.repos_base, project["id"], record.default_branch, config.request_timeout
                )

                # Fallback to statistics if zero/None (e.g. X-Total header missing)
                if not total_commits:
                    stats_count = project.get("statistics", {}).get("commit_count")
                    if stats_count:
                        total_commits = int(stats_count)
                if commit:
                    record.latest_revision = commit.get("id") or commit.get("short_id")
                    record.latest_commit_at = parse_iso_datetime(commit.get("committed_date"))
                else:
                    record.latest_commit_at = parse_iso_datetime(project.get("last_activity_at"))
                    record.latest_revision = prev_map.get(repo_key)

                record.scan_status = "success"
                upsert_repo(connection, record)

                repo_catalog_id = fetch_repo_catalog_id(connection, "gitlab", repo_key)

                # Assign department_id from project owner if repo has no department
                if repo_catalog_id:
                    cursor = connection.cursor()
                    cursor.execute("SELECT department_id FROM repo_catalog WHERE id = %s", (repo_catalog_id,))
                    dept_row = cursor.fetchone()
                    cursor.close()
                    if dept_row and not dept_row[0]:
                        # Try owner (access_level=50) first, fallback to creator
                        dept_id = _resolve_project_owner_dept(connection, session, source.repos_base, project["id"], _user_dept_cache)
                        if not dept_id:
                            creator_id = project.get("creator_id")
                            if creator_id:
                                dept_id = _resolve_gitlab_user_dept(connection, session, source.repos_base, creator_id, _user_dept_cache)
                        if dept_id:
                            cursor = connection.cursor()
                            cursor.execute("UPDATE repo_catalog SET department_id = %s WHERE id = %s", (dept_id, repo_catalog_id))
                            cursor.close()
                            LOGGER.debug("[%s] Assigned department_id=%s to repo %s",
                                         source.source_name, dept_id, repo_key)

                if repo_catalog_id and total_commits:
                    cursor = connection.cursor()
                    cursor.execute("UPDATE repo_catalog SET total_commits = %s WHERE id = %s", (total_commits, repo_catalog_id))
                    cursor.close()

                # update_repo_validity(connection, repo_catalog_id, dt.datetime.now(), thresholds)

                prev_rev = prev_map.get(repo_key)
                if record.latest_revision and (not prev_rev or record.latest_revision != prev_rev):
                    if repo_catalog_id:
                        updated_repo_ids.append(repo_catalog_id)

                succeeded += 1
                insert_run_log(connection, run_id, "INFO", "Project scanned", {"repo_key": repo_key, "project_id": project["id"]})

            except Exception as exc:
                failed += 1
                LOGGER.exception("Failed to scan project %s", repo_key)
                insert_run_log(connection, run_id, "ERROR", f"Project scan failed: {repo_key}", {"error": str(exc)})

            if processed % 10 == 0:
                LOGGER.info("[%s] Processed %d projects...", source.source_name, processed)

        connection.commit()

    except Exception as exc:
        LOGGER.exception("[%s] GitLab scan aborted", source.source_name)
        insert_run_log(connection, run_id, "ERROR", f"GitLab scan aborted: {source.source_name}", {"error": str(exc)})
        return SourceScanStatus(
            source_id=source.id, source_name=source.source_name, source_type=source.source_type,
            status="failed", processed=processed, succeeded=succeeded, failed=failed, updated_repo_ids=updated_repo_ids
        )
    finally:
        session.close()

    LOGGER.info("[%s] GitLab scan complete: processed=%d succeeded=%d failed=%d", source.source_name, processed, succeeded, failed)
    return SourceScanStatus(
        source_id=source.id, source_name=source.source_name, source_type=source.source_type,
        status="success" if failed == 0 else "partial", processed=processed, succeeded=succeeded, failed=failed, updated_repo_ids=updated_repo_ids
    )


# ---------------------------------------------------------------------------
# SVN Scanner
# ---------------------------------------------------------------------------

def run_svnlook(repo_path: str, *args: str) -> str:
    cmd = ["svnlook", *args, repo_path]
    result = subprocess.run(cmd, check=True, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
    return result.stdout.strip()


def parse_svn_date(raw: str) -> Optional[dt.datetime]:
    if not raw:
        return None
    cleaned = raw.split(" (")[0].strip()
    try:
        aware = dt.datetime.strptime(cleaned, "%Y-%m-%d %H:%M:%S %z")
    except ValueError:
        return None
    return aware.astimezone().replace(tzinfo=None)


def is_svn_repository(path: str) -> bool:
    return os.path.isfile(os.path.join(path, "format")) and os.path.isdir(os.path.join(path, "db"))


def discover_svn_repositories(root: str) -> List[str]:
    repos: List[str] = []
    for current, dirnames, _ in os.walk(root):
        if is_svn_repository(current):
            repos.append(current)
            dirnames.clear()
        else:
            dirnames[:] = [d for d in dirnames if not d.startswith(".")]
    return repos


def fetch_svn_repo_created_at(repo_path: str) -> Optional[dt.datetime]:
    for revision in ("0", "1"):
        try:
            raw_date = run_svnlook(repo_path, "date", "-r", revision)
            created_at = parse_svn_date(raw_date)
            if created_at:
                return created_at
        except subprocess.CalledProcessError:
            continue
    return None


def scan_svn_source(connection, source: RepoSource, config: ScriptConfig, run_id: int) -> SourceScanStatus:
    """Scan an SVN source."""
    svn_root = source.repos_base
    LOGGER.info("[%s] Starting SVN scan: %s", source.source_name, svn_root)

    if not svn_root or not os.path.isdir(svn_root):
        LOGGER.error("[%s] SVN root does not exist: %s", source.source_name, svn_root)
        return SourceScanStatus(
            source_id=source.id, source_name=source.source_name, source_type=source.source_type,
            status="failed", processed=0, succeeded=0, failed=0
        )

    repos = discover_svn_repositories(svn_root)
    LOGGER.info("[%s] Found %d SVN repositories", source.source_name, len(repos))

    processed, succeeded, failed = 0, 0, 0
    updated_repo_ids: List[int] = []
    thresholds = load_thresholds(connection)
    prev_map = existing_revision_map(connection, "svn")

    for repo_path in repos:
        repo_key = os.path.relpath(repo_path, svn_root)
        if repo_key == ".":
            repo_key = os.path.basename(repo_path)
        processed += 1

        try:
            record = RepoRecord(
                repo_key=repo_key,
                name=os.path.basename(repo_path),
                source_type="svn",
                repo_source_id=source.id,
                repo_path=repo_path,
            )

            record.repo_created_at = fetch_svn_repo_created_at(repo_path)
            youngest = run_svnlook(repo_path, "youngest")
            record.latest_revision = youngest

            raw_date = run_svnlook(repo_path, "date", "-r", youngest)
            record.latest_commit_at = parse_svn_date(raw_date)
            record.scan_status = "success"

            upsert_repo(connection, record)

            repo_catalog_id = fetch_repo_catalog_id(connection, "svn", repo_key)
            if repo_catalog_id and record.latest_revision:
                try:
                    cursor = connection.cursor()
                    cursor.execute("UPDATE repo_catalog SET total_commits = %s WHERE id = %s", (int(record.latest_revision), repo_catalog_id))
                    cursor.close()
                except Exception:
                    pass

            # update_repo_validity(connection, repo_catalog_id, dt.datetime.now(), thresholds)

            prev_rev = prev_map.get(repo_key)
            if record.latest_revision and (not prev_rev or record.latest_revision != prev_rev):
                if repo_catalog_id:
                    updated_repo_ids.append(repo_catalog_id)

            succeeded += 1
            insert_run_log(connection, run_id, "INFO", "Repository scanned", {"repo_key": repo_key})

        except subprocess.CalledProcessError as exc:
            failed += 1
            LOGGER.error("svnlook failed for %s: %s", repo_path, exc.stderr)
            insert_run_log(connection, run_id, "ERROR", f"SVN scan failed: {repo_key}", {"error": exc.stderr})
        except Exception as exc:
            failed += 1
            LOGGER.exception("Unexpected error scanning %s", repo_path)
            insert_run_log(connection, run_id, "ERROR", f"SVN scan failed: {repo_key}", {"error": str(exc)})

        if processed % 10 == 0:
            LOGGER.info("[%s] Processed %d/%d repositories", source.source_name, processed, len(repos))

    connection.commit()
    LOGGER.info("[%s] SVN scan complete: processed=%d succeeded=%d failed=%d", source.source_name, processed, succeeded, failed)

    return SourceScanStatus(
        source_id=source.id, source_name=source.source_name, source_type=source.source_type,
        status="success" if failed == 0 else "partial", processed=processed, succeeded=succeeded, failed=failed, updated_repo_ids=updated_repo_ids
    )


# ---------------------------------------------------------------------------
# Main Entry Point
# ---------------------------------------------------------------------------

def load_config(argv: Optional[Iterable[str]] = None) -> ScriptConfig:
    parser = argparse.ArgumentParser(description="Unified repository scanner")
    parser.add_argument("--db-host", default=os.environ.get("DB_HOST", AppConfig.DB_HOST))
    parser.add_argument("--db-port", type=int, default=int(os.environ.get("DB_PORT", AppConfig.DB_PORT)))
    parser.add_argument("--db-user", default=os.environ.get("DB_USER", AppConfig.DB_USER))
    parser.add_argument("--db-password", default=os.environ.get("DB_PASSWORD", AppConfig.DB_PASSWORD))
    parser.add_argument("--db-name", default=os.environ.get("DB_NAME", AppConfig.DB_NAME))
    parser.add_argument("--source-id", type=int, default=None, help="Scan only this source ID")
    parser.add_argument("--source-type", default=None, help="Scan only sources of this type (GITLAB, SVN)")
    parser.add_argument("--log-level", default=os.environ.get("LOG_LEVEL", "INFO"))

    args = parser.parse_args(list(argv) if argv is not None else None)

    try:
        from log_utils import configure_logging
    except ImportError:
        from server.scripts.log_utils import configure_logging

    configure_logging(args.log_level)

    return ScriptConfig(
        db_host=args.db_host,
        db_port=args.db_port,
        db_user=args.db_user,
        db_password=args.db_password,
        db_name=args.db_name,
        source_id=args.source_id,
        source_type=args.source_type.upper() if args.source_type else None,
    )


def run(config: ScriptConfig) -> ScanResult:
    connection = get_connection(config)
    sources = fetch_active_sources(connection, config.source_id, config.source_type)

    if not sources:
        LOGGER.warning("No active sources found matching criteria")
        connection.close()
        return ScanResult(sources=[], total_processed=0, total_succeeded=0, total_failed=0)

    LOGGER.info("Found %d active source(s) to scan", len(sources))

    run_id = create_run(connection, sources[0] if len(sources) == 1 else None)
    insert_run_log(connection, run_id, "INFO", "Unified scan started", {"source_count": len(sources)})

    all_statuses: List[SourceScanStatus] = []
    total_processed, total_succeeded, total_failed = 0, 0, 0

    for source in sources:
        LOGGER.info("Processing source: %s (%s)", source.source_name, source.source_type)
        insert_run_log(connection, run_id, "INFO", f"Starting source: {source.source_name}", {"source_type": source.source_type})

        if source.source_type.upper() == "GITLAB":
            status = scan_gitlab_source(connection, source, config, run_id)
        elif source.source_type.upper() == "SVN":
            status = scan_svn_source(connection, source, config, run_id)
        else:
            LOGGER.warning("Unsupported source type: %s", source.source_type)
            status = SourceScanStatus(
                source_id=source.id, source_name=source.source_name, source_type=source.source_type,
                status="skipped", processed=0, succeeded=0, failed=0
            )

        all_statuses.append(status)
        total_processed += status.processed
        total_succeeded += status.succeeded
        total_failed += status.failed

        # Update last_synced_at for this source if scan was not skipped
        if status.status != "skipped":
            update_source_last_synced(connection, source.id)

        insert_run_log(connection, run_id, "INFO", f"Completed source: {source.source_name}", {
            "processed": status.processed, "succeeded": status.succeeded, "failed": status.failed
        })

    overall_status = "success" if total_failed == 0 else "partial"
    finalize_run(connection, run_id, overall_status, total_processed, total_succeeded, total_failed, None)
    insert_run_log(connection, run_id, "INFO", "Unified scan completed", {
        "total_processed": total_processed, "total_succeeded": total_succeeded, "total_failed": total_failed
    })

    connection.close()

    return ScanResult(
        sources=all_statuses,
        total_processed=total_processed,
        total_succeeded=total_succeeded,
        total_failed=total_failed,
        run_id=run_id,
    )


def main(argv: Optional[Iterable[str]] = None) -> int:
    config = load_config(argv)
    result = run(config)
    LOGGER.info("Scan complete: processed=%d succeeded=%d failed=%d", result.total_processed, result.total_succeeded, result.total_failed)
    return 0 if result.total_failed == 0 else 1


def result_to_dict(result: ScanResult) -> Dict:
    """Serialize ScanResult for API responses."""
    payload = asdict(result)
    payload["runId"] = payload.pop("run_id", None)
    return payload


if __name__ == "__main__":
    sys.exit(main())
