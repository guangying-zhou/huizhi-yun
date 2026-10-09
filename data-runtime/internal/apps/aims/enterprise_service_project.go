package aims

import (
	"context"
	"database/sql"
	"github.com/huizhi-yun/data-runtime/internal/enterprise"
	"github.com/huizhi-yun/data-runtime/internal/httperror"
)

// CheckServiceProjectTx is an owning, read-only caller-Tx qualification check.
// A contract-bound project or its current leader/manager can be selected; this
// never changes project access, members or the contract binding.
func CheckServiceProjectTx(ctx context.Context, tx *sql.Tx, r enterprise.Resolved, actor, code, contract string) error {
	if tx == nil || r.Domain != "aims" || actor == "" || contract == "" {
		return enterprise.ErrBindingMismatch
	}
	projects, e := r.Table("aims_projects")
	if e != nil {
		return e
	}
	members, e := r.Table("aims_project_members")
	if e != nil {
		return e
	}
	var id int64
	var leader, bound, status string
	e = tx.QueryRowContext(ctx, "SELECT id,COALESCE(leader_uid,''),COALESCE(contract_code,''),lifecycle_status FROM "+projects+" WHERE BINARY project_code=BINARY ? FOR UPDATE", code).Scan(&id, &leader, &bound, &status)
	if e == sql.ErrNoRows {
		return httperror.New(404, "service_project_not_found", "项目不存在")
	}
	if e != nil {
		return e
	}
	if status == "archived" || status == "completed" || bound != "" && bound != contract {
		return httperror.New(409, "service_project_conflict", "项目状态或合同归属不符")
	}
	var count int
	e = tx.QueryRowContext(ctx, "SELECT COUNT(*) FROM "+members+" WHERE project_id=? AND BINARY uid=BINARY ? AND role='manager' AND status='active' FOR UPDATE", id, actor).Scan(&count)
	if e != nil {
		return e
	}
	if bound != contract && leader != actor && count == 0 {
		return httperror.New(403, "service_project_scope_denied", "无权关联此项目")
	}
	return nil
}
