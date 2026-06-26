import logging
import datetime as dt
import requests
from typing import Dict, List, Optional, Any
from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel, Field

from server.python_service.config import Config
try:
    import mysql.connector
except ImportError:
    mysql = None

router = APIRouter(prefix="/api/reports", tags=["reports"])
LOGGER = logging.getLogger(__name__)

# ========== Models ==========

class DatabaseSettings(BaseModel):
    host: Optional[str] = Field(None, description="Database host")
    port: Optional[int] = Field(None, description="Database port")
    user: Optional[str] = Field(None, description="Database user name")
    password: Optional[str] = Field(None, description="Database password")
    name: Optional[str] = Field(None, description="Database schema name")

# ========== Helpers ==========

def _db_conn(settings: Optional[DatabaseSettings] = None):
    host = settings.host if settings and settings.host else Config.DB_HOST
    port = settings.port if settings and settings.port else Config.DB_PORT
    user = settings.user if settings and settings.user else Config.DB_USER
    password = settings.password if settings and settings.password else Config.DB_PASSWORD
    database = settings.name if settings and settings.name else Config.DB_NAME
    return mysql.connector.connect(host=host, port=port, user=user, password=password, database=database)

def ensure_holidays_for_year(conn, year: int):
    # Check if exists
    cur = conn.cursor()
    cur.execute("SELECT 1 FROM system_holidays WHERE year = %s LIMIT 1", (year,))
    if cur.fetchone():
        return

    # Fetch from GitHub
    url = f"https://raw.githubusercontent.com/Natescarlet/holiday-cn/master/{year}.json"
    try:
        resp = requests.get(url, timeout=10)
        if resp.status_code != 200:
            LOGGER.warning(f"Failed to fetch holidays for {year}: {resp.status_code}")
            return

        data = resp.json()
        if not data or 'days' not in data:
            return

        values = []
        for day in data['days']:
            # date, name, is_off_day, year
            values.append((day['date'], day['name'], 1 if day['isOffDay'] else 0, year))

        if values:
            sql = """
                INSERT INTO system_holidays (date, name, is_off_day, year)
                VALUES (%s, %s, %s, %s)
                ON DUPLICATE KEY UPDATE
                  name = VALUES(name),
                  is_off_day = VALUES(is_off_day),
                  year = VALUES(year)
            """
            cur.executemany(sql, values)
            conn.commit()
    except Exception as e:
        LOGGER.error(f"Error fetching holidays: {e}")

def get_holiday_map(conn, start_date: dt.date, end_date: dt.date) -> Dict[str, bool]:
    # Ensure years
    start_year = start_date.year
    end_year = end_date.year
    for y in range(start_year, end_year + 1):
        ensure_holidays_for_year(conn, y)

    cur = conn.cursor(dictionary=True)
    cur.execute("SELECT date, is_off_day FROM system_holidays WHERE date BETWEEN %s AND %s", (start_date, end_date))
    rows = cur.fetchall()

    holiday_map = {}
    for r in rows:
        d_str = str(r['date'])
        holiday_map[d_str] = (r['is_off_day'] == 1)
    return holiday_map

def calculate_working_days(start_date: dt.date, end_date: dt.date, conn = None) -> int:
    # If no conn provided, just return simpler calc or try to get one?
    # Better to pass conn. If None, we can't fetch holidays.
    # Allow fallback if no DB? The original code assumes DB.
    if not conn:
        # Fallback
        days = 0
        curr = start_date
        while curr <= end_date:
            if curr.weekday() < 5: days += 1
            curr += dt.timedelta(days=1)
        return days

    try:
         holiday_map = get_holiday_map(conn, start_date, end_date)
    except:
         holiday_map = {}

    days = 0
    curr = start_date
    while curr <= end_date:
        d_str = str(curr)
        is_weekend = (curr.weekday() >= 5) # 5=Sat, 6=Sun

        if d_str in holiday_map:
            # defined: true=off (rest), false=work (make-up)
            if not holiday_map[d_str]:
                days += 1
        else:
            if not is_weekend:
                days += 1

        curr += dt.timedelta(days=1)
    return days

def get_period_dates(period: str, year: Optional[int] = None):
    now = dt.date.today()
    start_date = None
    end_date = None

    if period == 'current_month':
        start_date = dt.date(now.year, now.month, 1)
        end_date = now
    elif period == 'last_month':
        # First day of last month
        last_month_end = dt.date(now.year, now.month, 1) - dt.timedelta(days=1)
        start_date = dt.date(last_month_end.year, last_month_end.month, 1)
        end_date = last_month_end
    elif period == 'year':
        y = year or now.year
        start_date = dt.date(y, 1, 1)
        end_date = dt.date(y, 12, 31)

    return start_date, end_date

def build_month_filter(start_date: dt.date, end_date: dt.date, table_alias: str = 's'):
    s_year, s_month = start_date.year, start_date.month
    e_year, e_month = end_date.year, end_date.month

    params = []
    if s_year == e_year:
        sql = f"AND {table_alias}.stat_year = %s AND {table_alias}.stat_month BETWEEN %s AND %s"
        params.extend([s_year, s_month, e_month])
    else:
        sql = f"AND (({table_alias}.stat_year = %s AND {table_alias}.stat_month >= %s) OR ({table_alias}.stat_year > %s AND {table_alias}.stat_year < %s) OR ({table_alias}.stat_year = %s AND {table_alias}.stat_month <= %s))"
        params.extend([s_year, s_month, s_year, e_year, e_year, e_month])
    return sql, params

# ========== Endpoints: Commits Filters ==========

@router.get("/commits-filters")
def get_commit_filters(
    startDate: Optional[str] = None,
    endDate: Optional[str] = None,
    db: Optional[DatabaseSettings] = None
) -> Dict[str, object]:
    try:
        conn = _db_conn(db)
        params = []
        where = ["c.files_ingested = 1"]

        if startDate:
             where.append("c.committed_at >= %s")
             params.append(startDate)
        if endDate:
             where.append("c.committed_at <= %s")
             params.append(endDate + ' 23:59:59')

        where_clause = "WHERE " + " AND ".join(where)

        cur = conn.cursor(dictionary=True)

        # Repos
        cur.execute(f"""
            SELECT DISTINCT r.id, r.name
            FROM repo_commits c
            JOIN repo_catalog r ON c.repo_catalog_id = r.id
            {where_clause}
            ORDER BY r.name
        """, tuple(params))
        repos = [{"id": r['id'], "name": r['name']} for r in cur.fetchall()]

        # Authors
        cur.execute(f"""
            SELECT DISTINCT
              COALESCE(p.id, 0) as id,
              COALESCE(p.real_name, c.author_name) as name
            FROM repo_commits c
            LEFT JOIN org_persons p ON c.author_name = p.username
            {where_clause}
            ORDER BY name
        """, tuple(params))
        authors = [{"id": r['id'], "name": r['name']} for r in cur.fetchall()]

        return {"repos": repos, "authors": authors}
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc))
    finally:
        try: conn.close()
        except: pass

# ========== Endpoints: Commits ==========

@router.get("/commits")
def list_commits(
    page: int = Query(1, ge=1),
    pageSize: int = Query(50, ge=1, le=100),
    startDate: Optional[str] = None,
    endDate: Optional[str] = None,
    repoId: Optional[int] = None,
    personId: Optional[int] = None,
    sortBy: str = "committed_at",
    sortOrder: str = "desc",
    db: Optional[DatabaseSettings] = None
) -> Dict[str, object]:
    try:
        conn = _db_conn(db)

        offset = (page - 1) * pageSize
        params = []
        where = ["c.files_ingested = 1"]

        if startDate:
             where.append("c.committed_at >= %s")
             params.append(startDate)
        if endDate:
             where.append("c.committed_at <= %s")
             params.append(endDate + ' 23:59:59')
        if repoId:
             where.append("c.repo_catalog_id = %s")
             params.append(repoId)
        if personId:
             where.append("p.id = %s")
             params.append(personId)

        where_clause = "WHERE " + " AND ".join(where)

        allowed_sort = [
            'committed_at', 'files_added', 'code_files_added', 'lines_added', 'lines_deleted',
            'lines_modified', 'files_unexpected', 'abnormal_events', 'code_files_duplicated',
            'binary_files_duplicated', 'files_in_banned_directories', 'directories_banned',
            'bytes_added', 'binary_bytes_added', 'score_submission_quality', 'score_code_quality'
        ]
        sort_col = sortBy if sortBy in allowed_sort else 'committed_at'
        order = sortOrder.upper() if sortOrder.upper() in ['ASC', 'DESC'] else 'DESC'

        # Count
        count_params = list(params)
        cur = conn.cursor(dictionary=True)
        cur.execute(f"""
            SELECT COUNT(*) as total
            FROM repo_commits c
            LEFT JOIN org_persons p ON c.author_name = p.username
            {where_clause}
        """, tuple(count_params))
        total = cur.fetchone()['total']

        # Data
        sql = f"""
            SELECT
              c.id, c.repo_catalog_id, r.name as repo_name, c.author_name,
              p.id as person_id, p.real_name as person_real_name,
              c.revision as commit_hash, c.committed_at,
              c.files_added, c.code_files_added, c.code_files_deleted, c.code_files_modified,
              COALESCE(c.code_files_duplicated, 0) as code_files_duplicated,
              COALESCE(c.binary_files_added, 0) as binary_files_added,
              COALESCE(c.binary_files_deleted, 0) as binary_files_deleted,
              COALESCE(c.binary_files_modified, 0) as binary_files_modified,
              COALESCE(c.binary_files_duplicated, 0) as binary_files_duplicated,
              COALESCE(c.lines_added, 0) as lines_added,
              COALESCE(c.lines_deleted, 0) as lines_deleted,
              COALESCE(c.lines_modified, 0) as lines_modified,
              COALESCE(c.files_unexpected, 0) as files_unexpected,
              COALESCE(c.files_in_banned_directories, 0) as files_in_banned_directories,
              COALESCE(c.directories_banned, 0) as directories_banned,
              COALESCE(c.abnormal_events, 0) as abnormal_events,
              COALESCE(c.bytes_added, 0) as bytes_added,
              COALESCE(c.binary_bytes_added, 0) as binary_bytes_added,
              COALESCE(c.unexcepted_files_bytes, 0) as unexpected_files_bytes,
              COALESCE(c.duplicate_files_bytes, 0) as duplicate_files_bytes,
              c.score_submission_quality, c.score_code_quality
            FROM repo_commits c
            LEFT JOIN repo_catalog r ON c.repo_catalog_id = r.id
            LEFT JOIN org_persons p ON c.author_name = p.username
            {where_clause}
            ORDER BY c.{sort_col} {order}
            LIMIT %s OFFSET %s
        """
        cur.execute(sql, tuple(params + [pageSize, offset]))
        rows = cur.fetchall()

        data = []
        for r in rows:
            data.append({
                "id": r['id'],
                "repoCatalogId": r['repo_catalog_id'],
                "repoName": r['repo_name'],
                "authorName": r['author_name'],
                "personId": r['person_id'],
                "personRealName": r['person_real_name'],
                "commitHash": r['commit_hash'],
                "committedAt": str(r['committed_at']) if r['committed_at'] else None,
                "filesAdded": r['files_added'],
                "codeFilesAdded": r['code_files_added'],
                "codeFilesDeleted": r['code_files_deleted'],
                "codeFilesModified": r['code_files_modified'],
                "codeFilesDuplicated": r['code_files_duplicated'],
                "binaryFilesAdded": r['binary_files_added'],
                "binaryFilesDeleted": r['binary_files_deleted'],
                "binaryFilesModified": r['binary_files_modified'],
                "binaryFilesDuplicated": r['binary_files_duplicated'],
                "linesAdded": r['lines_added'],
                "linesDeleted": r['lines_deleted'],
                "linesModified": r['lines_modified'],
                "filesUnexpected": r['files_unexpected'],
                "filesInBannedDirectories": r['files_in_banned_directories'],
                "directoriesBanned": r['directories_banned'],
                "abnormalEvents": r['abnormal_events'],
                "bytesAdded": r['bytes_added'],
                "binaryBytesAdded": r['binary_bytes_added'],
                "unexpectedFilesBytes": r['unexpected_files_bytes'],
                "duplicateFilesBytes": r['duplicate_files_bytes'],
                "submissionQuality": r['score_submission_quality'],
                "codeQuality": r['score_code_quality'],
                "totalFilesChanged": (r['code_files_added'] or 0) + (r['code_files_deleted'] or 0) + (r['code_files_modified'] or 0) +
                                     (r['binary_files_added'] or 0) + (r['binary_files_deleted'] or 0) + (r['binary_files_modified'] or 0),
                "totalLinesChanged": (r['lines_added'] or 0) + (r['lines_deleted'] or 0) + (r['lines_modified'] or 0),
                "netLinesAdded": (r['lines_added'] or 0) - (r['lines_deleted'] or 0)
            })

        return {
            "data": data,
            "pagination": {
                "page": page,
                "pageSize": pageSize,
                "total": total,
                "totalPages": (total + pageSize - 1) // pageSize
            }
        }
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc))
    finally:
        try: conn.close()
        except: pass

# ========== Endpoints: Contributors ==========

@router.get("/contributors")
def get_contributors_report(
    period: str = "current_month",
    year: Optional[int] = None,
    departmentId: Optional[str] = None,
    isActive: Optional[str] = None,
    db: Optional[DatabaseSettings] = None
) -> List[Dict[str, Any]]:
    try:
        conn = _db_conn(db)

        start_date, end_date = get_period_dates(period, year)
        period_working_days = calculate_working_days(start_date, end_date, conn) if start_date and end_date else 0

        params = []
        month_join = ""

        if period != 'all_time' and start_date and end_date:
            filter_sql, filter_params = build_month_filter(start_date, end_date)
            month_join = f"LEFT JOIN stat_person_monthly s ON p.id = s.person_id {filter_sql}"
            params.extend(filter_params)
        else:
            month_join = "LEFT JOIN stat_person_monthly s ON p.id = s.person_id"

        where_clauses = ["p.is_coder = 1"]
        if departmentId and departmentId != 'all':
            where_clauses.append("p.department_id = %s")
            try:
                params.append(int(departmentId))
            except (ValueError, TypeError):
                raise HTTPException(status_code=400, detail=f"Invalid departmentId: {departmentId}")
        if isActive is not None and isActive != '' and isActive != 'all':
            where_clauses.append("p.is_active = %s")
            try:
                params.append(int(isActive))
            except (ValueError, TypeError):
                raise HTTPException(status_code=400, detail=f"Invalid isActive: {isActive}")

        where_sql = "WHERE " + " AND ".join(where_clauses)

        sql = f"""
            SELECT
              p.id as person_id,
              COALESCE(p.real_name, p.username) as person_name,
              p.email as person_email,
              d.name as department_name,
              p.is_active,
              COALESCE(SUM(s.files_added), 0) as files_added,
              COALESCE(SUM(s.total_commits), 0) as total_commits,
              COALESCE(SUM(s.lines_added), 0) as lines_added,
              COALESCE(SUM(s.lines_deleted), 0) as lines_deleted,
              COALESCE(SUM(s.lines_modified), 0) as lines_modified,
              COALESCE(SUM(s.lines_added), 0) - COALESCE(SUM(s.lines_deleted), 0) as net_lines_added,
              COALESCE(SUM(s.lines_added + s.lines_deleted + s.lines_modified), 0) as total_lines_changed,
              COALESCE(SUM(s.files_added), 0) - COALESCE(SUM(s.code_files_deleted), 0) as net_files_added,
              COALESCE(SUM(s.work_days), 0) as days,
              COALESCE(SUM(s.workload), 0) as workload,

              COALESCE(SUM(s.avg_submission_quality * s.total_commits) / NULLIF(SUM(s.total_commits), 0), 0) AS submission_quality,
              COALESCE(SUM(s.avg_code_quality * s.total_commits) / NULLIF(SUM(s.total_commits), 0), 0) AS code_quality,

              DATE(COALESCE(family_dates.agg_first, p.first_commit_at)) as first_commit_day,
              DATE(COALESCE(family_dates.agg_last, p.last_commit_at)) as last_commit_day
            FROM org_persons p
            {month_join}
            LEFT JOIN org_departments d ON p.department_id = d.id
            LEFT JOIN (
              SELECT
                COALESCE(parent_id, id) as p_id,
                MIN(first_commit_at) as agg_first,
                MAX(last_commit_at) as agg_last
              FROM org_persons
              GROUP BY COALESCE(parent_id, id)
            ) family_dates ON family_dates.p_id = p.id
            {where_sql}
            GROUP BY p.id, p.real_name, p.username, p.email, d.name, p.is_active
        """

        cur = conn.cursor(dictionary=True)
        cur.execute(sql, tuple(params))
        rows = cur.fetchall()

        results = []
        for r in rows:
            days = float(r['days'] or 0)
            if r['total_commits'] > 0 and days == 0:
                days = 1.0

            results.append({
                "person_id": r['person_id'],
                "person_name": r['person_name'],
                "person_email": r['person_email'],
                "department_name": r['department_name'],
                "is_active": r['is_active'],
                "total_commits": float(r['total_commits']),
                "files_added": float(r['files_added']),
                "workload": float(r['workload']),
                "lines_added": float(r['lines_added']),
                "lines_deleted": float(r['lines_deleted']),
                "lines_modified": float(r['lines_modified']),
                "net_lines_added": float(r['net_lines_added']),
                "total_lines_changed": float(r['total_lines_changed']),
                "net_files_added": float(r['net_files_added']),
                "days": days,
                "first_commit_day": str(r['first_commit_day']) if r['first_commit_day'] else None,
                "last_commit_day": str(r['last_commit_day']) if r['last_commit_day'] else None,
                "daily_avg_lines": int(float(r['workload']) / days) if days > 0 else 0,
                "submission_quality": max(0, min(100, round(float(r['submission_quality']), 1))),
                "code_quality": max(0, min(100, round(float(r['code_quality']), 1))),
                "periodWorkingDays": period_working_days
            })

        return results
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc))
    finally:
         try: conn.close()
         except: pass

@router.get("/departments")
def get_departments_report(
    period: str = "current_month",
    year: Optional[int] = None,
    db: Optional[DatabaseSettings] = None
) -> List[Dict[str, Any]]:
    try:
        conn = _db_conn(db)
        start_date, end_date = get_period_dates(period, year)
        period_working_days = calculate_working_days(start_date, end_date, conn) if start_date and end_date else 0

        params = []
        month_join = ""
        active_sql_filter = ""
        active_params = []

        if period != 'all_time' and start_date and end_date:
            filter_sql, filter_params = build_month_filter(start_date, end_date)
            month_join = f"LEFT JOIN stat_department_monthly s ON d.id = s.department_id {filter_sql}"
            params.extend(filter_params)

            # For active count
            active_filter_sql, active_filter_params = build_month_filter(start_date, end_date, 's')
            active_sql_filter = active_filter_sql
            active_params.extend(active_filter_params)
        else:
            month_join = "LEFT JOIN stat_department_monthly s ON d.id = s.department_id"

        sql = f"""
            SELECT
              d.id as department_id,
              d.name as department_name,
              COALESCE(SUM(s.total_commits), 0) as total_commits,
              COALESCE(SUM(s.lines_added), 0) - COALESCE(SUM(s.lines_deleted), 0) as net_lines_added,
              COALESCE(SUM(s.lines_added + s.lines_deleted + s.lines_modified), 0) as total_lines_changed,
              COALESCE(SUM(s.files_added), 0) as net_files_added,
              COALESCE(SUM(s.work_days), 0) as days,

              COALESCE(SUM(s.avg_submission_quality * s.total_commits) / NULLIF(SUM(s.total_commits), 0), 0) AS submission_quality,
              COALESCE(SUM(s.avg_code_quality * s.total_commits) / NULLIF(SUM(s.total_commits), 0), 0) AS code_quality
            FROM org_departments d
            {month_join}
            WHERE d.is_active = 1
            GROUP BY d.id, d.name
        """

        cur = conn.cursor(dictionary=True)
        cur.execute(sql, tuple(params))
        rows = cur.fetchall()

        # Active contributors
        active_sql = f"""
            SELECT
              p.department_id,
              COUNT(DISTINCT p.id) as active_count
            FROM org_persons p
            JOIN stat_person_monthly s ON p.id = s.person_id
            WHERE p.is_coder = 1 {active_sql_filter}
            GROUP BY p.department_id
        """
        cur.execute(active_sql, tuple(active_params))
        active_map = {r['department_id']: r['active_count'] for r in cur.fetchall()}

        results = []
        for r in rows:
            days = float(r['days'] or 0)
            net_lines = float(r['net_lines_added'])
            dept_id = r['department_id']

            results.append({
                "department_id": dept_id,
                "department_name": r['department_name'],
                "total_commits": float(r['total_commits']),
                "net_lines_added": net_lines,
                "total_lines_changed": float(r['total_lines_changed']),
                "net_files_added": float(r['net_files_added']),
                "days": days,
                "active_contributors": active_map.get(dept_id, 0),
                "daily_avg_lines": round(net_lines / days) if days > 0 else 0,
                "submission_quality": max(0, min(100, round(float(r['submission_quality']), 1))),
                "code_quality": max(0, min(100, round(float(r['code_quality']), 1))),
                "periodWorkingDays": period_working_days
            })

        return results
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc))
    finally:
         try: conn.close()
         except: pass

@router.get("/repos")
def get_repos_report(
    period: str = "current_month",
    year: Optional[int] = None,
    db: Optional[DatabaseSettings] = None
) -> List[Dict[str, Any]]:
    try:
        conn = _db_conn(db)
        start_date, end_date = get_period_dates(period, year)
        period_working_days = calculate_working_days(start_date, end_date, conn) if start_date and end_date else 0

        params = []
        month_join = ""
        active_sql_filter = ""
        active_params = []

        if period != 'all_time' and start_date and end_date:
            filter_sql, filter_params = build_month_filter(start_date, end_date)
            # For repos, join logic
            month_join = f"LEFT JOIN stat_repo_monthly s ON r.id = s.repo_catalog_id {filter_sql}"
            params.extend(filter_params)

             # For active count
            active_filter_sql, active_filter_params = build_month_filter(start_date, end_date, 's')
            active_sql_filter = active_filter_sql
            active_params.extend(active_filter_params)
        else:
            month_join = "LEFT JOIN stat_repo_monthly s ON r.id = s.repo_catalog_id"

        sql = f"""
            SELECT
              r.id as repo_catalog_id,
              r.name as repo_name,
              d.name as department_name,
              COALESCE(SUM(s.total_commits), 0) as total_commits,
              COALESCE(SUM(s.lines_added), 0) - COALESCE(SUM(s.lines_deleted), 0) as net_lines_added,
              COALESCE(SUM(s.lines_added + s.lines_deleted + s.lines_modified), 0) as total_lines_changed,
              COALESCE(SUM(s.files_added), 0) as net_files_added,
              COALESCE(SUM(s.work_days), 0) as days,

              COALESCE(SUM(s.avg_submission_quality * s.total_commits) / NULLIF(SUM(s.total_commits), 0), 0) AS submission_quality,
              COALESCE(SUM(s.avg_code_quality * s.total_commits) / NULLIF(SUM(s.total_commits), 0), 0) AS code_quality
            FROM repo_catalog r
            LEFT JOIN org_departments d ON r.department_id = d.id
            {month_join}
            WHERE r.is_valid = 1
            GROUP BY r.id, r.name, d.name
            HAVING SUM(s.total_commits) > 0
        """

        cur = conn.cursor(dictionary=True)
        cur.execute(sql, tuple(params))
        rows = cur.fetchall()

        # Active contributors
        active_sql = f"""
            SELECT
              s.repo_catalog_id,
              COUNT(DISTINCT s.person_id) as active_count
            FROM stat_person_repo_monthly s
            JOIN org_persons p ON s.person_id = p.id
            WHERE p.is_coder = 1 {active_sql_filter}
            GROUP BY s.repo_catalog_id
        """
        cur.execute(active_sql, tuple(active_params))
        active_map = {r['repo_catalog_id']: r['active_count'] for r in cur.fetchall()}

        results = []
        for r in rows:
            days = float(r['days'] or 0)
            net_lines = float(r['net_lines_added'])
            repo_id = r['repo_catalog_id']

            results.append({
                "repo_catalog_id": repo_id,
                "repo_name": r['repo_name'],
                "department_name": r['department_name'],
                "total_commits": float(r['total_commits']),
                "net_lines_added": net_lines,
                "total_lines_changed": float(r['total_lines_changed']),
                "net_files_added": float(r['net_files_added']),
                "days": days,
                "active_contributors": active_map.get(repo_id, 0),
                "daily_avg_lines": round(net_lines / days) if days > 0 else 0,
                "submission_quality": max(0, min(100, round(float(r['submission_quality']), 1))),
                "code_quality": max(0, min(100, round(float(r['code_quality']), 1))),
                "periodWorkingDays": period_working_days
            })

        return results
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc))
    finally:
         try: conn.close()
         except: pass
