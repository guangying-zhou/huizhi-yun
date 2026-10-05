"""
Dashboard API endpoints - Repos module.

Implements statistics, rankings, trends, and distribution data for repositories.
"""
from typing import Optional

from fastapi import APIRouter, Query

from server.python_service.db import execute_query
from server.python_service.models.dashboard import RepoStatsResponse

router = APIRouter(prefix="/api/dashboard/repos", tags=["dashboard-repos"])


@router.get("/stats", response_model=RepoStatsResponse)
async def get_repos_stats(dept_id: Optional[int] = Query(None, alias="deptId")):
    """
    Get overall repository statistics.

    Returns counts of repositories, commits, and LOC metrics.
    Can be filtered by department.
    """
    # Fetch active threshold from system parameters
    param_sql = "SELECT param_value FROM system_parameters WHERE param_key = %s"
    param_rows = await execute_query(param_sql, ("repo_active_threshold",))
    active_threshold = int(param_rows[0]["param_value"] or 90) if param_rows else 90

    # Build department filter
    dept_filter = f"AND r.department_id = {dept_id}" if dept_id else ""
    dept_filter_r2 = f"AND r2.department_id = {dept_id}" if dept_id else ""

    # Main statistics query
    stats_sql = f"""
        SELECT
            COUNT(DISTINCT r.id) as total_repos,
            SUM(CASE WHEN r.latest_commit_at >= DATE_SUB(NOW(), INTERVAL {active_threshold} DAY) THEN 1 ELSE 0 END) as active_repos,
            SUM(r.total_commits) as total_commits,
            (
                SELECT SUM(last_day_lines)
                FROM stat_repo_monthly srm
                JOIN (
                    SELECT repo_catalog_id, MAX(CONCAT(stat_year, '-', LPAD(stat_month,2,'0'))) as max_ym
                    FROM stat_repo_monthly
                    GROUP BY repo_catalog_id
                ) latest ON srm.repo_catalog_id = latest.repo_catalog_id
                  AND CONCAT(srm.stat_year, '-', LPAD(srm.stat_month,2,'0')) = latest.max_ym
                JOIN repo_catalog r2 ON srm.repo_catalog_id = r2.id
                WHERE r2.is_valid = 1 AND r2.is_deleted = 0
                {dept_filter_r2}
            ) as total_loc
        FROM repo_catalog r
        WHERE r.is_valid = 1 AND r.is_deleted = 0
        {dept_filter}
    """

    rows = await execute_query(stats_sql, ())
    stats = rows[0] if rows else {}

    total_loc = int(stats.get("total_loc") or 0)
    total_repos = int(stats.get("total_repos") or 0)

    return RepoStatsResponse(
        totalRepos=total_repos,
        activeRepos=int(stats.get("active_repos") or 0),
        totalCommits=int(stats.get("total_commits") or 0),
        totalLoc=total_loc,
        avgLoc=round(total_loc / total_repos) if total_repos > 0 else 0,
        activeThreshold=active_threshold,
    )
