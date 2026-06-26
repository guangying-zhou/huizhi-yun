import logging
import json
from typing import Dict, List, Optional, Any
from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel, Field

from server.python_service.config import Config
try:
    import mysql.connector
except ImportError:
    mysql = None

router = APIRouter(prefix="/api/commits", tags=["commits"])
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

# ========== Endpoints ==========

@router.get("/{commitId}")
def get_commit_detail(commitId: int, db: Optional[DatabaseSettings] = None) -> Dict[str, Any]:
    try:
        conn = _db_conn(db)
        cur = conn.cursor(dictionary=True)

        sql = """
            SELECT rc.id, rc.repo_catalog_id, rc.source_type, rc.repo_key, rc.revision, rc.parent_revisions, rc.author_name, rc.author_email,
                   rc.committer_name, rc.committer_email, rc.committed_at, rc.title, rc.message,
                   rc.files_added, rc.code_files_deleted, rc.code_files_modified, rc.lines_added, rc.lines_deleted, rc.lines_modified,
                   rc.raw_metadata, rc.ingested_at,
                   (SELECT JSON_ARRAYAGG(banned_directory_path) FROM repo_commit_banned_directories WHERE repo_commit_id = rc.id) as banned_directories,
                   rc.files_in_banned_directories,
                   ore.name as repo_catalog_name,
                   rc.directories_banned,
                   rc.files_unexpected,
                   rc.code_files_duplicated,
                   rc.binary_files_added,
                   rc.binary_files_deleted,
                   rc.binary_files_modified,
                   rc.binary_files_duplicated,
                   rc.unexcepted_files_bytes,
                   rc.duplicate_files_bytes,
                   rc.bytes_added,
                   rc.binary_bytes_added,
                   rc.abnormal_events
            FROM repo_commits rc
            LEFT JOIN repo_catalog ore ON rc.repo_catalog_id = ore.id
            WHERE rc.id = %s
            LIMIT 1
        """
        cur.execute(sql, (commitId,))
        commit = cur.fetchone()

        if not commit:
            raise HTTPException(status_code=404, detail="Commit not found")

        # Parse JSON fields
        parents = None
        if commit['parent_revisions']:
            try: parents = json.loads(commit['parent_revisions'])
            except: parents = commit['parent_revisions']

        raw_metadata = None
        if commit['raw_metadata']:
            try: raw_metadata = json.loads(commit['raw_metadata'])
            except: raw_metadata = commit['raw_metadata']

        banned_dirs = []
        if commit['banned_directories']:
            try:
                raw = commit['banned_directories']
                # mysql-connector might return bytes or string depending on version/config
                parsed = json.loads(raw) if isinstance(raw, (str, bytes)) else raw
                if isinstance(parsed, list):
                    banned_dirs = [str(p) for p in parsed]
            except Exception as e:
                LOGGER.error(f"Failed to parse banned_directories: {e}")

        # Calculate derived
        files_changed = (commit['files_added'] or 0) + (commit['code_files_deleted'] or 0) + (commit['code_files_modified'] or 0) + \
                        (commit['binary_files_added'] or 0) + (commit['binary_files_deleted'] or 0) + (commit['binary_files_modified'] or 0) + \
                        (commit['files_unexpected'] or 0)

        # Convert datetime
        committed_at = str(commit['committed_at']) if commit['committed_at'] else None
        ingested_at = str(commit['ingested_at']) if commit['ingested_at'] else None

        return {
            "id": commit['id'],
            "repoCatalogId": commit['repo_catalog_id'],
            "repoCatalogName": commit['repo_catalog_name'],
            "sourceType": commit['source_type'],
            "repoKey": commit['repo_key'],
            "revision": commit['revision'],
            "parentRevisions": parents,
            "authorName": commit['author_name'],
            "authorEmail": commit['author_email'],
            "committerName": commit['committer_name'],
            "committerEmail": commit['committer_email'],
            "committedAt": committed_at,
            "title": commit['title'],
            "message": commit['message'],
            "filesAdded": commit['files_added'],
            "filesDeleted": commit['code_files_deleted'],
            "filesModified": commit['code_files_modified'],
            "linesAdded": commit['lines_added'],
            "linesDeleted": commit['lines_deleted'],
            "linesModified": commit['lines_modified'],
            "filesChanged": files_changed,
            "rawMetadata": raw_metadata,
            "ingestedAt": ingested_at,
            "bannedDirectories": banned_dirs,
            "bannedDirectoryFiles": commit['files_in_banned_directories'],
            "directoriesBanned": commit['directories_banned'], # Check type? TS says string[] but SQL might be count?
                                                               # Wait, TS interface says `directories_banned: string[]` but SQL column `directories_banned` is likely an INT count based on `files.get.ts` naming?
                                                               # TS interface `directories_banned` is actually `number` in `CommitDetailRow` but `string[]` in property?
                                                               # In RowDataPacket `directories_banned: number` (line 27 in commits.get.ts, line 29 in [commitId].get.ts says string[]!)
                                                               # Let's check the SQL.
                                                               # Node.js: `rc.directories_banned` is selected. If it's `string[]` it must be JSON?
                                                               # In `commits` listing (Step 382), `directories_banned` is number.
                                                               # In `[commitId].get.ts`, it is used as `directoriesBanned: commit.directories_banned`.
                                                               # If `directories_banned` is a column, it's likely number.
                                                               # But line 29 of `[commitId].get.ts` says `directories_banned: string[]`.
                                                               # This might be an error in Node.js type definition or schema change?
                                                               # Assuming it is number in DB (count).
            "filesUnexpected": commit['files_unexpected'],
            "filesDuplicated": commit['code_files_duplicated'],
            "binaryFilesAdded": commit['binary_files_added'],
            "binaryFilesDeleted": commit['binary_files_deleted'],
            "binaryFilesModified": commit['binary_files_modified'],
            "binaryFilesDuplicated": commit['binary_files_duplicated'],
            "unexceptedFilesBytes": commit['unexcepted_files_bytes'],
            "duplicateFilesBytes": commit['duplicate_files_bytes'],
            "bytesAdded": commit['bytes_added'],
            "binaryBytesAdded": commit['binary_bytes_added'],
            "abnormalEvents": commit['abnormal_events']
        }
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc))
    finally:
         try: conn.close()
         except: pass

@router.get("/{commitId}/files")
def get_commit_files(commitId: int, db: Optional[DatabaseSettings] = None) -> Dict[str, Any]:
    try:
        conn = _db_conn(db)
        cur = conn.cursor(dictionary=True)

        # Check commit exists
        cur.execute("SELECT id FROM repo_commits WHERE id = %s LIMIT 1", (commitId,))
        if not cur.fetchone():
            raise HTTPException(status_code=404, detail="Commit not found")

        # Fetch files
        sql = """
            SELECT id, repo_commit_id, file_path, change_type, lines_added, lines_deleted, lines_modified,
                   bytes_before, bytes_after, can_line_count, file_type, is_duplicate
            FROM repo_commit_files
            WHERE repo_commit_id = %s
            ORDER BY file_path ASC
        """
        cur.execute(sql, (commitId,))
        rows = cur.fetchall()

        data = []
        for r in rows:
            data.append({
                "id": r['id'],
                "repoCommitId": r['repo_commit_id'],
                "filePath": r['file_path'],
                "changeType": r['change_type'],
                "linesAdded": r['lines_added'],
                "linesDeleted": r['lines_deleted'],
                "linesModified": r['lines_modified'],
                "bytesBefore": r['bytes_before'],
                "bytesAfter": r['bytes_after'],
                "canLineCount": bool(r['can_line_count']),
                "fileType": r['file_type'],
                "isDuplicate": bool(r['is_duplicate'])
            })

        return {"data": data}
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc))
    finally:
         try: conn.close()
         except: pass
