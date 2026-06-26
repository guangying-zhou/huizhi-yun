"""
Contributors/Persons Management API - Complete implementation.

Includes person listing, details, stats, and management endpoints.
"""
from datetime import datetime
from typing import List, Optional

from fastapi import APIRouter, Path, Query, Body
from pydantic import BaseModel, Field

from server.python_service.db import execute_query, execute_update

router = APIRouter(prefix="/api/contributors", tags=["contributors"])


# ========== Pydantic Models ==========

class ContributorListItem(BaseModel):
    """Contributor list item."""
    model_config = {"populate_by_name": True}

    id: int
    name: str  # Display name (real_name or username)
    real_name: Optional[str] = Field(None, alias="realName")
    username: str
    email: Optional[str] = None
    parent_id: Optional[int] = Field(None, alias="parentId")
    parent_name: Optional[str] = Field(None, alias="parentName") 
    department_id: Optional[int] = Field(None, alias="departmentId")
    department_name: Optional[str] = Field(None, alias="departmentName")
    is_coder: bool = Field(False, alias="isCoder")
    is_active: bool = Field(True, alias="isActive")
    first_commit_at: Optional[datetime] = Field(None, alias="firstCommitAt")
    last_commit_at: Optional[datetime] = Field(None, alias="lastCommitAt")


class ContributorDetail(BaseModel):
    """Contributor detail response."""
    model_config = {"populate_by_name": True}

    id: int
    username: str
    real_name: Optional[str] = Field(None, alias="realName")
    email: Optional[str] = None
    parent_id: Optional[int] = Field(None, alias="parentId")
    parent_name: Optional[str] = Field(None, alias="parentName")
    department_id: Optional[int] = Field(None, alias="departmentId")
    department_name: Optional[str] = Field(None, alias="departmentName")
    is_coder: bool = Field(False, alias="isCoder")
    is_active: bool = Field(True, alias="isActive")
    first_commit_at: Optional[datetime] = Field(None, alias="firstCommitAt")
    last_commit_at: Optional[datetime] = Field(None, alias="lastCommitAt")


# ========== Contributors Management Endpoints ==========

@router.get("", response_model=List[ContributorListItem])
@router.get("/", response_model=List[ContributorListItem], include_in_schema=False)
async def list_contributors(
    dept_id: Optional[int] = Query(None, alias="deptId"),
    is_coder: Optional[int] = Query(None, alias="isCoder"),
    is_active: Optional[int] = Query(None, alias="isActive"),
    search: Optional[str] = None,
    include_secondary: bool = Query(False, alias="includeSecondary"),
):
    """
    Get full list of contributors with filtering.

    Supports filtering by department, coder status, search term, and inclusion of secondary accounts.
    """
    where_clauses = [] 
    if not include_secondary:
        where_clauses.append("p.parent_id IS NULL")
    params = []

    if dept_id:
        where_clauses.append("p.department_id = %s")
        params.append(dept_id)

    if is_coder is not None:
        where_clauses.append("p.is_coder = %s")
        params.append(is_coder)

    # Note: alias is 'isActive' in frontend, but we can accept it as query param if we defined it
    # Adding an explicit parameter for clarity
    if is_active is not None:
        where_clauses.append("p.is_active = %s")
        params.append(is_active)

    if search:
        where_clauses.append("(p.real_name LIKE %s OR p.username LIKE %s OR p.email LIKE %s)")
        search_param = f"%{search}%"
        params.extend([search_param, search_param, search_param])

    where_sql = ""
    if where_clauses:
        where_sql = f"WHERE {' AND '.join(where_clauses)}"

    sql = f"""
        SELECT
            p.id,
            COALESCE(p.real_name, p.username) as name,
            p.username,
            p.real_name,
            p.email,
            p.parent_id,
            COALESCE(parent.real_name, parent.username) as parent_name,
            p.department_id,
            d.name as department_name,
            p.is_coder,
            p.is_active,
            p.first_commit_at,
            p.last_commit_at
        FROM org_persons p
        LEFT JOIN org_departments d ON p.department_id = d.id
        LEFT JOIN org_persons parent ON p.parent_id = parent.id
        {where_sql}
        ORDER BY p.last_commit_at IS NULL, p.last_commit_at DESC
        LIMIT 10000
    """

    rows = await execute_query(sql, tuple(params))

    return [
        ContributorListItem(
            id=row["id"],
            name=row["name"],
            username=row["username"],
            real_name=row["real_name"],
            email=row["email"],
            parent_id=row["parent_id"],
            parent_name=row["parent_name"],
            department_id=row["department_id"],
            department_name=row["department_name"],
            is_coder=row["is_coder"],
            is_active=row["is_active"],
            first_commit_at=row["first_commit_at"],
            last_commit_at=row["last_commit_at"],
        )
        for row in rows
    ]


@router.get("/{person_id}", response_model=ContributorDetail)
async def get_contributor_detail(person_id: int = Path(...)):
    """Get detailed information for a specific contributor."""
    """Get detailed information for a specific contributor."""
    sql = """
        SELECT
            p.id,
            p.username,
            p.real_name,
            p.email,
            p.parent_id,
            COALESCE(parent.real_name, parent.username) as parent_name,
            p.department_id,
            d.name as department_name,
            p.is_coder,
            p.is_active,
            p.first_commit_at,
            p.last_commit_at
        FROM org_persons p
        LEFT JOIN org_departments d ON p.department_id = d.id
        LEFT JOIN org_persons parent ON p.parent_id = parent.id
        WHERE p.id = %s
    """

    rows = await execute_query(sql, (person_id,))
    if not rows:
        return None

    row = rows[0]
    return ContributorDetail(
        id=row["id"],
        username=row["username"],
        real_name=row["real_name"],
        email=row["email"],
        parent_id=row["parent_id"],
        parent_name=row["parent_name"],
        department_id=row["department_id"],
        department_name=row["department_name"],
        is_coder=row["is_coder"],
        is_active=row["is_active"],
        first_commit_at=row["first_commit_at"],
        last_commit_at=row["last_commit_at"],
    )


@router.patch("/{person_id}/active")
async def update_contributor_active_status(
    person_id: int = Path(...),
    is_active: bool = Body(..., embed=True, alias="isActive"),
):
    """Update contributor active status."""
    sql = "UPDATE org_persons SET is_active = %s WHERE id = %s"
    await execute_update(sql, (is_active, person_id))

    return {"success": True, "id": person_id, "isActive": is_active}


@router.patch("/{person_id}/department")
async def update_contributor_department(
    person_id: int = Path(...),
    department_id: Optional[int] = Body(None, embed=True, alias="departmentId"),
):
    """Update contributor department assignment."""
    sql = "UPDATE org_persons SET department_id = %s WHERE id = %s"
    await execute_update(sql, (department_id, person_id))

    return {"success": True, "id": person_id, "departmentId": department_id}


@router.patch("/{person_id}/coder")
async def update_contributor_coder_status(
    person_id: int = Path(...),
    is_coder: bool = Body(..., embed=True, alias="isCoder"),
):
    """Update contributor coder status."""
    sql = "UPDATE org_persons SET is_coder = %s WHERE id = %s"
    await execute_update(sql, (is_coder, person_id))

    return {"success": True, "id": person_id, "isCoder": is_coder}


@router.get("/{person_id}/repos")
async def get_contributor_repos(
    person_id: int = Path(...),
    page: int = Query(1, ge=1),
    page_size: int = Query(20, ge=1, le=100),
):
    """Get repositories contributed to by a person."""
    offset = (page - 1) * page_size

    sql = """
        SELECT DISTINCT
            r.id,
            r.name,
            SUM(sprm.total_lines_changed) as total_loc,
            SUM(sprm.total_commits) as commits,
            MAX(sprm.last_commit_at) as last_commit_at
        FROM stat_person_repo_monthly sprm
        JOIN repo_catalog r ON sprm.repo_catalog_id = r.id
        WHERE sprm.person_id = %s
        GROUP BY r.id, r.name
        ORDER BY total_loc DESC
        LIMIT %s OFFSET %s
    """

    rows = await execute_query(sql, (person_id, page_size, offset))

    return [
        {
            "id": row["id"],
            "name": row["name"],
            "totalLoc": int(row["total_loc"] or 0),
            "commits": int(row["commits"] or 0),
            "lastCommitAt": row["last_commit_at"],
        }
        for row in rows
    ]


@router.get("/{person_id}/commits")
async def get_contributor_commits(
    person_id: int = Path(...),
    page: int = Query(1, ge=1),
    page_size: int = Query(20, ge=1, le=100),
    start_date: Optional[str] = Query(None, alias="startDate"),
    end_date: Optional[str] = Query(None, alias="endDate"),
):
    """Get commit history for a specific contributor across all repositories."""
    offset = (page - 1) * page_size

    # First get the person's email and usernames (including aliases)
    person_sql = "SELECT email, username FROM org_persons WHERE id = %s OR parent_id = %s"
    persons = await execute_query(person_sql, (person_id, person_id))
    if not persons:
        return {"data": [], "total": 0}

    emails = {p["email"] for p in persons if p["email"]}
    usernames = {p["username"] for p in persons if p["username"]}

    # Construct the query
    where_clauses = ["rc.is_invalid = 0"]
    params = []

    # Filter by author (email OR username, supporting aliases)
    author_conditions = []

    if emails:
        placeholders = ",".join(["%s"] * len(emails))
        author_conditions.append(f"rc.author_email IN ({placeholders})")
        params.extend(emails)

    if usernames:
        placeholders = ",".join(["%s"] * len(usernames))
        author_conditions.append(f"rc.author_name IN ({placeholders})")
        params.extend(usernames)

    if author_conditions:
        where_clauses.append(f"({' OR '.join(author_conditions)})")
    else:
        # Should imply no valid identity to match
        return {"data": [], "total": 0}

    if start_date:
        where_clauses.append("rc.committed_at >= %s")
        params.append(start_date)

    if end_date:
        if len(end_date) == 10:
            end_date += " 23:59:59"
        where_clauses.append("rc.committed_at <= %s")
        params.append(end_date)

    where_str = " AND ".join(where_clauses)

    # Count total
    count_sql = f"""
        SELECT COUNT(*) as count
        FROM repo_commits rc
        WHERE {where_str}
    """
    count_rows = await execute_query(count_sql, tuple(params))
    total_count = count_rows[0]["count"] if count_rows else 0

    # Fetch data
    sql = f"""
        SELECT
            rc.id,
            rc.revision,
            rc.message,
            rc.committed_at,
            r.name as repo_name,
            r.source_type,
            rc.author_name,
            rc.files_added,
            rc.code_files_modified,
            rc.code_files_deleted,
            rc.files_unexpected,
            rc.lines_added,
            rc.lines_modified,
            rc.lines_deleted,
            rc.score_submission_quality as quality_score
        FROM repo_commits rc
        JOIN repo_catalog r ON rc.repo_catalog_id = r.id
        WHERE {where_str}
        ORDER BY rc.committed_at DESC
        LIMIT %s OFFSET %s
    """

    rows = await execute_query(sql, tuple(params + [page_size, offset]))

    data = []
    for row in rows:
        total_lines = (row["lines_added"] or 0) + (row["lines_deleted"] or 0) + (row["lines_modified"] or 0)
        total_files = (row["files_added"] or 0) + (row["code_files_modified"] or 0) + (row["code_files_deleted"] or 0)

        data.append({
            "id": row["id"],
            "revision": row["revision"],
            "message": row["message"],
            "committedAt": row["committed_at"],
            "repoName": row["repo_name"],
            "sourceType": row["source_type"],
            "authorName": row["author_name"],
            "filesAdded": row["files_added"] or 0,
            "filesModified": row["code_files_modified"] or 0,
            "filesDeleted": row["code_files_deleted"] or 0,
            "totalFilesChanged": total_files,
            "totalUnexpectedFiles": row["files_unexpected"] or 0,
            "totalLinesChanged": total_lines,
            "qualityScore": float(row["quality_score"] or 0) if row["quality_score"] is not None else 0,
        })

    return {
        "data": data,
        "total": total_count,
        "page": page,
        "pageSize": page_size
    }


@router.patch("/{person_id}")
async def update_contributor(
    person_id: int = Path(...),
    updates: dict = Body(...)
):
    """Generic endpoint to update contributor fields.

    Accepts a dict of field names and values to update.
    Supported fields: realName, email, departmentId, isActive, isCoder, parentId
    """
    # Map camelCase fields to snake_case database columns
    field_mapping = {
        "realName": "real_name",
        "email": "email",
        "departmentId": "department_id",
        "isActive": "is_active",
        "isCoder": "is_coder",
        "parentId": "parent_id"
    }

    # Build SET clause and params
    set_clauses = []
    params = []

    for key, value in updates.items():
        # Check if field is in the mapping
        if key in field_mapping:
            db_column = field_mapping[key]
            set_clauses.append(f"{db_column} = %s")
            params.append(value)

    if not set_clauses:
        return {"success": False, "message": "No valid fields to update"}

    params.append(person_id)
    sql = f"UPDATE org_persons SET {', '.join(set_clauses)} WHERE id = %s"

    try:
        await execute_update(sql, tuple(params))
    except Exception as e:
        if "Duplicate entry" in str(e):
            return {"success": False, "message": "Changes conflict with existing records (e.g. duplicate email)."}
        raise e

    return {"success": True, "id": person_id, "updated": list(updates.keys())}


@router.post("/batch-set-email")
async def batch_set_email(
    person_ids: list[int] = Body(..., alias="personIds"),
    email_domain: str = Body(..., alias="emailDomain")
):
    """Batch set email addresses for contributors.

    Sets email as username@emailDomain for all specified person IDs.
    """
    if not person_ids:
        return {"success": False, "updatedCount": 0, "message": "No person IDs provided"}

    if not email_domain or not email_domain.strip():
        return {"success": False, "updatedCount": 0, "message": "Email domain is required"}

    # First fetch usernames for the given IDs
    placeholders = ", ".join(["%s"] * len(person_ids))
    select_sql = f"SELECT id, username FROM org_persons WHERE id IN ({placeholders})"

    rows = await execute_query(select_sql, tuple(person_ids))

    if not rows:
        return {"success": False, "updatedCount": 0, "message": "No contributors found with provided IDs"}

    # Build batch update
    domain = email_domain.strip()
    updated_count = 0

    for row in rows:
        person_id = row["id"]
        username = row["username"]
        email = f"{username}@{domain}"

        update_sql = "UPDATE org_persons SET email = %s WHERE id = %s"
        await execute_update(update_sql, (email, person_id))
        updated_count += 1

    return {
        "success": True,
        "updatedCount": updated_count,
        "message": f"Successfully set email for {updated_count} contributor(s)"
    }
