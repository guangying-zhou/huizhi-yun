#!/usr/bin/env python3
"""Backfill first_commit_at and last_commit_at on org_persons

Scans repo_commits to compute MIN/MAX committed_at for each org_persons
matched by username (TRIM author_name) only (we skip matching on email), and updates
org_persons.first_commit_at / last_commit_at accordingly.

Usage:
  python server/scripts/backfill_person_commit_times.py --dry-run
  python server/scripts/backfill_person_commit_times.py --batch-size 200

Options:
  --db-host --db-port --db-user --db-password --db-name
  --dry-run (default: False) : don't write changes, print summary
  --batch-size (default: 200) : how many persons to update per transaction
  --only-null (default: true) : only touch persons where first_commit_at IS NULL OR last_commit_at IS NULL

This script is safe to re-run; updates use LEAST/GREATEST semantics to avoid regressing values.
"""
from __future__ import annotations

import argparse
import datetime as dt
import logging
import os
import sys
from typing import Optional

try:
    import mysql.connector  # type: ignore
except ImportError as exc:
    raise SystemExit("mysql-connector-python required. pip install mysql-connector-python") from exc

logging.basicConfig(level=os.environ.get("LOG_LEVEL", "INFO"))
LOGGER = logging.getLogger(__name__)


def parse_args(argv: Optional[list] = None):
    p = argparse.ArgumentParser(description="Backfill org_persons first_commit_at and last_commit_at from repo_commits")
    p.add_argument("--db-host", default=os.environ.get("DB_HOST", "127.0.0.1"))
    p.add_argument("--db-port", type=int, default=int(os.environ.get("DB_PORT", "3306")))
    p.add_argument("--db-user", default=os.environ.get("DB_USER", "root"))
    p.add_argument("--db-password", default=os.environ.get("DB_PASSWORD", "Wiztek@1902"))
    p.add_argument("--db-name", default=os.environ.get("DB_NAME", "codeinsightdb"))
    p.add_argument("--dry-run", action="store_true")
    p.add_argument("--batch-size", type=int, default=200)
    p.add_argument("--only-null", dest="only_null", action="store_true", default=True)
    p.add_argument("--no-only-null", dest="only_null", action="store_false")
    return p.parse_args(list(argv) if argv is not None else None)


def connect(args):
    return mysql.connector.connect(
        host=args.db_host,
        port=args.db_port,
        user=args.db_user,
        password=args.db_password,
        database=args.db_name,
        autocommit=False,
    )


def main(argv: Optional[list] = None) -> int:
    args = parse_args(argv)
    conn = connect(args)
    cur = conn.cursor()

    # Build list of person ids to process
    if args.only_null:
        cur.execute(
            "SELECT id, username, email FROM org_persons WHERE first_commit_at IS NULL OR last_commit_at IS NULL"
        )
    else:
        cur.execute("SELECT id, username, email FROM org_persons")

    persons = cur.fetchall()
    total = len(persons)
    LOGGER.info(f"Found {total} person(s) to inspect")

    batch = []
    processed = 0
    failures = 0

    for idx, (pid, username, email) in enumerate(persons, start=1):
        # Compute MIN/MAX from repo_commits
        try:
            q = (
                "SELECT MIN(c.committed_at), MAX(c.committed_at) FROM repo_commits c "
                "WHERE TRIM(c.author_name) = %s AND c.committed_at IS NOT NULL"
            )
            cur.execute(q, (username or '',))
            row = cur.fetchone()
            if not row:
                LOGGER.debug("No commits found for person %s (%s)", pid, username)
                continue
            first_seen, last_seen = row[0], row[1]

            if first_seen is None and last_seen is None:
                continue

            if args.dry_run:
                LOGGER.info("[dry-run] person=%s username=%s email=%s -> first=%s last=%s", pid, username, email, first_seen, last_seen)
            else:
                # Update with conservative LEAST/GREATEST semantics to avoid regressions
                cur.execute(
                    "UPDATE org_persons SET first_commit_at = CASE WHEN first_commit_at IS NULL THEN %s ELSE LEAST(first_commit_at, %s) END, "
                    "last_commit_at = CASE WHEN last_commit_at IS NULL THEN %s ELSE GREATEST(last_commit_at, %s) END WHERE id=%s",
                    (first_seen, first_seen, last_seen, last_seen, pid),
                )
                batch.append(pid)
        except Exception as e:
            failures += 1
            LOGGER.exception("Failed to compute/update person %s (%s): %s", pid, username, e)

        # commit per batch
        if not args.dry_run and len(batch) >= args.batch_size:
            try:
                conn.commit()
                processed += len(batch)
                LOGGER.info("Committed batch of %d updates (%d/%d)", len(batch), processed, total)
            except Exception:
                conn.rollback()
                LOGGER.exception("Failed to commit batch updates")
            batch = []

    # final commit
    if not args.dry_run and batch:
        try:
            conn.commit()
            processed += len(batch)
            LOGGER.info("Committed final batch of %d updates (%d/%d)", len(batch), processed, total)
        except Exception:
            conn.rollback()
            LOGGER.exception("Failed to commit final batch updates")

    LOGGER.info("Finished. processed=%d failures=%d total=%d", processed, failures, total)
    cur.close()
    conn.close()
    return 0


if __name__ == '__main__':
    sys.exit(main())
