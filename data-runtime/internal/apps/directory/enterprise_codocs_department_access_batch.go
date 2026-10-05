package directory

import (
	"context"
	"database/sql"
	"errors"
	"net/http"
	"sort"
	"strings"

	"github.com/huizhi-yun/data-runtime/internal/httperror"
)

// LockEnterpriseCodocsDepartmentAccessBatch re-reads the relation of several
// users to one department under a single set of shared Directory locks, for the
// department collaboration session re-verification. The returned read
// transaction owns the locks and must be rolled back by the caller once its
// Codocs transaction has ended (lock order: Directory before Codocs).
//
// Every requested uid gets an entry. An inactive or missing department yields
// CodocsDepartmentNone for all of them (the relation no longer exists), whereas
// an unavailable Directory returns an error and never a stale role. Users are
// locked in sorted order so concurrent batches cannot deadlock each other.
func (a *Adapter) LockEnterpriseCodocsDepartmentAccessBatch(ctx context.Context, deptCode string, uids []string) (map[string]EnterpriseCodocsDepartmentRole, *sql.Tx, error) {
	deptCode = strings.TrimSpace(deptCode)
	if deptCode == "" || len(deptCode) > 128 || len(uids) > 256 {
		return nil, nil, httperror.New(http.StatusBadRequest, "department_access_input_invalid", "Invalid department access input")
	}
	unique := map[string]struct{}{}
	for _, uid := range uids {
		uid = strings.TrimSpace(uid)
		if uid == "" || len(uid) > 128 {
			return nil, nil, httperror.New(http.StatusBadRequest, "department_access_input_invalid", "Invalid department access input")
		}
		unique[uid] = struct{}{}
	}
	sorted := make([]string, 0, len(unique))
	for uid := range unique {
		sorted = append(sorted, uid)
	}
	sort.Strings(sorted)
	tx, err := a.db.BeginTx(ctx, &sql.TxOptions{Isolation: sql.LevelReadCommitted, ReadOnly: true})
	if err != nil {
		return nil, nil, err
	}
	roles, err := enterpriseCodocsDepartmentAccessBatchTx(ctx, tx, deptCode, sorted)
	if err != nil {
		_ = tx.Rollback()
		return nil, nil, err
	}
	return roles, tx, nil
}

func enterpriseCodocsDepartmentAccessBatchTx(ctx context.Context, tx *sql.Tx, deptCode string, sortedUIDs []string) (map[string]EnterpriseCodocsDepartmentRole, error) {
	roles := make(map[string]EnterpriseCodocsDepartmentRole, len(sortedUIDs))
	var leader, manager, parentCode sql.NullString
	err := tx.QueryRowContext(ctx, `SELECT leader_uid,manager_uid,parent_dept_code FROM directory_departments
		WHERE dept_code=? AND status='active' AND org_type='department' FOR SHARE`, deptCode).
		Scan(&leader, &manager, &parentCode)
	if errors.Is(err, sql.ErrNoRows) {
		for _, uid := range sortedUIDs {
			roles[uid] = CodocsDepartmentNone
		}
		return roles, nil
	}
	if err != nil {
		return nil, err
	}
	var parentLeader, parentManager sql.NullString
	if parentCode.Valid && parentCode.String != "" {
		err = tx.QueryRowContext(ctx, `SELECT leader_uid,manager_uid FROM directory_departments
			WHERE dept_code=? AND status='active' AND org_type='department' FOR SHARE`, parentCode.String).
			Scan(&parentLeader, &parentManager)
		if err != nil && !errors.Is(err, sql.ErrNoRows) {
			return nil, err
		}
	}
	for _, uid := range sortedUIDs {
		var userStatus string
		err = tx.QueryRowContext(ctx, `SELECT status FROM directory_users
			WHERE BINARY uid=BINARY ? FOR SHARE`, uid).Scan(&userStatus)
		if errors.Is(err, sql.ErrNoRows) || (err == nil && userStatus != "active") {
			roles[uid] = CodocsDepartmentNone
			continue
		}
		if err != nil {
			return nil, err
		}
		var memberStatus string
		err = tx.QueryRowContext(ctx, `SELECT status FROM directory_user_departments
			WHERE BINARY uid=BINARY ? AND dept_code=? FOR SHARE`, uid, deptCode).Scan(&memberStatus)
		if err != nil && !errors.Is(err, sql.ErrNoRows) {
			return nil, err
		}
		roles[uid] = chooseEnterpriseCodocsDepartmentRole(uid, leader.String, manager.String, parentLeader.String, parentManager.String, err == nil && memberStatus == "active")
	}
	return roles, nil
}
