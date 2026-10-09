package people

import (
	"context"
	"crypto/sha256"
	"database/sql"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"github.com/google/uuid"
	"github.com/huizhi-yun/data-runtime/internal/integrationoperation"
	"time"
)

// Caller-Tx only. It freezes a command, never delivers or projects Console facts.
// sourceApp is Enterprise even though the owning data domain is People.
func FreezeEnterpriseLifecycleTx(ctx context.Context, tx *sql.Tx, table func(string) (string, error), uid string, who FactsContext) (map[string]any, error) {
	employees, e := table("people_employees")
	if e != nil {
		return nil, e
	}
	versions, e := table("people_directory_lifecycle_versions")
	if e != nil {
		return nil, e
	}
	operations, e := table("integration_operation")
	if e != nil {
		return nil, e
	}
	rows, e := tx.QueryContext(ctx, "SELECT employee_uid,employee_no,COALESCE(login_name,'') login_name,display_name,COALESCE(dept_code,'') dept_code,COALESCE(position_code,'') position_code,COALESCE(position_name,'') position_name,employment_status,COALESCE(CAST(leave_date AS CHAR),'') leave_date,COALESCE(mobile,'') mobile FROM "+employees+" WHERE BINARY employee_uid=BINARY ? AND archived_at IS NULL FOR UPDATE", uid)
	if e != nil {
		return nil, e
	}
	cols, _ := rows.Columns()
	items, e := MasterRows(rows, cols)
	if e != nil {
		return nil, e
	}
	if len(items) != 1 {
		return nil, fmt.Errorf("employee lifecycle unavailable")
	}
	row := items[0]
	fact := peopleLifecycleFact{EmployeeUID: uid, EmployeeNumber: fmt.Sprint(row["employee_no"]), LoginName: fmt.Sprint(row["login_name"]), DisplayName: fmt.Sprint(row["display_name"]), DeptCode: fmt.Sprint(row["dept_code"]), PositionCode: fmt.Sprint(row["position_code"]), PositionName: fmt.Sprint(row["position_name"]), EmploymentStatus: fmt.Sprint(row["employment_status"]), LeaveDate: fmt.Sprint(row["leave_date"]), Mobile: fmt.Sprint(row["mobile"]), EmailSourceState: "absent", MobileSourceState: "absent"}
	if fact.Mobile != "" {
		fact.MobileSourceState = "provided"
	}
	if e = EnsureEffectiveOffboardingCaseTx(ctx, tx, table, uid, who); e != nil {
		return nil, e
	}
	content, op, cap := peopleLifecycleContent(fact)
	hash, e := integrationoperation.ValidateAndDigestCommand(content)
	if e != nil {
		return nil, e
	}
	var revision uint64
	var previousHash, previousKey string
	e = tx.QueryRowContext(ctx, "SELECT revision_no,snapshot_hash,operation_key FROM "+versions+" WHERE BINARY employee_uid=BINARY ? FOR UPDATE", uid).Scan(&revision, &previousHash, &previousKey)
	if e != nil && e != sql.ErrNoRows {
		return nil, e
	}
	if previousHash == hash {
		return map[string]any{"operationKey": previousKey, "sourceRevision": revision, "replayed": true}, nil
	}
	revision++
	content["sourceRevision"] = revision
	content["snapshotHash"] = hash
	content["originalActorUid"] = who.Actor
	digest, e := integrationoperation.ValidateAndDigestCommand(content)
	if e != nil {
		return nil, e
	}
	raw, e := json.Marshal(content)
	if e != nil {
		return nil, e
	}
	uhash := sha256.Sum256([]byte(uid))
	correlation := "enterprise:people:directory:" + hex.EncodeToString(uhash[:16])
	key := fmt.Sprintf("%s:r%d", correlation, revision)
	_, e = tx.ExecContext(ctx, "INSERT INTO "+operations+"(operation_id,operation_key,correlation_key,sequence_no,depends_on_operation_key,tenant_code,deployment_code,source_app,target_app,operation_code,required_capability,source_biz_type,source_biz_code,idempotency_key,command_schema_version,command_json,command_sha256,status,next_attempt_at,original_request_id,original_actor_uid,service_client_id,created_by,updated_by) VALUES(?,?,?,?,NULLIF(?,''),?,?,'enterprise','console',?,?,'employee',?,?,'v1',?,?,'pending',UTC_TIMESTAMP(3),?,?,?,?,?)", uuid.NewString(), key, correlation, revision, previousKey, who.Tenant, who.Deployment, op, cap, uid, key, string(raw), digest, who.RequestID, who.Actor, who.Client, who.Actor, who.Actor)
	if e != nil {
		return nil, e
	}
	_, e = tx.ExecContext(ctx, "INSERT INTO "+versions+"(employee_uid,revision_no,snapshot_hash,operation_key,lifecycle_type,effective_date) VALUES(?,?,?,?,?,NULLIF(?,'')) ON DUPLICATE KEY UPDATE revision_no=VALUES(revision_no),snapshot_hash=VALUES(snapshot_hash),operation_key=VALUES(operation_key),lifecycle_type=VALUES(lifecycle_type),effective_date=VALUES(effective_date)", uid, revision, hash, key, content["lifecycleType"], fact.LeaveDate)
	return map[string]any{"operationKey": key, "sourceRevision": revision, "operationStatus": "pending"}, e
}

// Recompute only the primary assignment effective now. A future approved row
// creates no early cache projection; c2's prepare-due will revisit at its date.
func ProjectEnterprisePrimaryTx(ctx context.Context, tx *sql.Tx, table func(string) (string, error), uid string, who FactsContext) error {
	assignments, e := table("people_assignments")
	if e != nil {
		return e
	}
	employees, e := table("people_employees")
	if e != nil {
		return e
	}
	asOf := who.AsOf
	if asOf.IsZero() {
		asOf = time.Now().UTC()
	}
	rows, e := tx.QueryContext(ctx, "SELECT change_type,CAST(effective_from AS CHAR) effective_from,dept_code,dept_name,position_code,position_name,rank_code,rank_name,manager_uid FROM "+assignments+" WHERE BINARY employee_uid=BINARY ? AND is_primary=1 AND approval_status IN ('none','approved') AND effective_from<=? AND (effective_to IS NULL OR effective_to>=?) ORDER BY effective_from DESC,id DESC LIMIT 1 FOR UPDATE", uid, asOf.Format("2006-01-02"), asOf.Format("2006-01-02"))
	if e != nil {
		return e
	}
	cols, _ := rows.Columns()
	items, e := MasterRows(rows, cols)
	if e != nil {
		return e
	}
	if len(items) == 0 {
		return nil
	}
	r := items[0]
	status := "active"
	var leave any
	if r["change_type"] == "leave" {
		status = "left"
		leave = r["effective_from"]
	}
	_, e = tx.ExecContext(ctx, "UPDATE "+employees+" SET dept_code=?,dept_name=?,position_code=?,position_name=?,rank_code=?,rank_name=?,manager_uid=?,employment_status=?,leave_date=?,row_version=row_version+1,updated_by=? WHERE BINARY employee_uid=BINARY ? AND archived_at IS NULL AND NOT (dept_code<=>? AND dept_name<=>? AND position_code<=>? AND position_name<=>? AND rank_code<=>? AND rank_name<=>? AND manager_uid<=>? AND employment_status<=>? AND leave_date<=>?)", r["dept_code"], r["dept_name"], r["position_code"], r["position_name"], r["rank_code"], r["rank_name"], r["manager_uid"], status, leave, who.Actor, uid, r["dept_code"], r["dept_name"], r["position_code"], r["position_name"], r["rank_code"], r["rank_name"], r["manager_uid"], status, leave)
	return e
}
