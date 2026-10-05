"""
Repos Management API - Complete implementation.

Includes repository listing, details, stats, sync status, and management endpoints.
"""
from typing import List, Optional, Dict

from fastapi import APIRouter, Path, Query, Body
from pydantic import BaseModel, Field, ConfigDict

from server.python_service.db import execute_query, execute_update

router = APIRouter(prefix="/api/repos", tags=["repos"])


# ========== Pydantic Models ==========

class RepoListItem(BaseModel):
    """Repository list item."""
    model_config = ConfigDict(populate_by_name=True)

    id: int
    name: str
    repo_key: str = Field(..., alias="repoKey")
    description: Optional[str] = None
    default_branch: Optional[str] = Field(None, alias="defaultBranch")
    source_type: Optional[str] = Field(None, alias="sourceType")
    source_id: Optional[int] = Field(None, alias="sourceId")
    repo_source: Optional[str] = Field(None, alias="repoSource")
    department_id: Optional[int] = Field(None, alias="departmentId")
    department_name: Optional[str] = Field(None, alias="departmentName")
    is_valid: bool = Field(..., alias="isValid")
    latest_commit_at: Optional[str] = Field(None, alias="latestCommitAt")
    total_commits: int = Field(0, alias="totalCommits")
    synced_commits: int = Field(0, alias="syncedCommits")
    ingested_commits: int = Field(0, alias="ingestedCommits")
    current_year_commits: int = Field(0, alias="currentYearCommits")
    last_scanned_at: Optional[str] = Field(None, alias="lastScannedAt")
    repo_created_at: Optional[str] = Field(None, alias="repoCreatedAt")
    scan_status: Optional[str] = Field(None, alias="scanStatus")


class RepoDetail(BaseModel):
    """Repository detail response."""
    model_config = ConfigDict(populate_by_name=True)

    id: int
    name: str
    url: Optional[str] = None
    description: Optional[str] = None
    default_branch: Optional[str] = Field(None, alias="defaultBranch")
    source_type: Optional[str] = Field(None, alias="sourceType")
    is_valid: int = Field(..., alias="isValid")
    total_commits: int = Field(0, alias="totalCommits")
    latest_revision: Optional[str] = Field(None, alias="latestRevision")
    latest_commit_at: Optional[str] = Field(None, alias="latestCommitAt")
    repo_created_at: Optional[str] = Field(None, alias="repoCreatedAt")
    last_scanned_at: Optional[str] = Field(None, alias="lastScannedAt")
    department_id: Optional[int] = Field(None, alias="departmentId")
    repo_events: int = Field(0, alias="repoEvents")
    commits_events: int = Field(0, alias="commitsEvents")
    code_lines: int = Field(0, alias="codeLines") # Add placeholder or calc


class SyncStatus(BaseModel):
    """Sync/progress status."""
    status: str
    progress: Optional[dict] = None


# ========== Repository Management Endpoints ==========

class RepoListResponse(BaseModel):
    data: List[RepoListItem]
    meta: Dict[str, int]

@router.get("", response_model=RepoListResponse)
@router.get("/", response_model=RepoListResponse, include_in_schema=False)
async def list_repos(
    page: int = Query(1, ge=1),
    page_size: int = Query(20, ge=1, le=10000, alias="pageSize"),
    source_id: Optional[int] = Query(None, alias="repoSourceId"), # Align alias with Node client usage if needed, or stick to sourceId. Node code supports 'repoSourceId' param.
    source_type: Optional[str] = Query(None, alias="sourceType"),
    dept_id: Optional[int] = Query(None, alias="deptId"),
    is_valid_param: Optional[str] = Query(None, alias="isValid"), # Receive as string to handle "true"/"1"
    active_sources_only: Optional[str] = Query(None, alias="activeSourcesOnly"),
    search: Optional[str] = None,
):
    """
    Get paginated list of repositories with filtering.
    """
    where_clauses = ["r.is_deleted = 0"]
    params = []

    if source_id:
        where_clauses.append("r.repo_source_id = %s")
        params.append(source_id)
    elif active_sources_only and active_sources_only != '0' and active_sources_only.lower() != 'false':
        where_clauses.append("rs.is_active = 1")

    if source_type:
        where_clauses.append("r.source_type = %s")
        params.append(source_type)

    if dept_id:
        where_clauses.append("r.department_id = %s")
        params.append(dept_id)

    if is_valid_param is not None:
        is_valid_bool = is_valid_param == '1' or is_valid_param.lower() == 'true'
        where_clauses.append("r.is_valid = %s")
        params.append(1 if is_valid_bool else 0)

    if search:
        where_clauses.append("(r.name LIKE %s OR r.repo_key LIKE %s)")
        params.append(f"%{search}%")
        params.append(f"%{search}%")

    where_clause = " AND ".join(where_clauses)

    # Get total count (need left join repo_sources for active filtering)
    count_sql = f"""
        SELECT COUNT(*) as total
        FROM repo_catalog r
        LEFT JOIN repo_sources rs ON r.repo_source_id = rs.id
        WHERE {where_clause}
    """
    count_rows = await execute_query(count_sql, tuple(params))
    total = count_rows[0]["total"] if count_rows else 0

    offset = (page - 1) * page_size

    sql = f"""
        SELECT
            r.id,
            r.repo_key,
            r.name,
            r.description,
            r.default_branch,
            r.source_type,
            r.repo_source_id as source_id,
            rs.source_name as repo_source,
            r.department_id,
            d.name as department_name,
            r.is_valid,
            r.latest_commit_at,
            r.total_commits,
            r.synced_commits,
            r.ingested_commits,
            r.current_year_commits,
            r.last_scanned_at,
            r.repo_created_at,
            r.scan_status
        FROM repo_catalog r
        LEFT JOIN repo_sources rs ON r.repo_source_id = rs.id
        LEFT JOIN org_departments d ON r.department_id = d.id
        WHERE {where_clause}
        ORDER BY r.latest_commit_at IS NULL, r.latest_commit_at DESC, r.id DESC
        LIMIT %s OFFSET %s
    """

    rows = await execute_query(sql, tuple(params + [page_size, offset]))

    data = [
        RepoListItem(
            id=row["id"],
            repoKey=row["repo_key"],
            name=row["name"],
            description=row["description"],
            defaultBranch=row["default_branch"],
            sourceType=row["source_type"],
            sourceId=row["source_id"],
            repoSource=row["repo_source"],
            departmentId=row["department_id"],
            departmentName=row["department_name"],
            isValid=bool(row["is_valid"]),
            latestCommitAt=str(row["latest_commit_at"]) if row["latest_commit_at"] else None,
            totalCommits=int(row["total_commits"] or 0),
            syncedCommits=int(row["synced_commits"] or 0),
            ingestedCommits=int(row["ingested_commits"] or 0),
            currentYearCommits=int(row["current_year_commits"] or 0),
            lastScannedAt=str(row["last_scanned_at"]) if row["last_scanned_at"] else None,
            repoCreatedAt=str(row["repo_created_at"]) if row["repo_created_at"] else None,
            scanStatus=row["scan_status"]
        )
        for row in rows
    ]

    return {
        "data": data,
        "meta": {
            "page": page,
            "pageSize": page_size,
            "total": total
        }
    }


@router.get("/active")
async def get_active_repos():
    """Get count of active repositories."""
    param_sql = "SELECT param_value FROM system_parameters WHERE param_key = %s"
    param_rows = await execute_query(param_sql, ("repo_active_threshold",))
    threshold = int(param_rows[0]["param_value"] or 60) if param_rows else 60

    sql = f"""
        SELECT COUNT(*) as count
        FROM repo_catalog
        WHERE is_deleted = 0
        AND is_valid = 1
        AND latest_commit_at >= DATE_SUB(NOW(), INTERVAL {threshold} DAY)
    """

    rows = await execute_query(sql, ())
    return {"count": int(rows[0]["count"] or 0) if rows else 0}


@router.get("/sync-status")
async def get_sync_status(source_id: Optional[int] = Query(None, alias="sourceId")):
    """Get synchronization status for repositories."""
    where = f"WHERE repo_source_id = {source_id}" if source_id else "WHERE 1=1"

    sql = f"""
        SELECT
            COUNT(*) as total,
            SUM(CASE WHEN files_ingested = 1 THEN 1 ELSE 0 END) as synced,
            MAX(updated_at) as last_sync
        FROM repo_commits
        JOIN repo_catalog ON repo_commits.repo_catalog_id = repo_catalog.id
        {where}
    """

    rows = await execute_query(sql, ())
    if not rows:
        return {"status": "unknown"}

    row = rows[0]
    total = int(row["total"] or 0)
    synced = int(row["synced"] or 0)

    return {
        "status": "synced" if synced == total and total > 0 else "syncing",
        "progress": {
            "total": total,
            "synced": synced,
            "percentage": round(synced / total * 100, 2) if total > 0 else 0,
        },
        "lastSync": row["last_sync"],
    }


# ========== Stats Endpoints (must be before /{repo_id}) ==========

@router.get("/{repo_id}/stats/years")
async def get_repo_stats_years(repo_id: int = Path(...)):
    """Get list of years with commit data for repository."""
    sql = """
        SELECT DISTINCT YEAR(stat_date) as year
        FROM stat_repo_daily
        WHERE repo_catalog_id = %s
        ORDER BY year DESC
    """

    rows = await execute_query(sql, (repo_id,))
    return [int(row["year"]) for row in rows]


@router.get("/{repo_id}/stats/daily")
async def get_repo_stats_daily(
    repo_id: int = Path(...),
    year: Optional[str] = Query(None)
):
    """Get daily commit statistics for repository heatmap."""
    sql = """
        SELECT
            stat_date as date,
            commits as count
        FROM stat_repo_daily
        WHERE repo_catalog_id = %s
    """

    params = [repo_id]

    if year:
        sql += " AND YEAR(stat_date) = %s"
        params.append(year)
    else:
        # Default to last 366 days if no year specified
        sql += " AND stat_date >= DATE_SUB(CURDATE(), INTERVAL 1 YEAR)"

    sql += " ORDER BY stat_date ASC"

    rows = await execute_query(sql, tuple(params))

    return [
        {
            "date": str(row["date"]),
            "count": int(row["count"] or 0)
        }
        for row in rows
    ]


@router.get("/{repo_id}/stats/contributors")
async def get_repo_contributor_stats(repo_id: int = Path(...)):
    """Get contributor statistics for a repository."""
    sql = """
        SELECT
            p.id,
            COALESCE(p.real_name, p.username) as name,
            SUM(sprm.total_lines_changed) as total_loc,
            SUM(sprm.total_commits) as commits,
            MIN(sprm.first_commit_at) as first_commit_at,
            MAX(sprm.last_commit_at) as last_commit_at
        FROM stat_person_repo_monthly sprm
        JOIN org_persons p ON sprm.person_id = p.id
        WHERE sprm.repo_catalog_id = %s
        GROUP BY p.id, name
        ORDER BY total_loc DESC
        LIMIT 50
    """

    rows = await execute_query(sql, (repo_id,))

    return [
        {
            "id": row["id"],
            "name": row["name"],
            "value": int(row["total_loc"] or 0),
            "totalLoc": int(row["total_loc"] or 0),
            "commits": int(row["commits"] or 0),
            "firstCommitAt": row["first_commit_at"],
            "lastCommitAt": row["last_commit_at"],
        }
        for row in rows
    ]


# ========== Repository Management Endpoints ==========

@router.get("/{repo_id}", response_model=RepoDetail)
async def get_repo_detail(repo_id: int = Path(...)):
    """Get detailed information for a specific repository."""
    sql = """
        SELECT
            id,
            name,
            repo_path,
            description,
            default_branch,
            source_type,
            is_valid,
            total_commits,
            latest_revision,
            latest_commit_at,
            repo_created_at,
            last_scanned_at,
            department_id,
            repo_events,
            commits_events
        FROM repo_catalog
        WHERE id = %s
    """

    rows = await execute_query(sql, (repo_id,))
    if not rows:
        return None

    row = rows[0]
    return RepoDetail(
        id=row["id"],
        name=row["name"],
        url=row["repo_path"],
        description=row["description"],
        default_branch=row["default_branch"],
        source_type=row["source_type"],
        is_valid=row["is_valid"],
        total_commits=int(row["total_commits"] or 0),
        latest_revision=row["latest_revision"],
        latest_commit_at=str(row["latest_commit_at"]) if row["latest_commit_at"] else None,
        repo_created_at=str(row["repo_created_at"]) if row["repo_created_at"] else None,
        last_scanned_at=str(row["last_scanned_at"]) if row["last_scanned_at"] else None,
        department_id=row["department_id"],
        repo_events=int(row["repo_events"] or 0),
        commits_events=int(row["commits_events"] or 0),
        code_lines=0 # Placeholder or fetch from stats
    )


@router.patch("/{repo_id}/active")
async def update_repo_active_status(
    repo_id: int = Path(...),
    is_valid: int = Body(..., embed=True),
):
    """Update repository active/valid status."""
    sql = "UPDATE repo_catalog SET is_valid = %s WHERE id = %s"
    await execute_update(sql, (is_valid, repo_id))

    return {"success": True, "id": repo_id, "is_valid": is_valid}


@router.patch("/{repo_id}/department")
async def update_repo_department(
    repo_id: int = Path(...),
    department_id: Optional[int] = Body(None, embed=True, alias="departmentId"),
):
    """Update repository department assignment."""
    sql = "UPDATE repo_catalog SET department_id = %s WHERE id = %s"
    await execute_update(sql, (department_id, repo_id))

    return {"success": True, "id": repo_id, "departmentId": department_id}


@router.get("/{repo_id}/commits")
async def get_repo_commits(
    repo_id: int = Path(...),
    page: int = Query(1, ge=1),
    page_size: int = Query(20, ge=1, le=100),
):
    """Get commit history for a repository."""
    offset = (page - 1) * page_size

    sql = """
        SELECT
            rc.id,
            rc.revision as commit_hash,
            rc.message as commit_message,
            rc.author_name,
            rc.author_email,
            rc.committed_at,
            rc.files_added as files_changed,
            rc.lines_added,
            rc.lines_deleted
        FROM repo_commits rc
        WHERE rc.repo_catalog_id = %s
        ORDER BY rc.committed_at DESC
        LIMIT %s OFFSET %s
    """

    rows = await execute_query(sql, (repo_id, page_size, offset))

    return [
        {
            "id": row["id"],
            "revision": row["commit_hash"],
            "message": row["commit_message"],
            "author": row["author_name"],
            "authorEmail": row["author_email"],
            "committedAt": row["committed_at"],
            "filesChanged": int(row["files_changed"] or 0),
            "linesAdded": int(row["lines_added"] or 0),
            "linesDeleted": int(row["lines_deleted"] or 0),
        }
        for row in rows
    ]



