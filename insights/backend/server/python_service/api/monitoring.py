import logging
import os
import subprocess
import datetime as dt
from typing import Dict, List, Optional, Any
from fastapi import APIRouter, HTTPException, Query, Body
from pydantic import BaseModel, Field

from server.python_service.config import Config
try:
    import mysql.connector
except ImportError:
    mysql = None

router = APIRouter(prefix="/api/monitoring", tags=["monitoring"])
LOGGER = logging.getLogger(__name__)

REPO_ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..", ".."))

# ========== Models ==========

class DatabaseSettings(BaseModel):
    host: Optional[str] = Field(None, description="Database host")
    port: Optional[int] = Field(None, description="Database port")
    user: Optional[str] = Field(None, description="Database user name")
    password: Optional[str] = Field(None, description="Database password")
    name: Optional[str] = Field(None, description="Database schema name")

class MonitoringScanRequest(BaseModel):
    from_date: Optional[str] = Field(None, alias="fromDate", description="Start date (YYYY-MM-DD)")
    to_date: Optional[str] = Field(None, alias="toDate", description="End date (YYYY-MM-DD)")
    db: Optional[DatabaseSettings] = Field(None, description="Database connection overrides")

class StartDateRequest(BaseModel):
    start_date: str = Field(..., alias="startDate")

class EventLevelUpdate(BaseModel):
    description: Optional[str] = None
    action: Optional[str] = None
    report_levels: Optional[int] = Field(None, alias="reportLevels")
    notification_methods: Optional[int] = Field(None, alias="notificationMethods")
    is_reply_needed: Optional[bool] = Field(None, alias="isReplyNeeded")

class EventTypeCreate(BaseModel):
    event_name: str = Field(..., alias="eventName")
    description: Optional[str] = None
    event_level_id: int = Field(..., alias="eventLevelId")
    monitoring_table: str = Field(..., alias="monitoringTable")
    eval_formula: str = Field(..., alias="evalFormula")
    comparison: str = Field(...)
    monitoring_threshold: str = Field(..., alias="monitoringThreshold")
    message_template: Optional[str] = Field(None, alias="messageTemplate")
    coder_only: bool = Field(False, alias="coderOnly")
    is_enabled: bool = Field(True, alias="isEnabled")

class EventTypeUpdate(EventTypeCreate):
    pass

class EventStatusUpdate(BaseModel):
    status: str

# ========== Helpers ==========

def _db_conn(settings: Optional[DatabaseSettings] = None):
    host = settings.host if settings and settings.host else Config.DB_HOST
    port = settings.port if settings and settings.port else Config.DB_PORT
    user = settings.user if settings and settings.user else Config.DB_USER
    password = settings.password if settings and settings.password else Config.DB_PASSWORD
    database = settings.name if settings and settings.name else Config.DB_NAME
    return mysql.connector.connect(host=host, port=port, user=user, password=password, database=database)

# ========== Endpoints: Scan ==========

@router.post("/scan")
def trigger_monitoring_scan(request: MonitoringScanRequest) -> Dict[str, object]:
    LOGGER.info("Received /api/monitoring/scan request (from=%s, to=%s)", request.from_date, request.to_date)

    try:
        conn = _db_conn(request.db)
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"DB connect failed: {exc}") from exc

    try:
        cmd = [
            os.environ.get('PYTHON_BIN', 'python3'),
            "-m", "server.scripts.monitor_anomalies"
        ]
        if request.from_date:
            cmd += ["--start-date", request.from_date]

        env = dict(os.environ)
        if request.db:
             if request.db.host: env["DB_HOST"] = request.db.host
             if request.db.port: env["DB_PORT"] = str(request.db.port)
             if request.db.user: env["DB_USER"] = request.db.user
             if request.db.password: env["DB_PASSWORD"] = request.db.password
             if request.db.name: env["DB_NAME"] = request.db.name

        # Add PYTHONPATH to identify modules
        existing = env.get("PYTHONPATH")
        if existing:
            paths = existing.split(os.pathsep)
            if REPO_ROOT not in paths:
                env["PYTHONPATH"] = os.pathsep.join([REPO_ROOT, existing])
        else:
            env["PYTHONPATH"] = REPO_ROOT

        LOGGER.info(f"Running monitoring scan: {' '.join(cmd)}")
        result = subprocess.run(
            cmd,
            env=env,
            capture_output=True,
            text=True,
            timeout=300
        )

        if result.returncode != 0:
            LOGGER.error(f"Scan failed: {result.stderr}")
            raise HTTPException(status_code=500, detail=f"Scan failed: {result.stderr or 'Unknown error'}")

        import re
        events_created = 0
        combined_output = (result.stdout or '') + '\n' + (result.stderr or '')
        for line in combined_output.split('\n'):
            match = re.search(r'Inserted (\d+) events', line)
            if match:
                events_created += int(match.group(1))

        cur = conn.cursor(dictionary=True)
        cur.execute("SELECT param_value FROM system_parameters WHERE param_key = 'monitoring_start_date'")
        row = cur.fetchone()
        end_date = row['param_value'] if row else str(dt.date.today())
        start_date = request.from_date or end_date

        return {
            "success": True,
            "eventsCreated": events_created,
            "dateRange": {
                "from": start_date,
                "to": end_date
            },
            "output": result.stdout
        }
    finally:
        try: conn.close()
        except: pass

# ========== Endpoints: Start Date ==========

@router.get("/start-date")
def get_start_date(db: Optional[DatabaseSettings] = None) -> Dict[str, object]:
    try:
        conn = _db_conn(db)
        cur = conn.cursor(dictionary=True)
        cur.execute("SELECT param_value FROM system_parameters WHERE param_key = 'monitoring_start_date'")
        row = cur.fetchone()
        value = row['param_value'] if row else None
        return {"data": {"monitoringStartDate": value or '2024-01-01'}}
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc))
    finally:
        try: conn.close()
        except: pass

@router.put("/start-date")
def update_start_date(body: StartDateRequest, db: Optional[DatabaseSettings] = None) -> Dict[str, object]:
    try:
        conn = _db_conn(db)
        cur = conn.cursor()
        cur.execute(
            "INSERT INTO system_parameters (param_key, param_value, description) VALUES ('monitoring_start_date', %s, '监控扫描起始日期') "
            "ON DUPLICATE KEY UPDATE param_value=VALUES(param_value)",
            (body.start_date,)
        )
        conn.commit()
        return {"success": True, "data": {"monitoringStartDate": body.start_date}}
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc))
    finally:
        try: conn.close()
        except: pass

# ========== Endpoints: Event Levels ==========

@router.get("/event-levels")
def list_event_levels(db: Optional[DatabaseSettings] = None) -> Dict[str, object]:
    try:
        conn = _db_conn(db)
        cur = conn.cursor(dictionary=True)
        cur.execute("SELECT id, level_name, description, action, report_levels, notification_methods, is_reply_needed, created_at, updated_at FROM event_levels ORDER BY id ASC")
        rows = cur.fetchall()

        data = []
        for r in rows:
            data.append({
                "id": r['id'],
                "levelName": r['level_name'],
                "description": r['description'],
                "action": r['action'],
                "reportLevels": r['report_levels'],
                "notificationMethods": r['notification_methods'],
                "isReplyNeeded": bool(r['is_reply_needed']),
                "createdAt": str(r['created_at']) if r['created_at'] else None,
                "updatedAt": str(r['updated_at']) if r['updated_at'] else None
            })
        return {"data": data}
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc))
    finally:
        try: conn.close()
        except: pass

@router.put("/event-levels/{id}")
def update_event_level(id: int, body: EventLevelUpdate, db: Optional[DatabaseSettings] = None) -> Dict[str, object]:
    try:
        conn = _db_conn(db)
        fields = []
        params = []

        if body.description is not None:
             fields.append("description=%s"); params.append(body.description)
        if body.action is not None:
             fields.append("action=%s"); params.append(body.action)
        if body.report_levels is not None:
             fields.append("report_levels=%s"); params.append(body.report_levels)
        if body.notification_methods is not None:
             fields.append("notification_methods=%s"); params.append(body.notification_methods)
        if body.is_reply_needed is not None:
             fields.append("is_reply_needed=%s"); params.append(1 if body.is_reply_needed else 0)

        if not fields:
            return {"success": True}

        params.append(id)
        sql = f"UPDATE event_levels SET {', '.join(fields)} WHERE id=%s"

        cur = conn.cursor()
        cur.execute(sql, tuple(params))
        conn.commit()
        return {"success": True}
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc))
    finally:
        try: conn.close()
        except: pass

# ========== Endpoints: Event Types ==========

@router.get("/event-types")
def list_event_types(db: Optional[DatabaseSettings] = None) -> Dict[str, object]:
    try:
        conn = _db_conn(db)
        cur = conn.cursor(dictionary=True)
        sql = """
            SELECT met.*, el.level_name
            FROM monitoring_event_types met
            LEFT JOIN event_levels el ON met.event_level_id = el.id
            ORDER BY met.event_level_id ASC, met.is_enabled DESC
        """
        cur.execute(sql)
        rows = cur.fetchall()
        data = []
        for r in rows:
            data.append({
                "id": r['id'],
                "eventName": r['event_name'],
                "description": r['description'],
                "eventLevelId": r['event_level_id'],
                "eventLevelName": r['level_name'],
                "monitoringTable": r['monitoring_table'],
                "evalFormula": r['eval_formula'],
                "comparison": r['comparison'],
                "monitoringThreshold": r['monitoring_threshold'],
                "messageTemplate": r['message_template'],
                "coderOnly": bool(r['coder_only']),
                "isEnabled": bool(r['is_enabled']),
                "createdAt": str(r['created_at']) if r['created_at'] else None,
                "updatedAt": str(r['updated_at']) if r['updated_at'] else None
            })
        return {"data": data}
    except Exception as exc:
         raise HTTPException(status_code=500, detail=str(exc))
    finally:
        try: conn.close()
        except: pass

@router.post("/event-types")
def create_event_type(body: EventTypeCreate, db: Optional[DatabaseSettings] = None) -> Dict[str, object]:
    try:
        conn = _db_conn(db)
        cur = conn.cursor()
        sql = """
            INSERT INTO monitoring_event_types
            (event_name, description, event_level_id, monitoring_table, eval_formula, comparison, monitoring_threshold, message_template, coder_only, is_enabled)
            VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
        """
        params = (body.event_name, body.description, body.event_level_id, body.monitoring_table, body.eval_formula, body.comparison,
                  body.monitoring_threshold, body.message_template, 1 if body.coder_only else 0, 1 if body.is_enabled else 0)
        cur.execute(sql, params)
        conn.commit()
        return {"success": True, "id": cur.lastrowid}
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc))
    finally:
         try: conn.close()
         except: pass

@router.put("/event-types/{id}")
def update_event_type(id: int, body: EventTypeUpdate, db: Optional[DatabaseSettings] = None) -> Dict[str, object]:
    try:
        conn = _db_conn(db)
        cur = conn.cursor()
        sql = """
            UPDATE monitoring_event_types
            SET event_name=%s, description=%s, event_level_id=%s, monitoring_table=%s, eval_formula=%s, comparison=%s,
                monitoring_threshold=%s, message_template=%s, coder_only=%s, is_enabled=%s
            WHERE id=%s
        """
        params = (body.event_name, body.description, body.event_level_id, body.monitoring_table, body.eval_formula, body.comparison,
                  body.monitoring_threshold, body.message_template, 1 if body.coder_only else 0, 1 if body.is_enabled else 0, id)
        cur.execute(sql, params)
        conn.commit()
        return {"success": True}
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc))
    finally:
         try: conn.close()
         except: pass

@router.delete("/event-types/{id}")
def delete_event_type(id: int, db: Optional[DatabaseSettings] = None) -> Dict[str, object]:
    try:
        conn = _db_conn(db)
        cur = conn.cursor()
        cur.execute("DELETE FROM monitoring_event_types WHERE id=%s", (id,))
        conn.commit()
        return {"success": True}
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc))
    finally:
         try: conn.close()
         except: pass

# ========== Endpoints: Events ==========

@router.get("/events")
def list_events(
    limit: int = Query(50, ge=1, le=200),
    offset: int = 0,
    status: Optional[str] = None,
    eventLevelId: Optional[int] = None,
    eventTypeId: Optional[int] = None,
    orgPersonId: Optional[int] = None,
    orgRepoId: Optional[int] = None,
    orgDepartmentId: Optional[int] = None,
    startDate: Optional[str] = None,
    endDate: Optional[str] = None,
    sortBy: str = "created_at",
    sortOrder: str = "DESC",
    db: Optional[DatabaseSettings] = None
) -> Dict[str, object]:
    try:
        conn = _db_conn(db)
        conditions = []
        params: List[Any] = []

        if status: conditions.append("me.status = %s"); params.append(status)
        if eventLevelId: conditions.append("me.event_level_id = %s"); params.append(eventLevelId)
        if eventTypeId: conditions.append("me.event_type_id = %s"); params.append(eventTypeId)
        if orgPersonId: conditions.append("me.org_person_id = %s"); params.append(orgPersonId)
        if orgRepoId: conditions.append("me.org_repo_id = %s"); params.append(orgRepoId)
        if orgDepartmentId: conditions.append("me.org_department_id = %s"); params.append(orgDepartmentId)
        if startDate: conditions.append("DATE(me.event_time) >= %s"); params.append(startDate)
        if endDate: conditions.append("DATE(me.event_time) <= %s"); params.append(endDate)

        where_clause = "WHERE " + " AND ".join(conditions) if conditions else ""

        sort_col = sortBy if sortBy in ['event_time', 'eval_value', 'status', 'created_at'] else 'event_time'
        order = sortOrder.upper() if sortOrder.upper() in ['ASC', 'DESC'] else 'DESC'

        sql = f"""
            SELECT
              me.id, me.event_type_id, met.event_name, me.org_department_id, od.name as dept_name,
              me.org_repo_id, ore.name as repo_name, me.org_person_id, op.username, op.real_name,
              me.repo_commit_id, rc.revision, me.event_level_id, el.level_name,
              me.monitoring_table, me.eval_formula, me.eval_value, me.comparison,
              me.monitoring_threshold, me.threshold_value, me.message, me.status,
              me.sent_at, me.read_at, me.resolved_at, me.event_time, me.created_at, me.updated_at
            FROM monitoring_events me
            LEFT JOIN monitoring_event_types met ON me.event_type_id = met.id
            LEFT JOIN event_levels el ON me.event_level_id = el.id
            LEFT JOIN org_departments od ON me.org_department_id = od.id
            LEFT JOIN repo_catalog ore ON me.org_repo_id = ore.id
            LEFT JOIN org_persons op ON me.org_person_id = op.id
            LEFT JOIN repo_commits rc ON me.repo_commit_id = rc.id
            {where_clause}
            ORDER BY me.{sort_col} {order}
            LIMIT %s OFFSET %s
        """
        query_params = tuple(params + [limit, offset])

        cur = conn.cursor(dictionary=True)
        cur.execute(sql, query_params)
        rows = cur.fetchall()

        events = []
        for r in rows:
            events.append({
                "id": r['id'],
                "eventTypeId": r['event_type_id'],
                "eventTypeName": r['event_name'],
                "orgDepartmentId": r['org_department_id'],
                "departmentName": r['dept_name'],
                "orgRepoId": r['org_repo_id'],
                "repoName": r['repo_name'],
                "orgPersonId": r['org_person_id'],
                "personUsername": r['username'],
                "personRealName": r['real_name'],
                "repoCommitId": r['repo_commit_id'],
                "commitHash": r['revision'],
                "eventLevelId": r['event_level_id'],
                "eventLevelName": r['level_name'],
                "monitoringTable": r['monitoring_table'],
                "evalFormula": r['eval_formula'],
                "evalValue": r['eval_value'],
                "comparison": r['comparison'],
                "monitoringThreshold": r['monitoring_threshold'],
                "thresholdValue": r['threshold_value'],
                "message": r['message'],
                "status": r['status'],
                "sentAt": str(r['sent_at']) if r['sent_at'] else None,
                "readAt": str(r['read_at']) if r['read_at'] else None,
                "resolvedAt": str(r['resolved_at']) if r['resolved_at'] else None,
                "eventTime": str(r['event_time']) if r['event_time'] else None,
                "createdAt": str(r['created_at']) if r['created_at'] else None,
                "updatedAt": str(r['updated_at']) if r['updated_at'] else None
            })

        # Count
        count_sql = f"SELECT COUNT(*) as total FROM monitoring_events me {where_clause}"
        cur.execute(count_sql, tuple(params))
        total = cur.fetchone()['total']

        return {
            "data": events,
            "pagination": {
                "total": total,
                "limit": limit,
                "offset": offset,
                "hasMore": (offset + limit) < total
            }
        }
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc))
    finally:
        try: conn.close()
        except: pass

@router.get("/events/stats")
def get_event_stats(db: Optional[DatabaseSettings] = None) -> Dict[str, object]:
    try:
        conn = _db_conn(db)
        cur = conn.cursor(dictionary=True)

        # Status counts
        cur.execute("SELECT status, COUNT(*) as count FROM monitoring_events GROUP BY status")
        status_counts = {r['status']: r['count'] for r in cur.fetchall()}

        # Level counts
        cur.execute("""
            SELECT me.event_level_id, el.level_name, COUNT(*) as count
            FROM monitoring_events me
            LEFT JOIN event_levels el ON me.event_level_id = el.id
            GROUP BY me.event_level_id, el.level_name
            ORDER BY me.event_level_id
        """)
        level_counts = [{"eventLevelId": r['event_level_id'], "levelName": r['level_name'], "count": r['count']} for r in cur.fetchall()]

        # Daily trend
        cur.execute("""
            SELECT DATE(created_at) as date, COUNT(*) as count
            FROM monitoring_events
            WHERE created_at >= DATE_SUB(CURDATE(), INTERVAL 30 DAY)
            GROUP BY DATE(created_at)
            ORDER BY date DESC
        """)
        daily_trend = [{"date": str(r['date']), "count": r['count']} for r in cur.fetchall()]

        # Recent events (10)
        cur.execute("""
            SELECT me.id, met.event_name, el.level_name, op.username, ore.name as repo_name, me.message, me.status, me.created_at
            FROM monitoring_events me
            LEFT JOIN monitoring_event_types met ON me.event_type_id = met.id
            LEFT JOIN event_levels el ON me.event_level_id = el.id
            LEFT JOIN org_persons op ON me.org_person_id = op.id
            LEFT JOIN repo_catalog ore ON me.org_repo_id = ore.id
            ORDER BY me.created_at DESC LIMIT 10
        """)
        recent = []
        for r in cur.fetchall():
            recent.append({
                "id": r['id'],
                "eventTypeName": r['event_name'],
                "eventLevelName": r['level_name'],
                "personUsername": r['username'],
                "repoName": r['repo_name'],
                "message": r['message'],
                "status": r['status'],
                "createdAt": str(r['created_at'])
            })

        summary = {
            "total": sum(status_counts.values()),
            "pending": status_counts.get("PENDING", 0),
            "sent": status_counts.get("SENT", 0),
            "read": status_counts.get("READ", 0),
            "resolved": status_counts.get("RESOLVED", 0),
            "ignored": status_counts.get("IGNORED", 0)
        }

        return {
            "data": {
                "statusCounts": status_counts,
                "levelCounts": level_counts,
                "dailyTrend": daily_trend,
                "recentEvents": recent,
                "summary": summary
            }
        }
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc))
    finally:
        try: conn.close()
        except: pass

@router.get("/events/{id}")
def get_event_detail(id: int, db: Optional[DatabaseSettings] = None) -> Dict[str, object]:
    try:
        conn = _db_conn(db)
        cur = conn.cursor(dictionary=True)
        sql = """
            SELECT
              me.id,
              me.event_type_id AS eventTypeId,
              met.event_name AS eventTypeName,
              met.description AS eventTypeDescription,
              me.org_department_id AS orgDepartmentId,
              od.name AS departmentName,
              me.org_repo_id AS orgRepoId,
              ore.name AS repoName,
              me.org_person_id AS orgPersonId,
              op.username AS personUsername,
              op.real_name AS personRealName,
              op.email AS personEmail,
              me.repo_commit_id AS repoCommitId,
              rc.revision AS commitHash,
              rc.message AS commitMessage,
              rc.author AS commitAuthor,
              rc.commit_date AS commitDate,
              me.event_level_id AS eventLevelId,
              el.level_name AS eventLevelName,
              el.description AS eventLevelDescription,
              me.monitoring_table AS monitoringTable,
              me.eval_formula AS evalFormula,
              me.eval_value AS evalValue,
              me.comparison,
              me.monitoring_threshold AS monitoringThreshold,
              me.threshold_value AS thresholdValue,
              me.message,
              me.status,
              me.sent_at AS sentAt,
              me.read_at AS readAt,
              me.resolved_at AS resolvedAt,
              me.event_time AS eventTime,
              me.created_at AS createdAt,
              me.updated_at AS updatedAt
            FROM monitoring_events me
            LEFT JOIN monitoring_event_types met ON me.event_type_id = met.id
            LEFT JOIN event_levels el ON me.event_level_id = el.id
            LEFT JOIN org_departments od ON me.org_department_id = od.id
            LEFT JOIN repo_catalog ore ON me.org_repo_id = ore.id
            LEFT JOIN org_persons op ON me.org_person_id = op.id
            LEFT JOIN repo_commits rc ON me.repo_commit_id = rc.id
            WHERE me.id = %s
            LIMIT 1
        """
        cur.execute(sql, (id,))
        row = cur.fetchone()

        if not row:
            raise HTTPException(status_code=404, detail="Event not found")

        # Convert dates
        for k, v in row.items():
            if isinstance(v, (dt.date, dt.datetime)):
                row[k] = str(v)

        return {"data": row}
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc))
    finally:
         try: conn.close()
         except: pass

@router.put("/events/{id}")
def update_event_status(id: int, body: EventStatusUpdate, db: Optional[DatabaseSettings] = None) -> Dict[str, object]:
    VALID_STATUSES = ['PENDING', 'SENT', 'READ', 'RESOLVED', 'IGNORED']
    if body.status not in VALID_STATUSES:
         raise HTTPException(status_code=400, detail=f"Invalid status. Must be one of: {', '.join(VALID_STATUSES)}")

    try:
        conn = _db_conn(db)
        cur = conn.cursor()

        updates = ["status=%s"]
        params = [body.status]

        if body.status == 'SENT':
            updates.append("sent_at = NOW()")
        if body.status == 'READ':
            updates.append("read_at = NOW()")
        if body.status in ('RESOLVED', 'IGNORED'):
            updates.append("resolved_at = NOW()")

        params.append(id)

        sql = f"UPDATE monitoring_events SET {', '.join(updates)} WHERE id=%s"
        cur.execute(sql, tuple(params))
        conn.commit()

        if cur.rowcount == 0:
             raise HTTPException(status_code=404, detail="Event not found")

        return {"success": True, "message": "Event updated successfully"}
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc))
    finally:
        try: conn.close()
        except: pass

@router.delete("/events/{id}")
def delete_event(id: int, db: Optional[DatabaseSettings] = None) -> Dict[str, object]:
    try:
        conn = _db_conn(db)
        cur = conn.cursor()
        cur.execute("DELETE FROM monitoring_events WHERE id=%s", (id,))
        conn.commit()

        if cur.rowcount == 0:
             raise HTTPException(status_code=404, detail="Event not found")

        return {"success": True, "message": "Event deleted successfully"}
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc))
    finally:
        try: conn.close()
        except: pass
