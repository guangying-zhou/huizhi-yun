import logging
import os
import subprocess
import time
import uuid
import datetime as dt
from typing import Dict, List, Optional, Any

from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel, Field

from server.python_service.config import Config
try:
    import mysql.connector
except ImportError:
    mysql = None

# Import existing data ingestion modules from server.scripts
# We need to make sure the import path is correct.
# Since we are in server.python_service.api, 'server.scripts' should be importable if 'server' is in path.
# app.py does it, so it should work here too.
try:
    from server.scripts import scan_repos
except ImportError:
    scan_repos = None

try:
    from server.scripts import scan_gitlab_repos
except ImportError:
    scan_gitlab_repos = None

try:
    from server.scripts import scan_svn_repos
except ImportError:
    scan_svn_repos = None

try:
    from server.scripts import sync_gitlab_commits
except ImportError:
    sync_gitlab_commits = None

try:
    from server.scripts import sync_svn_commits
except ImportError:
    sync_svn_commits = None

try:
    from server.scripts import repair_gitlab_commits
except ImportError:
    repair_gitlab_commits = None

from server.python_service.db import execute_update

router = APIRouter(prefix="/api/ingestion", tags=["ingestion"])
LOGGER = logging.getLogger(__name__)

REPO_ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..", ".."))

# ========== Models ==========

class DatabaseSettings(BaseModel):
    host: Optional[str] = Field(None, description="Database host")
    port: Optional[int] = Field(None, description="Database port")
    user: Optional[str] = Field(None, description="Database user name")
    password: Optional[str] = Field(None, description="Database password")
    name: Optional[str] = Field(None, description="Database schema name")

class UnifiedScanRequest(BaseModel):
    source_id: Optional[int] = Field(None, description="Scan only this repo_sources.id")
    source_type: Optional[str] = Field(None, description="Scan only sources of this type (GITLAB, SVN)")
    db: Optional[DatabaseSettings] = Field(None, description="Override database connection settings")

class StageBStartRequest(BaseModel):
    batch_size: Optional[int] = Field(None, description="每批处理提交数量（默认 500）")
    include_invalid: Optional[bool] = Field(False, description="是否包含未标记有效的仓库")
    svn_max_diff_bytes: Optional[int] = Field(None, description="SVN 单文件 diff 最大字节数")
    no_diffs: Optional[bool] = Field(False, description="是否跳过 diff_text 存储，仅写入元数据")
    gitlab_url: Optional[str] = Field(None, description="GitLab 基础 URL（提供 token 才会处理 GitLab 提交文件）")
    gitlab_token: Optional[str] = Field(None, description="GitLab 访问令牌")
    db: Optional[DatabaseSettings] = Field(None, description="数据库连接覆盖项")

class StageBStopRequest(BaseModel):
    db: Optional[DatabaseSettings] = Field(None, description="数据库连接覆盖项")

class DeduplicateRequest(BaseModel):
    db: Optional[DatabaseSettings] = Field(None, description="Database connection overrides")

class DeduplicateStopRequest(BaseModel):
    db: Optional[DatabaseSettings] = Field(None, description="Database connection overrides")

class GitLabScanRequest(BaseModel):
    gitlab_url: Optional[str] = Field(None, description="GitLab base URL")
    gitlab_token: Optional[str] = Field(None, description="Personal access token")
    group_id: Optional[str] = Field(None, description="Optional GitLab group ID to scope scan")
    per_page: Optional[int] = Field(None, description="Pagination size for GitLab API calls")
    request_timeout: Optional[int] = Field(None, description="HTTP timeout (seconds)")
    year: Optional[int] = Field(
        None, description="Restrict commit sync to a specific year (defaults to current year)"
    )
    repo_catalog_ids: Optional[List[int]] = Field(
        None, description="Restrict operations to specified repo_catalog IDs"
    )
    db: Optional[DatabaseSettings] = Field(
        None, description="Override database connection settings"
    )


class GitLabSyncRequest(GitLabScanRequest):
    valid_only: Optional[bool] = Field(
        None, description="Restrict operations to repositories marked active"
    )
    include_invalid: Optional[bool] = Field(
        None,
        description="Include invalid repositories (overrides valid_only when True)",
    )


class SVNRequest(BaseModel):
    svn_root: Optional[str] = Field(None, description="Root directory containing SVN repositories")
    year: Optional[int] = Field(
        None, description="Restrict commit sync to a specific year (defaults to current year)"
    )
    max_diff_bytes: Optional[int] = Field(
        None, description="Maximum diff payload to retain per file (bytes)"
    )
    repo_catalog_ids: Optional[List[int]] = Field(
        None, description="Restrict operations to specified repo_catalog IDs"
    )
    db: Optional[DatabaseSettings] = Field(None, description="Override database connection settings")
    valid_only: Optional[bool] = Field(
        None, description="Restrict operations to repositories marked active"
    )
    include_invalid: Optional[bool] = Field(
        None,
        description="Include invalid repositories (overrides valid_only when True)",
    )

# ========== Helpers ==========

def _db_conn(settings: Optional[DatabaseSettings]):
    host = settings.host if settings and settings.host else Config.DB_HOST
    port = settings.port if settings and settings.port else Config.DB_PORT
    user = settings.user if settings and settings.user else Config.DB_USER
    password = settings.password if settings and settings.password else Config.DB_PASSWORD
    database = settings.name if settings and settings.name else Config.DB_NAME
    return mysql.connector.connect(host=host, port=port, user=user, password=password, database=database)

def _child_env(triggered_by: str) -> Dict[str, str]:
    env: Dict[str, str] = dict(os.environ)
    env["TRIGGERED_BY"] = triggered_by
    existing = env.get("PYTHONPATH")
    if existing:
        paths = existing.split(os.pathsep)
        if REPO_ROOT not in paths:
            env["PYTHONPATH"] = os.pathsep.join([REPO_ROOT, existing])
    else:
        env["PYTHONPATH"] = REPO_ROOT
    return env

def _query_latest_run(conn, job_type: str):
    cur = conn.cursor(dictionary=True)
    try:
        cur.execute(
            "SELECT id, job_type, status, started_at, finished_at, items_processed, items_failed, error_message, params, triggered_by "
            "FROM ingestion_runs WHERE job_type=%s ORDER BY id DESC LIMIT 1",
            (job_type,)
        )
        row = cur.fetchone()
        return row
    finally:
        cur.close()

def _get_stop_flag(conn, key: str) -> bool:
    cur = conn.cursor()
    try:
        cur.execute("SELECT param_value FROM system_parameters WHERE param_key=%s", (key,))
        row = cur.fetchone()
        return (row and str(row[0]).strip() == '1')
    finally:
        cur.close()

def _set_stop_flag(conn, key: str, value: str) -> None:
    cur = conn.cursor()
    try:
        cur.execute(
            "INSERT INTO system_parameters (param_key, param_value, description) VALUES (%s, %s, 'Flag to stop') "
            "ON DUPLICATE KEY UPDATE param_value=VALUES(param_value)",
            (key, value,),
        )
        conn.commit()
    finally:
        cur.close()

# Helpers for Sync
def _db_overrides(settings: Optional[DatabaseSettings]) -> Dict[str, object]:
    overrides: Dict[str, object] = {}
    if settings is None:
        return overrides
    if settings.host is not None:
        overrides["db_host"] = settings.host
    if settings.port is not None:
        overrides["db_port"] = settings.port
    if settings.user is not None:
        overrides["db_user"] = settings.user
    if settings.password is not None:
        overrides["db_password"] = settings.password
    if settings.name is not None:
        overrides["db_name"] = settings.name
    return overrides


def _build_gitlab_overrides(request: GitLabScanRequest) -> Dict[str, object]:
    overrides: Dict[str, object] = _db_overrides(request.db)
    if request.gitlab_url is not None:
        overrides["gitlab_url"] = request.gitlab_url
    if request.gitlab_token is not None:
        overrides["gitlab_token"] = request.gitlab_token
    if request.group_id is not None:
        overrides["group_id"] = request.group_id
    if request.per_page is not None:
        overrides["per_page"] = request.per_page
    if request.request_timeout is not None:
        overrides["request_timeout"] = request.request_timeout
    if request.year is not None:
        overrides["year"] = request.year
    include_invalid = getattr(request, "include_invalid", None)
    if include_invalid is not None:
        overrides["include_invalid"] = include_invalid
    return overrides


def _build_svn_overrides(request: SVNRequest) -> Dict[str, object]:
    overrides: Dict[str, object] = _db_overrides(request.db)
    if request.svn_root is not None:
        overrides["svn_root"] = request.svn_root
    if request.year is not None:
        overrides["year"] = request.year
    if request.max_diff_bytes is not None:
        overrides["max_diff_bytes"] = request.max_diff_bytes
    if request.include_invalid is not None:
        overrides["include_invalid"] = request.include_invalid
    return overrides

def config_or_422(func, overrides):
    try:
        return func(overrides)
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc


# ========== Endpoints: Repos Scan (Stage A) ==========

@router.post("/repos/scan")
def trigger_unified_scan(request: UnifiedScanRequest) -> Dict[str, object]:
    LOGGER.info("Received /api/ingestion/repos/scan request (source_id=%s, source_type=%s)",
                request.source_id, request.source_type)

    db_settings = request.db
    config = scan_repos.ScriptConfig(
        db_host=db_settings.host if db_settings and db_settings.host else Config.DB_HOST,
        db_port=db_settings.port if db_settings and db_settings.port else Config.DB_PORT,
        db_user=db_settings.user if db_settings and db_settings.user else Config.DB_USER,
        db_password=db_settings.password if db_settings and db_settings.password else Config.DB_PASSWORD,
        db_name=db_settings.name if db_settings and db_settings.name else Config.DB_NAME,
        source_id=request.source_id,
        source_type=request.source_type.upper() if request.source_type else None,
    )

    try:
        result = scan_repos.run(config)
    except Exception as exc:
        LOGGER.exception("Unified scan failed")
        raise HTTPException(status_code=500, detail=f"Scan failed: {exc}") from exc

    return scan_repos.result_to_dict(result)

    return scan_repos.result_to_dict(result)

# ========== Endpoints: Sync ==========

@router.post("/sync/gitlab")
def trigger_gitlab_sync(request: GitLabSyncRequest) -> Dict[str, object]:
    LOGGER.info(
        "Received /api/ingestion/sync/gitlab request (valid_only=%s, include_invalid=%s, repo_ids=%s)",
        request.valid_only,
        request.include_invalid,
        request.repo_catalog_ids or "all",
    )
    overrides = _build_gitlab_overrides(request)
    try:
        config = sync_gitlab_commits.config_from_environment(overrides)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    try:
        result = sync_gitlab_commits.run(config, repo_catalog_ids=request.repo_catalog_ids)
    except Exception as exc:
        LOGGER.exception("GitLab commit sync failed")
        raise HTTPException(status_code=500, detail=f"GitLab commit sync failed: {exc}") from exc

    payload = sync_gitlab_commits.result_to_dict(result)
    payload["has_failures"] = result.total_commits_failed > 0
    return payload


@router.post("/sync/svn")
def trigger_svn_sync(request: SVNRequest) -> Dict[str, object]:
    LOGGER.info(
        "Received /api/ingestion/sync/svn request (valid_only=%s, include_invalid=%s, repo_ids=%s)",
        request.valid_only,
        request.include_invalid,
        request.repo_catalog_ids or "all",
    )
    overrides = _build_svn_overrides(request)
    config = config_or_422(sync_svn_commits.config_from_environment, overrides)

    try:
        result = sync_svn_commits.run(config, repo_catalog_ids=request.repo_catalog_ids)
    except Exception as exc:  # pylint: disable=broad-except
        LOGGER.exception("SVN commit sync failed")
        raise HTTPException(status_code=500, detail=f"SVN commit sync failed: {exc}") from exc

    payload = sync_svn_commits.result_to_dict(result)
    payload["has_failures"] = result.total_commits_failed > 0
    return payload


# ========== Endpoints: Files Ingestion (Stage B) ==========

@router.post("/files/start")
async def start_stage_b(request: StageBStartRequest) -> Dict[str, object]:
    LOGGER.info("Received /api/ingestion/files/start request")

    try:
        conn = _db_conn(request.db)
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"DB connect failed: {exc}") from exc

    try:
        latest = _query_latest_run(conn, 'commit_files_ingest')
        if latest and latest.get('status') == 'running':
            # Check if stuck (running for more than 30 minutes)
            import datetime as _dt
            started = latest.get('started_at')
            if started:
                if isinstance(started, str):
                    started = _dt.datetime.fromisoformat(started)
                elapsed = (_dt.datetime.now() - started).total_seconds()
                if elapsed > 1800:  # 30 minutes
                    LOGGER.warning("Marking stuck run %s as failed (elapsed: %ds)", latest['id'], elapsed)
                    cur = conn.cursor()
                    cur.execute(
                        "UPDATE ingestion_runs SET status='failed', finished_at=NOW(), error_message='Auto-terminated: stuck for >30min' WHERE id=%s",
                        (latest['id'],)
                    )
                    conn.commit()
                    cur.close()
                else:
                    return {
                        "started": False,
                        "reason": "ingest already running",
                        "runId": latest['id'],
                        "remote": {
                            "status": "already-running",
                            "run": latest,
                            "message": "Stage B is already running"
                        }
                    }
            else:
                return {
                    "started": False,
                    "reason": "ingest already running",
                    "runId": latest['id'],
                    "remote": {
                        "status": "already-running",
                        "run": latest,
                        "message": "Stage B is already running"
                    }
                }

        # Clear stop flag
        _set_stop_flag(conn, 'commit_files_ingest_stop', '0')

        # Set ingestion_completed = false (Added logic from Node proxy)
        cur = conn.cursor()
        try:
            cur.execute(
                "INSERT INTO system_parameters (param_key, param_value, description) VALUES ('ingestion_completed', 'false', 'Flag indicating if ingestion and deduplication are completed') "
                "ON DUPLICATE KEY UPDATE param_value=VALUES(param_value)"
            )
            conn.commit()
        finally:
            cur.close()

        trig = f"api:{uuid.uuid4()}"
        cmd = [
            os.environ.get('PYTHON_BIN', 'python3'),
            "-m", "server.scripts.ingest_commit_files",
        ]
        if request.batch_size:
            cmd += ["--batch-size", str(request.batch_size)]
        if request.include_invalid:
            cmd += ["--include-invalid"]
        if request.svn_max_diff_bytes:
            cmd += ["--svn-max-diff-bytes", str(request.svn_max_diff_bytes)]
        if not request.no_diffs:
            cmd += ["--save-diffs"]
        if request.gitlab_url:
            cmd += ["--gitlab-url", request.gitlab_url]
        if request.gitlab_token:
            cmd += ["--gitlab-token", request.gitlab_token]

        # Pass DB settings to script
        if request.db:
             if request.db.host: cmd += ["--db-host", request.db.host]
             if request.db.port: cmd += ["--db-port", str(request.db.port)]
             if request.db.user: cmd += ["--db-user", request.db.user]
             if request.db.password: cmd += ["--db-password", request.db.password]
             if request.db.name: cmd += ["--db-name", request.db.name]

        env = _child_env(trig)

        import tempfile
        stdout_f = tempfile.NamedTemporaryFile(prefix="codeinsight-ingest-", suffix=".out", delete=False)
        stderr_f = tempfile.NamedTemporaryFile(prefix="codeinsight-ingest-", suffix=".err", delete=False)
        proc = subprocess.Popen(cmd, env=env, cwd=REPO_ROOT, stdout=stdout_f, stderr=stderr_f)

        # Poll for run_id
        run_id = None
        for _ in range(25):
            time.sleep(0.2)
            cur = conn.cursor()
            try:
                cur.execute(
                    "SELECT id FROM ingestion_runs WHERE job_type='commit_files_ingest' AND triggered_by=%s ORDER BY id DESC LIMIT 1",
                    (trig,),
                )
                row = cur.fetchone()
                if row:
                    run_id = int(row[0])
                    break
            finally:
                cur.close()

        remote_resp = {
            "status": "started",
            "pid": proc.pid,
            "triggered_by": trig,
            "run_id": run_id,
            "stdout_log": stdout_f.name,
            "stderr_log": stderr_f.name,
        }

        return {
             "started": True,
             "batchSize": request.batch_size,
             "includeInvalid": request.include_invalid,
             "triggeredBy": "api",
             "runId": run_id,
             "remote": remote_resp
        }

    finally:
        try:
            conn.close()
        except:
            pass

@router.post("/files/stop")
def stop_stage_b(request: StageBStopRequest) -> Dict[str, object]:
    LOGGER.info("Received /api/ingestion/files/stop request")
    try:
        conn = _db_conn(request.db)
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"DB connect failed: {exc}") from exc
    try:
        _set_stop_flag(conn, 'commit_files_ingest_stop', '1')
        latest = _query_latest_run(conn, 'commit_files_ingest')
        return {
            "status": "stop-requested",
            "run": latest,
            "stop_flag": True,
        }
    finally:
        try:
            conn.close()
        except:
            pass

@router.get("/files/status")
async def stage_b_status(db: Optional[DatabaseSettings] = None) -> Dict[str, object]:
    # This endpoint mimics the simple status check from app.py
    # If frontend uses /files/progress, it calls the progress endpoint below.
    # We keep this for compatibility if needed, distinct from progress.
    LOGGER.info("Received /api/ingestion/files/status request")
    try:
        conn = _db_conn(db)
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"DB connect failed: {exc}") from exc
    try:
        latest = _query_latest_run(conn, 'commit_files_ingest')
        stop_flag = _get_stop_flag(conn, 'commit_files_ingest_stop')
        return {
            "status": "ok",
            "run": latest,
            "stop_requested": stop_flag,
        }
    finally:
        try:
            conn.close()
        except:
            pass

@router.get("/files/progress")
async def get_stage_b_progress(db: Optional[DatabaseSettings] = None) -> Dict[str, object]:
    LOGGER.info("Received /api/ingestion/files/progress request")
    try:
        conn = _db_conn(db)
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"DB connect failed: {exc}") from exc

    try:
        cur = conn.cursor(dictionary=True)

        # Total commits
        cur.execute(
            "SELECT COUNT(*) AS total FROM repo_commits c JOIN repo_catalog r ON r.id=c.repo_catalog_id "
            "WHERE (r.source_type='gitlab' OR r.source_type='svn') AND r.is_valid=1"
        )
        all_row = cur.fetchone()
        total = int(all_row['total']) if all_row else 0

        # Processed commits
        cur.execute(
            "SELECT COUNT(*) AS total FROM repo_commits c JOIN repo_catalog r ON r.id=c.repo_catalog_id "
            "WHERE (r.source_type='gitlab' OR r.source_type='svn') AND r.is_valid=1 AND c.files_ingested=1"
        )
        done_row = cur.fetchone()
        processed = int(done_row['total']) if done_row else 0

        remaining = max(0, total - processed)
        percent = round((processed * 100) / total, 2) if total > 0 else 0

        latest = _query_latest_run(conn, 'commit_files_ingest')
        stop_flag = _get_stop_flag(conn, 'commit_files_ingest_stop')

        # Parse params if string
        if latest and latest.get('params') and isinstance(latest['params'], str):
             import json
             try:
                 latest['params'] = json.loads(latest['params'])
             except:
                 pass

        return {
            "totalCommits": total,
            "ingestedCommits": processed,
            "remainingCommits": remaining,
            "progressPercent": percent,
            "latestRun": latest,
            "stopRequested": stop_flag
        }
    finally:
        try:
            conn.close()
        except:
             pass

@router.get("/files/logs")
async def get_stage_b_logs(
    run_id: Optional[int] = Query(None, alias="runId"),
    limit: int = Query(200, ge=1, le=1000),
    db: Optional[DatabaseSettings] = None
) -> Dict[str, object]:
    LOGGER.info("Received /api/ingestion/files/logs request")
    try:
        conn = _db_conn(db)
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"DB connect failed: {exc}") from exc

    try:
        if not run_id:
             latest = _query_latest_run(conn, 'commit_files_ingest')
             if latest:
                 run_id = latest['id']

        if not run_id:
             return {"runId": None, "logs": []}

        cur = conn.cursor(dictionary=True)
        cur.execute(
            "SELECT id, ingestion_run_id, log_level, message, context, created_at FROM ingestion_run_logs "
            "WHERE ingestion_run_id = %s ORDER BY id ASC LIMIT %s",
            (run_id, limit)
        )
        rows = cur.fetchall()

        import json
        logs = []
        for r in rows:
            ctx = r['context']
            if ctx and isinstance(ctx, str):
                try:
                    ctx = json.loads(ctx)
                except:
                    pass
            logs.append({
                "id": r['id'],
                "level": r['log_level'],
                "message": r['message'],
                "context": ctx,
                "createdAt": str(r['created_at'])
            })

        return {
            "runId": run_id,
            "logs": logs
        }
    finally:
        try:
            conn.close()
        except:
            pass

# ========== Endpoints: Deduplicate ==========

@router.post("/repos/stats")
@router.post("/repos/progress")
def refresh_repo_stats(db: Optional[DatabaseSettings] = None) -> Dict[str, object]:
    """
    Recalculate and update `ingested_commits` count in repo_catalog
    based on repo_commits where files_ingested=1.
    """
    LOGGER.info("Received /api/ingestion/repos/stats (or progress) request")
    try:
        conn = _db_conn(db)
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"DB connect failed: {exc}") from exc

    try:
        cur = conn.cursor()
        # Update ingested_commits for all valid repositories
        # count how many commits have files_ingested=1
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
        # Retry on deadlock
        for attempt in range(3):
            try:
                cur.execute(query)
                break
            except Exception as e:
                if 'Deadlock' in str(e) and attempt < 2:
                    import time
                    time.sleep(1)
                    continue
                raise
        updated = cur.rowcount
        conn.commit()

        # Get summary stats for the response
        cur.execute("SELECT COUNT(*) FROM repo_catalog WHERE is_valid = 1")
        valid_repos = cur.fetchone()[0]

        cur.execute("SELECT SUM(ingested_commits) FROM repo_catalog WHERE is_valid = 1")
        total_ingested = cur.fetchone()[0] or 0

        cur.close()

        return {
            "status": "ok",
            "message": "Repo stats updated",
            "updated": updated,
            "validRepos": valid_repos,
            "totalIngestedCommits": int(total_ingested)
        }
    except Exception as exc:
        LOGGER.exception("Failed to update repo stats")
        raise HTTPException(status_code=500, detail=f"Stats update failed: {exc}") from exc
    finally:
        try:
            conn.close()
        except:
            pass

@router.post("/deduplicate/start")

def start_deduplication(request: DeduplicateRequest) -> Dict[str, object]:
    LOGGER.info("Received /api/ingestion/deduplicate/start request")
    try:
        conn = _db_conn(request.db)
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"DB connect failed: {exc}") from exc

    try:
        latest = _query_latest_run(conn, 'deduplicate_files')
        if latest and latest.get('status') == 'running':
             return {
                "started": False,
                "reason": "deduplication already running",
                "runId": latest['id'],
                "remote": {
                    "status": "already-running",
                    "run": latest,
                    "message": "Deduplication is already running"
                }
            }

        _set_stop_flag(conn, 'deduplicate_files_stop', '0')

        trig = f"api-dedupe:{uuid.uuid4()}"
        cmd = [
            os.environ.get('PYTHON_BIN', 'python3'),
            "-m", "server.scripts.deduplicate_repo_files",
            "--triggered-by", trig,
        ]
        if request.db:
             if request.db.host: cmd += ["--db-host", request.db.host]
             if request.db.port: cmd += ["--db-port", str(request.db.port)]
             if request.db.user: cmd += ["--db-user", request.db.user]
             if request.db.password: cmd += ["--db-password", request.db.password]
             if request.db.name: cmd += ["--db-name", request.db.name]

        env = _child_env(trig)

        import tempfile
        stdout_f = tempfile.NamedTemporaryFile(prefix="codeinsight-dedupe-", suffix=".out", delete=False)
        stderr_f = tempfile.NamedTemporaryFile(prefix="codeinsight-dedupe-", suffix=".err", delete=False)
        proc = subprocess.Popen(cmd, env=env, cwd=REPO_ROOT, stdout=stdout_f, stderr=stderr_f)

        run_id = None
        for _ in range(25):
            time.sleep(0.2)
            cur = conn.cursor()
            try:
                cur.execute(
                    "SELECT id, status, started_at FROM ingestion_runs WHERE job_type='deduplicate_files' AND triggered_by=%s ORDER BY id DESC LIMIT 1",
                    (trig,),
                )
                row = cur.fetchone()
                if row:
                    run_id = int(row[0])
                    break
            finally:
                cur.close()

        remote_resp = {
            "status": "started",
            "pid": proc.pid,
            "triggered_by": trig,
            "run_id": run_id,
            "stdout_log": stdout_f.name,
            "stderr_log": stderr_f.name,
        }

        return {
            "started": True,
            "runId": run_id,
            "remote": remote_resp
        }
    finally:
         try:
            conn.close()
         except:
            pass

@router.post("/deduplicate/stop")
def stop_deduplication(request: DeduplicateStopRequest) -> Dict[str, object]:
    LOGGER.info("Received /api/ingestion/deduplicate/stop request")
    try:
        conn = _db_conn(request.db)
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"DB connect failed: {exc}") from exc
    try:
        _set_stop_flag(conn, 'deduplicate_files_stop', '1')
        latest = _query_latest_run(conn, 'deduplicate_files')
        return {
            "status": "stop-requested",
            "run": latest,
            "stop_flag": True,
        }
    finally:
        try:
            conn.close()
        except:
            pass

@router.get("/deduplicate/status")
def deduplication_status(db: Optional[DatabaseSettings] = None) -> Dict[str, object]:
    LOGGER.info("Received /api/ingestion/deduplicate/status request")
    try:
        conn = _db_conn(db)
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"DB connect failed: {exc}") from exc
    try:
        latest = _query_latest_run(conn, 'deduplicate_files')
        stop_flag = _get_stop_flag(conn, 'deduplicate_files_stop')
        return {
            "status": "ok",
            "run": latest,
            "stop_requested": stop_flag,
        }
    finally:
        try:
            conn.close()
        except:
            pass

# ========== Endpoints: Runs ==========

@router.get("/runs")
async def list_runs(
    page: int = Query(1, ge=1),
    page_size: int = Query(20, ge=1, le=100, alias="pageSize"),
    status: Optional[str] = None,
    source_type: Optional[str] = Query(None, alias="sourceType"),
    job_type: Optional[str] = Query(None, alias="jobType"),
    since: Optional[str] = None,
    repo_id: Optional[int] = Query(None, alias="repoId"),
    db: Optional[DatabaseSettings] = None
) -> Dict[str, object]:
    LOGGER.info("Received /api/ingestion/runs request")
    try:
         conn = _db_conn(db)
    except Exception as exc:
         raise HTTPException(status_code=500, detail=f"DB connect failed: {exc}") from exc

    try:
        offset = (page - 1) * page_size
        filters = []
        params = []

        if status:
            filters.append("r.status = %s")
            params.append(status.strip())

        if source_type:
            filters.append("r.source_type = %s")
            params.append(source_type.strip())

        if job_type:
            filters.append("r.job_type = %s")
            params.append(job_type.strip())

        if since:
            filters.append("r.started_at >= %s")
            params.append(since.strip())

        if repo_id:
            filters.append("r.repo_catalog_id = %s")
            params.append(repo_id)

        where_sql = ("WHERE " + " AND ".join(filters)) if filters else ""

        cur = conn.cursor(dictionary=True)

        query = f"""
            SELECT r.id, r.job_type, r.source_type, r.repo_catalog_id, r.repo_key, r.status, r.started_at, r.finished_at,
                   r.items_total, r.items_processed, r.items_failed, r.error_message, r.triggered_by, r.params,
                   c.name AS repo_name
            FROM ingestion_runs r
            LEFT JOIN repo_catalog c ON c.id = r.repo_catalog_id
            {where_sql}
            ORDER BY r.started_at DESC
            LIMIT %s OFFSET %s
        """
        cur.execute(query, tuple(params + [page_size, offset]))
        rows = cur.fetchall()

        count_query = f"SELECT COUNT(*) AS total FROM ingestion_runs r {where_sql}"
        cur.execute(count_query, tuple(params))
        count_row = cur.fetchone()
        total = count_row['total'] if count_row else 0

        import json
        data = []
        for r in rows:
            p_val = r['params']
            if p_val and isinstance(p_val, str):
                try: p_val = json.loads(p_val)
                except: pass

            data.append({
                "id": r['id'],
                "jobType": r['job_type'],
                "sourceType": r['source_type'],
                "repoCatalogId": r['repo_catalog_id'],
                "repoKey": r['repo_key'],
                "repoName": r['repo_name'],
                "status": r['status'],
                "startedAt": str(r['started_at']) if r['started_at'] else None,
                "finishedAt": str(r['finished_at']) if r['finished_at'] else None,
                "itemsTotal": r['items_total'],
                "itemsProcessed": r['items_processed'],
                "itemsFailed": r['items_failed'],
                "errorMessage": r['error_message'],
                "triggeredBy": r['triggered_by'],
                "params": p_val
            })

        return {
            "data": data,
            "meta": {
                "page": page,
                "pageSize": page_size,
                "total": total
            }
        }
    finally:
        try: conn.close()
        except: pass
@router.get("/runs/{id}")
async def get_run(id: int, db: Optional[DatabaseSettings] = None) -> Dict[str, object]:
    LOGGER.info(f"Received /api/ingestion/runs/{id} request")
    try:
        conn = _db_conn(db)
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"DB connect failed: {exc}") from exc

    try:
        cur = conn.cursor(dictionary=True)
        query = """
            SELECT r.id, r.job_type, r.source_type, r.repo_catalog_id, r.repo_key, r.status, r.started_at, r.finished_at,
                   r.items_total, r.items_processed, r.items_failed, r.error_message, r.triggered_by, r.params,
                   c.name AS repo_name
            FROM ingestion_runs r
            LEFT JOIN repo_catalog c ON c.id = r.repo_catalog_id
            WHERE r.id = %s
        """
        cur.execute(query, (id,))
        r = cur.fetchone()
        if not r:
            raise HTTPException(status_code=404, detail="Run not found")

        import json
        p_val = r['params']
        if p_val and isinstance(p_val, str):
            try: p_val = json.loads(p_val)
            except: pass

        return {
            "id": r['id'],
            "jobType": r['job_type'],
            "sourceType": r['source_type'],
            "repoCatalogId": r['repo_catalog_id'],
            "repoKey": r['repo_key'],
            "repoName": r['repo_name'],
            "status": r['status'],
            "startedAt": str(r['started_at']) if r['started_at'] else None,
            "finishedAt": str(r['finished_at']) if r['finished_at'] else None,
            "itemsTotal": r['items_total'],
            "itemsProcessed": r['items_processed'],
            "itemsFailed": r['items_failed'],
            "errorMessage": r['error_message'],
            "triggeredBy": r['triggered_by'],
            "params": p_val
        }
    finally:
        try: conn.close()
        except: pass


@router.get("/runs/progress-latest")
async def get_progress_latest(db: Optional[DatabaseSettings] = None) -> Dict[str, object]:
    try:
         conn = _db_conn(db)
    except Exception as exc:
         raise HTTPException(status_code=500, detail=f"DB connect failed: {exc}") from exc
    try:
        cur = conn.cursor(dictionary=True)
        cur.execute(
            "SELECT l.id, l.ingestion_run_id, l.message, l.context, l.created_at "
            "FROM ingestion_run_logs l "
            "WHERE l.message = 'Progress' "
            "ORDER BY l.id DESC LIMIT 1"
        )
        latest = cur.fetchone()
        if not latest:
            return {"data": None}

        import json, re
        ctx = latest['context']
        if ctx and isinstance(ctx, str):
             try: ctx = json.loads(ctx)
             except: pass

        processedTotalLabel = ''
        percent = 0
        totalCommits = 0

        if isinstance(ctx, dict):
            raw = ctx.get('processed_total') or ctx.get('processedTotal')
            if raw is not None: processedTotalLabel = str(raw)

            totalRaw = ctx.get('total_commits') or ctx.get('totalCommits')
            if totalRaw is not None:
                try: totalCommits = float(totalRaw)
                except: totalCommits = 0
        elif isinstance(ctx, str):
            processedTotalLabel = ctx

        m1 = re.match(r'^(\d+(?:\.\d+)?)%\((\d+)(?:\/(\d+))?\)$', processedTotalLabel)
        m2 = re.match(r'^(\d+)(?:\/(\d+))$', processedTotalLabel)

        if m1:
            try: percent = float(m1.group(1))
            except: pass
            if m1.group(3):
                 try: totalCommits = float(m1.group(3))
                 except: pass
        elif m2:
            try:
                processedNum = float(m2.group(1))
                totalNum = float(m2.group(2))
                if totalNum > 0:
                     totalCommits = totalNum
                     percent = round((processedNum * 100) / totalNum, 1)
            except: pass

        return {
            "data": {
                "processedTotal": processedTotalLabel,
                "totalCommits": totalCommits,
                "percent": percent
            }
        }
    finally:
        try: conn.close()
        except: pass

@router.get("/runs/{id}/logs")
async def get_run_logs_path(
    id: int,
    limit: int = Query(500, ge=1, le=1000),
    order: str = Query("asc", regex="^(asc|desc)$", case_sensitive=False),
    level: Optional[str] = Query(None),
    db: Optional[DatabaseSettings] = None
) -> Dict[str, object]:
    try:
        conn = _db_conn(db)
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"DB connect failed: {exc}") from exc

    try:
        cur = conn.cursor(dictionary=True)
        cur.execute("SELECT id FROM ingestion_runs WHERE id = %s", (id,))
        if not cur.fetchone():
             raise HTTPException(status_code=404, detail="Run not found")

        filters = ["ingestion_run_id = %s"]
        params = [id]

        if level and level.lower() in ('error', 'warning', 'info', 'debug'):
            filters.append("LOWER(log_level) = %s")
            params.append(level.lower())

        where_sql = "WHERE " + " AND ".join(filters)

        sql = f"""
            SELECT id, ingestion_run_id, log_level, message, context, created_at
            FROM ingestion_run_logs
            {where_sql}
            ORDER BY created_at {order.upper()}
            LIMIT %s
        """
        cur.execute(sql, tuple(params + [limit]))
        rows = cur.fetchall()

        import json
        logs = []
        for r in rows:
            ctx = r['context']
            if ctx and isinstance(ctx, str):
                try: ctx = json.loads(ctx)
                except: pass
            logs.append({
                "id": r['id'],
                "runId": r['ingestion_run_id'],
                "level": r['log_level'],
                "message": r['message'],
                "context": ctx,
                "createdAt": str(r['created_at'])
            })

        return {"data": logs}
    finally:
        try: conn.close()
        except: pass


# ========== Endpoints: Daily Ingestion Cron ==========

class DailyIngestionTriggerRequest(BaseModel):
    steps: Optional[str] = Field(None, description="Comma-separated steps to run (scan,sync,ingest,dedup,aggregate)")
    db: Optional[DatabaseSettings] = Field(None, description="Database connection overrides")


@router.post("/daily/trigger")
def trigger_daily_ingestion(request: DailyIngestionTriggerRequest) -> Dict[str, object]:
    """
    Manually trigger the daily ingestion pipeline.
    Launches the coordinator script in background.
    """
    LOGGER.info("Received /api/ingestion/daily/trigger request")

    cmd = [
        os.environ.get('PYTHON_BIN', 'python3'),
        "-m", "server.scripts.maintenance.daily_ingestion_coordinator",
        "--run-now",
    ]
    if request.steps:
        cmd += ["--steps", request.steps]

    env = _child_env("api-daily-trigger")

    import tempfile
    stdout_f = tempfile.NamedTemporaryFile(prefix="codeinsight-daily-", suffix=".out", delete=False)
    stderr_f = tempfile.NamedTemporaryFile(prefix="codeinsight-daily-", suffix=".err", delete=False)

    proc = subprocess.Popen(cmd, env=env, cwd=REPO_ROOT, stdout=stdout_f, stderr=stderr_f)

    return {
        "status": "started",
        "pid": proc.pid,
        "steps": request.steps or "default",
        "stdout_log": stdout_f.name,
        "stderr_log": stderr_f.name,
    }


@router.get("/daily/status")
def get_daily_ingestion_status(db: Optional[DatabaseSettings] = None) -> Dict[str, object]:
    """
    Get the status of the daily ingestion cron job.
    Returns enabled status, schedule, last run info, and latest run record.
    """
    LOGGER.info("Received /api/ingestion/daily/status request")
    try:
        conn = _db_conn(db)
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"DB connect failed: {exc}") from exc

    try:
        cur = conn.cursor(dictionary=True)

        # Get system parameters for daily ingestion
        cur.execute(
            "SELECT param_key, param_value FROM system_parameters "
            "WHERE param_key IN ('daily_ingestion_enabled', 'daily_ingestion_cron', "
            "'daily_ingestion_last_run', 'daily_ingestion_last_status', 'daily_ingestion_steps')"
        )
        params = {row['param_key']: row['param_value'] for row in cur.fetchall()}

        # Get latest daily_ingestion run
        cur.execute(
            "SELECT id, job_type, status, started_at, finished_at, items_processed, items_failed, error_message, params "
            "FROM ingestion_runs WHERE job_type = 'daily_ingestion' ORDER BY id DESC LIMIT 1"
        )
        latest_run = cur.fetchone()

        if latest_run and latest_run.get('params'):
            import json
            try:
                latest_run['params'] = json.loads(latest_run['params'])
            except:
                pass

        cur.close()

        return {
            "enabled": params.get('daily_ingestion_enabled', '0') == '1',
            "cron": params.get('daily_ingestion_cron', '02:00'),
            "steps": params.get('daily_ingestion_steps', 'scan,sync,ingest,dedup,aggregate'),
            "lastRun": params.get('daily_ingestion_last_run'),
            "lastStatus": params.get('daily_ingestion_last_status'),
            "latestRun": latest_run,
        }
    finally:
        try:
            conn.close()
        except:
            pass
