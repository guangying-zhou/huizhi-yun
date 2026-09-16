import logging
import json
import datetime
from typing import Dict, List, Optional, Any, Union
from fastapi import APIRouter, HTTPException, Query, Path
from pydantic import BaseModel, Field

from server.python_service.config import Config
try:
    import mysql.connector
except ImportError:
    mysql = None

router = APIRouter(prefix="/api/dashboard", tags=["dashboard"])
LOGGER = logging.getLogger(__name__)

# ========== Models ==========

class DatabaseSettings(BaseModel):
    host: Optional[str] = Field(None, description="Database host")
    port: Optional[int] = Field(None, description="Database port")
    user: Optional[str] = Field(None, description="Database user name")
    password: Optional[str] = Field(None, description="Database password")
    name: Optional[str] = Field(None, description="Database schema name")

# ========== Helpers ==========

def parse_optional_int(value: Union[str, int, None] = None) -> Optional[int]:
    """Convert empty string, 'null', 'undefined' to None, otherwise parse as int."""
    if value is None or value == "" or (isinstance(value, str) and value.lower() in ('null', 'undefined')):
        return None
    try:
        return int(value)
    except (ValueError, TypeError):
        return None

def _db_conn(settings: Optional[DatabaseSettings] = None):
    host = settings.host if settings and settings.host else Config.DB_HOST
    port = settings.port if settings and settings.port else Config.DB_PORT
    user = settings.user if settings and settings.user else Config.DB_USER
    password = settings.password if settings and settings.password else Config.DB_PASSWORD
    database = settings.name if settings and settings.name else Config.DB_NAME
    return mysql.connector.connect(host=host, port=port, user=user, password=password, database=database)

# ========== Overview Endpoints ==========

@router.get("/overview/sankey")
def get_sankey(
    year: Optional[int] = None,
    repoLimit: int = 20,
    personLimit: int = 50,
    db: Optional[DatabaseSettings] = None
) -> Dict[str, Any]:
    try:
        y = year if year is not None else datetime.datetime.now().year

        conn = _db_conn(db)
        cur = conn.cursor(dictionary=True)

        where_clause = "WHERE 1=1"
        params = []
        if y != 0:
            where_clause += " AND stat_year = %s"
            # CTEs + Main Query need params.
            # With formatting, we pass them as args.
            # TopRepos: 1 param. TopPersons: 1 param. Main: 1 param.
            # Total 3 params.
            params = [y, y, y]

        sql = f"""
            WITH TopRepos AS (
              SELECT repo_catalog_id
              FROM stat_person_repo_monthly
              {where_clause}
              GROUP BY repo_catalog_id
              ORDER BY SUM(total_lines_changed) DESC
              LIMIT {repoLimit}
            ),
            TopPersons AS (
              SELECT person_id
              FROM stat_person_repo_monthly
              {where_clause}
              GROUP BY person_id
              ORDER BY SUM(total_lines_changed) DESC
              LIMIT {personLimit}
            )
            SELECT
              COALESCE(d.id, 999) as dept_id,
              COALESCE(d.name, '未分配部门') as dept_name,
              r.id as repo_id,
              r.name as repo_name,
              p.id as person_id,
              COALESCE(p.real_name, p.username) as person_name,
              SUM(sprm.total_lines_changed) as total_lines
            FROM stat_person_repo_monthly sprm
            JOIN TopRepos tr ON sprm.repo_catalog_id = tr.repo_catalog_id
            JOIN TopPersons tp ON sprm.person_id = tp.person_id
            JOIN repo_catalog r ON sprm.repo_catalog_id = r.id
            LEFT JOIN org_persons p ON sprm.person_id = p.id
            LEFT JOIN org_departments d ON r.department_id = d.id
            {where_clause.replace('WHERE 1=1', 'WHERE sprm.stat_year IS NOT NULL' if y != 0 else 'WHERE 1=1')}
            AND p.is_active = 1
            GROUP BY dept_id, dept_name, repo_id, repo_name, person_id, person_name
            HAVING total_lines > 0
            ORDER BY total_lines DESC
        """

        cur.execute(sql, tuple(params))
        rows = cur.fetchall()

        nodes_map = {}
        links_map = {}

        for row in rows:
            lines = float(row['total_lines'])
            dept_node_id = f"dept_{row['dept_id']}"
            repo_node_id = f"repo_{row['repo_id']}"
            person_node_id = f"person_{row['person_id']}"

            for nid, name, cat in [
                (dept_node_id, row['dept_name'], 'department'),
                (repo_node_id, row['repo_name'], 'repo'),
                (person_node_id, row['person_name'], 'person')
            ]:
                if nid not in nodes_map:
                    nodes_map[nid] = {'id': nid, 'name': name, 'category': cat, 'totalLines': 0.0}
                nodes_map[nid]['totalLines'] += lines

            link_dept_repo = f"{dept_node_id}|{repo_node_id}"
            links_map[link_dept_repo] = links_map.get(link_dept_repo, 0.0) + lines

            link_repo_person = f"{repo_node_id}|{person_node_id}"
            links_map[link_repo_person] = links_map.get(link_repo_person, 0.0) + lines

        all_nodes = list(nodes_map.values())

        # Sort by category and lines
        dept_nodes = sorted([n for n in all_nodes if n['category'] == 'department'], key=lambda x: x['totalLines'], reverse=True)
        repo_nodes = sorted([n for n in all_nodes if n['category'] == 'repo'], key=lambda x: x['totalLines'], reverse=True)
        person_nodes = sorted([n for n in all_nodes if n['category'] == 'person'], key=lambda x: x['totalLines'], reverse=True)

        nodes = dept_nodes + repo_nodes + person_nodes
        # Clean for response
        final_nodes = [{'id': n['id'], 'name': n['name'], 'category': n['category']} for n in nodes]

        links = [{'source': k.split('|')[0], 'target': k.split('|')[1], 'value': v} for k, v in links_map.items()]

        return {"nodes": final_nodes, "links": links}
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc))
    finally:
         try: conn.close()
         except: pass

# ========== Repos Endpoints ==========

@router.get("/repos/ranking")
def get_repos_ranking(
    deptId: Union[str, int, None] = None,
    sortBy: str = 'total_loc',
    db: Optional[DatabaseSettings] = None
) -> List[Dict[str, Any]]:
    deptId = parse_optional_int(deptId)
    try:
        conn = _db_conn(db)
        cur = conn.cursor(dictionary=True)

        dept_filter = ""
        params = []
        if deptId:
            dept_filter = "AND r.department_id = %s"
            params.append(deptId)

        order_by = "total_loc DESC"
        if sortBy == 'commits': order_by = "commits DESC"

        sql = f"""
            SELECT
              r.id,
              r.name,
              r.department_id,
              COALESCE(d.name, '未分配') as dept_name,
              r.total_commits as commits,
              COALESCE(
                (SELECT last_day_lines FROM stat_repo_monthly WHERE repo_catalog_id = r.id ORDER BY stat_year DESC, stat_month DESC LIMIT 1),
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
        cur.execute(sql, tuple(params))
        rows = cur.fetchall()

        return [{
            "id": r['id'],
            "rank": i + 1,
            "name": r['name'],
            "deptName": r['dept_name'],
            "totalLoc": float(r['total_loc']),
            "commits": float(r['commits']),
            "lastCommit": str(r['latest_commit_at']) if r['latest_commit_at'] else None
        } for i, r in enumerate(rows)]
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc))
    finally:
         try: conn.close()
         except: pass

@router.get("/repos/stats")
def get_repos_stats(
    deptId: Union[str, int, None] = None,
    db: Optional[DatabaseSettings] = None
) -> Dict[str, Any]:
    deptId = parse_optional_int(deptId)
    try:
        conn = _db_conn(db)
        cur = conn.cursor(dictionary=True)

        cur.execute("SELECT param_value FROM system_parameters WHERE param_key = 'repo_active_threshold'")
        p_row = cur.fetchone()
        active_threshold = int(p_row['param_value']) if p_row and p_row['param_value'] else 90

        params = [active_threshold]
        if deptId: params.append(deptId)

        # NOTE: deptId needs to be injected into subquery too?
        # Node impl: "AND r2.department_id = " + deptId
        # We need to pass it twice if using positional args.

        sub_dept_filter = ""
        if deptId:
            sub_dept_filter = "AND r2.department_id = %s"
            params.append(deptId)

        sql = f"""
            SELECT
              COUNT(DISTINCT r.id) as total_repos,
              SUM(CASE WHEN r.latest_commit_at >= DATE_SUB(NOW(), INTERVAL %s DAY) THEN 1 ELSE 0 END) as active_repos,
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
                {sub_dept_filter}
              ) as total_loc
            FROM repo_catalog r
            WHERE r.is_valid = 1 AND r.is_deleted = 0
            {("AND r.department_id = %s" if deptId else "")}
        """
        cur.execute(sql, tuple(params))
        stats = cur.fetchone() or {}

        total_loc = float(stats.get('total_loc') or 0)
        total_repos = float(stats.get('total_repos') or 0)

        return {
            "totalRepos": total_repos,
            "activeRepos": float(stats.get('active_repos') or 0),
            "totalCommits": float(stats.get('total_commits') or 0),
            "totalLoc": total_loc,
            "avgLoc": round(total_loc / total_repos) if total_repos > 0 else 0,
            "activeThreshold": active_threshold
        }
    except Exception as exc:
         raise HTTPException(status_code=500, detail=str(exc))
    finally:
         try: conn.close()
         except: pass

@router.get("/repos/tree")
def get_repos_tree(
    sortBy: str = 'total_loc',
    db: Optional[DatabaseSettings] = None
) -> List[Dict[str, Any]]:
    try:
        conn = _db_conn(db)
        cur = conn.cursor(dictionary=True)

        order_clause = "total_loc DESC"
        if sortBy != 'total_loc':
             order_clause = "last_commit IS NULL ASC, last_commit DESC"

        sql = f"""
            SELECT
              COALESCE(d.id, 999) as dept_id,
              COALESCE(d.name, '未分配部门') as dept_name,
              r.id as repo_id,
              r.name as repo_name,
              COALESCE(
                (SELECT last_day_lines FROM stat_repo_monthly WHERE repo_catalog_id = r.id ORDER BY stat_year DESC, stat_month DESC LIMIT 1),
                0
              ) as total_loc,
              r.latest_commit_at as last_commit
            FROM repo_catalog r
            LEFT JOIN org_departments d ON r.department_id = d.id
            WHERE r.is_valid = 1 AND r.is_deleted = 0
            AND (d.id IS NULL OR d.is_active = 1)
            ORDER BY dept_id, {order_clause}
        """
        cur.execute(sql)
        rows = cur.fetchall()

        dept_map = {}
        unassigned_dept = {'id': 999, 'label': '未分配部门', 'children': [], 'type': 'department'}

        for row in rows:
            dept_id = row['dept_id']
            if dept_id not in dept_map:
                if dept_id == 999:
                    dept = unassigned_dept
                else:
                    dept = {'id': dept_id, 'label': row['dept_name'], 'children': [], 'type': 'department'}
                dept_map[dept_id] = dept
            else:
                dept = dept_map[dept_id]

            dept['children'].append({
                'id': row['repo_id'],
                'label': row['repo_name'],
                'type': 'repo',
                'total_loc': float(row['total_loc']),
                'last_commit': str(row['last_commit']) if row['last_commit'] else None
            })

        # Sort children
        for dept in dept_map.values():
            dept['children'].sort(
                key=lambda x: (
                    x['total_loc'] if sortBy == 'total_loc' else
                    (datetime.datetime.strptime(x['last_commit'], '%Y-%m-%d %H:%M:%S').timestamp() if x['last_commit'] else 0)
                ),
                reverse=True
            )

        result = list(dept_map.values())
        if 999 in dept_map:
            # Move unassigned to end
            u = dept_map[999]
            if u in result:
                result.remove(u)
                result.append(u)

        return result
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc))
    finally:
         try: conn.close()
         except: pass

@router.get("/repos/trend")
def get_repos_trend(
    deptId: Union[str, int, None] = None,
    db: Optional[DatabaseSettings] = None
) -> List[Dict[str, Any]]:
    deptId = parse_optional_int(deptId)
    try:
        conn = _db_conn(db)
        cur = conn.cursor(dictionary=True)

        params = []
        dept_filter = ""
        if deptId:
            dept_filter = "AND r.department_id = %s"
            params.append(deptId)

        sql = f"""
            SELECT
              CONCAT(srm.stat_year, '-', LPAD(srm.stat_month, 2, '0')) as date,
              SUM(srm.total_commits) as commits,
              SUM(srm.total_lines_changed) as locChanged,
              COUNT(DISTINCT CASE WHEN srm.total_commits > 0 THEN srm.repo_catalog_id END) as activeRepos
            FROM stat_repo_monthly srm
            JOIN repo_catalog r ON srm.repo_catalog_id = r.id
            WHERE r.is_valid = 1 AND r.is_deleted = 0
            {dept_filter}
            AND CONCAT(srm.stat_year, '-', LPAD(srm.stat_month, 2, '0')) >= DATE_FORMAT(DATE_SUB(NOW(), INTERVAL 12 MONTH), '%Y-%m')
            GROUP BY date
            ORDER BY date ASC
        """
        cur.execute(sql, tuple(params))
        rows = cur.fetchall()

        return [{
            "date": r['date'],
            "commits": float(r['commits']),
            "locChanged": float(r['locChanged']),
            "activeRepos": float(r['activeRepos'])
        } for r in rows]
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc))
    finally:
         try: conn.close()
         except: pass

@router.get("/repos/{id}/contributors")
def get_repo_contributors(
    id: Union[str, int],
    db: Optional[DatabaseSettings] = None
) -> List[Dict[str, Any]]:
    id = parse_optional_int(id)
    if id is None:
        raise HTTPException(status_code=422, detail="Invalid repo ID")
    try:
        conn = _db_conn(db)
        cur = conn.cursor(dictionary=True)
        sql = """
            SELECT
              p.id as person_id,
              COALESCE(p.real_name, p.username) as name,
              SUM(sprm.total_commits) as commits,
              SUM(sprm.total_lines_changed) as loc,
              MAX(sprm.stat_year * 100 + sprm.stat_month) as last_activity_ym
            FROM stat_person_repo_monthly sprm
            JOIN org_persons p ON sprm.person_id = p.id
            WHERE sprm.repo_catalog_id = %s
            GROUP BY p.id, name
            ORDER BY loc DESC
            LIMIT 20
        """
        cur.execute(sql, (id,))
        rows = cur.fetchall()
        return [{
            "rank": i + 1,
            "name": r['name'],
            "commits": float(r['commits']),
            "loc": float(r['loc'])
        } for i, r in enumerate(rows)]
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc))
    finally:
         try: conn.close()
         except: pass

@router.get("/repos/{id}/distribution")
def get_repo_distribution(
    id: Union[str, int],
    db: Optional[DatabaseSettings] = None
) -> Dict[str, Any]:
    id = parse_optional_int(id)
    if id is None:
        raise HTTPException(status_code=422, detail="Invalid repo ID")
    try:
        conn = _db_conn(db)
        cur = conn.cursor(dictionary=True)
        cur.execute("SELECT language_breakdown FROM repo_catalog WHERE id = %s", (id,))
        row = cur.fetchone()

        result = []
        if row and row['language_breakdown']:
            try:
                lb = row['language_breakdown']
                if isinstance(lb, str): lb = json.loads(lb)
                result = lb if isinstance(lb, list) else []
            except: pass

        result.sort(key=lambda x: (1 if x.get('name') == 'Other' else 0, -float(x.get('value', 0))))

        return {"languages": result}
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc))
    finally:
         try: conn.close()
         except: pass

@router.get("/repos/{id}/growth")
def get_repo_growth(
    id: Union[str, int],
    db: Optional[DatabaseSettings] = None
) -> List[Dict[str, Any]]:
    id = parse_optional_int(id)
    if id is None:
        raise HTTPException(status_code=422, detail="Invalid repo ID")
    try:
        conn = _db_conn(db)
        cur = conn.cursor(dictionary=True)
        sql = """
            SELECT
              stat_year,
              stat_month,
              last_day_lines
            FROM stat_repo_monthly
            WHERE repo_catalog_id = %s
            ORDER BY stat_year ASC, stat_month ASC
        """
        cur.execute(sql, (id,))
        rows = cur.fetchall()
        return [{
            "date": f"{r['stat_year']}-{str(r['stat_month']).zfill(2)}",
            "value": float(r['last_day_lines'])
        } for r in rows]
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc))
    finally:
         try: conn.close()
         except: pass

@router.get("/repos/{id}/stats")
def get_repo_detail_stats(
    id: Union[str, int],
    db: Optional[DatabaseSettings] = None
) -> Dict[str, Any]:
    id = parse_optional_int(id)
    if id is None:
        raise HTTPException(status_code=422, detail="Invalid repo ID")
    try:
        conn = _db_conn(db)
        cur = conn.cursor(dictionary=True)
        sql = """
            SELECT
              r.id,
              r.name,
              r.description,
              r.repo_created_at,
              r.total_commits,
              COALESCE(d.name, '未分配') as dept_name,
              r.language_breakdown,
              COALESCE(
                (SELECT last_day_lines FROM stat_repo_monthly WHERE repo_catalog_id = r.id ORDER BY stat_year DESC, stat_month DESC LIMIT 1),
                0
              ) as total_loc,
              (SELECT COUNT(DISTINCT author_name) FROM repo_commits WHERE repo_catalog_id = r.id) as total_contributors
            FROM repo_catalog r
            LEFT JOIN org_departments d ON r.department_id = d.id
            WHERE r.id = %s
        """
        cur.execute(sql, (id,))
        row = cur.fetchone()

        if not row:
            raise HTTPException(status_code=404, detail="Repo not found")

        total_files = 0
        if row['language_breakdown']:
            try:
                lb = row['language_breakdown']
                if isinstance(lb, str): lb = json.loads(lb)
                if isinstance(lb, list):
                    total_files = sum(float(item.get('value', 0)) for item in lb)
            except: pass

        return {
            "id": row['id'],
            "name": row['name'],
            "description": row['description'],
            "createdAt": str(row['repo_created_at']) if row['repo_created_at'] else None,
            "deptName": row['dept_name'],
            "totalLoc": float(row['total_loc']),
            "totalCommits": float(row['total_commits']),
            "totalContributors": int(row['total_contributors']),
            "totalFiles": total_files
        }
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc))
    finally:
         try: conn.close()
         except: pass

@router.get("/repos/{id}/trend")
def get_repo_detail_trend(
    id: Union[str, int],
    db: Optional[DatabaseSettings] = None
) -> List[Dict[str, Any]]:
    id = parse_optional_int(id)
    if id is None:
        raise HTTPException(status_code=422, detail="Invalid repo ID")
    try:
        conn = _db_conn(db)
        cur = conn.cursor(dictionary=True)
        sql = """
            SELECT
              CONCAT(stat_year, '-', LPAD(stat_month, 2, '0')) as date,
              total_commits as commits,
              active_contributors,
              total_lines_changed as locChanged
            FROM stat_repo_monthly
            WHERE repo_catalog_id = %s
            ORDER BY stat_year, stat_month
        """
        cur.execute(sql, (id,))
        rows = cur.fetchall()
        return [{
            "date": r['date'],
            "commits": float(r['commits']),
            "contributors": float(r['active_contributors']),
            "locChanged": float(r['locChanged'])
        } for r in rows]
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc))
    finally:
         try: conn.close()
         except: pass

# ========== Contributors Endpoints ==========

@router.get("/contributors/ranking")
def get_contributors_ranking(
    deptId: Union[str, int, None] = None,
    sortBy: str = 'total_loc',
    db: Optional[DatabaseSettings] = None
) -> List[Dict[str, Any]]:
    # ... Implementation of ranking logic ...
    deptId = parse_optional_int(deptId)
    try:
        conn = _db_conn(db)
        cur = conn.cursor(dictionary=True)

        where_clause = "WHERE 1=1"
        params = []
        if deptId:
            where_clause += " AND p.department_id = %s"
            params.append(deptId)

        params.append(0) # For HAVING total_loc > ? (placeholder for 0)

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
            HAVING total_loc > %s
            ORDER BY {(
                '(total_loc / NULLIF(active_days, 0))' if sortBy == 'daily_avg' else 'total_loc'
            )} DESC
        """
        cur.execute(sql, tuple(params))
        rows = cur.fetchall()

        return [{
            "id": r['id'],
            "name": r['name'],
            "totalLoc": float(r['total_loc']),
            "dailyAvg": round(float(r['total_loc']) / r['active_days']) if r['active_days'] > 0 else 0
        } for r in rows]
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc))
    finally:
         try: conn.close()
         except: pass

@router.get("/contributors/stats")
def get_contributors_stats(
    deptId: Union[str, int, None] = None,
    db: Optional[DatabaseSettings] = None
) -> Dict[str, Any]:
    deptId = parse_optional_int(deptId)
    try:
        conn = _db_conn(db)
        cur = conn.cursor(dictionary=True)

        params = []
        where_clause = "WHERE 1=1"
        if deptId:
            where_clause += " AND p.department_id = %s"
            params.append(deptId)

        # Total Contributors
        sql = f"SELECT COUNT(*) as c FROM org_persons p {where_clause} AND p.parent_id IS NULL AND p.is_active = 1"
        cur.execute(sql, tuple(params))
        total_contributors = int((cur.fetchone() or {}).get('c', 0))

        # Total Programmers
        sql = f"SELECT COUNT(*) as c FROM org_persons p {where_clause} AND p.parent_id IS NULL AND p.is_active = 1 AND p.is_coder = 1"
        cur.execute(sql, tuple(params))
        total_programmers = int((cur.fetchone() or {}).get('c', 0))

        # Repo Stats
        # Active threshold param
        cur.execute("SELECT param_value FROM system_parameters WHERE param_key = 'repo_active_threshold'")
        p_row = cur.fetchone()
        limit_days = int(p_row['param_value']) if p_row and p_row['param_value'] else 30

        repo_params = [limit_days]
        repo_where = "WHERE is_deleted = 0"
        if deptId:
            repo_where += " AND department_id = %s"
            repo_params.append(deptId)

        sql = f"""
            SELECT
              COUNT(*) as total_repos,
              SUM(CASE WHEN latest_commit_at > DATE_SUB(NOW(), INTERVAL %s DAY) THEN 1 ELSE 0 END) as active_repos
            FROM repo_catalog
            {repo_where}
        """
        cur.execute(sql, tuple(repo_params))
        rr = cur.fetchone() or {}
        total_repos = int(rr.get('total_repos', 0))
        active_repos = int(rr.get('active_repos', 0))

        # Total LOC
        sql = f"""
            SELECT SUM(sprm.total_lines_changed) as total_loc
            FROM stat_person_repo_monthly sprm
            JOIN org_persons p ON sprm.person_id = p.id
            {where_clause}
        """
        cur.execute(sql, tuple(params))
        total_loc = float((cur.fetchone() or {}).get('total_loc', 0))

        avg_loc = round(total_loc / total_programmers) if total_programmers > 0 else 0

        return {
            "totalContributors": total_contributors,
            "totalProgrammers": total_programmers,
            "totalRepos": total_repos,
            "activeRepos": active_repos,
            "totalLoc": total_loc,
            "avgLoc": avg_loc
        }
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc))
    finally:
         try: conn.close()
         except: pass

@router.get("/contributors/tree")
def get_contributors_tree(
    sortBy: str = 'total_loc',
    db: Optional[DatabaseSettings] = None
) -> List[Dict[str, Any]]:
    try:
        conn = _db_conn(db)
        cur = conn.cursor(dictionary=True)

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
            WHERE p.parent_id IS NULL AND p.is_active = 1
            AND (d.id IS NULL OR d.is_active = 1)
            GROUP BY d.id, d.name, p.id, p.real_name, p.username
            ORDER BY dept_id, {( 'total_loc DESC' if sortBy == 'total_loc' else 'last_commit DESC' )}
        """
        cur.execute(sql)
        rows = cur.fetchall()

        dept_map = {}
        unassigned_dept = {'id': 999, 'label': '未分配部门', 'children': [], 'type': 'department'}

        for row in rows:
            dept_id = row['dept_id']
            if dept_id not in dept_map:
                if dept_id == 999:
                    dept = unassigned_dept
                else:
                    dept = {'id': dept_id, 'label': row['dept_name'], 'children': [], 'type': 'department'}
                dept_map[dept_id] = dept
            else:
                dept = dept_map[dept_id]

            dept['children'].append({
                'id': row['person_id'],
                'label': row['person_name'],
                'type': 'person',
                'total_loc': float(row['total_loc'] or 0),
                'last_commit': str(row['last_commit']) if row['last_commit'] else None
            })

        for dept in dept_map.values():
            dept['children'].sort(
                key=lambda x: (
                    x['total_loc'] if sortBy == 'total_loc' else
                    (datetime.datetime.strptime(x['last_commit'], '%Y-%m-%d %H:%M:%S').timestamp() if x['last_commit'] else 0)
                ),
                reverse=True
            )

        result = list(dept_map.values())
        if 999 in dept_map:
            u = dept_map[999]
            if u in result:
                result.remove(u)
                result.append(u)

        return result
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc))
    finally:
         try: conn.close()
         except: pass

@router.get("/contributors/trend")
def get_contributors_trend(
    deptId: Union[str, int, None] = None,
    db: Optional[DatabaseSettings] = None
) -> List[Dict[str, Any]]:
    deptId = parse_optional_int(deptId)
    try:
        conn = _db_conn(db)
        cur = conn.cursor(dictionary=True)

        params = []
        where_clause = "WHERE 1=1"
        if deptId:
            where_clause += " AND p.department_id = %s"
            params.append(deptId)

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
        cur.execute(sql, tuple(params))
        rows = cur.fetchall()
        return [{
            "date": f"{r['stat_year']}-{str(r['stat_month']).zfill(2)}",
            "value": int(r['active_contributors'])
        } for r in rows]
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc))
    finally:
         try: conn.close()
         except: pass

@router.get("/contributors/{id}/distribution")
def get_contributor_distribution(
    id: Union[str, int],
    db: Optional[DatabaseSettings] = None
) -> Dict[str, Any]:
    id = parse_optional_int(id)
    if id is None:
        raise HTTPException(status_code=422, detail="Invalid contributor ID")
    try:
        conn = _db_conn(db)
        cur = conn.cursor(dictionary=True)

        # 1. Repo Dist
        sql = """
            SELECT
              r.name,
              SUM(s.total_lines_changed) as value
            FROM stat_person_repo_monthly s
            JOIN org_persons child ON s.person_id = child.id
            JOIN repo_catalog r ON s.repo_catalog_id = r.id
            WHERE (child.parent_id = %s OR child.id = %s)
            GROUP BY r.id, r.name
            ORDER BY value DESC
            LIMIT 10
        """
        cur.execute(sql, (id, id))
        repos = cur.fetchall()

        # 2. Lang Dist
        sql = "SELECT language_breakdown FROM org_persons WHERE id = %s OR parent_id = %s"
        cur.execute(sql, (id, id))
        l_rows = cur.fetchall()

        lang_map = {}
        for row in l_rows:
            if row['language_breakdown']:
                try:
                    lb = row['language_breakdown']
                    if isinstance(lb, str): lb = json.loads(lb)
                    if isinstance(lb, list):
                        for item in lb:
                            lang_map[item['name']] = lang_map.get(item['name'], 0) + float(item['value'])
                except: pass

        langs = [{'name': k, 'value': v} for k, v in lang_map.items()]
        langs.sort(key=lambda x: (1 if x['name'] == 'Other' else 0, -x['value']))
        langs = langs[:10]

        return {
            "repos": [{"name": r['name'], "value": float(r['value'])} for r in repos],
            "languages": langs
        }
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc))
    finally:
         try: conn.close()
         except: pass

@router.get("/contributors/{id}/heatmap")
def get_contributor_heatmap(
    id: Union[str, int],
    year: Optional[int] = None,
    db: Optional[DatabaseSettings] = None
) -> List[Dict[str, Any]]:
    id = parse_optional_int(id)
    if id is None:
        raise HTTPException(status_code=422, detail="Invalid contributor ID")
    try:
        y = year if year else datetime.datetime.now().year
        conn = _db_conn(db)
        cur = conn.cursor(dictionary=True)
        sql = """
            SELECT
              DATE_FORMAT(spd.stat_date, '%Y-%m-%d') as date,
              SUM(spd.commits) as count
            FROM stat_person_daily spd
            JOIN org_persons child ON spd.person_id = child.id
            WHERE (child.parent_id = %s OR child.id = %s) AND YEAR(spd.stat_date) = %s
            GROUP BY spd.stat_date
        """
        cur.execute(sql, (id, id, y))
        rows = cur.fetchall()
        return [{"date": r['date'], "count": int(r['count'])} for r in rows]
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc))
    finally:
         try: conn.close()
         except: pass

@router.get("/contributors/{id}/heatmap_years")
def get_contributor_heatmap_years(
    id: Union[str, int],
    db: Optional[DatabaseSettings] = None
) -> List[int]:
    id = parse_optional_int(id)
    if id is None:
        raise HTTPException(status_code=422, detail="Invalid contributor ID")
    try:
        conn = _db_conn(db)
        cur = conn.cursor(dictionary=True)
        sql = """
            SELECT DISTINCT YEAR(spd.stat_date) as year
            FROM stat_person_daily spd
            JOIN org_persons child ON spd.person_id = child.id
            WHERE (child.parent_id = %s OR child.id = %s)
            ORDER BY year DESC
        """
        cur.execute(sql, (id, id))
        rows = cur.fetchall()
        return [r['year'] for r in rows]
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc))
    finally:
         try: conn.close()
         except: pass

@router.get("/contributors/{id}/stats")
def get_contributor_detail_stats(
    id: Union[str, int],
    db: Optional[DatabaseSettings] = None
) -> Dict[str, Any]:
    id = parse_optional_int(id)
    if id is None:
        raise HTTPException(status_code=422, detail="Invalid contributor ID")
    try:
        conn = _db_conn(db)
        cur = conn.cursor(dictionary=True)
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
              COALESCE(SUM(spm.lines_added), 0) - COALESCE(SUM(spm.lines_deleted), 0) as net_lines_added,
              SUM(spm.code_files_duplicated) as dup_files,
              SUM(spm.code_files_added) as code_added,
              SUM(spm.directories_banned) as banned,
              SUM(spm.files_unexpected) as unexpected,
              SUM(spm.total_commits) as commits,
              DATEDIFF(NOW(), MIN(all_p.first_commit_at)) as days_in_service
            FROM org_persons p
            LEFT JOIN org_persons all_p ON (all_p.parent_id = p.id OR all_p.id = p.id)
            LEFT JOIN stat_person_monthly spm ON all_p.id = spm.person_id
            WHERE p.id = %s
            GROUP BY p.id
        """
        cur.execute(sql, (id,))
        row = cur.fetchone()

        if not row: raise HTTPException(status_code=404, detail="Contributor not found")

        # Rankings (Simulate)
        # In a real app we might cache rankings or run a separate ranking query to find the rank of THIS user
        # For simplicity, we just set rank=1 or calculate it expensive way?
        # Node impl did an expensive Rank Query: SELECT COUNT(*) ... HAVING loc > ?

        total_loc = float(row['total_loc'] or 0)
        rank_sql = """
            SELECT COUNT(*) + 1 as rank_val
            FROM (
              SELECT person_id, SUM(total_lines_changed) as loc
              FROM stat_person_monthly
              GROUP BY person_id
              HAVING loc > %s
            ) as t
        """
        cur.execute(rank_sql, (total_loc,))
        rank_res = cur.fetchone()
        rank = rank_res['rank_val'] if rank_res else 1

        # Quality logic
        code_added = float(row['code_added'] or 0)
        dup_files = float(row['dup_files'] or 0)
        dup_rate = (dup_files / code_added) if code_added > 0 else 0
        quality_score = max(60, min(100, round(100 - (dup_rate * 50))))

        banned = float(row['banned'] or 0)
        unexpected = float(row['unexpected'] or 0)
        commits = float(row['commits'] or 1)
        penalties = (banned * 10) + (unexpected * 2)
        penalty_per_commit = penalties / max(1, commits)
        commit_quality = max(60, min(100, round(100 - (penalty_per_commit * 5))))

        return {
            "id": row['id'],
            "name": row['name'],
            "first_commit_at": str(row['first_commit_at']) if row['first_commit_at'] else None,
            "repo_count": int(row['repo_count'] or 0),
            "total_loc": total_loc,
            "workload": float(row['workload'] or 0),
            "net_lines_added": float(row['net_lines_added'] or 0),
            "days_in_service": int(row['days_in_service'] or 0),
            "locRank": rank,
            "dailyAvgRank": rank,
            "workloadRank": rank,
            "qualityScore": quality_score,
            "commitQuality": commit_quality
        }
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc))
    finally:
         try: conn.close()
         except: pass

@router.get("/contributors/{id}/trend")
def get_contributor_trend(
    id: Union[str, int],
    db: Optional[DatabaseSettings] = None
) -> List[Dict[str, Any]]:
    id = parse_optional_int(id)
    if id is None:
        raise HTTPException(status_code=422, detail="Invalid contributor ID")
    try:
        conn = _db_conn(db)
        cur = conn.cursor(dictionary=True)
        sql = """
            SELECT
              sprm.stat_year,
              sprm.stat_month,
              COUNT(DISTINCT sprm.repo_catalog_id) as repo_count,
              SUM(sprm.total_lines_changed) as loc_changed
            FROM stat_person_repo_monthly sprm
            JOIN org_persons child ON sprm.person_id = child.id
            WHERE (child.parent_id = %s OR child.id = %s)
            GROUP BY sprm.stat_year, sprm.stat_month
            ORDER BY sprm.stat_year, sprm.stat_month
        """
        cur.execute(sql, (id, id))
        rows = cur.fetchall()
        return [{
            "date": f"{r['stat_year']}-{str(r['stat_month']).zfill(2)}",
            "repoCount": int(r['repo_count']),
            "locChanged": float(r['loc_changed'])
        } for r in rows]
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc))
    finally:
         try: conn.close()
         except: pass

@router.get("/departments/treemap")
def get_departments_treemap(db: Optional[DatabaseSettings] = None) -> Dict[str, Any]:
    try:
        conn = _db_conn(db)
        cur = conn.cursor(dictionary=True)
        sql = """
            SELECT
              d.name as dept_name,
              r.name as repo_name,
              SUM(s.lines_added) - SUM(s.lines_deleted) as loc
            FROM repo_catalog r
            JOIN org_departments d ON r.department_id = d.id
            JOIN stat_person_repo_monthly s ON r.id = s.repo_catalog_id
            WHERE r.is_deleted = 0 AND r.is_valid = 1
            GROUP BY r.id, r.name, dept_name
            HAVING loc > 0
            ORDER BY dept_name, loc DESC
        """
        cur.execute(sql)
        rows = cur.fetchall()

        root = {'name': 'root', 'children': []}
        dept_map = {}

        for row in rows:
            dept_name = row['dept_name']
            if dept_name not in dept_map:
                node = {'name': dept_name, 'children': []}
                dept_map[dept_name] = node
                root['children'].append(node)

            dept_map[dept_name]['children'].append({
                'name': row['repo_name'],
                'value': float(row['loc'])
            })

        return root
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc))
    finally:
         try: conn.close()
         except: pass
