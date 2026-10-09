package enterpriseapf

import (
	"context"
	"crypto/sha256"
	"database/sql"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"github.com/go-sql-driver/mysql"
	"github.com/google/uuid"
	"github.com/huizhi-yun/data-runtime/internal/apps/altoc"
	"github.com/huizhi-yun/data-runtime/internal/apps/people"
	"github.com/huizhi-yun/data-runtime/internal/enterprise"
	"github.com/huizhi-yun/data-runtime/internal/enterprise/domaininstall"
	"github.com/huizhi-yun/data-runtime/internal/httperror"
	"github.com/huizhi-yun/data-runtime/internal/integrationoperation"
	"github.com/huizhi-yun/data-runtime/internal/workflowapproval"
	"strings"
	"time"
)

// Separate c1 service leaves the reviewed ab/d handlers unchanged.
type PeopleFactsService struct {
	Registry       *enterprise.Registry
	Binding        enterprise.Binding
	ApprovalReader workflowapproval.PeopleReader
}

func factsMapError(err error) error {
	var me *mysql.MySQLError
	if errors.As(err, &me) && (me.Number == 1062 || me.Number == 1213 || me.Number == 1205) {
		return httperror.New(409, "people_write_conflict", "Concurrent facts changed")
	}
	return err
}
func (s PeopleFactsService) Execute(ctx context.Context, op string, i people.EnterpriseFactsInput, who Identity, scope altoc.BasicReadScope) (out any, err error) {
	if people.IsDirectoryRecoveryOperation(op) {
		return s.DirectoryRecovery(ctx, op, i, who, scope)
	}
	if people.IsOffboardingOperation(op) {
		return s.Offboarding(ctx, op, i, who, scope)
	}
	if people.IsHRSourceOperation(op) {
		return s.HRSource(ctx, op, i, who, scope)
	}
	defer func() { err = factsMapError(err) }()
	if e := people.ValidateFactsInput(op, i); e != nil {
		return nil, e
	}
	if e := scope.Validate(); e != nil {
		return nil, e
	}
	if s.Registry == nil || !domaininstall.IsPeopleFactsDomain(s.Binding.Domains["people"]) {
		return nil, httperror.New(503, "people_facts_not_installed", "People facts unavailable")
	}
	if who.Actor == "" || who.Client != "enterprise.runtime" || who.Tenant != s.Binding.Key.Tenant || who.Deployment != s.Binding.Domains["people"].OwnerDeployment {
		return nil, httperror.New(403, "people_actor_required", "Verified actor required")
	}
	_, action, _ := people.FactsPermission(op)
	write := action == "edit"
	operation := enterprise.Read
	if write {
		operation = enterprise.Write
		if who.Key == "" {
			return nil, httperror.New(400, "people_key_required", "Key required")
		}
	}
	req := s.request("people", operation)
	requests := []enterprise.ResolveRequest{req}
	var instance *workflowapproval.Instance
	if op == "assignments-attach-workflow" {
		instance, err = s.readApproval(ctx, people.FactsString(i.Payload, "workflowInstanceId"))
		if err != nil {
			return nil, err
		}
	}
	var tx *sql.Tx
	var resolved []enterprise.Resolved
	if write {
		tx, resolved, err = s.Registry.BeginWriteTransaction(ctx, requests...)
	} else {
		tx, resolved, err = s.Registry.BeginSnapshotReadTransaction(ctx, requests...)
	}
	if err != nil {
		return nil, err
	}
	defer tx.Rollback()
	r := resolved[0]
	// BeginWriteTransaction already holds the generation guard FOR SHARE.
	// Upgrading that shared lock would deadlock concurrent user/recovery writers.
	if e := peopleFactsScopeTx(ctx, tx, r, op, i, who.Actor, scope, write); e != nil {
		return nil, e
	}
	if op == "assignments-request-workflow" && people.FactsString(i.Payload, "phase") == "recover" {
		data, e := s.recoverAssignmentApprovalTx(ctx, tx, r, i, who)
		if e != nil {
			return nil, e
		}
		if e = tx.Commit(); e != nil {
			return nil, e
		}
		return map[string]any{"data": data}, nil
	}
	if op == "assignments-attach-workflow" {
		table, e := r.Table("people_assignments")
		if e != nil {
			return nil, e
		}
		row, e := people.FactsRowTx(ctx, tx, table, "id=? AND BINARY employee_uid=BINARY ?", i.ID, i.EmployeeUID)
		if e != nil {
			return nil, e
		}
		if e = people.ValidateAssignmentApproval(row, instance, people.FactsString(i.Payload, "workflowInstanceId"), "running"); e != nil {
			return nil, e
		}
	}
	if people.IsProvisioningOperation(op) {
		cases, er := r.Table("people_onboarding_cases")
		if er != nil {
			return nil, er
		}
		row, er := people.FactsRowTx(ctx, tx, cases, "id=?", i.ID)
		if er != nil {
			return nil, er
		}
		if er = people.CheckProvisioningRow(row); er != nil {
			return nil, er
		}
	}
	if !write {
		out, err = peopleOnboardingRead(ctx, tx, r, op, i, who, scope)
	} else {
		out, err = s.receipt(ctx, tx, r, op, i, who, func() (map[string]any, error) {
			facts := people.FactsContext{Tenant: who.Tenant, Deployment: who.Deployment, Actor: who.Actor, Client: who.Client, RequestID: who.RequestID, Key: who.Key, AsOf: time.Now().UTC()}
			switch {
			case op == "assignments-request-workflow":
				return s.freezeAssignmentApprovalTx(ctx, tx, r, i, who)
			case people.IsProvisioningOperation(op):
				return people.ProvisioningWriteTx(ctx, tx, r.Table, op, i, facts)
			case strings.HasPrefix(op, "employees-"):
				return people.FactsEmployeeWriteTx(ctx, tx, r.Table, op, i, facts)
			case strings.HasPrefix(op, "assignments-"):
				result, e := people.FactsAssignmentWriteTx(ctx, tx, r.Table, op, i, facts, instance)
				if e == nil && op == "assignments-attach-workflow" {
					e = s.confirmUserAssignmentApprovalTx(ctx, tx, r, i, who)
				}
				return result, e
			default:
				return people.FactsOnboardingWriteTx(ctx, tx, r.Table, op, i, facts)
			}
		})
	}
	if err != nil {
		return nil, err
	}
	err = tx.Commit()
	return out, err
}
func (s PeopleFactsService) request(domain string, op enterprise.Operation) enterprise.ResolveRequest {
	d := s.Binding.Domains[domain]
	return enterprise.ResolveRequest{Key: s.Binding.Key, Domain: domain, OwnerDeployment: d.OwnerDeployment, Generation: s.Binding.Generation, SchemaVersion: s.Binding.SchemaVersion, Operation: op}
}
func peopleFactsAllowed(actor, uid, dept string, scope altoc.BasicReadScope) bool {
	if scope.Access == "all" {
		return true
	}
	if scope.Access == "self" || scope.Access == "self_dept" {
		if uid != "" && uid == actor {
			return true
		}
	}
	if scope.Access == "dept" || scope.Access == "self_dept" {
		if dept != "" {
			for _, d := range scope.DepartmentCodes {
				if d == dept {
					return true
				}
			}
		}
	}
	return false
}
func peopleFactsScopeTx(ctx context.Context, tx *sql.Tx, r enterprise.Resolved, op string, i people.EnterpriseFactsInput, actor string, scope altoc.BasicReadScope, write bool) error {
	if op == "onboarding-list" {
		return nil
	}
	uid, dept := i.EmployeeUID, ""
	onboarding := strings.HasPrefix(op, "onboarding-")
	create := strings.HasSuffix(op, "-create") || op == "assignments-change"
	if onboarding {
		uid = "" // Proposed canonical UID is not a current Directory identity/self relation.
		if !create {
			t, e := r.Table("people_onboarding_cases")
			if e != nil {
				return e
			}
			row, e := people.FactsRowTx(ctx, tx, t, "id=?", i.ID)
			if e != nil {
				return e
			}
			dept, _ = row["dept_code"].(string)
		}
	} else if op != "employees-create" {
		t, e := r.Table("people_employees")
		if e != nil {
			return e
		}
		row, e := people.FactsRowTx(ctx, tx, t, "BINARY employee_uid=BINARY ? AND archived_at IS NULL", uid)
		if e != nil {
			return e
		}
		dept, _ = row["dept_code"].(string)
		if strings.HasPrefix(op, "assignments-") && i.ID != "" {
			t, e = r.Table("people_assignments")
			if e != nil {
				return e
			}
			if _, e = people.FactsRowTx(ctx, tx, t, "id=? AND BINARY employee_uid=BINARY ?", i.ID, uid); e != nil {
				var missing httperror.Error
				if op != "assignments-delete" || !errors.As(e, &missing) || missing.Status != 404 {
					return e
				}
				// A deleted draft may replay only its exact existing receipt. Current
				// employee scope is still verified; a new key reaches business 404.
			}
		}
		if op == "employees-update" {
			if fmt.Sprint(row["id"]) != i.ID {
				return httperror.New(403, "people_object_forbidden", "Employee mismatch")
			}
		}
	}
	proposed, hasDept := i.Payload["dept_code"].(string)
	if create {
		dept = proposed
	}
	if !peopleFactsAllowed(actor, uid, dept, scope) {
		return httperror.New(403, "people_scope_forbidden", "People object outside scope")
	}
	if write && hasDept && !peopleFactsAllowed(actor, uid, proposed, scope) {
		return httperror.New(403, "people_target_scope_forbidden", "Target department outside scope")
	}
	return nil
}
func peopleOnboardingRead(ctx context.Context, tx *sql.Tx, r enterprise.Resolved, op string, i people.EnterpriseFactsInput, who Identity, scope altoc.BasicReadScope) (any, error) {
	t, e := r.Table("people_onboarding_cases")
	if e != nil {
		return nil, e
	}
	where := "1=1"
	args := []any{}
	if scope.Access != "all" {
		where = "0=1"
		if scope.Access == "dept" || scope.Access == "self_dept" {
			where = "BINARY dept_code IN (" + strings.TrimSuffix(strings.Repeat("BINARY ?,", len(scope.DepartmentCodes)), ",") + ")"
			for _, d := range scope.DepartmentCodes {
				args = append(args, d)
			}
		}
	}
	if op == "onboarding-view" {
		where += " AND id=?"
		args = append(args, i.ID)
	}
	if i.Search != "" {
		where += " AND (LOCATE(?,candidate_name)>0 OR LOCATE(?,onboarding_code)>0)"
		args = append(args, i.Search, i.Search)
	}
	var total int64
	if e = tx.QueryRowContext(ctx, "SELECT COUNT(*) FROM "+t+" WHERE "+where, args...).Scan(&total); e != nil {
		return nil, e
	}
	cols := people.OnboardingColumns()
	if !i.SensitiveAllowed {
		filtered := []string{}
		for _, c := range cols {
			if c != "rank_code" {
				filtered = append(filtered, c)
			}
		}
		cols = filtered
	}
	query := "SELECT " + people.MasterSelect(cols) + " FROM " + t + " WHERE " + where + " ORDER BY id"
	if op == "onboarding-list" {
		query += " LIMIT ? OFFSET ?"
		args = append(args, i.PageSize, (i.Page-1)*i.PageSize)
	}
	rows, e := tx.QueryContext(ctx, query, args...)
	if e != nil {
		return nil, e
	}
	items, e := people.MasterRows(rows, cols)
	if e != nil {
		return nil, e
	}
	if op == "onboarding-view" {
		if len(items) != 1 {
			return nil, httperror.New(404, "people_object_not_found", "Onboarding unavailable")
		}
		return map[string]any{"data": items[0]}, nil
	}
	return map[string]any{"data": items, "total": total, "page": i.Page, "pageSize": i.PageSize}, nil
}
func (s PeopleFactsService) receipt(ctx context.Context, tx *sql.Tx, r enterprise.Resolved, op string, i people.EnterpriseFactsInput, who Identity, business func() (map[string]any, error)) (any, error) {
	command := map[string]any{"operation": op, "intent": people.FactsIntent(i), "actor": who.Actor}
	digest, e := integrationoperation.ValidateAndDigestCommand(command)
	if e != nil {
		return nil, e
	}
	raw, _ := json.Marshal(command)
	name, e := r.Table("service_command_receipt")
	if e != nil {
		return nil, e
	}
	repo, e := integrationoperation.NewReceiptRepository(r.DB, integrationoperation.WithReceiptTable(name))
	if e != nil {
		return nil, e
	}
	oid := uuid.NewHash(sha256.New(), uuid.NameSpaceOID, []byte("people-c1|"+who.Tenant+"|"+who.Deployment+"|"+who.Actor+"|"+op+"|"+who.Key), 4).String()
	capability := "people:enterprise-host:execute"
	if op == "workflow-callback" {
		capability = "people:scheduler:execute"
	}
	input := integrationoperation.ReceiptCommandInput{TrustedContext: integrationoperation.TrustedContext{TenantCode: who.Tenant, DeploymentCode: who.Deployment, SourceApp: "enterprise", ServiceClientID: who.Client, RequestID: who.RequestID}, SourceDeploymentCode: who.Deployment, TargetDeploymentCode: who.Deployment, TargetApp: "people", OperationID: oid, OperationCode: "people.apf09c1." + op + ".v1", RequiredCapability: capability, IdempotencyKey: who.Key, CommandSchemaVersion: "v1", CommandSHA256: digest, Command: raw, OriginalActorUID: who.Actor}
	receipt, e := repo.ExecuteInTransaction(ctx, tx, input, func(_ context.Context, _ *sql.Tx, _ json.RawMessage) (integrationoperation.ReceiptBusinessResult, error) {
		data, e := business()
		if e != nil {
			return integrationoperation.ReceiptBusinessResult{}, e
		}
		bytes, _ := json.Marshal(data)
		hash := sha256.Sum256(bytes)
		return integrationoperation.ReceiptBusinessResult{TargetBizType: "people_facts", TargetBizCode: fmt.Sprintf("%v:v%v", data["id"], data["row_version"]), HTTPStatus: 200, ResponseSummarySHA256: hex.EncodeToString(hash[:])}, nil
	})
	if e != nil {
		return nil, e
	}
	// Reload only under the current scope/lock; the immutable ID/version are from
	// the receipt, not whichever state a later write happens to have produced.
	parts := strings.Split(receipt.TargetBizCode, ":v")
	if len(parts) != 2 {
		return nil, fmt.Errorf("invalid facts receipt")
	}
	data := map[string]any{"id": parts[0], "row_version": parts[1]}
	if strings.HasPrefix(op, "assignments-") && op != "assignments-delete" {
		t, e := r.Table("people_assignments")
		if e != nil {
			return nil, e
		}
		row, e := people.FactsRowTx(ctx, tx, t, "id=? AND BINARY employee_uid=BINARY ?", parts[0], i.EmployeeUID)
		if e != nil {
			return nil, e
		}
		if row["approval_status"] == "draft" && fmt.Sprint(row["row_version"]) != parts[1] {
			return nil, httperror.New(409, "people_preparation_changed", "Assignment changed after preparation")
		}
		form, hash := people.AssignmentSnapshot(row, fmt.Sprint(row["created_by"]))
		data["formData"] = form
		data["snapshotHash"] = hash
		data["assignment_code"] = row["assignment_code"]
		data["approval_status"] = row["approval_status"]
		data["workflow_instance_id"] = row["workflow_instance_id"]
	}
	if people.IsProvisioningOperation(op) {
		cases, e := r.Table("people_onboarding_cases")
		if e != nil {
			return nil, e
		}
		row, e := people.FactsRowTx(ctx, tx, cases, "id=?", parts[0])
		if e != nil {
			return nil, e
		}
		data["status"] = row["status"]
		data["object_version"] = row["object_version"]
		if strings.HasPrefix(op, "onboarding-prepare-") {
			operations, e := r.Table("integration_operation")
			if e != nil {
				return nil, e
			}
			key := people.OnboardingFrozenKey(people.FactsContext{Tenant: who.Tenant, Deployment: who.Deployment, Actor: who.Actor, Key: who.Key}, op)
			frozen, e := people.FactsRowTx(ctx, tx, operations, "BINARY operation_key=BINARY ? AND tenant_code=? AND deployment_code=? AND source_app='enterprise'", key, who.Tenant, who.Deployment)
			if e != nil {
				return nil, e
			}
			var command map[string]any
			if e = json.Unmarshal([]byte(fmt.Sprint(frozen["command_json"])), &command); e != nil {
				return nil, e
			}
			data["frozen"] = map[string]any{"operationId": frozen["operation_id"], "operationKey": key, "operationCode": frozen["operation_code"], "requiredCapability": frozen["required_capability"], "idempotencyKey": frozen["idempotency_key"], "commandSchemaVersion": "v1", "commandSha256": frozen["command_sha256"], "command": command, "tenantCode": who.Tenant, "deploymentCode": who.Deployment, "sourceApp": "enterprise", "targetApp": "console"}
		}
	}
	return map[string]any{"data": data, "receiptId": receipt.ReceiptID, "replayed": receipt.Existing}, nil
}
