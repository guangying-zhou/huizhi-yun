package people

import (
	"context"
	"crypto/sha256"
	"database/sql"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"github.com/google/uuid"
	"github.com/huizhi-yun/data-runtime/internal/httperror"
	"github.com/huizhi-yun/data-runtime/internal/workflowapproval"
	"strings"
	"time"
)

func FactsRowTx(ctx context.Context, tx *sql.Tx, table string, where string, args ...any) (map[string]any, error) {
	rows, e := tx.QueryContext(ctx, "SELECT * FROM "+table+" WHERE "+where+" FOR UPDATE", args...)
	if e != nil {
		return nil, e
	}
	cols, e := rows.Columns()
	if e != nil {
		rows.Close()
		return nil, e
	}
	items, e := MasterRows(rows, cols)
	if e != nil {
		return nil, e
	}
	if len(items) != 1 {
		return nil, httperror.New(404, "people_object_not_found", "People object unavailable")
	}
	return items[0], nil
}
func factsUpdateTx(ctx context.Context, tx *sql.Tx, table, id string, values map[string]any, version int64, actor string) error {
	keys := []string{}
	for k := range values {
		keys = append(keys, k)
	}
	sortStrings(keys)
	sets := []string{}
	args := []any{}
	for _, k := range keys {
		sets = append(sets, k+"=?")
		v := values[k]
		if v == "" {
			v = nil
		}
		args = append(args, v)
	}
	sets = append(sets, "row_version=row_version+1", "updated_by=?")
	args = append(args, actor, id, version)
	res, e := tx.ExecContext(ctx, "UPDATE "+table+" SET "+strings.Join(sets, ",")+" WHERE id=? AND row_version=?", args...)
	if e != nil {
		return e
	}
	n, _ := res.RowsAffected()
	if n != 1 {
		return httperror.New(409, "people_version_conflict", "Version changed")
	}
	return nil
}
func sortStrings(a []string) {
	for i := range a {
		for j := i + 1; j < len(a); j++ {
			if a[j] < a[i] {
				a[i], a[j] = a[j], a[i]
			}
		}
	}
}
func factsInsertTx(ctx context.Context, tx *sql.Tx, table string, values map[string]any) (string, error) {
	keys := []string{}
	for k := range values {
		keys = append(keys, k)
	}
	sortStrings(keys)
	args := []any{}
	for _, k := range keys {
		v := values[k]
		if v == "" {
			v = nil
		}
		args = append(args, v)
	}
	res, e := tx.ExecContext(ctx, "INSERT INTO "+table+"("+strings.Join(keys, ",")+") VALUES("+strings.TrimSuffix(strings.Repeat("?,", len(keys)), ",")+")", args...)
	if e != nil {
		return "", e
	}
	id, e := res.LastInsertId()
	return fmt.Sprint(id), e
}
func FactsEmployeeWriteTx(ctx context.Context, tx *sql.Tx, table func(string) (string, error), op string, i EnterpriseFactsInput, who FactsContext) (map[string]any, error) {
	employees, e := table("people_employees")
	if e != nil {
		return nil, e
	}
	fields := map[string]any{}
	for k, v := range i.Payload {
		if k != "expectedVersion" {
			fields[k] = v
		}
	}
	id := i.ID
	version := int64(1)
	if op == "employees-create" {
		no, e := factsNumberTx(ctx, tx, table)
		if e != nil {
			return nil, e
		}
		fields["employee_uid"] = i.EmployeeUID
		fields["employee_no"] = no
		fields["created_by"] = who.Actor
		fields["updated_by"] = who.Actor
		if fields["employment_type"] == nil || fields["employment_type"] == "" {
			fields["employment_type"] = "full_time"
		}
		if id, e = factsInsertTx(ctx, tx, employees, fields); e != nil {
			return nil, e
		}
	} else {
		row, e := FactsRowTx(ctx, tx, employees, "id=? AND BINARY employee_uid=BINARY ? AND archived_at IS NULL", id, i.EmployeeUID)
		if e != nil {
			return nil, e
		}
		_ = row
		// Department cache belongs to assignments, not arbitrary profile changes.
		if d, ok := fields["dept_code"]; ok && d != row["dept_code"] {
			return nil, httperror.New(409, "people_department_requires_assignment", "Use an assignment change")
		}
		version = FactsVersion(i.Payload) + 1
		if e = factsUpdateTx(ctx, tx, employees, id, fields, version-1, who.Actor); e != nil {
			return nil, e
		}
	}
	result := map[string]any{"id": id, "row_version": version, "employee_uid": i.EmployeeUID}
	if _, e = FreezeEnterpriseLifecycleTx(ctx, tx, table, i.EmployeeUID, who); e != nil {
		return nil, e
	}
	return result, nil
}
func AssignmentSnapshot(row map[string]any, actor string) (map[string]any, string) {
	keys := []string{"id", "assignment_code", "employee_uid", "change_type", "effective_from", "dept_code", "position_code", "rank_code", "manager_uid", "remarks"}
	form := map[string]any{"requestedBy": actor}
	for _, k := range keys {
		form[k] = row[k]
	}
	raw, _ := json.Marshal(form)
	h := sha256.Sum256(raw)
	return form, hex.EncodeToString(h[:])
}
func FactsAssignmentWriteTx(ctx context.Context, tx *sql.Tx, table func(string) (string, error), op string, i EnterpriseFactsInput, who FactsContext, instance *workflowapproval.Instance) (map[string]any, error) {
	assignments, e := table("people_assignments")
	if e != nil {
		return nil, e
	}
	employees, e := table("people_employees")
	if e != nil {
		return nil, e
	}
	// Parent employee is always locked before any assignment. Parallel transfers
	// cannot split periods or race the authoritative current cache.
	if _, e = FactsRowTx(ctx, tx, employees, "BINARY employee_uid=BINARY ? AND archived_at IS NULL", i.EmployeeUID); e != nil {
		return nil, e
	}
	id := i.ID
	version := int64(1)
	fields := map[string]any{}
	for k, v := range i.Payload {
		if k != "expectedVersion" {
			fields[k] = v
		}
	}
	var row map[string]any
	if id != "" {
		row, e = FactsRowTx(ctx, tx, assignments, "id=? AND BINARY employee_uid=BINARY ?", id, i.EmployeeUID)
		if e != nil {
			return nil, e
		}
	}
	if op == "assignments-attach-workflow" {
		if row["approval_status"] != "draft" && row["approval_status"] != "pending" {
			return nil, httperror.New(409, "people_assignment_frozen", "Assignment frozen")
		}
		instanceID := FactsString(i.Payload, "workflowInstanceId")
		if instance == nil {
			return nil, httperror.New(503, "people_workflow_unavailable", "Workflow unavailable")
		}
		if e := ValidateAssignmentApproval(row, instance, instanceID, "running"); e != nil {
			return nil, e
		}
		if row["approval_status"] == "pending" && row["workflow_instance_id"] != nil && row["workflow_instance_id"] != "" {
			if row["workflow_instance_id"] != instance.ID {
				return nil, httperror.New(409, "people_workflow_binding_conflict", "Workflow already attached")
			}
			return map[string]any{"id": id, "row_version": row["row_version"], "assignment_code": row["assignment_code"]}, nil
		}
		fields = map[string]any{"approval_status": "pending", "workflow_instance_id": instance.ID}
	} else if row != nil && row["approval_status"] != "draft" {
		return nil, httperror.New(409, "people_assignment_frozen", "Only drafts are editable")
	}
	for _, ref := range []struct{ field, logical, code, name string }{{"position_code", "people_positions", "position_code", "position_name"}, {"rank_code", "people_ranks", "rank_code", "rank_name"}} {
		value, supplied := fields[ref.field]
		if !supplied || value == "" {
			continue
		}
		master, err := table(ref.logical)
		if err != nil {
			return nil, err
		}
		var display string
		err = tx.QueryRowContext(ctx, "SELECT "+ref.name+" FROM "+master+" WHERE BINARY "+ref.code+"=BINARY ? AND enabled=1 FOR SHARE", value).Scan(&display)
		if err == sql.ErrNoRows {
			return nil, httperror.New(400, "people_assignment_reference_invalid", "Assignment master reference unavailable")
		}
		if err != nil {
			return nil, err
		}
		fields[ref.name] = display
	}
	if FactsString(fields, "change_type") == "rank_change" && FactsString(fields, "rank_code") == "" && (row == nil || row["rank_code"] == nil || row["rank_code"] == "") {
		return nil, httperror.New(400, "people_assignment_rank_required", "Rank is required")
	}
	if op == "assignments-delete" {
		if fmt.Sprint(row["row_version"]) != fmt.Sprint(FactsVersion(i.Payload)) {
			return nil, httperror.New(409, "people_version_conflict", "Version changed")
		}
		if _, e = tx.ExecContext(ctx, "DELETE FROM "+assignments+" WHERE id=? AND row_version=? AND approval_status='draft'", id, FactsVersion(i.Payload)); e != nil {
			return nil, e
		}
		result := map[string]any{"id": id, "row_version": FactsVersion(i.Payload) + 1, "deleted": true}
		return result, nil
	}
	if id == "" {
		fields["assignment_code"] = "ASN-" + strings.ReplaceAll(uuid.NewString(), "-", "")
		fields["employee_uid"] = i.EmployeeUID
		fields["approval_status"] = "draft"
		fields["is_primary"] = 1
		fields["source_app"] = "enterprise"
		fields["source_biz_type"] = "manual_assignment_adjustment"
		fields["created_by"] = who.Actor
		fields["updated_by"] = who.Actor
		if id, e = factsInsertTx(ctx, tx, assignments, fields); e != nil {
			return nil, e
		}
	} else {
		version = FactsVersion(i.Payload) + 1
		if e = factsUpdateTx(ctx, tx, assignments, id, fields, version-1, who.Actor); e != nil {
			return nil, e
		}
	}
	fresh, e := FactsRowTx(ctx, tx, assignments, "id=?", id)
	if e != nil {
		return nil, e
	}
	if _, e = FreezeEnterpriseLifecycleTx(ctx, tx, table, i.EmployeeUID, who); e != nil {
		return nil, e
	}
	form, hash := AssignmentSnapshot(fresh, fmt.Sprint(fresh["created_by"]))
	return map[string]any{"id": id, "row_version": version, "assignment_code": fresh["assignment_code"], "approval_status": fresh["approval_status"], "formData": form, "snapshotHash": hash}, nil
}

// Caller owns the transaction. Approval is supplied only after reading the
// authoritative Workflow instance via the injected narrow owning reader.
func ApplyAssignmentResultTx(ctx context.Context, tx *sql.Tx, table func(string) (string, error), row map[string]any, status string, who FactsContext) error {
	assignments, e := table("people_assignments")
	if e != nil {
		return e
	}
	id := fmt.Sprint(row["id"])
	if row["approval_status"] == status {
		return nil
	}
	if row["approval_status"] != "pending" {
		return httperror.New(409, "people_workflow_state_conflict", "Assignment is not pending")
	}
	if status != "approved" && status != "rejected" && status != "cancelled" {
		return httperror.New(403, "people_workflow_result_invalid", "Workflow is not final")
	}
	if status == "approved" {
		from := fmt.Sprint(row["effective_from"])
		if len(from) > 10 {
			from = from[:10]
		}
		day, e := time.Parse("2006-01-02", from)
		if e != nil {
			return e
		}
		var duplicate int
		if e = tx.QueryRowContext(ctx, "SELECT COUNT(*) FROM "+assignments+" WHERE BINARY employee_uid=BINARY ? AND id<>? AND effective_from=? AND is_primary=1 AND approval_status IN ('none','approved')", row["employee_uid"], id, from).Scan(&duplicate); e != nil {
			return e
		}
		if duplicate > 0 {
			return httperror.New(409, "people_assignment_date_conflict", "Primary assignment already exists")
		}
		// Close earlier intervals at the new effective date; future appointments must
		// not change today's cache. Later approved boundaries cap this interval.
		if _, e = tx.ExecContext(ctx, "UPDATE "+assignments+" SET effective_to=DATE_SUB(?,INTERVAL 1 DAY),superseded_by_assignment_code=?,row_version=row_version+1 WHERE BINARY employee_uid=BINARY ? AND id<>? AND is_primary=1 AND approval_status IN ('none','approved') AND effective_from<? AND (effective_to IS NULL OR effective_to>=?)", from, row["assignment_code"], row["employee_uid"], id, from, from); e != nil {
			return e
		}
		if _, e = tx.ExecContext(ctx, "UPDATE "+assignments+" SET effective_to=(SELECT boundary FROM (SELECT DATE_SUB(MIN(effective_from),INTERVAL 1 DAY) boundary FROM "+assignments+" WHERE BINARY employee_uid=BINARY ? AND id<>? AND is_primary=1 AND approval_status IN ('none','approved') AND effective_from>?) b) WHERE id=?", row["employee_uid"], id, from, id); e != nil {
			return e
		}
		_ = day // Projection always uses asOf, never a caller-supplied effective time.
	}
	if _, e = tx.ExecContext(ctx, "UPDATE "+assignments+" SET approval_status=?,row_version=row_version+1,updated_by=? WHERE id=? AND approval_status='pending'", status, who.Actor, id); e != nil {
		return e
	}
	if e = ProjectEnterprisePrimaryTx(ctx, tx, table, fmt.Sprint(row["employee_uid"]), who); e != nil {
		return e
	}
	if _, e = FreezeEnterpriseLifecycleTx(ctx, tx, table, fmt.Sprint(row["employee_uid"]), who); e != nil {
		return e
	}
	return nil
}
