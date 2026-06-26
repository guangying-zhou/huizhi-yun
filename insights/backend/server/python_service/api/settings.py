from typing import List, Optional, Dict, Any, Union
from fastapi import APIRouter, HTTPException, Query, Body, Path
from pydantic import BaseModel, Field, ConfigDict

from server.python_service.db import execute_query, execute_update, execute_insert

router = APIRouter(prefix="/api/settings", tags=["settings"])

# ========== Helpers ==========

async def get_system_parameters(keys: List[str]) -> Dict[str, str]:
    if not keys:
        return {}
    placeholders = ",".join(["%s"] * len(keys))
    sql = f"SELECT param_key, param_value FROM system_parameters WHERE param_key IN ({placeholders})"
    rows = await execute_query(sql, tuple(keys))
    result = {}
    for row in rows:
        result[row["param_key"]] = row["param_value"]
    return result

async def set_system_parameter(key: str, value: str, description: str = "Updated via API"):
    sql = """
        INSERT INTO system_parameters (param_key, param_value, description)
        VALUES (%s, %s, %s)
        ON DUPLICATE KEY UPDATE param_value=VALUES(param_value)
    """
    await execute_update(sql, (key, value, description))

# ========== Models ==========

# Params
class ParamItem(BaseModel):
    key: str
    value: str
    description: str
    updatedAt: Optional[str] = None
    defaultValue: Optional[str] = None

class ParamsResponse(BaseModel):
    data: List[ParamItem]

# Monitoring
class MonitoringSettings(BaseModel):
    model_config = ConfigDict(extra='allow') # Allow dynamic keys

# Sync Schedule
class SyncScheduleBody(BaseModel):
    enabled: Optional[bool] = None
    time: Optional[str] = None
    retryCount: Optional[int] = None
    retryDelay: Optional[int] = None

class RepoSourceBody(BaseModel):
    sourceName: str
    sourceType: str
    reposBase: Optional[str] = None
    credentialRef: Optional[str] = None
    syncEnabled: Optional[bool] = True
    isActive: Optional[bool] = True

class RepoSourceUpdateBody(BaseModel):
    sourceName: Optional[str] = None
    sourceType: Optional[str] = None
    reposBase: Optional[str] = None
    credentialRef: Optional[str] = None
    syncEnabled: Optional[bool] = None
    isActive: Optional[bool] = None

class RepoSourceItem(BaseModel):
    id: int
    sourceName: str
    sourceType: str
    reposBase: Optional[str] = None
    credentialRef: Optional[str] = None
    syncEnabled: bool
    lastSyncedAt: Optional[str] = None
    isActive: bool
    createdAt: str
    updatedAt: str
    totalRepos: int
    validRepos: int
    activeRepos: int

class RepoSourceListResponse(BaseModel):
    data: List[RepoSourceItem]

# ========== Endpoints: Params ==========

PARAMS_DEF = [
  {
    "key": 'system_name',
    "defaultValue": 'RepoInsight',
    "defaultDescription": '显示在界面顶部的系统名称'
  },
  {
    "key": 'default_department_id',
    "defaultValue": '0',
    "defaultDescription": '新仓库的默认归属部门'
  },
  {
    "key": 'commit_batch_size',
    "defaultValue": '100',
    "defaultDescription": '每次处理的提交数量'
  },
  {
    "key": 'sync_interval_hours',
    "defaultValue": '24',
    "defaultDescription": '自动同步的间隔时间（小时）'
  },
  {
    "key": 'daily_ingestion_enabled',
    "defaultValue": '0',
    "defaultDescription": '日常数据导入开关（开=1 关=0）'
  },
  {
    "key": 'daily_ingestion_cron',
    "defaultValue": '0 2 * * *',
    "defaultDescription": '日常数据导入定时（Cron 5段：分 时 日 月 周。例：0 2 * * *）'
  },
  {
    "key": 'retention_days',
    "defaultValue": '90',
    "defaultDescription": '日志数据保留天数'
  },
  {
    "key": 'minimum_commits',
    "defaultValue": '10',
    "defaultDescription": '有效仓库最少提交数'
  },
  {
    "key": 'minimum_days',
    "defaultValue": '30',
    "defaultDescription": '有效仓库最少持续天数'
  },
  {
    "key": 'workload_max_added',
    "defaultValue": '1000',
    "defaultDescription": '工作量计算 - 新增行上限（防止批量生成代码膨胀）'
  },
  {
    "key": 'workload_weight_deleted',
    "defaultValue": '0.5',
    "defaultDescription": '工作量计算 - 删除行权重（基准为1）'
  },
  {
    "key": 'workload_weight_modified',
    "defaultValue": '1.3',
    "defaultDescription": '工作量计算 - 修改行权重（基准为1）'
  }
]

@router.get("/params", response_model=ParamsResponse)
async def get_params():
    keys = [p["key"] for p in PARAMS_DEF]
    placeholders = ",".join(["%s"] * len(keys))
    sql = f"SELECT param_key, param_value, description, updated_at FROM system_parameters WHERE param_key IN ({placeholders})"
    rows = await execute_query(sql, tuple(keys))
    row_map = {row["param_key"]: row for row in rows}

    data = []
    for p in PARAMS_DEF:
        row = row_map.get(p["key"])
        data.append(ParamItem(
            key=p["key"],
            value=row["param_value"] if row else p["defaultValue"],
            description=row["description"] if row and row["description"] else p["defaultDescription"],
            updatedAt=str(row["updated_at"]) if row and row["updated_at"] else None,
            defaultValue=p["defaultValue"]
        ))
    return {"data": data}

def _normalize_daily_ingestion_cron(value: Any) -> str:
    """
    Accept either:
      - HH:MM
      - cron(5 fields): M H * * *
    Returns a normalized string.
    """
    raw = str(value or "").strip()
    if not raw:
        return "0 2 * * *"

    # HH:MM
    import re
    m = re.match(r'^(\d{1,2}):(\d{2})$', raw)
    if m:
        hh = int(m.group(1))
        mm = int(m.group(2))
        if 0 <= hh <= 23 and 0 <= mm <= 59:
            return f"{mm} {hh} * * *"

    # Cron 5 fields
    parts = raw.split()
    if len(parts) == 5:
        try:
            minute = int(parts[0])
            hour = int(parts[1])
        except Exception:
            minute = -1
            hour = -1
        if 0 <= minute <= 59 and 0 <= hour <= 23:
            # Keep original day/month/dow parts but normalize spacing and numeric fields
            return f"{minute} {hour} {parts[2]} {parts[3]} {parts[4]}"

    raise HTTPException(status_code=400, detail="daily_ingestion_cron 格式错误：请输入 HH:MM 或 cron 5段（如：0 2 * * *）")


@router.put("/params")
async def update_params(body: Dict[str, Any]):
    # Accept both:
    #  - {"key": "value", ...}
    #  - {"params": [{"key": "...", "value": "..."}, ...]}
    updates: Dict[str, Any] = {}

    params_list = body.get("params")
    if isinstance(params_list, list):
        for item in params_list:
            if not isinstance(item, dict):
                continue
            k = item.get("key")
            if isinstance(k, str) and k:
                updates[k] = item.get("value")

    for k, v in body.items():
        if k == "params":
            continue
        updates[k] = v

    # Validate and update
    INTEGER_KEYS = {
        'minimum_commits', 'minimum_days',
        'workload_max_added',
        'default_department_id',
        'commit_batch_size',
        'sync_interval_hours',
        'retention_days',
    }
    FLOAT_KEYS = {'workload_weight_deleted', 'workload_weight_modified'}
    SWITCH_KEYS = {'daily_ingestion_enabled'}
    CRON_KEYS = {'daily_ingestion_cron'}
    STRING_KEYS = {'system_name'}
    ALLOWED_KEYS = INTEGER_KEYS | FLOAT_KEYS | SWITCH_KEYS | CRON_KEYS | STRING_KEYS

    for key, value in updates.items():
        if key not in ALLOWED_KEYS:
            continue

        if key in STRING_KEYS:
            v = str(value or "").strip()
            if len(v) > 128:
                raise HTTPException(status_code=400, detail=f"参数 {key} 过长")
            await set_system_parameter(key, v)
            continue

        if key in SWITCH_KEYS:
            if value is True or str(value).strip() == "1":
                v = "1"
            elif value is False or str(value).strip() == "0":
                v = "0"
            else:
                raise HTTPException(status_code=400, detail=f"参数 {key} 必须为 0 或 1")
            await set_system_parameter(key, v)
            continue

        if key in CRON_KEYS:
            v = _normalize_daily_ingestion_cron(value)
            await set_system_parameter(key, v)
            continue

        try:
            n = float(value)
        except (ValueError, TypeError):
            raise HTTPException(status_code=400, detail=f"参数 {key} 必须为数字")

        if n < 0:
            raise HTTPException(status_code=400, detail=f"参数 {key} 不能为负数")

        v = str(int(n)) if key in INTEGER_KEYS else str(n)
        await set_system_parameter(key, v)

    return {"success": True}

# ========== Endpoints: Monitoring ==========

MONITORING_KEYS = [
    'monitoring_start_date',
    'monitoring_last_trigger_date',
    'monitoring_commit_files_threshold',
    'monitoring_commit_files_size_threshold',
    'monitoring_commit_unexcepted_files_threshold',
    'monitoring_commit_duplicate_files_threshold',
    'monitoring_commit_code_lines_threshold',
    'monitoring_commit_code_quality_threshold',
    'monitoring_commit_submission_quality_threshold',
    'monitoring_repo_daily_commits_threshold',
    'monitoring_repo_daily_code_lines_threshold',
    'monitoring_repo_daily_files_threshold',
    'monitoring_repo_daily_file_size_threshold'
]

@router.get("/monitoring")
async def get_monitoring():
    params = await get_system_parameters(MONITORING_KEYS)
    # Ensure all keys are present, even if missing in DB (return None or empty?)
    # Node implementation returns whatever getSystemParameters returns,
    # which usually returns object with keys found.
    return params

@router.put("/monitoring")
async def update_monitoring(body: Dict[str, Any]):
    for key, value in body.items():
        if key in MONITORING_KEYS:
            await set_system_parameter(key, str(value))
    return {"success": True}

# ========== Endpoints: Sync Schedule ==========

SYNC_KEYS = [
    'commits_sync_enabled', 'commits_sync_time',
    'commits_sync_retry_count', 'commits_sync_retry_delay_secs',
    'commits_sync_last_run', 'commits_sync_last_status'
]

@router.get("/sync-schedule")
async def get_sync_schedule():
    rows = await get_system_parameters(SYNC_KEYS)
    result = {k: None for k in SYNC_KEYS}
    result.update(rows)
    return result

@router.post("/sync-schedule")
async def update_sync_schedule(body: SyncScheduleBody):
    conn_ops = []
    if body.enabled is not None:
        conn_ops.append(('commits_sync_enabled', '1' if body.enabled else '0'))
    if body.time is not None:
        # Validate time format HH:MM
        import re
        if not re.match(r'^\d{2}:\d{2}$', body.time):
             pass # Ignore invalid time? Node implementation validates.
             # We should probably behave same way. Node implementation ignores invalid but doesn't error?
             # "const time = ... validTime(body.time) ? body.time : undefined"
             # Yes, it filters invalid.
        else:
            conn_ops.append(('commits_sync_time', body.time))

    if body.retryCount is not None:
         conn_ops.append(('commits_sync_retry_count', str(max(0, int(body.retryCount)))))

    if body.retryDelay is not None:
         conn_ops.append(('commits_sync_retry_delay_secs', str(max(0, int(body.retryDelay)))))

    for k, v in conn_ops:
        await set_system_parameter(k, v)

    return {"updated": [{"key": k, "value": v} for k, v in conn_ops]}

# ========== Endpoints: Repo Sources ==========

@router.get("/repo-sources", response_model=RepoSourceListResponse)
async def list_repo_sources(
    source_type: Optional[str] = Query(None, alias="source_type"),
    is_active: Optional[str] = Query(None, alias="is_active")
):
    # Fetch active threshold
    threshold_sql = "SELECT param_value FROM system_parameters WHERE param_key = 'repo_active_threshold'"
    rows = await execute_query(threshold_sql)
    threshold = int(rows[0]["param_value"]) if rows and rows[0]["param_value"] else 90

    sql = f"""
        SELECT
          rs.id, rs.source_name, rs.source_type, rs.repos_base, rs.credential_ref,
          rs.sync_enabled, rs.last_synced_at, rs.is_active, rs.created_at, rs.updated_at,
          COALESCE(stats.total_repos, 0) as total_repos,
          COALESCE(stats.valid_repos, 0) as valid_repos,
          COALESCE(stats.active_repos, 0) as active_repos
        FROM repo_sources rs
        LEFT JOIN (
          SELECT
            repo_source_id,
            COUNT(*) as total_repos,
            SUM(CASE WHEN is_valid = 1 AND is_deleted = 0 THEN 1 ELSE 0 END) as valid_repos,
            SUM(CASE WHEN is_valid = 1 AND is_deleted = 0 AND latest_commit_at >= DATE_SUB(NOW(), INTERVAL %s DAY) THEN 1 ELSE 0 END) as active_repos
          FROM repo_catalog
          GROUP BY repo_source_id
        ) stats ON rs.id = stats.repo_source_id
        WHERE 1=1
    """
    params = [threshold]

    if source_type:
        sql += " AND rs.source_type = %s"
        params.append(source_type.upper())

    if is_active is not None and is_active != 'all':
        sql += " AND rs.is_active = %s"
        params.append(1 if is_active == '1' or is_active.lower() == 'true' else 0)

    sql += " ORDER BY rs.id ASC"

    rows = await execute_query(sql, tuple(params))

    data = [
        RepoSourceItem(
            id=row["id"],
            sourceName=row["source_name"],
            sourceType=row["source_type"],
            reposBase=row["repos_base"],
            credentialRef=row["credential_ref"],
            syncEnabled=bool(row["sync_enabled"]),
            lastSyncedAt=str(row["last_synced_at"]) if row["last_synced_at"] else None,
            isActive=bool(row["is_active"]),
            createdAt=str(row["created_at"]),
            updatedAt=str(row["updated_at"]),
            totalRepos=int(row["total_repos"] or 0),
            validRepos=int(row["valid_repos"] or 0),
            activeRepos=int(row["active_repos"] or 0)
        )
        for row in rows
    ]
    return {"data": data}

@router.post("/repo-sources")
async def create_repo_source(body: RepoSourceBody):
    if not body.sourceName or not body.sourceType:
        raise HTTPException(status_code=400, detail="源名称和源类型为必填项")

    valid_types = ['SVN', 'GIT', 'GITLAB', 'GITHUB', 'GITEE']
    source_type = body.sourceType.upper()
    if source_type not in valid_types:
         raise HTTPException(status_code=400, detail=f"无效的源类型，支持: {', '.join(valid_types)}")

    sql = """
        INSERT INTO repo_sources
          (source_name, source_type, repos_base, credential_ref, sync_enabled, is_active)
        VALUES (%s, %s, %s, %s, %s, %s)
    """
    params = (
        body.sourceName,
        source_type,
        body.reposBase,
        body.credentialRef,
        1 if body.syncEnabled else 0,
        1 if body.isActive else 0
    )

    try:
        res = await execute_insert(sql, params)
    except Exception as e:
        if "Duplicate entry" in str(e):
            raise HTTPException(status_code=409, detail=f"数据源名称 '{body.sourceName}' 已存在")
        raise HTTPException(status_code=500, detail=str(e))
    return {
        "success": True,
        "id": res,
        "message": "创建成功"
    }

@router.put("/repo-sources/{id}")
async def update_repo_source(id: int, body: RepoSourceUpdateBody):
    if not id:
        raise HTTPException(status_code=400, detail="无效的ID")

    updates = []
    params = []

    if body.sourceName is not None:
        updates.append("source_name = %s")
        params.append(body.sourceName)

    if body.sourceType is not None:
        valid_types = ['SVN', 'GIT', 'GITLAB', 'GITHUB', 'GITEE']
        source_type = body.sourceType.upper()
        if source_type not in valid_types:
             raise HTTPException(status_code=400, detail=f"无效的源类型，支持: {', '.join(valid_types)}")
        updates.append("source_type = %s")
        params.append(source_type)

    if body.reposBase is not None:
        updates.append("repos_base = %s")
        params.append(body.reposBase)

    if body.credentialRef is not None:
        updates.append("credential_ref = %s")
        params.append(body.credentialRef)

    if body.syncEnabled is not None:
        updates.append("sync_enabled = %s")
        params.append(1 if body.syncEnabled else 0)

    if body.isActive is not None:
        updates.append("is_active = %s")
        params.append(1 if body.isActive else 0)

    if not updates:
         raise HTTPException(status_code=400, detail="没有要更新的字段")

    params.append(id)
    sql = f"UPDATE repo_sources SET {', '.join(updates)} WHERE id = %s"
    await execute_update(sql, tuple(params))

    return {
        "success": True,
        "message": "更新成功"
    }

@router.delete("/repo-sources/{id}")
async def delete_repo_source(id: int):
    if not id:
        raise HTTPException(status_code=400, detail="无效的ID")

    # TODO: Check for dependencies? Node implementation doesn't check explicitly (it relies on DB constraints if any, or just deletes).
    # But usually deleting a source might cascade or fail. Assuming safe delete.
    sql = "DELETE FROM repo_sources WHERE id = %s"
    await execute_update(sql, (id,))

    return {
        "success": True,
        "message": "删除成功"
    }

# ========== Endpoints: System Users ==========

class SystemUserBody(BaseModel):
    username: str
    email: Optional[str] = None
    realName: Optional[str] = None
    role: Union[int, str] = 1  # Support int (bitmask) or str (legacy)
    isActive: Optional[bool] = None # Deprecated in favor of status
    status: Optional[int] = None # 0=Disabled, 1=Active, 2=Verifying

class SystemUserUpdateBody(BaseModel):
    username: Optional[str] = None
    email: Optional[str] = None
    realName: Optional[str] = None
    role: Optional[Union[int, str]] = None
    isActive: Optional[bool] = None # Deprecated in favor of status
    status: Optional[int] = None

# Helper to convert umask to role string (Legacy support, maybe unused now for API response)
def umask_to_role(umask: int) -> str:
    if umask & 16: return 'admin'
    if umask & 8: return 'supervisor'
    if umask & 4: return 'hr'
    if umask & 2: return 'dept_manager'
    return 'user'

# Helper to convert role string to umask
def role_to_umask(role: Union[str, int]) -> int:
    if isinstance(role, int):
        return role

    # Try to parse as int first (in case it passed as string "6")
    try:
        return int(role)
    except ValueError:
        pass

    role_map = {
        'admin': 16,
        'supervisor': 8,
        'hr': 4,
        'dept_manager': 2,
        'user': 1
    }
    return role_map.get(role, 1)

@router.get("/users")
async def list_users():
    sql = "SELECT id, username, email, umask, status, latest_logged_at, created_at FROM system_users ORDER BY id DESC"
    rows = await execute_query(sql)
    return {"data": [
        {
            "id": r["id"],
            "username": r["username"],
            "email": r["email"],
            "realName": r["username"],
            "role": r["umask"] if r["umask"] else 1, # Return raw umask integer
            "isActive": r["status"] == 1, # Keep for backward compatibility
            "status": r["status"], # Return raw status
            "lastLoginAt": str(r["latest_logged_at"]) if r["latest_logged_at"] else None,
            "createdAt": str(r["created_at"]) if r["created_at"] else None
        } for r in rows
    ]}

@router.post("/users")
async def create_user(body: SystemUserBody):
    users = await execute_query("SELECT id FROM system_users WHERE username = %s", (body.username,))
    if users:
         raise HTTPException(status_code=400, detail="用户名已存在")

    sql = """
        INSERT INTO system_users (username, email, umask, status, password_hash)
        VALUES (%s, %s, %s, %s, '')
    """
    umask = role_to_umask(body.role)

    # Determine status: explicit status > isActive > default 1
    status_val = 1
    if body.status is not None:
        status_val = body.status
    elif body.isActive is not None:
        status_val = 1 if body.isActive else 0

    params = (body.username, body.email, umask, status_val)

    res = await execute_insert(sql, params)
    return {"success": True, "id": res}

@router.put("/users/{id}")
async def update_user(id: int, body: SystemUserUpdateBody):
    if not id:
        raise HTTPException(status_code=400, detail="Invalid ID")

    updates = []
    params = []

    if body.username is not None:
        updates.append("username = %s")
        params.append(body.username)
    if body.email is not None:
        updates.append("email = %s")
        params.append(body.email)
    if body.role is not None:
        updates.append("umask = %s")
        params.append(role_to_umask(body.role))

    # Handle status update
    if body.status is not None:
        updates.append("status = %s")
        params.append(body.status)
    elif body.isActive is not None:
        updates.append("status = %s")
        params.append(1 if body.isActive else 0)

    if not updates:
        return {"success": True}

    params.append(id)
    sql = f"UPDATE system_users SET {', '.join(updates)} WHERE id = %s"
    await execute_update(sql, tuple(params))

    return {"success": True}
