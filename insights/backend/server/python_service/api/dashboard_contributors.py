"""
Dashboard API endpoints - Contributors module.

Implements statistics, rankings, trends, and distribution data for contributors.
"""
from typing import List, Optional

from fastapi import APIRouter, Query

from server.python_service.db import execute_query
from server.python_service.models.dashboard import (
    ContributorRankingItem,
    DashboardStatsResponse,
)

router = APIRouter(prefix="/api/dashboard/contributors", tags=["dashboard-contributors"])


@router.get("/stats", response_model=DashboardStatsResponse)
async def get_contributors_stats(dept_id: Optional[int] = Query(None, alias="deptId")):
    """
    Get overall contributor statistics.

    Returns counts of contributors, programmers, repos, and LOC metrics.
    Can be filtered by department.
    """
    where_clause = "WHERE 1=1"
    params = []

    if dept_id:
        where_clause += " AND p.department_id = %s"
        params.append(dept_id)

    # 1. Total Contributors (Active Main Accounts)
    count_sql = f"""
        SELECT COUNT(*) as total_contributors
        FROM org_persons p
        {where_clause}
        AND p.parent_id IS NULL
        AND p.is_active = 1
    """
    count_rows = await execute_query(count_sql, tuple(params))
    total_contributors = int(count_rows[0]["total_contributors"] or 0) if count_rows else 0

    # 2. Total Programmers (is_coder = 1)
    coder_sql = f"""
        SELECT COUNT(*) as total_programmers
        FROM org_persons p
        {where_clause}
        AND p.parent_id IS NULL
        AND p.is_active = 1
        AND p.is_coder = 1
    """
    coder_rows = await execute_query(coder_sql, tuple(params))
    total_programmers = int(coder_rows[0]["total_programmers"] or 0) if coder_rows else 0

    # 3. Repository Stats - Get active threshold
    param_sql = "SELECT param_value FROM system_parameters WHERE param_key = %s"
    param_rows = await execute_query(param_sql, ("repo_active_threshold",))
    limit_days = int(param_rows[0]["param_value"] or 30) if param_rows else 30

    repo_where = "WHERE is_deleted = 0"
    repo_params = []
    if dept_id:
        repo_where += " AND department_id = %s"
        repo_params.append(dept_id)

    repo_sql = f"""
        SELECT
            COUNT(*) as total_repos,
            SUM(CASE WHEN latest_commit_at > DATE_SUB(NOW(), INTERVAL %s DAY) THEN 1 ELSE 0 END) as active_repos
        FROM repo_catalog
        {repo_where}
    """
    repo_rows = await execute_query(repo_sql, tuple([limit_days] + repo_params))
    total_repos = int(repo_rows[0]["total_repos"] or 0) if repo_rows else 0
    active_repos = int(repo_rows[0]["active_repos"] or 0) if repo_rows else 0

    # 4. Total LOC
    loc_sql = f"""
        SELECT SUM(sprm.total_lines_changed) as total_loc
        FROM stat_person_repo_monthly sprm
        JOIN org_persons p ON sprm.person_id = p.id
        {where_clause}
    """
    loc_rows = await execute_query(loc_sql, tuple(params))
    total_loc = int(loc_rows[0]["total_loc"] or 0) if loc_rows else 0

    # 5. Avg LOC
    avg_loc = round(total_loc / total_programmers) if total_programmers > 0 else 0

    return DashboardStatsResponse(
        totalContributors=total_contributors,
        totalProgrammers=total_programmers,
        totalRepos=total_repos,
        activeRepos=active_repos,
        totalLoc=total_loc,
        avgLoc=avg_loc,
    )


@router.get("/ranking", response_model=List[ContributorRankingItem])
async def get_contributors_ranking(
    dept_id: Optional[int] = Query(None, alias="deptId"),
    sort_by: str = Query("total_loc", alias="sortBy"),
):
    """
    Get contributor rankings by LOC or daily average.

    Args:
        dept_id: Filter by department ID
        sort_by: Sort by 'total_loc' or 'daily_avg'
    """
    where_clause = "WHERE 1=1"
    params = []

    if dept_id:
        where_clause += " AND p.department_id = %s"
        params.append(dept_id)

    # Determine order by clause
    order_by_clause = "(total_loc / NULLIF(active_days, 0))" if sort_by == "daily_avg" else "total_loc"

    sql = f"""
        SELECT
            p.id,
            COALESCE(p.real_name, p.username) as name,
            SUM(spm.total_lines_changed) as total_loc,
            (
                SELECT COUNT(DISTINCT spd.stat_date)
                FROM stat_person_daily spd
                JOIN org_persons child ON (child.parent_id = p.id OR child.id = p.id)
                WHERE spd.person_id = child.id
            ) as active_days
        FROM org_persons p
        LEFT JOIN org_persons child ON (child.parent_id = p.id OR child.id = p.id)
        LEFT JOIN stat_person_monthly spm ON child.id = spm.person_id
        {where_clause}
        AND p.parent_id IS NULL
        AND p.is_active = 1
        GROUP BY p.id, name
        HAVING total_loc > 0
        ORDER BY {order_by_clause} DESC
    """

    rows = await execute_query(sql, tuple(params))

    return [
        ContributorRankingItem(
            id=row["id"],
            name=row["name"],
            totalLoc=int(row["total_loc"] or 0),
            dailyAvg=round(int(row["total_loc"] or 0) / int(row["active_days"] or 1))
                    if int(row["active_days"] or 0) > 0 else 0,
        )
        for row in rows
    ]


@router.get("/trend")
async def get_contributors_trend(dept_id: Optional[int] = Query(None, alias="deptId")):
    """
    Get monthly active contributors trend.

    Returns the count of active contributors per month.
    """
    where_clause = "WHERE 1=1"
    params = []

    if dept_id:
        where_clause += " AND p.department_id = %s"
        params.append(dept_id)

    sql = f"""
        SELECT
            sprm.stat_year,
            sprm.stat_month,
            COUNT(DISTINCT COALESCE(p.parent_id, p.id)) as active_contributors
        FROM stat_person_repo_monthly sprm
        JOIN org_persons p ON sprm.person_id = p.id
        {where_clause}
        GROUP BY sprm.stat_year, sprm.stat_month
        ORDER BY sprm.stat_year, sprm.stat_month
    """

    rows = await execute_query(sql, tuple(params))

    return [
        {
            "date": f"{row['stat_year']}-{str(row['stat_month']).zfill(2)}",
            "value": int(row["active_contributors"] or 0),
        }
        for row in rows
    ]


@router.get("/tree")
async def get_contributors_tree(sort_by: str = Query("total_loc", alias="sortBy")):
    """
    Get contributors tree grouped by department.

    Returns hierarchical data: departments -> contributors.
    Sort by total_loc or last_commit.
    """
    sql = f"""
        SELECT
            COALESCE(d.id, 999) as dept_id,
            COALESCE(d.name, '未分配部门') as dept_name,
            p.id as person_id,
            COALESCE(p.real_name, p.username) as person_name,
            SUM(spm.total_lines_changed) as total_loc,
            MAX(child.last_commit_at) as last_commit
        FROM org_persons p
        LEFT JOIN org_departments d ON p.department_id = d.id
        LEFT JOIN org_persons child ON (child.parent_id = p.id OR child.id = p.id)
        LEFT JOIN stat_person_monthly spm ON child.id = spm.person_id
        WHERE p.parent_id IS NULL
        AND p.is_active = 1
        GROUP BY d.id, d.name, p.id, p.real_name, p.username
        ORDER BY dept_id, {'total_loc DESC' if sort_by == 'total_loc' else 'last_commit DESC'}
    """

    rows = await execute_query(sql, ())

    # Transform to tree format
    dept_map = {}

    for row in rows:
        dept_id = row["dept_id"]

        if dept_id not in dept_map:
            dept_map[dept_id] = {
                "id": dept_id,
                "label": row["dept_name"],
                "type": "department",
                "children": [],
            }

        dept_map[dept_id]["children"].append({
            "id": row["person_id"],
            "label": row["person_name"],
            "type": "person",
            "total_loc": int(row["total_loc"] or 0),
            "last_commit": row["last_commit"],
        })

    # Sort children within departments
    for dept in dept_map.values():
        if sort_by == "total_loc":
            dept["children"].sort(key=lambda x: x["total_loc"], reverse=True)
        else:
            dept["children"].sort(
                key=lambda x: x["last_commit"] or "", reverse=True
            )

    result = list(dept_map.values())

    # Move unassigned dept to end
    if 999 in dept_map:
        unassigned = dept_map[999]
        result.remove(unassigned)
        result.append(unassigned)

    return result
