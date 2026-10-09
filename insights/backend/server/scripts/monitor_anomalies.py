#!/usr/bin/env python3
"""
Anomaly Monitoring Script

This script detects anomaly events based on configured rules in `monitoring_event_types`.
It reads system parameters for configuration, queries statistical tables, and inserts
detected anomalies into `monitoring_events`.

Usage:
  python server/scripts/monitor_anomalies.py
"""

import os
import sys
import argparse
import logging
import json
import datetime as dt
from typing import Dict, List, Any, Optional, Tuple

try:
    import mysql.connector
    from mysql.connector import errorcode
except ImportError:
    print("mysql-connector-python is required. pip install mysql-connector-python")
    sys.exit(1)

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(levelname)s - %(message)s',
    handlers=[logging.StreamHandler()]
)
LOGGER = logging.getLogger(__name__)

def get_db_connection():
    return mysql.connector.connect(
        host=os.environ.get("DB_HOST", "svn.wiztek.cn"),
        port=int(os.environ.get("DB_PORT", "3306")),
        user=os.environ.get("DB_USER", "root"),
        password=os.environ.get("DB_PASSWORD", "Wiztek@1902"),
        database=os.environ.get("DB_NAME", "codeinsightdb")
    )

def get_system_parameters(conn) -> Dict[str, str]:
    """Fetch all system parameters."""
    cursor = conn.cursor()
    cursor.execute("SELECT param_key, param_value FROM system_parameters")
    params = {row[0]: row[1] for row in cursor.fetchall()}
    cursor.close()
    return params

def update_system_parameter(conn, key: str, value: str):
    """Update a system parameter."""
    cursor = conn.cursor()
    cursor.execute(
        "INSERT INTO system_parameters (param_key, param_value) VALUES (%s, %s) "
        "ON DUPLICATE KEY UPDATE param_value = VALUES(param_value)",
        (key, value)
    )
    conn.commit()
    cursor.close()

def get_enabled_event_types(conn) -> List[Dict[str, Any]]:
    """Fetch all enabled monitoring event types."""
    cursor = conn.cursor(dictionary=True)
    cursor.execute("SELECT * FROM monitoring_event_types WHERE is_enabled = 1")
    event_types = cursor.fetchall()
    cursor.close()
    return event_types

def get_threshold_value(params: Dict[str, str], threshold_key: str) -> Optional[float]:
    """Get threshold value from system parameters."""
    val = params.get(threshold_key)
    if val is None:
        return None
    try:
        return float(val)
    except ValueError:
        LOGGER.warning(f"Invalid threshold value for {threshold_key}: {val}")
        return None

def format_message(template: str, context: Dict[str, Any]) -> str:
    """Format message template with context variables."""
    if not template:
        return ""
    try:
        return template.format(**context)
    except KeyError as e:
        LOGGER.warning(f"Missing key for message template: {e}")
        return template # Return raw template if formatting fails
    except Exception as e:
        LOGGER.error(f"Error formatting message: {e}")
        return template

def format_number(value: float) -> str:
    """Format number to string, removing trailing .0 if it's an integer."""
    if value is None:
        return "0"
    # Format to 1 decimal place first
    s = f"{float(value):.1f}"
    if s.endswith(".0"):
        return s[:-2]
    return s

def process_event_type(conn, event_type: Dict[str, Any], start_date: str, end_date: str, params: Dict[str, str], is_manual_run: bool = False):
    """Process a single event type and detect anomalies."""
    event_type_id = event_type['id']
    event_name = event_type['event_name']
    table_name = event_type['monitoring_table']
    eval_formula = event_type['eval_formula']
    comparison = event_type['comparison']
    threshold_key = event_type['monitoring_threshold']
    message_template = event_type['message_template']
    coder_only = event_type['coder_only']
    event_level_id = event_type['event_level_id']

    LOGGER.info(f"Processing rule: {event_name} (ID: {event_type_id}) on table {table_name}")

    threshold_value = get_threshold_value(params, threshold_key)
    if threshold_value is None:
        LOGGER.warning(f"Skipping rule {event_name}: Threshold {threshold_key} not found or invalid.")
        return

    # Cleanup for manual run
    if is_manual_run:
        LOGGER.info(f"Manual run: Deleting existing events for rule {event_name} in window {start_date} to {end_date}")
        cursor_del = conn.cursor()
        try:
            # Note: event_time is a DATETIME, start_date/end_date are strings. MySQL handles comparison.
            del_sql = "DELETE FROM monitoring_events WHERE event_type_id = %s AND event_time >= %s AND event_time <= %s"
            cursor_del.execute(del_sql, (event_type_id, start_date, end_date))
            conn.commit()
            LOGGER.info(f"Deleted {cursor_del.rowcount} existing events.")
        except mysql.connector.Error as err:
            LOGGER.error(f"Failed to delete existing events: {err}")
        finally:
            cursor_del.close()

    cursor = conn.cursor(dictionary=True)

    # Build Query
    # We need to select columns to populate monitoring_events:
    # org_department_id, org_repo_id, org_person_id, repo_commit_id, created_at (as event time)
    # And the value for the message.

    # Identify time column and ID columns based on table
    time_col = ""
    select_cols = ""
    join_clause = ""
    where_clause = ""

    # Common joins
    # Most tables link to repo_catalog (-> org_repo_id?) No, repo_catalog IS the repo.
    # We need to map internal IDs to what monitoring_events expects.
    # monitoring_events: org_department_id, org_repo_id, org_person_id, repo_commit_id

    # NOTE: org_repo_id in monitoring_events likely refers to repo_catalog.id (or a separate org_repos table if it existed, but usually repo_catalog is the main one).
    # Let's assume org_repo_id -> repo_catalog.id.
    # org_person_id -> org_persons.id
    # org_department_id -> org_departments.id (often via person or repo)
    # repo_commit_id -> repo_commits.id

    if table_name == 'repo_commits':
        time_col = "committed_at"
        # repo_commits has repo_catalog_id. It doesn't have person_id directly, but has author_name/email.
        # We need to join org_persons to get person_id and department_id?
        # Or maybe we just record what we have.
        # Ideally we join org_persons on author_name = username.
        select_cols = """
            t.id as repo_commit_id,
            t.repo_catalog_id as org_repo_id,
            p.id as org_person_id,
            p.department_id as org_department_id,
            t.committed_at as event_time,
            rc.name as repo_name,
            COALESCE(p.real_name, t.author_name) as actor_name
        """
        join_clause = """
            LEFT JOIN org_persons p ON t.author_name = p.username
            LEFT JOIN repo_catalog rc ON t.repo_catalog_id = rc.id
        """
        # Only process commits that have been fully ingested
        where_clause = f"t.files_ingested = 1 AND t.{time_col} >= '{start_date}' AND t.{time_col} <= '{end_date}'"

        if coder_only:
            # If coder_only is set, we strictly require the person to be a coder.
            # This implies p.id must not be null AND p.is_coder = 1
            where_clause += " AND p.is_coder = 1"

    elif table_name == 'stat_person_daily':
        time_col = "stat_date"
        select_cols = """
            NULL as repo_commit_id,
            NULL as org_repo_id,
            t.person_id as org_person_id,
            t.department_id as org_department_id,
            t.stat_date as event_time,
            'ALL' as repo_name,
            p.real_name as actor_name
        """
        join_clause = """
            JOIN org_persons p ON t.person_id = p.id
        """
        where_clause = f"t.{time_col} >= '{start_date}' AND t.{time_col} <= '{end_date}'"

        if coder_only:
             where_clause += " AND p.is_coder = 1"

    elif table_name == 'stat_repo_daily':
        time_col = "stat_date"
        select_cols = """
            NULL as repo_commit_id,
            t.repo_catalog_id as org_repo_id,
            NULL as org_person_id,
            rc.department_id as org_department_id,
            t.stat_date as event_time,
            rc.name as repo_name,
            'System' as actor_name
        """
        join_clause = """
            JOIN repo_catalog rc ON t.repo_catalog_id = rc.id
        """
        where_clause = f"t.{time_col} >= '{start_date}' AND t.{time_col} <= '{end_date}'"

        # coder_only doesn't make much sense for repo stats, but if set, maybe we ignore?
        # Or maybe it implies we only look at repos owned by coders? Unlikely.
        # We'll ignore coder_only for repo stats or treat it as no-op unless defined otherwise.

    elif table_name == 'stat_person_monthly':
         # Similar to daily but monthly
         # stat_year, stat_month. We need to construct a date for comparison.
         # Let's assume we check if the month falls within the range.
         # Or simpler: construct a date 'YYYY-MM-01'
         select_cols = """
            NULL as repo_commit_id,
            NULL as org_repo_id,
            t.person_id as org_person_id,
            t.department_id as org_department_id,
            STR_TO_DATE(CONCAT(t.stat_year, '-', t.stat_month, '-01'), '%Y-%m-%d') as event_time,
            'ALL' as repo_name,
            p.real_name as actor_name
        """
         join_clause = """
            JOIN org_persons p ON t.person_id = p.id
        """
         # Filter by constructing date
         where_clause = f"STR_TO_DATE(CONCAT(t.stat_year, '-', t.stat_month, '-01'), '%Y-%m-%d') >= '{start_date}' AND STR_TO_DATE(CONCAT(t.stat_year, '-', t.stat_month, '-01'), '%Y-%m-%d') <= '{end_date}'"

         if coder_only:
             where_clause += " AND p.is_coder = 1"

    elif table_name == 'stat_repo_monthly':
        select_cols = """
            NULL as repo_commit_id,
            t.repo_catalog_id as org_repo_id,
            NULL as org_person_id,
            rc.department_id as org_department_id,
            STR_TO_DATE(CONCAT(t.stat_year, '-', t.stat_month, '-01'), '%Y-%m-%d') as event_time,
            rc.name as repo_name,
            'System' as actor_name
        """
        join_clause = """
            JOIN repo_catalog rc ON t.repo_catalog_id = rc.id
        """
        where_clause = f"STR_TO_DATE(CONCAT(t.stat_year, '-', t.stat_month, '-01'), '%Y-%m-%d') >= '{start_date}' AND STR_TO_DATE(CONCAT(t.stat_year, '-', t.stat_month, '-01'), '%Y-%m-%d') <= '{end_date}'"

    else:
        LOGGER.warning(f"Unknown monitoring table: {table_name}")
        return

    # Construct the full query
    # We also need the calculated value to put in the message
    # eval_formula is something like "files_added" or "lines_added / commits"

    # Safety check for eval_formula to prevent SQL injection is hard in pure python without a parser,
    # but here we assume admin input is trusted or we rely on the fact that it's just columns.
    # We will select it as 'actual_value'

    sql = f"""
        SELECT
            {select_cols},
            ({eval_formula}) as actual_value
        FROM {table_name} t
        {join_clause}
        WHERE {where_clause}
        AND ({eval_formula}) {comparison} {threshold_value}
    """

    try:
        cursor.execute(sql)
        rows = cursor.fetchall()
    except mysql.connector.Error as err:
        LOGGER.error(f"Failed to execute query for rule {event_name}: {err}")
        LOGGER.error(f"SQL: {sql}")
        return

    if not rows:
        return

    LOGGER.info(f"Found {len(rows)} anomalies for rule {event_name}")



    # Re-write insert SQL to let DB handle created_at
    insert_sql = """
        INSERT INTO monitoring_events (
            event_type_id, org_department_id, org_repo_id, org_person_id, repo_commit_id,
            event_level_id, monitoring_table, eval_formula, comparison, monitoring_threshold,
            message, status, eval_value, threshold_value, event_time
        ) VALUES (
            %s, %s, %s, %s, %s,
            %s, %s, %s, %s, %s,
            %s, 'PENDING', %s, %s, %s
        )
    """

    # Adjust data tuple
    events_to_insert_clean = []
    for row in rows:
        context = {
            "actor": row['actor_name'] or "Unknown",
            "repo": row['repo_name'] or "Unknown",
            "value": format_number(row['actual_value']),
            "threshold": format_number(threshold_value),
            "repo_commit_id": row['repo_commit_id'],
            "event_time": row['event_time']
        }
        message = format_message(message_template, context)
        events_to_insert_clean.append((
            event_type_id,
            row['org_department_id'],
            row['org_repo_id'],
            row['org_person_id'],
            row['repo_commit_id'],
            event_level_id,
            table_name,
            eval_formula,
            comparison,
            threshold_key,
            message,
            float(row['actual_value'] or 0.0),
            int(threshold_value or 0),
            row['event_time']
        ))

    cursor_insert = conn.cursor()
    try:
        cursor_insert.executemany(insert_sql, events_to_insert_clean)
        conn.commit()
        LOGGER.info(f"Inserted {cursor_insert.rowcount} events for rule {event_name}")
    except mysql.connector.Error as err:
        LOGGER.error(f"Failed to insert events: {err}")
    finally:
        cursor_insert.close()


def update_event_stats(conn, start_date: str, end_date: str):
    """
    Update event counts in repo_commits, stat_person_monthly, stat_repo_monthly, and repo_catalog.
    """
    LOGGER.info("Updating event statistics in summary tables...")
    cursor = conn.cursor()

    try:
        # 1. Update repo_commits.abnormal_events
        # Count all monitoring_events for each commit
        sql_commits = """
            UPDATE repo_commits rc
            LEFT JOIN (
                SELECT repo_commit_id, COUNT(*) as cnt
                FROM monitoring_events
                WHERE repo_commit_id IS NOT NULL
                GROUP BY repo_commit_id
            ) me ON rc.id = me.repo_commit_id
            SET rc.abnormal_events = COALESCE(me.cnt, 0)
            WHERE rc.committed_at >= %s AND rc.committed_at <= %s
        """
        cursor.execute(sql_commits, (start_date, end_date))
        LOGGER.info(f"Updated repo_commits.abnormal_events (window {start_date} to {end_date}). Rows affected: {cursor.rowcount}")

        # 2. Update stat_person_monthly.abnormal_events
        # Aggregate based on org_person_id and month derived from event_time
        # We match stat_person_monthly on person_id, stat_year, stat_month
        sql_person_monthly = """
            UPDATE stat_person_monthly spm
            LEFT JOIN (
                SELECT
                    org_person_id,
                    YEAR(event_time) as e_year,
                    MONTH(event_time) as e_month,
                    COUNT(*) as cnt
                FROM monitoring_events
                WHERE org_person_id IS NOT NULL
                GROUP BY org_person_id, YEAR(event_time), MONTH(event_time)
            ) me ON spm.person_id = me.org_person_id
                AND spm.stat_year = me.e_year
                AND spm.stat_month = me.e_month
            SET spm.abnormal_events = COALESCE(me.cnt, 0)
            WHERE STR_TO_DATE(CONCAT(spm.stat_year, '-', spm.stat_month, '-01'), '%Y-%m-%d') >= %s
              AND STR_TO_DATE(CONCAT(spm.stat_year, '-', spm.stat_month, '-01'), '%Y-%m-%d') <= %s
        """
        cursor.execute(sql_person_monthly, (start_date, end_date))
        LOGGER.info(f"Updated stat_person_monthly.abnormal_events. Rows affected: {cursor.rowcount}")

        # 3. Update stat_repo_monthly.commits_events and repo_events
        sql_repo_monthly = """
            UPDATE stat_repo_monthly srm
            LEFT JOIN (
                SELECT
                    org_repo_id,
                    YEAR(event_time) as e_year,
                    MONTH(event_time) as e_month,
                    COUNT(CASE WHEN repo_commit_id IS NOT NULL THEN 1 END) as cnt_commits,
                    COUNT(CASE WHEN repo_commit_id IS NULL THEN 1 END) as cnt_repo
                FROM monitoring_events
                WHERE org_repo_id IS NOT NULL
                GROUP BY org_repo_id, YEAR(event_time), MONTH(event_time)
            ) me ON srm.repo_catalog_id = me.org_repo_id
                AND srm.stat_year = me.e_year
                AND srm.stat_month = me.e_month
            SET
                srm.commits_events = COALESCE(me.cnt_commits, 0),
                srm.repo_events = COALESCE(me.cnt_repo, 0)
            WHERE STR_TO_DATE(CONCAT(srm.stat_year, '-', srm.stat_month, '-01'), '%Y-%m-%d') >= %s
              AND STR_TO_DATE(CONCAT(srm.stat_year, '-', srm.stat_month, '-01'), '%Y-%m-%d') <= %s
        """
        cursor.execute(sql_repo_monthly, (start_date, end_date))
        LOGGER.info(f"Updated stat_repo_monthly.commits_events/repo_events. Rows affected: {cursor.rowcount}")

        # 4. Update repo_catalog.commits_events and repo_events (Global totals)
        # This is cumulative, so we can just recount everything or use the latest aggregate.
        # Recounting from monitoring_events is safest to ensure consistency.
        sql_catalog = """
            UPDATE repo_catalog rc
            LEFT JOIN (
                SELECT org_repo_id, COUNT(*) as cnt
                FROM monitoring_events
                WHERE repo_commit_id IS NOT NULL
                GROUP BY org_repo_id
            ) me_commits ON rc.id = me_commits.org_repo_id
            LEFT JOIN (
                SELECT org_repo_id, COUNT(*) as cnt
                FROM monitoring_events
                WHERE repo_commit_id IS NULL
                GROUP BY org_repo_id
            ) me_repo ON rc.id = me_repo.org_repo_id
            SET
                rc.commits_events = COALESCE(me_commits.cnt, 0),
                rc.repo_events = COALESCE(me_repo.cnt, 0)
        """
        cursor.execute(sql_catalog)
        LOGGER.info(f"Updated repo_catalog global event counts. Rows affected: {cursor.rowcount}")

        conn.commit()

    except mysql.connector.Error as err:
        LOGGER.error(f"Failed to update event stats: {err}")
    finally:
        cursor.close()

def main():
    parser = argparse.ArgumentParser(description="Anomaly Monitoring")
    parser.add_argument("--start-date", help="Override start date (YYYY-MM-DD)")
    args = parser.parse_args()

    conn = get_db_connection()

    try:
        params = get_system_parameters(conn)

        # Determine time window
        # Use only monitoring_start_date (simplified from dual parameters)
        start_date = args.start_date or params.get("monitoring_start_date") or "2024-01-01"
        end_date = dt.datetime.now().strftime("%Y-%m-%d %H:%M:%S")

        LOGGER.info(f"Monitoring Window: {start_date} to {end_date}")

        event_types = get_enabled_event_types(conn)
        if not event_types:
            LOGGER.info("No enabled monitoring rules found.")
            return

        for et in event_types:
            process_event_type(conn, et, start_date, end_date, params, is_manual_run=bool(args.start_date))

        # Update start date to now for next scan
        update_system_parameter(conn, "monitoring_start_date", end_date)

        # Update statistics in repo_commits and repo_catalog
        update_event_stats(conn, start_date, end_date)

        LOGGER.info("Monitoring run completed.")

    finally:
        conn.close()

if __name__ == "__main__":
    main()
