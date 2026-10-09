package directory

import (
	"context"
	"database/sql"
	"errors"
	"net/http"
	"strings"

	"github.com/huizhi-yun/data-runtime/internal/httperror"
)

// EnterpriseCodocsDepartmentRole is an internal Directory fact, not a browser
// assertion. The Codocs enterprise route calls it only with its signed actor.
// Leader wins over manager, and parent access stops at the direct parent.
type EnterpriseCodocsDepartmentRole string

const (
	CodocsDepartmentLeader  EnterpriseCodocsDepartmentRole = "leader"
	CodocsDepartmentManager EnterpriseCodocsDepartmentRole = "manager"
	CodocsDepartmentMember  EnterpriseCodocsDepartmentRole = "member"
	CodocsDepartmentParent  EnterpriseCodocsDepartmentRole = "parent"
	CodocsDepartmentNone    EnterpriseCodocsDepartmentRole = "none"
)

func (r EnterpriseCodocsDepartmentRole) CanRead() bool {
	return r != CodocsDepartmentNone
}

func (r EnterpriseCodocsDepartmentRole) CanWrite() bool {
	return r == CodocsDepartmentLeader || r == CodocsDepartmentManager || r == CodocsDepartmentMember
}

func (r EnterpriseCodocsDepartmentRole) CanManage() bool {
	return r == CodocsDepartmentManager
}

func chooseEnterpriseCodocsDepartmentRole(actor, leader, manager, parentLeader, parentManager string, member bool) EnterpriseCodocsDepartmentRole {
	switch {
	case actor == leader:
		return CodocsDepartmentLeader
	case actor == manager:
		return CodocsDepartmentManager
	case member:
		return CodocsDepartmentMember
	case actor == parentManager || actor == parentLeader:
		return CodocsDepartmentParent
	default:
		return CodocsDepartmentNone
	}
}

func (a *Adapter) EnterpriseCodocsDepartmentAccess(ctx context.Context, actor, deptCode string) (EnterpriseCodocsDepartmentRole, error) {
	actor, deptCode = strings.TrimSpace(actor), strings.TrimSpace(deptCode)
	if actor == "" || deptCode == "" || len(actor) > 128 || len(deptCode) > 128 {
		return CodocsDepartmentNone, httperror.New(http.StatusBadRequest, "department_access_input_invalid", "Invalid department access input")
	}
	var leader, manager, parentLeader, parentManager sql.NullString
	err := a.db.QueryRowContext(ctx, `SELECT d.leader_uid,d.manager_uid,parent.leader_uid,parent.manager_uid
		FROM directory_departments d
		LEFT JOIN directory_departments parent ON parent.dept_code=d.parent_dept_code
			AND parent.status='active' AND parent.org_type='department'
		WHERE d.dept_code=? AND d.status='active' AND d.org_type='department'`, deptCode).
		Scan(&leader, &manager, &parentLeader, &parentManager)
	if errors.Is(err, sql.ErrNoRows) {
		return CodocsDepartmentNone, httperror.New(http.StatusNotFound, "department_not_found", "Department not found")
	}
	if err != nil {
		return CodocsDepartmentNone, err
	}
	var activeActor bool
	err = a.db.QueryRowContext(ctx, `SELECT EXISTS(
		SELECT 1 FROM directory_users u
		WHERE BINARY u.uid=BINARY ? AND u.status='active'
	)`, actor).Scan(&activeActor)
	if err != nil {
		return CodocsDepartmentNone, err
	}
	if !activeActor {
		return CodocsDepartmentNone, nil
	}
	// Membership is checked even for a leader: a revoked or unavailable
	// Directory read must never be replaced by a stale role snapshot.
	var member bool
	err = a.db.QueryRowContext(ctx, `SELECT EXISTS(
		SELECT 1 FROM directory_user_departments ud
		WHERE BINARY ud.uid=BINARY ? AND ud.dept_code=? AND ud.status='active'
	)`, actor, deptCode).Scan(&member)
	if err != nil {
		return CodocsDepartmentNone, err
	}
	return chooseEnterpriseCodocsDepartmentRole(actor, leader.String, manager.String, parentLeader.String, parentManager.String, member), nil
}

// LockEnterpriseCodocsDepartmentAccess keeps Directory's shared row locks on
// Directory's own connection until the caller has committed its Codocs write.
// The caller must Rollback the returned read transaction on every path.
func (a *Adapter) LockEnterpriseCodocsDepartmentAccess(ctx context.Context, actor, deptCode string) (EnterpriseCodocsDepartmentRole, *sql.Tx, error) {
	tx, err := a.db.BeginTx(ctx, &sql.TxOptions{Isolation: sql.LevelReadCommitted, ReadOnly: true})
	if err != nil {
		return CodocsDepartmentNone, nil, err
	}
	role, err := a.EnterpriseCodocsDepartmentAccessTx(ctx, tx, actor, deptCode)
	if err != nil {
		_ = tx.Rollback()
		return CodocsDepartmentNone, nil, err
	}
	return role, tx, nil
}

// EnterpriseCodocsDepartmentAccessTx reads authoritative Directory facts
// under shared locks. tx must belong to the Directory database.
func (a *Adapter) EnterpriseCodocsDepartmentAccessTx(ctx context.Context, tx *sql.Tx, actor, deptCode string) (EnterpriseCodocsDepartmentRole, error) {
	actor, deptCode = strings.TrimSpace(actor), strings.TrimSpace(deptCode)
	if tx == nil || actor == "" || deptCode == "" || len(actor) > 128 || len(deptCode) > 128 {
		return CodocsDepartmentNone, httperror.New(http.StatusBadRequest, "department_access_input_invalid", "Invalid department access input")
	}
	var leader, manager, parentCode sql.NullString
	err := tx.QueryRowContext(ctx, `SELECT leader_uid,manager_uid,parent_dept_code FROM directory_departments
		WHERE dept_code=? AND status='active' AND org_type='department' FOR SHARE`, deptCode).
		Scan(&leader, &manager, &parentCode)
	if errors.Is(err, sql.ErrNoRows) {
		return CodocsDepartmentNone, httperror.New(http.StatusNotFound, "department_not_found", "Department not found")
	}
	if err != nil {
		return CodocsDepartmentNone, err
	}
	var parentLeader, parentManager sql.NullString
	if parentCode.Valid && parentCode.String != "" {
		err = tx.QueryRowContext(ctx, `SELECT leader_uid,manager_uid FROM directory_departments
			WHERE dept_code=? AND status='active' AND org_type='department' FOR SHARE`, parentCode.String).
			Scan(&parentLeader, &parentManager)
		if err != nil && !errors.Is(err, sql.ErrNoRows) {
			return CodocsDepartmentNone, err
		}
	}
	var userStatus string
	err = tx.QueryRowContext(ctx, `SELECT status FROM directory_users
		WHERE BINARY uid=BINARY ? FOR SHARE`, actor).Scan(&userStatus)
	if errors.Is(err, sql.ErrNoRows) {
		return CodocsDepartmentNone, nil
	}
	if err != nil {
		return CodocsDepartmentNone, err
	}
	if userStatus != "active" {
		return CodocsDepartmentNone, nil
	}
	var memberStatus string
	err = tx.QueryRowContext(ctx, `SELECT status FROM directory_user_departments
		WHERE BINARY uid=BINARY ? AND dept_code=? FOR SHARE`, actor, deptCode).Scan(&memberStatus)
	if err != nil && !errors.Is(err, sql.ErrNoRows) {
		return CodocsDepartmentNone, err
	}
	return chooseEnterpriseCodocsDepartmentRole(actor, leader.String, manager.String, parentLeader.String, parentManager.String, err == nil && memberStatus == "active"), nil
}
