"""
Dashboard API - Complete implementation of all remaining endpoints.

Includes Contributors individual, Repos ranking/trend/tree/individual,
Departments, Overview modules.
"""
from typing import List, Optional

from fastapi import APIRouter, Path, Query

from server.python_service.db import execute_query

# Create routers for each module
contributors_detail_router = APIRouter(prefix="/api/dashboard/contributors", tags=["dashboard-contributors-detail"])
repos_router = APIRouter(prefix="/api/dashboard/repos", tags=["dashboard-repos-detail"])
departments_router = APIRouter(prefix="/api/dashboard/departments", tags=["dashboard-departments"])
overview_router = APIRouter(prefix="/api/dashboard/overview", tags=["dashboard-overview"])


from server.python_service.models.dashboard import (
    ContributorRankingItem,
    DashboardStatsResponse,
)

# ========== Contributors Global Endpoints ==========

@contributors_detail_router.get("/stats", response_model=DashboardStatsResponse)
async def get_contributors_stats(dept_id: Optional[str] = Query(None, alias="deptId")):
    """
    Get overall contributor statistics.

    Returns counts of contributors, programmers, repos, and LOC metrics.
    Can be filtered by department.
    """
    dept_id_int = int(dept_id) if dept_id and dept_id.isdigit() else None

    where_clause = "WHERE 1=1"
    params = []

    if dept_id_int:
        where_clause += " AND p.department_id = %s"
        params.append(dept_id_int)

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
    if dept_id_int:
        repo_where += " AND department_id = %s"
        repo_params.append(dept_id_int)

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


@contributors_detail_router.get("/ranking", response_model=List[ContributorRankingItem])
async def get_contributors_ranking(
    dept_id: Optional[str] = Query(None, alias="deptId"),
    sort_by: str = Query("total_loc", alias="sortBy"),
):
    """
    Get contributor rankings by LOC or daily average.

    Args:
        dept_id: Filter by department ID
        sort_by: Sort by 'total_loc' or 'daily_avg'
    """
    dept_id_int = int(dept_id) if dept_id and dept_id.isdigit() else None

    where_clause = "WHERE 1=1"
    params = []

    if dept_id_int:
        where_clause += " AND p.department_id = %s"
        params.append(dept_id_int)

    # Determine order by clause
    order_by_clause = "(total_loc / NULLIF(active_days, 0))" if sort_by == "daily_avg" else "total_loc"

    sql = f"""
        SELECT
            p.id,
            COALESCE(p.real_name, p.username) as name,
            d.name as dept_name,
            SUM(spm.total_lines_changed) as total_loc,
            (
                SELECT COUNT(DISTINCT spd.stat_date)
                FROM stat_person_daily spd
                JOIN org_persons child ON (child.parent_id = p.id OR child.id = p.id)
                WHERE spd.person_id = child.id
            ) as active_days,
            SUM(spm.total_commits) as commits,
            MAX(all_p.last_commit_at) as last_commit
        FROM org_persons p
        LEFT JOIN org_departments d ON p.department_id = d.id
        LEFT JOIN org_persons all_p ON (all_p.parent_id = p.id OR all_p.id = p.id)
        LEFT JOIN stat_person_monthly spm ON all_p.id = spm.person_id
        {where_clause}
        AND p.parent_id IS NULL
        AND p.is_active = 1
        GROUP BY p.id, name, dept_name
        HAVING total_loc > 0
        ORDER BY {order_by_clause} DESC
    """

    rows = await execute_query(sql, tuple(params))

    return [
        ContributorRankingItem(
            id=row["id"],
            rank=idx + 1,
            name=row["name"],
            deptName=row["dept_name"] or "未分配",
            totalLoc=int(row["total_loc"] or 0),
            commits=int(row["commits"] or 0),
            lastCommit=row["last_commit"],
            dailyAvg=round(int(row["total_loc"] or 0) / int(row["active_days"] or 1))
                    if int(row["active_days"] or 0) > 0 else 0,
        )
        for idx, row in enumerate(rows)
    ]


@contributors_detail_router.get("/trend")
async def get_contributors_trend(dept_id: Optional[str] = Query(None, alias="deptId")):
    """
    Get monthly active contributors trend.

    Returns the count of active contributors per month.
    """
    dept_id_int = int(dept_id) if dept_id and dept_id.isdigit() else None

    where_clause = "WHERE 1=1"
    params = []

    if dept_id_int:
        where_clause += " AND p.department_id = %s"
        params.append(dept_id_int)

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


@contributors_detail_router.get("/tree")
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
        AND (d.id IS NULL OR d.is_active = 1)
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


# ========== Contributors Individual Endpoints ==========

@contributors_detail_router.get("/{person_id}/stats")
async def get_contributor_stats(person_id: str = Path(...)):
    """Get detailed stats for individual contributor."""
    if person_id == "null" or not person_id.isdigit():
        return None

    person_id_int = int(person_id)
    sql = """
        SELECT
            p.id,
            COALESCE(p.real_name, p.username) as name,
            MIN(all_p.first_commit_at) as first_commit_at,
            (
                SELECT COUNT(DISTINCT s.repo_catalog_id)
                FROM stat_person_repo_monthly s
                JOIN org_persons child ON (child.parent_id = p.id OR child.id = p.id)
                WHERE s.person_id = child.id
            ) as repo_count,
            SUM(spm.total_lines_changed) as total_loc,
            SUM(spm.workload) as workload,
            SUM(spm.total_commits) as commits,
            SUM(spm.avg_submission_quality * spm.total_commits) / NULLIF(SUM(spm.total_commits), 0) as commit_quality,
            DATEDIFF(NOW(), MIN(all_p.first_commit_at)) as days_in_service
        FROM org_persons p
        LEFT JOIN org_persons all_p ON (all_p.parent_id = p.id OR all_p.id = p.id)
        LEFT JOIN stat_person_monthly spm ON all_p.id = spm.person_id
        WHERE p.id = %s
        GROUP BY p.id;
    """
    rows = await execute_query(sql, (person_id_int,))
    if not rows:
        raise HTTPException(status_code=404, detail="Contributor not found")

    person = rows[0]
    return {
        "id": person["id"],
        "name": person["name"],
        "firstCommitAt": person["first_commit_at"],
        "repo_count": int(person["repo_count"] or 0),
        "total_loc": int(person["total_loc"] or 0),
        "net_lines_added": int(person["total_loc"] or 0),
        "workload": int(person["workload"] or 0),
        "commits": int(person["commits"] or 0),
        "days_in_service": int(person["days_in_service"] or 0),
        "commitQuality": float(person["commit_quality"]) if person.get("commit_quality") is not None else None,
    }


@contributors_detail_router.get("/{person_id}/trend")
async def get_contributor_trend(person_id: str = Path(...)):
    """Get monthly trend for individual contributor."""
    if person_id == "null" or not person_id.isdigit():
        return []
    person_id_int = int(person_id)
    sql = """
        SELECT
            sprm.stat_year,
            sprm.stat_month,
            COUNT(DISTINCT sprm.repo_catalog_id) as repo_count,
            SUM(sprm.total_lines_changed) as loc_changed
        FROM stat_person_repo_monthly sprm
        WHERE sprm.person_id = %s
        GROUP BY sprm.stat_year, sprm.stat_month
        ORDER BY sprm.stat_year, sprm.stat_month
    """
    rows = await execute_query(sql, (person_id_int,))
    return [
        {
            "date": f"{row['stat_year']}-{str(row['stat_month']).zfill(2)}",
            "repoCount": int(row["repo_count"] or 0),
            "locChanged": int(row["loc_changed"] or 0)
        }
        for row in rows
    ]

@contributors_detail_router.get("/{person_id}/distribution")
async def get_contributor_distribution(person_id: str = Path(...)):
    """Get contribution distribution by repo and language."""
    if person_id == "null" or not person_id.isdigit():
        return {"repos": [], "languages": []}
    person_id_int = int(person_id)

    # 1. Repo Distribution (Top 10 repos by LOC)
    repo_sql = """
        SELECT
            r.name,
            SUM(sprm.total_lines_changed) as value
        FROM stat_person_repo_monthly sprm
        JOIN repo_catalog r ON sprm.repo_catalog_id = r.id
        WHERE sprm.person_id = %s
        GROUP BY r.name
        ORDER BY value DESC
        LIMIT 10
    """
    repo_rows = await execute_query(repo_sql, (person_id_int,))
    repos = [{"name": row["name"], "value": int(row["value"] or 0)} for row in repo_rows]

    # 2. Language Distribution (Based on repo languages weighted by contribution or simplified)
    # Simplified: Sum of language breakdown for repos touched by person?
    # Better: Use file extensions from `repo_commit_files` if available, but that's heavy.
    # Alternative: Just return empty or mocked if we can't easily calculate per-person language stats without huge query.
    # Let's try to infer from repos they contribute to, weighted by their LOC in that repo vs repo total LOC?
    # For now, let's just return Top Repos as proxy or skip languages if too complex.
    # Frontend expects {repos: [], languages: []}.
    # Let's aggregated language breakdown of repos they contribute to.

    lang_sql = """
        SELECT r.language_breakdown
        FROM stat_person_repo_monthly sprm
        JOIN repo_catalog r ON sprm.repo_catalog_id = r.id
        WHERE sprm.person_id = %s
        GROUP BY r.id, r.language_breakdown
    """
    lang_rows = await execute_query(lang_sql, (person_id_int,))

    import json
    lang_map = {}

    for row in lang_rows:
        if not row["language_breakdown"]:
            continue
        try:
            lb = row["language_breakdown"]
            if isinstance(lb, str):
                lb = json.loads(lb)

            # lb indicates repo composition. We don't know exactly what the person wrote.
            # But we can aggregate.
            if isinstance(lb, list):
                for item in lb:
                    name = item.get("name") or item.get("language")
                    val = int(item.get("value") or item.get("files") or 0)
                    lang_map[name] = lang_map.get(name, 0) + val
            elif isinstance(lb, dict):
                for name, val in lb.items():
                    lang_map[name] = lang_map.get(name, 0) + int(val or 0)
        except:
            pass

    languages = [{"name": k, "value": v} for k, v in lang_map.items()]
    languages.sort(key=lambda x: x["value"], reverse=True)

    return {"repos": repos, "languages": languages[:10]}


@contributors_detail_router.get("/{person_id}/heatmap_years")
async def get_contributor_heatmap_years(person_id: str = Path(...)):
    """Get available years for heatmap."""
    if person_id == "null" or not person_id.isdigit():
        return []
    person_id_int = int(person_id)

    sql = """
        SELECT DISTINCT YEAR(stat_date) as stat_year
        FROM stat_person_daily
        WHERE person_id = %s
        ORDER BY stat_year DESC
    """
    rows = await execute_query(sql, (person_id_int,))
    return [row["stat_year"] for row in rows]


@contributors_detail_router.get("/{person_id}/heatmap")
async def get_contributor_heatmap(
    person_id: str = Path(...),
    year: int = Query(...)
):
    """Get daily contribution heatmap data."""
    if person_id == "null" or not person_id.isdigit():
        return []
    person_id_int = int(person_id)

    sql = """
        SELECT stat_date, total_lines_changed
        FROM stat_person_daily
        WHERE person_id = %s AND YEAR(stat_date) = %s
        ORDER BY stat_date
    """
    rows = await execute_query(sql, (person_id_int, year))

    return [
        {
            "date": str(row["stat_date"]),
            "count": int(row["total_lines_changed"] or 0)
        }
        for row in rows
    ]
# ========== Repos Endpoints ==========

@repos_router.get("/stats")
async def get_repos_stats(dept_id: Optional[str] = Query(None, alias="deptId")):
    """Get global or department repository statistics."""
    dept_id_int = int(dept_id) if dept_id and dept_id.isdigit() else None

    # Base filter for Repos
    repo_where = "WHERE is_valid = 1 AND is_deleted = 0"
    if dept_id_int:
        repo_where += f" AND department_id = {dept_id_int}"

    # 1. Get Repo Counts & Total Commits from repo_catalog
    sql_repos = f"""
        SELECT
            COUNT(*) as total_repos,
            SUM(CASE WHEN latest_commit_at >= DATE_SUB(NOW(), INTERVAL 90 DAY) THEN 1 ELSE 0 END) as active_repos,
            SUM(total_commits) as total_commits
        FROM repo_catalog
        {repo_where}
    """
    rows_repos = await execute_query(sql_repos, ())
    res = rows_repos[0]

    # 2. Get Total LOC (sum of latest monthly stat per repo)
    # This is complex in SQL, so we can use a simplifying assumption or subquery
    loc_where = ""
    if dept_id_int:
        loc_where = f"AND r.department_id = {dept_id_int}"

    sql_loc = f"""
        SELECT SUM(last_day_lines) as total_loc
        FROM (
            SELECT
                r.id,
                (SELECT last_day_lines FROM stat_repo_monthly
                 WHERE repo_catalog_id = r.id
                 ORDER BY stat_year DESC, stat_month DESC LIMIT 1) as last_day_lines
            FROM repo_catalog r
            WHERE r.is_valid = 1 AND r.is_deleted = 0
            {loc_where}
        ) as repo_locs
    """
    rows_loc = await execute_query(sql_loc, ())
    total_loc = int(rows_loc[0]["total_loc"] or 0)

    # 3. Get Total Files
    # Count of non-deleted files in valid repos
    file_where = "r.is_valid = 1 AND r.is_deleted = 0"
    if loc_where: # Reuse existing filter variable logic
        file_where += f" {loc_where}"

    sql_files = f"""
        SELECT COUNT(*) as total_files
        FROM repo_files f
        JOIN repo_catalog r ON f.repo_catalog_id = r.id
        WHERE f.is_deleted = 0 AND {file_where}
    """
    rows_files = await execute_query(sql_files, ())
    total_files = int(rows_files[0]["total_files"] or 0)

    # Calculate avg
    total_repos = int(res["total_repos"] or 0)
    avg_loc = total_loc // total_repos if total_repos > 0 else 0

    return {
        "totalRepos": total_repos,
        "activeRepos": int(res["active_repos"] or 0),
        "totalCommits": int(res["total_commits"] or 0),
        "totalLoc": total_loc,
        "totalFiles": total_files,
        "avgLoc": avg_loc,
        "activeThreshold": 90
    }

@repos_router.get("/ranking")
async def get_repos_ranking(
    dept_id: Optional[str] = Query(None, alias="deptId"),
    sort_by: str = Query("total_loc", alias="sortBy"),
):
    """Get repository rankings."""
    dept_id_int = int(dept_id) if dept_id and dept_id.isdigit() else None
    dept_filter = f"AND r.department_id = {dept_id_int}" if dept_id_int else ""
    order_by = "commits DESC" if sort_by == "commits" else "total_loc DESC"

    sql = f"""
        SELECT
            r.id,
            r.name,
            COALESCE(d.name, '未分配') as dept_name,
            r.total_commits as commits,
            COALESCE(
                (SELECT last_day_lines FROM stat_repo_monthly
                 WHERE repo_catalog_id = r.id
                 ORDER BY stat_year DESC, stat_month DESC LIMIT 1),
                0
            ) as total_loc,
            r.latest_commit_at
        FROM repo_catalog r
        LEFT JOIN org_departments d ON r.department_id = d.id
        WHERE r.is_valid = 1 AND r.is_deleted = 0
        {dept_filter}
        ORDER BY {order_by}
        LIMIT 50
    """
    rows = await execute_query(sql, ())
    return [
        {
            "id": r["id"],
            "rank": i + 1,
            "name": r["name"],
            "deptName": r["dept_name"],
            "totalLoc": int(r["total_loc"] or 0),
            "commits": int(r["commits"] or 0),
            "lastCommit": r["latest_commit_at"],
        }
        for i, r in enumerate(rows)
    ]


@repos_router.get("/trend")
async def get_repos_trend(dept_id: Optional[str] = Query(None, alias="deptId")):
    """Get monthly active repos trend."""
    dept_id_int = int(dept_id) if dept_id and dept_id.isdigit() else None
    where_clause = f"WHERE r.department_id = {dept_id_int}" if dept_id_int else "WHERE 1=1"

    sql = f"""
        SELECT
            srm.stat_year,
            srm.stat_month,
            COUNT(DISTINCT srm.repo_catalog_id) as active_repos,
            SUM(srm.total_commits) as commits,
            SUM(srm.total_lines_changed) as loc_changed,
            SUM(srm.active_contributors) as contributors
        FROM stat_repo_monthly srm
        JOIN repo_catalog r ON srm.repo_catalog_id = r.id
        {where_clause}
        GROUP BY srm.stat_year, srm.stat_month
        ORDER BY srm.stat_year, srm.stat_month
    """
    rows = await execute_query(sql, ())
    return [
        {
            "date": f"{row['stat_year']}-{str(row['stat_month']).zfill(2)}",
            "value": int(row["active_repos"] or 0), # Backward compat
            "activeRepos": int(row["active_repos"] or 0),
            "commits": int(row["commits"] or 0),
            "locChanged": int(row["loc_changed"] or 0),
            "contributors": int(row["contributors"] or 0)
        }
        for row in rows
    ]


@repos_router.get("/tree")
async def get_repos_tree(sort_by: str = Query("total_loc", alias="sortBy")):
    """Get repos tree grouped by department."""
    order_col = "total_loc DESC" if sort_by == "total_loc" else "r.latest_commit_at DESC"

    sql = f"""
        SELECT
            COALESCE(d.id, 999) as dept_id,
            COALESCE(d.name, '未分配部门') as dept_name,
            r.id as repo_id,
            r.name as repo_name,
            COALESCE(
                (SELECT last_day_lines FROM stat_repo_monthly
                 WHERE repo_catalog_id = r.id
                 ORDER BY stat_year DESC, stat_month DESC LIMIT 1),
                0
            ) as total_loc,
            r.latest_commit_at
        FROM repo_catalog r
        LEFT JOIN org_departments d ON r.department_id = d.id
        WHERE r.is_valid = 1 AND r.is_deleted = 0
        AND (d.id IS NULL OR d.is_active = 1)
        ORDER BY dept_id, {order_col}
    """
    rows = await execute_query(sql, ())

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
            "id": row["repo_id"],
            "label": row["repo_name"],
            "type": "repo",
            "total_loc": int(row["total_loc"] or 0),
            "last_commit": row["latest_commit_at"],
        })

    result = list(dept_map.values())
    if 999 in dept_map:
        unassigned = dept_map[999]
        result.remove(unassigned)
        result.append(unassigned)
    return result


@repos_router.get("/{repo_id}/stats")
async def get_repo_stats(repo_id: str = Path(...)):
    """Get detailed stats for individual repository."""
    if repo_id == "null" or not repo_id.isdigit():
        return None
    repo_id_int = int(repo_id)
    sql = """
        SELECT
            r.id,
            r.name,
            r.description,
            r.repo_created_at,
            d.name as dept_name,
            r.total_commits,
            r.latest_commit_at,
            (
                SELECT last_day_lines FROM stat_repo_monthly
                WHERE repo_catalog_id = r.id
                ORDER BY stat_year DESC, stat_month DESC LIMIT 1
            ) as total_loc,
            (
                SELECT COUNT(DISTINCT person_id)
                FROM stat_person_repo_monthly
                WHERE repo_catalog_id = r.id
            ) as contributor_count,
            (
                SELECT COUNT(*)
                FROM repo_files
                WHERE repo_catalog_id = r.id AND is_deleted = 0
            ) as total_files
        FROM repo_catalog r
        LEFT JOIN org_departments d ON r.department_id = d.id
        WHERE r.id = %s
    """
    rows = await execute_query(sql, (repo_id_int,))
    if not rows:
        return None

    repo = rows[0]
    return {
        "id": repo["id"],
        "name": repo["name"],
        "description": repo["description"] or "",
        "createdAt": str(repo["repo_created_at"]) if repo["repo_created_at"] else None,
        "deptName": repo["dept_name"] or "未分配",
        "totalLoc": int(repo["total_loc"] or 0),
        "totalCommits": int(repo["total_commits"] or 0),
        "totalContributors": int(repo["contributor_count"] or 0),
        "totalFiles": int(repo["total_files"] or 0),
    }


@repos_router.get("/{repo_id}/trend")
async def get_repo_trend(repo_id: str = Path(...)):
    """Get monthly trend for individual repository."""
    if repo_id == "null" or not repo_id.isdigit():
        return []
    repo_id_int = int(repo_id)
    sql = """
        SELECT
            stat_year,
            stat_month,
            total_commits as commits,
            total_lines_changed as loc_changed,
            active_contributors as contributors,
            last_day_lines as value
        FROM stat_repo_monthly
        WHERE repo_catalog_id = %s
        ORDER BY stat_year, stat_month
    """
    rows = await execute_query(sql, (repo_id_int,))
    return [
        {
            "date": f"{row['stat_year']}-{str(row['stat_month']).zfill(2)}",
            "value": int(row["value"] or 0),
            "commits": int(row["commits"] or 0),
            "locChanged": int(row["loc_changed"] or 0),
            "contributors": int(row["contributors"] or 0)
        }
        for row in rows
    ]


@repos_router.get("/{repo_id}/contributors")
async def get_repo_contributors(repo_id: str = Path(...)):
    """Get top contributors for a repository."""
    if repo_id == "null" or not repo_id.isdigit():
        return []
    repo_id_int = int(repo_id)
    sql = """
        SELECT
            p.id,
            COALESCE(p.real_name, p.username) as name,
            SUM(sprm.total_lines_changed) as total_loc,
            SUM(sprm.total_commits) as commits
        FROM stat_person_repo_monthly sprm
        JOIN org_persons p ON sprm.person_id = p.id
        WHERE sprm.repo_catalog_id = %s
        GROUP BY p.id, name
        ORDER BY total_loc DESC
        LIMIT 20
    """
    rows = await execute_query(sql, (repo_id_int,))
    return [
        {
            "rank": idx + 1,
            "name": row["name"],
            "loc": int(row["total_loc"] or 0),
            "commits": int(row["commits"] or 0),
        }
        for idx, row in enumerate(rows)
    ]


@repos_router.get("/{repo_id}/growth")
async def get_repo_growth(repo_id: str = Path(...)):
    """Get growth trend. (Not implemented yet)"""
    return []


@repos_router.get("/{repo_id}/distribution")
async def get_repo_distribution(repo_id: str = Path(...)):
    """Get language distribution for repository."""
    if repo_id == "null" or not repo_id.isdigit():
        return {"languages": []}

    repo_id_int = int(repo_id)

    sql = """
        SELECT language_breakdown
        FROM repo_catalog
        WHERE id = %s
    """

    rows = await execute_query(sql, (repo_id_int,))
    if not rows or not rows[0]["language_breakdown"]:
        return {"languages": []}

    # Parse JSON language_breakdown
    import json
    language_data = rows[0]["language_breakdown"]

    # Handle both string JSON and already-parsed dict/list
    if isinstance(language_data, str):
        try:
            languages = json.loads(language_data)
        except:
            return {"languages": []}
    else:
        languages = language_data

    # Convert to expected format: [{name, value}, ...]
    # language_breakdown format is typically: [{"language": "Python", "files": 100}, ...]
    # or {"Python": 100, "JavaScript": 50}
    result = []

    if isinstance(languages, list):
        # List format: [{"language": "Python", "files": 100}, ...] or [{"name": "Python", "value": 100}, ...]
        result = [
            {
                "name": lang.get("name") or lang.get("language") or "Unknown",
                "value": int(lang.get("value") or lang.get("files") or 0)
            }
            for lang in languages
            if isinstance(lang, dict)
        ]
    elif isinstance(languages, dict):
        # Dict format: {"Python": 100, "JavaScript": 50}
        result = [
            {"name": name, "value": int(value or 0)}
            for name, value in languages.items()
        ]

    return {"languages": result}


# ========== Departments Endpoints ==========

@departments_router.get("/treemap")
async def get_departments_treemap():
    """Get department treemap data with LOC distribution."""
    # Get all repos with their LOC
    sql = """
        SELECT
            COALESCE(d.name, '未分配') as dept_name,
            r.name as repo_name,
            COALESCE(
                (SELECT last_day_lines FROM stat_repo_monthly
                 WHERE repo_catalog_id = r.id
                 ORDER BY stat_year DESC, stat_month DESC LIMIT 1),
                0
            ) as total_loc
        FROM repo_catalog r
        LEFT JOIN org_departments d ON r.department_id = d.id
        WHERE r.is_valid = 1 AND r.is_deleted = 0
        HAVING total_loc > 0
        ORDER BY total_loc DESC
    """
    rows = await execute_query(sql, ())

    # Build hierarchy: Root -> Dept -> Repo
    dept_map = {}
    for row in rows:
        dept_name = row["dept_name"]
        if dept_name not in dept_map:
            dept_map[dept_name] = {"name": dept_name, "children": []}

        dept_map[dept_name]["children"].append({
            "name": row["repo_name"],
            "value": int(row["total_loc"] or 0)
        })

    return {
        "name": "Departments",
        "children": list(dept_map.values())
    }


# ========== Overview Endpoints ==========

@overview_router.get("/sankey")
async def get_overview_sankey():
    """Get Sankey diagram data showing dept -> repo -> person relationships."""
    # Simplified version - returns dept to repo to person flow
    sql = """
        SELECT
            COALESCE(d.name, '未分配') as dept_name,
            r.name as repo_name,
            COALESCE(p.real_name, p.username) as person_name,
            SUM(sprm.total_lines_changed) as value
        FROM stat_person_repo_monthly sprm
        JOIN repo_catalog r ON sprm.repo_catalog_id = r.id
        JOIN org_persons p ON sprm.person_id = p.id
        LEFT JOIN org_departments d ON p.department_id = d.id
        WHERE r.is_valid = 1
        GROUP BY dept_name, repo_name, person_name
        HAVING value > 1000
        ORDER BY value DESC
        LIMIT 200
    """
    rows = await execute_query(sql, ())

    # Format for Sankey: nodes and links
    nodes_map = {}  # name -> category
    links = []

    for row in rows:
        dept = row["dept_name"]
        repo = row["repo_name"]
        person = row["person_name"]
        value = int(row["value"] or 0)

        nodes_map[dept] = "department"
        nodes_map[repo] = "repo"
        nodes_map[person] = "person"

        links.append({"source": dept, "target": repo, "value": value})
        links.append({"source": repo, "target": person, "value": value})

    # Sort nodes by name for consistency
    nodes_list = [
        {"id": name, "name": name, "category": cat}
        for name, cat in sorted(nodes_map.items())
    ]

    return {
        "nodes": nodes_list,
        "links": links[:100],  # Limit for performance
    }

