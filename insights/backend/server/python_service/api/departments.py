from typing import List, Optional, Dict
from fastapi import APIRouter, Path, Query, Body, HTTPException
from pydantic import BaseModel, Field, ConfigDict

from server.python_service.db import execute_query, execute_update, execute_insert

router = APIRouter(prefix="/api/departments", tags=["departments"])

# ========== ID Models ==========

class CreateDepartmentBody(BaseModel):
    name: str
    code: Optional[str] = None
    parent_id: Optional[int] = Field(None, alias="parentId")
    is_active: bool = Field(True, alias="isActive")
    is_external: bool = Field(False, alias="isExternal")
    manager_id: Optional[int] = Field(None, alias="managerId")

class UpdateDepartmentBody(BaseModel):
    name: Optional[str] = None
    code: Optional[str] = None
    parent_id: Optional[int] = Field(None, alias="parentId")
    is_active: Optional[bool] = Field(None, alias="isActive")
    is_external: Optional[bool] = Field(None, alias="isExternal")
    manager_id: Optional[int] = Field(None, alias="managerId")
    leader_id: Optional[int] = Field(None, alias="leaderId")

class DepartmentItem(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    id: int
    name: str
    code: Optional[str] = None
    parent_id: Optional[int] = Field(None, alias="parentId")
    is_active: bool = Field(..., alias="isActive")
    is_external: bool = Field(..., alias="isExternal")
    manager_id: Optional[int] = Field(None, alias="managerId")
    manager: Optional[str] = None
    leader_id: Optional[int] = Field(None, alias="leaderId")
    leader: Optional[str] = None

class DepartmentResponse(BaseModel):
    data: List[DepartmentItem]

# ========== Endpoints ==========

@router.get("", response_model=DepartmentResponse)
@router.get("/", response_model=DepartmentResponse, include_in_schema=False)
async def list_departments(
    search: Optional[str] = None,
    is_active: Optional[str] = Query(None, alias="isActive"), # '1', '0', 'all', or None
    department_id: Optional[str] = Query(None, alias="departmentId"),
    is_external: Optional[str] = Query(None, alias="isExternal"),
):
    sql = """
        SELECT
            d.id,
            d.name,
            d.code,
            d.parent_id,
            d.is_active,
            d.is_external,
            d.manager_user_id,
            um.username as manager_name,
            d.leader_user_id,
            ul.username as leader_name
        FROM org_departments d
        LEFT JOIN system_users um ON d.manager_user_id = um.id
        LEFT JOIN system_users ul ON d.leader_user_id = ul.id
        WHERE 1=1
    """
    params = []

    if search:
        sql += " AND (d.name LIKE %s OR d.code LIKE %s)"
        params.extend([f"%{search}%", f"%{search}%"])

    if is_active and is_active.lower() != 'all':
        sql += " AND d.is_active = %s"
        params.append(1 if is_active == '1' or is_active.lower() == 'true' else 0)

    if department_id and department_id != '0':
        sql += " AND d.id = %s"
        params.append(department_id)

    if is_external and is_external.lower() != 'all':
        sql += " AND d.is_external = %s"
        params.append(1 if is_external == '1' or is_external.lower() == 'true' else 0)

    sql += " ORDER BY d.parent_id ASC, d.id ASC"

    rows = await execute_query(sql, tuple(params))

    data = [
        DepartmentItem(
            id=row["id"],
            name=row["name"],
            code=row["code"],
            parent_id=row["parent_id"],
            is_active=bool(row["is_active"]),
            is_external=bool(row["is_external"]),
            manager_id=row["manager_user_id"],
            manager=row["manager_name"],
            leader_id=row["leader_user_id"],
            leader=row["leader_name"]
        )
        for row in rows
    ]

    return {"data": data}

@router.post("")
@router.post("/", include_in_schema=False)
async def create_department(body: CreateDepartmentBody):
    if not body.name:
         raise HTTPException(status_code=400, detail="Department name is required")

    try:
        sql = """
            INSERT INTO org_departments
            (name, code, parent_id, is_active, is_external, manager_user_id)
            VALUES (%s, %s, %s, %s, %s, %s)
        """
        params = (
            body.name.strip(),
            body.code.strip() if body.code else None,
            body.parent_id,
            1 if body.is_active else 0,
            1 if body.is_external else 0,
            body.manager_id
        )
        res = await execute_insert(sql, params)
        return {
            "success": True,
            "id": res,
            "message": "Department created successfully"
        }
    except Exception as e:
        # Check for ER_DUP_ENTRY equivalent (IntegrityError)
        if "Duplicate entry" in str(e): # Simplified check, ideally check error code
             raise HTTPException(status_code=409, detail="Department code must be unique")
        raise HTTPException(status_code=500, detail=str(e))

@router.patch("/{id}")
async def update_department(id: int, body: UpdateDepartmentBody):
    if not id:
        raise HTTPException(status_code=400, detail="Invalid department id")

    # Check parent loop
    if body.parent_id is not None and body.parent_id == id:
        raise HTTPException(status_code=400, detail="Cannot set parent to self")

    updates = []
    params = []

    if body.name is not None:
        updates.append("name = %s")
        params.append(body.name.strip())

    if body.code is not None:
        updates.append("code = %s")
        params.append(body.code.strip() if body.code else None)

    if body.parent_id is not None:
        updates.append("parent_id = %s")
        params.append(body.parent_id)

    if body.is_active is not None:
        updates.append("is_active = %s")
        params.append(1 if body.is_active else 0)

    if body.is_external is not None:
        updates.append("is_external = %s")
        params.append(1 if body.is_external else 0)

    if body.manager_id is not None:
        updates.append("manager_user_id = %s")
        params.append(body.manager_id)

    if body.leader_id is not None:
        updates.append("leader_user_id = %s")
        params.append(body.leader_id)

    if not updates:
        return {"success": True, "message": "No valid fields to update"}

    params.append(id)
    sql = f"UPDATE org_departments SET {', '.join(updates)} WHERE id = %s"

    try:
        await execute_update(sql, tuple(params))
        return {
            "success": True,
            "message": "Department updated successfully"
        }
    except Exception as e:
        if "Duplicate entry" in str(e):
             raise HTTPException(status_code=409, detail="Department code must be unique")
        raise HTTPException(status_code=500, detail=str(e))

@router.delete("/{id}")
async def delete_department(id: int):
    if not id:
        raise HTTPException(status_code=400, detail="Invalid department id")

    try:
        res = await execute_update("DELETE FROM org_departments WHERE id = %s", (id,))
        if res == 0:
             raise HTTPException(status_code=404, detail="Department not found")
        return {
            "success": True,
            "message": "Department deleted successfully"
        }
    except Exception as e:
        if "foreign key constraint fails" in str(e).lower():
            raise HTTPException(
                status_code=409,
                detail="Cannot delete department because it has associated users or sub-departments."
            )
        raise HTTPException(status_code=500, detail=str(e))
