package enterpriseapf

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"github.com/huizhi-yun/data-runtime/internal/apps/altoc"
	"github.com/huizhi-yun/data-runtime/internal/apps/assets"
	"github.com/huizhi-yun/data-runtime/internal/apps/people"
	"github.com/huizhi-yun/data-runtime/internal/enterprise"
	"github.com/huizhi-yun/data-runtime/internal/enterprise/domaininstall"
	"github.com/huizhi-yun/data-runtime/internal/httperror"
	"github.com/huizhi-yun/data-runtime/internal/integrationoperation"
	"strings"
	"time"
)

func (s PeopleFactsService) Offboarding(ctx context.Context, op string, i people.EnterpriseFactsInput, who Identity, scope altoc.BasicReadScope) (out any, err error) {
	defer func() {
		if errors.Is(err, integrationoperation.ErrIdempotencyPayloadMismatch) {
			err = httperror.New(409, "people_idempotency_conflict", "Original command differs")
		} else {
			err = factsMapError(err)
		}
	}()
	if err = people.ValidateOffboardingInput(op, i); err != nil {
		return nil, err
	}
	if err = scope.Validate(); err != nil {
		return nil, err
	}
	if who.Actor == "" || who.Client != "enterprise.runtime" || who.Tenant != s.Binding.Key.Tenant || who.Deployment != s.Binding.Domains["people"].OwnerDeployment {
		return nil, httperror.New(403, "people_actor_required", "Verified actor required")
	}
	if scope.Access == "none" {
		return nil, httperror.New(403, "people_scope_forbidden", "No offboarding scope")
	}
	if s.Registry == nil || !domaininstall.IsPeopleOffboardingDomain(s.Binding.Domains["people"]) {
		return nil, httperror.New(503, "people_offboarding_not_installed", "Offboarding unavailable")
	}
	_, action, _ := people.OffboardingPermission(op)
	write := action != "view"
	mode := enterprise.Read
	if write {
		mode = enterprise.Write
		if who.Key == "" {
			return nil, httperror.New(400, "people_key_required", "Key required")
		}
	}
	reqs := []enterprise.ResolveRequest{s.request("people", mode)}
	if op == "offboarding-arrange" || (op == "offboarding-confirm" && people.FactsString(i.Payload, "taskType") == "asset_recovery_coordination") {
		reqs = append(reqs, s.request("assets", enterprise.Write))
	}
	var tx *sql.Tx
	var resolved []enterprise.Resolved
	if write {
		tx, resolved, err = s.Registry.BeginWriteTransaction(ctx, reqs...)
	} else {
		tx, resolved, err = s.Registry.BeginSnapshotReadTransaction(ctx, reqs...)
	}
	if err != nil {
		return nil, err
	}
	defer tx.Rollback()
	r := resolved[0]
	if !write {
		out, err = offboardingRead(ctx, tx, r, op, i, who, scope)
	} else {
		cases, e := r.Table("people_offboarding_cases")
		if e != nil {
			return nil, e
		}
		employee, e := people.LockOffboardingEmployeesTx(ctx, tx, r.Table, i)
		if e != nil {
			return nil, e
		}
		var row map[string]any
		if op == "offboarding-create" {
			assignments, e := r.Table("people_assignments")
			if e != nil {
				return nil, e
			}
			leave, e := people.FactsRowTx(ctx, tx, assignments, "BINARY assignment_code=BINARY ? AND BINARY employee_uid=BINARY ?", people.FactsString(i.Payload, "leaveAssignmentCode"), i.EmployeeUID)
			if e != nil {
				return nil, e
			}
			if leave["change_type"] != "leave" || (leave["approval_status"] != "approved" && leave["approval_status"] != "none") {
				return nil, httperror.New(409, "people_offboarding_leave_not_approved", "Approved leave required")
			}
			// Creation is inside receipt below; scope is checked before it.
			row = map[string]any{"effective_date": leave["effective_from"]}
		} else {
			row, e = people.FactsRowTx(ctx, tx, cases, "id=? AND BINARY employee_uid=BINARY ?", i.ID, i.EmployeeUID)
			if e != nil {
				return nil, e
			}
		}
		allowed := peopleFactsAllowed("", "", fmt.Sprint(employee["dept_code"]), scope)
		if !allowed && (scope.Access == "self" || scope.Access == "self_dept") && op != "offboarding-create" && op != "offboarding-arrange" {
			tasks, e := r.Table("people_offboarding_tasks")
			if e != nil {
				return nil, e
			}
			var n int
			e = tx.QueryRowContext(ctx, "SELECT COUNT(*) FROM "+tasks+" WHERE case_id=? AND task_type=? AND BINARY responsible_uid=BINARY ?", i.ID, people.FactsString(i.Payload, "taskType"), who.Actor).Scan(&n)
			if e != nil {
				return nil, e
			}
			allowed = n == 1
		}
		if !allowed {
			return nil, httperror.New(403, "people_scope_forbidden", "Offboarding outside scope")
		}
		var at func(string) (string, error)
		for _, v := range resolved {
			if v.Domain == "assets" {
				v := v
				at = v.Table
			}
		}
		out, err = s.receipt(ctx, tx, r, op, i, who, func() (map[string]any, error) {
			if op == "offboarding-create" {
				date := offboardingDate(row["effective_date"])
				return people.EnsureEnterpriseOffboardingCaseTx(ctx, tx, r.Table, i.EmployeeUID, date, who.Actor)
			}
			return offboardingWrite(ctx, tx, r, at, op, i, who, row)
		})
	}
	if err != nil {
		return nil, err
	}
	err = tx.Commit()
	return out, err
}

func offboardingDate(v any) string {
	if d, ok := v.(time.Time); ok {
		return d.UTC().Format("2006-01-02")
	}
	s := fmt.Sprint(v)
	if len(s) >= 10 {
		return s[:10]
	}
	return s
}

func offboardingWrite(ctx context.Context, tx *sql.Tx, r enterprise.Resolved, at func(string) (string, error), op string, i people.EnterpriseFactsInput, who Identity, row map[string]any) (map[string]any, error) {
	if fmt.Sprint(row["row_version"]) != fmt.Sprint(people.FactsVersion(i.Payload)) {
		return nil, httperror.New(409, "people_version_conflict", "Offboarding changed")
	}
	if row["status"] == "completed" || row["status"] == "cancelled" {
		return nil, httperror.New(409, "people_offboarding_terminal", "Offboarding already closed")
	}
	tasks, e := r.Table("people_offboarding_tasks")
	if e != nil {
		return nil, e
	}
	cases, e := r.Table("people_offboarding_cases")
	if e != nil {
		return nil, e
	}
	locked, e := tx.QueryContext(ctx, "SELECT id FROM "+tasks+" WHERE case_id=? ORDER BY task_type FOR UPDATE", i.ID)
	if e != nil {
		return nil, e
	}
	for locked.Next() {
		var id int64
		if e = locked.Scan(&id); e != nil {
			locked.Close()
			return nil, e
		}
	}
	e = locked.Err()
	locked.Close()
	if e != nil {
		return nil, e
	}
	if op == "offboarding-arrange" {
		var terminal int
		e = tx.QueryRowContext(ctx, "SELECT COUNT(*) FROM "+tasks+" WHERE case_id=? AND status<>'pending'", i.ID).Scan(&terminal)
		if e != nil {
			return nil, e
		}
		if terminal != 0 {
			return nil, httperror.New(409, "people_offboarding_tasks_frozen", "Finished tasks cannot be rearranged")
		}
		for _, v := range []struct{ typ, prefix string }{{"handover", "handover"}, {"asset_recovery_coordination", "assetRecovery"}} {
			due, _ := time.Parse(time.RFC3339, people.FactsString(i.Payload, v.prefix+"DueAt"))
			uid := people.FactsString(i.Payload, v.prefix+"ResponsibleUid")
			_, e = tx.ExecContext(ctx, "INSERT INTO "+tasks+"(case_id,task_type,responsible_uid,due_at) VALUES(?,?,?,?) ON DUPLICATE KEY UPDATE responsible_uid=VALUES(responsible_uid),due_at=VALUES(due_at),row_version=row_version+1", i.ID, v.typ, uid, due.UTC())
			if e != nil {
				return nil, e
			}
		}
		due, _ := time.Parse(time.RFC3339, people.FactsString(i.Payload, "assetRecoveryDueAt"))
		date, _ := time.Parse("2006-01-02", offboardingDate(row["effective_date"]))
		if e = assets.ArrangeEnterpriseOffboardingTx(ctx, tx, at, assets.EnterpriseOffboardingArrangement{EventCode: fmt.Sprint(row["case_code"]), EmployeeUID: i.EmployeeUID, ResponsibleUID: people.FactsString(i.Payload, "assetRecoveryResponsibleUid"), Actor: who.Actor, EffectiveDate: date, DueAt: due}); e != nil {
			return nil, e
		}
	} else {
		if row["status"] != "active" {
			return nil, httperror.New(409, "people_offboarding_not_arranged", "Arrange offboarding first")
		}
		typ := people.FactsString(i.Payload, "taskType")
		if op == "offboarding-confirm" && typ == "asset_recovery_coordination" {
			employees, e := r.Table("people_employees")
			if e != nil {
				return nil, e
			}
			var employment string
			if e = tx.QueryRowContext(ctx, "SELECT employment_status FROM "+employees+" WHERE BINARY employee_uid=BINARY ?", i.EmployeeUID).Scan(&employment); e != nil {
				return nil, e
			}
			if employment != "left" {
				return nil, httperror.New(409, "people_offboarding_not_effective", "Leave is not effective")
			}
			date := offboardingDate(row["effective_date"])
			if date > time.Now().UTC().Format("2006-01-02") {
				return nil, httperror.New(409, "people_offboarding_not_effective", "Leave is not effective")
			}
			if e = assets.ResolveEnterpriseOffboardingTx(ctx, tx, at, fmt.Sprint(row["case_code"]), i.EmployeeUID, who.Actor); e != nil {
				return nil, e
			}
		}
		status := "completed"
		var reason any
		if op == "offboarding-cancel" {
			status = "cancelled"
			reason = people.FactsString(i.Payload, "reason")
		}
		res, e := tx.ExecContext(ctx, "UPDATE "+tasks+" SET status=?,finished_by=?,finished_at=UTC_TIMESTAMP(3),cancellation_reason=?,row_version=row_version+1 WHERE case_id=? AND task_type=? AND status='pending'", status, who.Actor, reason, i.ID, typ)
		if e != nil {
			return nil, e
		}
		n, _ := res.RowsAffected()
		if n != 1 {
			return nil, httperror.New(409, "people_offboarding_task_changed", "Task changed")
		}
	}
	status := "active"
	var pending, cancelled int
	e = tx.QueryRowContext(ctx, "SELECT COALESCE(SUM(status='pending'),0),COALESCE(SUM(status='cancelled'),0) FROM "+tasks+" WHERE case_id=?", i.ID).Scan(&pending, &cancelled)
	if e != nil {
		return nil, e
	}
	if pending == 0 {
		status = "completed"
		if cancelled > 0 {
			status = "cancelled"
		}
	}
	_, e = tx.ExecContext(ctx, "UPDATE "+cases+" SET status=?,row_version=row_version+1,updated_by=? WHERE id=?", status, who.Actor, i.ID)
	return map[string]any{"id": i.ID, "row_version": people.FactsVersion(i.Payload) + 1}, e
}

func offboardingRead(ctx context.Context, tx *sql.Tx, r enterprise.Resolved, op string, i people.EnterpriseFactsInput, who Identity, scope altoc.BasicReadScope) (any, error) {
	cases, e := r.Table("people_offboarding_cases")
	if e != nil {
		return nil, e
	}
	tasks, e := r.Table("people_offboarding_tasks")
	if e != nil {
		return nil, e
	}
	employees, e := r.Table("people_employees")
	if e != nil {
		return nil, e
	}
	where := "1=1"
	args := []any{}
	if scope.Access != "all" {
		parts := []string{"0=1"}
		if scope.Access == "self" || scope.Access == "self_dept" {
			parts = append(parts, "EXISTS(SELECT 1 FROM "+tasks+" t WHERE t.case_id=c.id AND BINARY t.responsible_uid=BINARY ?)")
			args = append(args, who.Actor)
		}
		if scope.Access == "dept" || scope.Access == "self_dept" {
			for _, d := range scope.DepartmentCodes {
				parts = append(parts, "BINARY e.dept_code=BINARY ?")
				args = append(args, d)
			}
		}
		where = "(" + strings.Join(parts, " OR ") + ")"
	}
	if op == "offboarding-view" {
		where += " AND c.id=?"
		args = append(args, i.ID)
	}
	if i.Search != "" {
		where += " AND (LOCATE(?,c.case_code)>0 OR LOCATE(?,e.display_name)>0)"
		args = append(args, i.Search, i.Search)
	}
	from := " FROM " + cases + " c JOIN " + employees + " e ON BINARY e.employee_uid=BINARY c.employee_uid WHERE " + where
	var total int64
	if e = tx.QueryRowContext(ctx, "SELECT COUNT(*)"+from, args...).Scan(&total); e != nil {
		return nil, e
	}
	query := "SELECT c.id,c.case_code,c.employee_uid,CAST(c.effective_date AS CHAR) effective_date,c.status,c.row_version,e.display_name" + from + " ORDER BY c.id DESC"
	if op == "offboarding-list" {
		query += " LIMIT ? OFFSET ?"
		args = append(args, i.PageSize, (i.Page-1)*i.PageSize)
	}
	rows, e := tx.QueryContext(ctx, query, args...)
	if e != nil {
		return nil, e
	}
	cols, _ := rows.Columns()
	items, e := people.MasterRows(rows, cols)
	if e != nil {
		return nil, e
	}
	if op == "offboarding-view" {
		if len(items) != 1 {
			return nil, httperror.New(404, "people_object_not_found", "Offboarding unavailable")
		}
		rows, e = tx.QueryContext(ctx, "SELECT task_type,responsible_uid,due_at,status,row_version,finished_by,finished_at,cancellation_reason FROM "+tasks+" WHERE case_id=? ORDER BY task_type", i.ID)
		if e != nil {
			return nil, e
		}
		cols, _ = rows.Columns()
		sub, e := people.MasterRows(rows, cols)
		if e != nil {
			return nil, e
		}
		items[0]["tasks"] = sub
		return map[string]any{"data": items[0]}, nil
	}
	return map[string]any{"data": items, "total": total, "page": i.Page, "pageSize": i.PageSize}, nil
}
