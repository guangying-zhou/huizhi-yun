import logging
import json
import subprocess
import os
import sys
from typing import Dict, List, Optional, Any
from fastapi import APIRouter, HTTPException, Query, Body
from pydantic import BaseModel, Field

from server.python_service.config import Config
try:
    import mysql.connector
except ImportError:
    mysql = None

# Correct absolute path to the root of the project
REPO_ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "../../../"))

router = APIRouter(prefix="/api/statistics", tags=["statistics"])
LOGGER = logging.getLogger(__name__)

# ========== Models ==========

class DatabaseSettings(BaseModel):
    host: Optional[str] = Field(None, description="Database host")
    port: Optional[int] = Field(None, description="Database port")
    user: Optional[str] = Field(None, description="Database user name")
    password: Optional[str] = Field(None, description="Database password")
    name: Optional[str] = Field(None, description="Database schema name")

class AggregateRequest(BaseModel):
    fullAggregation: bool = False
    windowDays: int = 1

# ========== Helpers ==========

def _db_conn(settings: Optional[DatabaseSettings] = None):
    host = settings.host if settings and settings.host else Config.DB_HOST
    port = settings.port if settings and settings.port else Config.DB_PORT
    user = settings.user if settings and settings.user else Config.DB_USER
    password = settings.password if settings and settings.password else Config.DB_PASSWORD
    database = settings.name if settings and settings.name else Config.DB_NAME
    return mysql.connector.connect(host=host, port=port, user=user, password=password, database=database)

# ========== Endpoints ==========

@router.get("/stat-years")
def get_stat_years(db: Optional[DatabaseSettings] = None) -> List[int]:
    try:
        conn = _db_conn(db)
        cur = conn.cursor(dictionary=True)
        cur.execute("SELECT distinct(stat_year) FROM view_repo_yearly_stats order by stat_year desc")
        rows = cur.fetchall()
        return [r['stat_year'] for r in rows]
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc))
    finally:
         try: conn.close()
         except: pass

@router.get("/overview")
def get_overview_statistics(
    year: Optional[int] = None,
    month: Optional[int] = None,
    db: Optional[DatabaseSettings] = None
) -> Dict[str, Any]:
    try:
        conn = _db_conn(db)
        cur = conn.cursor(dictionary=True)

        currentStats = {}
        prevStats = {}

        if not year:
            # All Time
            cur.execute("SELECT COALESCE(SUM(total_commits), 0) as total_commits, COALESCE(SUM(workload), 0) as workload FROM stat_repo_monthly")
            commitStats = cur.fetchone()

            cur.execute("SELECT COUNT(DISTINCT person_id) as active_developers FROM stat_person_monthly")
            personStats = cur.fetchone()

            cur.execute("SELECT COALESCE(SUM(lines_added), 0) - COALESCE(SUM(lines_deleted), 0) as total_lines FROM stat_repo_monthly")
            lineStats = cur.fetchone()

            cur.execute("SELECT COUNT(DISTINCT repo_catalog_id) as active_repos FROM stat_repo_monthly")
            currentRepo = cur.fetchone()

            cur.execute("""
                SELECT
                  CASE WHEN COALESCE(SUM(files_added),0) = 0 THEN 1 ELSE AVG(avg_submission_quality) END AS submission_quality,
                  CASE WHEN COALESCE(SUM(total_commits),0) = 0 THEN 0 ELSE AVG(avg_code_quality) END AS code_quality
                FROM stat_repo_monthly
            """)
            qualityStats = cur.fetchone()

            currentStats = {
                "total_commits": commitStats['total_commits'],
                "active_developers": personStats['active_developers'],
                "total_lines": lineStats['total_lines'],
                "workload": commitStats['workload'],
                "active_repos": currentRepo['active_repos'],
                "submission_quality": float(qualityStats['submission_quality'] or 1),
                "code_quality": float(qualityStats['code_quality'] or 1)
            }

            prevStats = {
                "total_commits": 0, "active_developers": 0, "total_lines": 0, "workload": 0,
                "active_repos": 0, "submission_quality": 0, "code_quality": 0
            }

        elif month:
            # Monthly
            cur.execute("""
                SELECT
                  COALESCE(SUM(total_commits), 0) as total_commits,
                  COUNT(DISTINCT person_id) as active_developers,
                  COALESCE(SUM(lines_added), 0) - COALESCE(SUM(lines_deleted), 0) as total_lines,
                  COALESCE(SUM(workload), 0) as workload
                FROM stat_person_monthly
                WHERE stat_year = %s AND stat_month = %s
            """, (year, month))
            mainStats = cur.fetchone()

            cur.execute("SELECT COUNT(DISTINCT repo_catalog_id) as active_repos FROM stat_repo_monthly WHERE stat_year = %s AND stat_month = %s", (year, month))
            repoStats = cur.fetchone()

            cur.execute("""
                SELECT avg_submission_quality as submission_quality, avg_code_quality as code_quality
                FROM stat_repo_monthly WHERE stat_year = %s AND stat_month = %s
            """, (year, month))
            qualityStats = cur.fetchone() or {'submission_quality': 1, 'code_quality': 1}

            currentStats = {
                "total_commits": mainStats['total_commits'],
                "active_developers": mainStats['active_developers'],
                "total_lines": mainStats['total_lines'],
                "workload": mainStats['workload'],
                "active_repos": repoStats['active_repos'],
                "submission_quality": float(qualityStats['submission_quality'] or 0),
                "code_quality": float(qualityStats['code_quality'] or 0)
            }

            # Prev month
            prevYear, prevMonth = year, month - 1
            if prevMonth == 0: prevMonth, prevYear = 12, prevYear - 1

            cur.execute("""
                SELECT
                  COALESCE(SUM(total_commits), 0) as total_commits,
                  COUNT(DISTINCT person_id) as active_developers,
                  COALESCE(SUM(lines_added), 0) - COALESCE(SUM(lines_deleted), 0) as total_lines,
                  COALESCE(SUM(workload), 0) as workload
                FROM stat_person_monthly
                WHERE stat_year = %s AND stat_month = %s
            """, (prevYear, prevMonth))
            prevMain = cur.fetchone()

            cur.execute("SELECT COUNT(DISTINCT repo_catalog_id) as active_repos FROM stat_repo_monthly WHERE stat_year = %s AND stat_month = %s", (prevYear, prevMonth))
            prevRepo = cur.fetchone()

            cur.execute("""
                SELECT avg_submission_quality as submission_quality, avg_code_quality as code_quality
                FROM stat_repo_monthly WHERE stat_year = %s AND stat_month = %s
            """, (prevYear, prevMonth))
            prevQuality = cur.fetchone() or {'submission_quality': 1, 'code_quality': 1}

            prevStats = {
                "total_commits": prevMain['total_commits'],
                "active_developers": prevMain['active_developers'],
                "total_lines": prevMain['total_lines'],
                "workload": prevMain['workload'],
                "active_repos": prevRepo['active_repos'],
                "submission_quality": float(prevQuality['submission_quality'] or 0),
                "code_quality": float(prevQuality['code_quality'] or 0)
            }

        else:
            # Yearly
            cur.execute("""
                SELECT
                  COALESCE(SUM(total_commits), 0) as total_commits,
                  COALESCE(SUM(lines_added), 0) - COALESCE(SUM(lines_deleted), 0) as total_lines,
                  COALESCE(SUM(workload), 0) as workload
                FROM stat_repo_monthly WHERE stat_year = %s
            """, (year,))
            mainStats = cur.fetchone()

            cur.execute("SELECT COUNT(DISTINCT person_id) as active_developers FROM stat_person_monthly WHERE stat_year = %s", (year,))
            personStats = cur.fetchone()

            cur.execute("SELECT COUNT(DISTINCT repo_catalog_id) as active_repos FROM stat_repo_monthly WHERE stat_year = %s", (year,))
            repoStats = cur.fetchone()

            cur.execute("""
                SELECT
                  CASE WHEN COALESCE(SUM(files_added),0) = 0 THEN 1 ELSE SUM(avg_submission_quality * total_commits) / SUM(total_commits) END AS submission_quality,
                  CASE WHEN COALESCE(SUM(total_commits),0) = 0 THEN 0 ELSE SUM(avg_code_quality * total_commits) / SUM(total_commits) END AS code_quality
                FROM stat_repo_monthly WHERE stat_year = %s
            """, (year,))
            qualityStats = cur.fetchone() or {'submission_quality': 0, 'code_quality': 0}

            currentStats = {
                "total_commits": mainStats['total_commits'],
                "active_developers": personStats['active_developers'],
                "total_lines": mainStats['total_lines'],
                "workload": mainStats['workload'],
                "active_repos": repoStats['active_repos'],
                "submission_quality": float(qualityStats['submission_quality'] or 0),
                "code_quality": float(qualityStats['code_quality'] or 0)
            }

            # Prev Year
            prevYear = year - 1
            cur.execute("""
                SELECT
                  COALESCE(SUM(total_commits), 0) as total_commits,
                  COALESCE(SUM(lines_added), 0) - COALESCE(SUM(lines_deleted), 0) as total_lines,
                  COALESCE(SUM(workload), 0) as workload
                FROM stat_repo_monthly WHERE stat_year = %s
            """, (prevYear,))
            prevMain = cur.fetchone()

            cur.execute("SELECT COUNT(DISTINCT person_id) as active_developers FROM stat_person_monthly WHERE stat_year = %s", (prevYear,))
            prevPerson = cur.fetchone()

            cur.execute("SELECT COUNT(DISTINCT repo_catalog_id) as active_repos FROM stat_repo_monthly WHERE stat_year = %s", (prevYear,))
            prevRepo = cur.fetchone()

            cur.execute("""
                SELECT
                  CASE WHEN COALESCE(SUM(files_added),0) = 0 THEN 1 ELSE SUM(avg_submission_quality * total_commits) / SUM(total_commits) END AS submission_quality,
                  CASE WHEN COALESCE(SUM(total_commits),0) = 0 THEN 0 ELSE SUM(avg_code_quality * total_commits) / SUM(total_commits) END AS code_quality
                FROM stat_repo_monthly WHERE stat_year = %s
            """, (prevYear,))
            prevQuality = cur.fetchone() or {'submission_quality': 0, 'code_quality': 0}

            prevStats = {
                "total_commits": prevMain['total_commits'],
                "active_developers": prevPerson['active_developers'],
                "total_lines": prevMain['total_lines'],
                "workload": prevMain['workload'],
                "active_repos": prevRepo['active_repos'],
                "submission_quality": float(prevQuality['submission_quality'] or 0),
                "code_quality": float(prevQuality['code_quality'] or 0)
            }

        def calculate_change(c, p):
            if p == 0: return 100 if c > 0 else 0
            return round(((c - p) / p) * 100)

        return {
          "totalCommits": float(currentStats['total_commits']),
          "totalCommitsChange": calculate_change(currentStats['total_commits'], prevStats['total_commits']),
          "activeRepos": float(currentStats['active_repos']),
          "activeReposChange": calculate_change(currentStats['active_repos'], prevStats['active_repos']),
          "activeDevelopers": float(currentStats['active_developers']),
          "activeDevelopersChange": calculate_change(currentStats['active_developers'], prevStats['active_developers']),
          "totalLines": float(currentStats['total_lines']),
          "totalLinesChange": calculate_change(currentStats['total_lines'], prevStats['total_lines']),
          "workload": float(currentStats['workload']),
          "workloadChange": calculate_change(currentStats['workload'], prevStats['workload']),
          "submissionQuality": currentStats['submission_quality'],
          "submissionQualityChange": calculate_change(currentStats['submission_quality'], prevStats['submission_quality']),
          "codeQuality": currentStats['code_quality'],
          "codeQualityChange": calculate_change(currentStats['code_quality'], prevStats['code_quality'])
        }
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc))
    finally:
         try: conn.close()
         except: pass

@router.get("/active-repositories")
def get_active_repositories(
    year: Optional[int] = None,
    limit: int = 5,
    db: Optional[DatabaseSettings] = None
) -> List[Dict[str, Any]]:
    try:
        conn = _db_conn(db)
        cur = conn.cursor(dictionary=True)

        y = year if year else 0 # 0 means all time (current year handled by default? JS used new Date().getFullYear() if undefined/empty? Wait JS code: year = query.year ? Number : new Date().getFullYear(). Then line 61: if year === 0. So 0 is explicit.)
        # If year not provided, default to current year
        if year is None:
            y = 2024 # Or datetime.now().year
            import datetime
            y = datetime.datetime.now().year
        # Wait, Node code: if query.year !== undefined && query.year !== '' -> year = Number. Else year = current year.
        # But wait, query.year '0' -> year 0.
        # My python code: year is Optional[int].
        # If user passes 0, year=0.
        # If user passes nothing, year=None.

        query_year = y

        sql = """
            SELECT
                r.id as repo_catalog_id,
                r.name as repo_name,
                COUNT(DISTINCT s.person_id) as active_contributors,
                SUM(s.total_commits) as total_commits,
                SUM(s.lines_added + s.lines_deleted + s.lines_modified) as total_lines_changed,
                SUM(s.files_added + s.code_files_modified + s.code_files_deleted) as files_added,
                COALESCE(
                  DATEDIFF(
                    COALESCE(r.latest_commit_at, NOW()),
                    COALESCE(r.repo_created_at, (SELECT MIN(committed_at) FROM repo_commits WHERE repo_catalog_id = r.id))
                  ),
                  0
                ) as survival_days
            FROM stat_person_repo_monthly s
            JOIN repo_catalog r ON s.repo_catalog_id = r.id
        """
        params = []
        if query_year != 0:
            sql += " WHERE s.stat_year = %s "
            params.append(query_year)

        sql += " GROUP BY r.id, r.name, r.latest_commit_at, r.repo_created_at ORDER BY total_lines_changed DESC LIMIT %s "
        params.append(limit)

        cur.execute(sql, tuple(params))
        rows = cur.fetchall()

        # Convert Decimals
        return [{k: float(v) if isinstance(v, (int, float,  mysql.connector.conversion.Decimal)) else v for k, v in r.items()} for r in rows]
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc))
    finally:
         try: conn.close()
         except: pass

@router.post("/aggregate")
def trigger_aggregation(body: AggregateRequest):
    # Trigger server/scripts/aggregate_stats.py
    # Assuming script name based on logic.
    # Node calls: /run/aggregate-stats.
    # Python ingestion logic likely maps runs.
    # I'll implement direct script execution here.
    script_path = os.path.join(REPO_ROOT, "server/scripts/aggregate_stats.py")
    if not os.path.exists(script_path):
        # Fallback to verify name
        LOGGER.error(f"Aggregation script not found at {script_path}")
        raise HTTPException(status_code=500, detail="Aggregation script not found")

    try:
        import uuid
        import time

        trig = f"api-aggregate:{uuid.uuid4()}"
        cmd = [sys.executable, script_path, "--triggered-by", trig]
        if body.fullAggregation:
            cmd.append("--full-aggregation")
        else:
            cmd.extend(["--window-days", str(body.windowDays)])

        process = subprocess.Popen(cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE)

        # Poll for run_id from database
        run_id = None
        try:
            conn = _db_conn(None)
            for _ in range(25):  # Wait up to 5 seconds
                time.sleep(0.2)
                cur = conn.cursor()
                try:
                    cur.execute(
                        "SELECT id FROM ingestion_runs WHERE job_type='stats_aggregate' AND triggered_by=%s ORDER BY id DESC LIMIT 1",
                        (trig,),
                    )
                    row = cur.fetchone()
                    if row:
                        run_id = int(row[0])
                        break
                finally:
                    cur.close()
            conn.close()
        except Exception as e:
            LOGGER.warning(f"Failed to poll for run_id: {e}")

        return {"status": "started", "runId": run_id, "message": "Aggregation started"}
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc))


@router.get("/department-ranking")
def get_department_ranking(
    year: Optional[int] = None,
    month: Optional[int] = None,
    limit: int = 10,
    db: Optional[DatabaseSettings] = None
) -> List[Dict[str, Any]]:
    import datetime
    y = year if year is not None else datetime.datetime.now().year # Handle 0 if passed? Node: Number(query.year) || current.
    # If 0 passed, || current evaluates to current? 0 is falsy.
    # So year 0 becomes current year in Node if they used ||.
    # Let's assume year is required or defaults to current.

    try:
        conn = _db_conn(db)
        cur = conn.cursor(dictionary=True)

        params = [y]
        month_sql = ""
        if month:
            month_sql = "AND s.stat_month = %s"
            params.append(month)

        params.append(limit)

        sql = f"""
            SELECT
                d.id as department_id,
                d.name as department_name,
                SUM(s.total_commits) as total_commits,
                SUM(s.files_added) as files_added,
                SUM(s.lines_added) as total_lines_added,
                SUM(s.lines_deleted) as total_lines_deleted,
                COUNT(DISTINCT s.person_id) as developer_count,
                SUM(s.repos_participated) as repo_count
            FROM stat_person_monthly s
            LEFT JOIN org_persons p ON s.person_id = p.id
            LEFT JOIN org_departments d ON p.department_id = d.id
            WHERE s.stat_year = %s
            {month_sql}
            GROUP BY d.id, d.name
            ORDER BY total_commits DESC
            LIMIT %s
        """
        cur.execute(sql, tuple(params))
        rows = cur.fetchall()
        return [{k: float(v) if isinstance(v, (int, float, mysql.connector.conversion.Decimal)) else v for k, v in r.items()} for r in rows]
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc))
    finally:
         try: conn.close()
         except: pass

@router.get("/person-ranking")
def get_person_ranking(
    year: Optional[int] = None,
    month: Optional[int] = None,
    limit: int = 10,
    db: Optional[DatabaseSettings] = None
) -> List[Dict[str, Any]]:
    import datetime
    y = year if year is not None else datetime.datetime.now().year
    # In Node: if query.year !== undefined && query.year !== '' -> year = Number. Else current.
    # If 0 is passed, it is respected.

    try:
        conn = _db_conn(db)
        cur = conn.cursor(dictionary=True)

        params = []
        where_year = ""

        if y != 0:
            where_year = "AND s.stat_year = %s"
            params.append(y)
            if month:
                where_year += " AND s.stat_month = %s"
                params.append(month)

        params.append(limit)

        sql = f"""
            SELECT
                p.id as person_id,
                COALESCE(p.real_name, p.username) as person_name,
                p.email as person_email,
                d.name as department_name,
                SUM(s.total_commits) as total_commits,
                SUM(s.files_added + s.code_files_modified + s.code_files_deleted) as files_added,
                SUM(s.lines_added) - SUM(s.lines_deleted) as net_lines_added,
                SUM(s.lines_added) + SUM(s.lines_deleted) + SUM(s.lines_modified) as total_lines_changed,
                SUM(s.workload) as workload,
                COUNT(DISTINCT s.repo_catalog_id) as repo_count
            FROM stat_person_repo_monthly s
            JOIN org_persons p ON s.person_id = p.id
            LEFT JOIN org_departments d ON p.department_id = d.id
            WHERE p.is_active = 1
            {where_year}
            GROUP BY p.id, p.real_name, p.username, p.email, d.name
            ORDER BY net_lines_added DESC
            LIMIT %s
        """
        cur.execute(sql, tuple(params))
        rows = cur.fetchall()
        return [{k: float(v) if isinstance(v, (int, float, mysql.connector.conversion.Decimal)) else v for k, v in r.items()} for r in rows]
    except Exception as exc:
         raise HTTPException(status_code=500, detail=str(exc))
    finally:
         try: conn.close()
         except: pass

@router.get("/trend")
def get_activity_trend(
    year: Optional[int] = None,
    db: Optional[DatabaseSettings] = None
) -> List[Dict[str, Any]]:
    try:
        conn = _db_conn(db)
        cur = conn.cursor(dictionary=True)

        if not year or year == 0:
            # Yearly trend
            sql = """
                SELECT
                  r.stat_year,
                  0 as stat_month,
                  SUM(total_commits) as total_commits,
                  SUM(files_added) as files_added,
                  SUM(lines_added) as lines_added,
                  SUM(lines_deleted) as lines_deleted,
                  SUM(lines_modified) as lines_modified,
                  SUM(duplicate_files_bytes) as duplicate_lines,
                  (SUM(lines_added) - SUM(lines_deleted)) as net_lines,
                  SUM(avg_submission_quality * total_commits) / NULLIF(SUM(total_commits), 0) as submission_quality,
                  SUM(workload) as workload,
                  COUNT(DISTINCT r.repo_catalog_id) as active_repos,
                  (
                    SELECT COUNT(DISTINCT p.person_id)
                    FROM stat_person_monthly p
                    WHERE p.stat_year = r.stat_year AND p.total_commits > 0
                  ) as active_contributors
                FROM stat_repo_monthly r
                WHERE r.total_commits > 0
                GROUP BY r.stat_year
                ORDER BY r.stat_year
            """
            cur.execute(sql)
        else:
            # Monthly trend
            sql = """
                SELECT
                  r.stat_year,
                  r.stat_month,
                  SUM(total_commits) as total_commits,
                  SUM(files_added) as files_added,
                  SUM(lines_added) as lines_added,
                  SUM(lines_deleted) as lines_deleted,
                  SUM(lines_modified) as lines_modified,
                  SUM(duplicate_files_bytes) as duplicate_lines,
                  (SUM(lines_added) - SUM(lines_deleted)) as net_lines,
                  SUM(avg_submission_quality * total_commits) / NULLIF(SUM(total_commits), 0) as submission_quality,
                  SUM(workload) as workload,
                  COUNT(DISTINCT r.repo_catalog_id) as active_repos,
                  (
                    SELECT COUNT(DISTINCT p.person_id)
                    FROM stat_person_monthly p
                    WHERE p.stat_year = r.stat_year AND p.stat_month = r.stat_month AND p.total_commits > 0
                  ) as active_contributors
                FROM stat_repo_monthly r
                WHERE r.stat_year = %s AND r.total_commits > 0
                GROUP BY r.stat_year, r.stat_month
                ORDER BY r.stat_year, r.stat_month
            """
            cur.execute(sql, (year,))

        rows = cur.fetchall()
        return [{k: float(v) if isinstance(v, (int, float, mysql.connector.conversion.Decimal)) else v for k, v in r.items()} for r in rows]
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc))
    finally:
         try: conn.close()
         except: pass
