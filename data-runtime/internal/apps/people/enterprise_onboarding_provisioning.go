package people

import (
	"context"
	"crypto/sha256"
	"database/sql"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"regexp"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/huizhi-yun/data-runtime/internal/httperror"
	"github.com/huizhi-yun/data-runtime/internal/integrationoperation"
)

// Closed operations; confirmation payloads are signed server facts, never browser
// input. Host has no public endpoint for these internal checkpoint operations.
var ProvisioningOperations = map[string]string{
	"onboarding-begin-provisioning": "", "onboarding-reserved": "identity-reserve",
	"onboarding-provisioning": "user-provision", "onboarding-failure": "",
	"onboarding-cancel": "identity-release", "onboarding-aggregate-status": "operation-status",
	"onboarding-activate": "operation-status", "onboarding-prepare-reserve": "identity-reserve",
	"onboarding-prepare-release": "identity-release", "onboarding-prepare-provision": "user-provision",
	"onboarding-prepare-status": "operation-status", "onboarding-prepare-activation-link": "activation-link",
}

func IsProvisioningOperation(op string) bool { _, ok := ProvisioningOperations[op]; return ok }
func RequireAutomaticOnboarding(row map[string]any) error {
	if row["provider_code"] != "dingtalk" || FactsString(row, "provider_subject") == "" {
		return httperror.New(409, "people_manual_onboarding_unsupported", "手工候选暂不支持自动开通，请在 Console 中处理")
	}
	return nil
}
func ValidateProvisioningInput(op string, i EnterpriseFactsInput) error {
	if !IsProvisioningOperation(op) || !regexp.MustCompile(`^[1-9][0-9]{0,15}$`).MatchString(i.ID) || i.EmployeeUID != "" || i.Page != 0 || i.PageSize != 0 || i.Search != "" || FactsVersion(i.Payload) == 0 {
		return factsError("people_provisioning_input_invalid")
	}
	for k, v := range i.Payload {
		switch k {
		case "expectedVersion":
		case "operationKey", "reason":
			s, ok := v.(string)
			if !ok || strings.TrimSpace(s) != s || len(s) > 200 || strings.ContainsAny(s, "\x00\r\n") {
				return factsError("people_provisioning_input_invalid")
			}
		case "confirmation":
			m, ok := v.(map[string]any)
			if !ok || len(m) == 0 {
				return factsError("people_confirmation_invalid")
			}
			for k, v := range m {
				if !strings.Contains("|uid|reservationId|operationId|status|errorCode|released|directoryApplied|platformStatus|", "|"+k+"|") {
					return factsError("people_confirmation_invalid")
				}
				switch v.(type) {
				case string, bool:
				default:
					return factsError("people_confirmation_invalid")
				}
			}
		default:
			return factsError("people_provisioning_input_invalid")
		}
	}
	if op == "onboarding-cancel" && len([]rune(FactsString(i.Payload, "reason"))) < 5 {
		return factsError("onboarding_cancellation_reason_required")
	}
	return nil
}
func OnboardingFrozenKey(who FactsContext, op string) string {
	h := sha256.Sum256([]byte(who.Tenant + "|" + who.Deployment + "|" + who.Actor + "|" + op + "|" + who.Key))
	return "enterprise:people:onboarding:" + hex.EncodeToString(h[:])
}
func onboardingContract(kind string) (string, string, error) {
	switch kind {
	case "identity-reserve", "identity-release":
		return "people.directory." + kind + ".v1", "console:directory-identity:reserve", nil
	case "user-provision":
		return "people.directory.user-provision.v1", "console:directory-user:provision", nil
	case "operation-status":
		return "people.directory.user-provision-status.v1", "console:directory-user:provision", nil
	case "activation-link":
		return "people.directory.activation-link.v1", "console:directory-user:provision", nil
	}
	return "", "", factsError("people_provisioning_operation_invalid")
}

// This guard must also run before reading a replay receipt. A manual candidate
// never inherits a previously frozen command from another candidate or source.
func CheckProvisioningRow(row map[string]any) error { return RequireAutomaticOnboarding(row) }
func provisioningRowDates(row map[string]any) {
	for _, key := range []string{"planned_onboard_date", "source_onboard_date"} {
		if date, ok := row[key].(time.Time); ok {
			row[key] = date.Format("2006-01-02")
		}
	}
}
func ProvisioningWriteTx(ctx context.Context, tx *sql.Tx, table func(string) (string, error), op string, i EnterpriseFactsInput, who FactsContext) (map[string]any, error) {
	cases, e := table("people_onboarding_cases")
	if e != nil {
		return nil, e
	}
	row, e := FactsRowTx(ctx, tx, cases, "id=?", i.ID)
	if e != nil {
		return nil, e
	}
	provisioningRowDates(row)
	if e = RequireAutomaticOnboarding(row); e != nil {
		return nil, e
	}
	version := FactsVersion(i.Payload)
	if fmt.Sprint(row["object_version"]) != fmt.Sprint(version) {
		return nil, httperror.New(409, "people_version_conflict", "Version changed")
	}
	status := FactsString(row, "status")
	if strings.HasPrefix(op, "onboarding-prepare-") {
		return freezeOnboardingCommandTx(ctx, tx, table, row, op, who)
	}
	sets := map[string]any{}
	switch op {
	case "onboarding-begin-provisioning":
		if status != "ready_for_provisioning" && status != "reservation_expired" && status != "provisioning_failed" && status != "awaiting_profile" {
			return nil, httperror.New(409, "onboarding_status_not_provisionable", "Onboarding is frozen")
		}
		values := map[string]string{}
		for _, k := range onboardingRequiredProfileFields {
			values[k] = FactsString(row, k)
		}
		if len(missingOnboardingProfileFields(values)) > 0 {
			return nil, httperror.New(400, "onboarding_profile_incomplete", "请先完善部门、岗位、职级、账号、邮箱和入职日期")
		}
		if FactsString(row, "reservation_id") != "" || FactsString(row, "provision_operation_id") != "" {
			return nil, httperror.New(409, "onboarding_resume_required", "请恢复原开通阶段，不能重新预留已有身份")
		}
		sets["status"] = "reserving_identity"
		sets["reservation_id"] = nil
		sets["provision_operation_id"] = nil
		sets["last_error_code"] = nil
	case "onboarding-reserved", "onboarding-provisioning", "onboarding-aggregate-status", "onboarding-activate", "onboarding-cancel":
		kind := ProvisioningOperations[op]
		if op == "onboarding-cancel" && FactsString(row, "reservation_id") == "" {
			if !onboardingEditableStatuses[status] {
				return nil, httperror.New(409, "onboarding_status_not_cancellable", "开通在途，请按离职流程处理")
			}
			sets["status"] = "cancelled"
			sets["cancellation_reason"] = i.Payload["reason"]
			sets["cancelled_by"] = who.Actor
			sets["cancelled_at"] = who.AsOf
			break
		}
		confirmation, e := confirmedOnboardingCommandTx(ctx, tx, table, row, i, who, kind)
		if e != nil {
			return nil, e
		}
		switch op {
		case "onboarding-reserved":
			if status != "reserving_identity" || FactsString(confirmation, "reservationId") == "" {
				return nil, httperror.New(409, "onboarding_status_conflict", "Reservation confirmation invalid")
			}
			sets["reservation_id"] = confirmation["reservationId"]
		case "onboarding-provisioning":
			if status != "reserving_identity" || FactsString(row, "reservation_id") == "" || FactsString(confirmation, "operationId") == "" {
				return nil, httperror.New(409, "onboarding_status_conflict", "Provision confirmation invalid")
			}
			sets["provision_operation_id"] = confirmation["operationId"]
			sets["status"] = "provisioning_account"
		case "onboarding-activate":
			if status != "provisioning_account" || FactsString(confirmation, "status") != "succeeded" {
				return nil, httperror.New(409, "onboarding_operation_pending", "账号尚未完成开通")
			}
			if e = activateEnterpriseOnboardingTx(ctx, tx, table, row, who); e != nil {
				return nil, e
			}
			sets["status"] = "activating_employee"
		case "onboarding-aggregate-status":
			if FactsString(confirmation, "status") != "succeeded" {
				return nil, httperror.New(409, "onboarding_operation_pending", "账号尚未完成开通")
			}
			if !onboardingAggregationStatuses[status] {
				return nil, httperror.New(409, "onboarding_status_conflict", "Onboarding status cannot aggregate")
			}
			// Both target Directory and Platform confirmation are required. A successful
			// LDAP provisioning status alone is not evidence of lifecycle completion.
			if confirmation["directoryApplied"] == true && FactsString(confirmation, "platformStatus") == "succeeded" && FactsString(row, "planned_onboard_date") <= who.AsOf.UTC().Format("2006-01-02") {
				sets["status"] = "completed"
				sets["completed_at"] = who.AsOf
				sets["completed_by"] = who.Actor
			} else if confirmation["directoryApplied"] == true {
				sets["status"] = "projecting_authorization"
			} else {
				sets["status"] = status
			}
		case "onboarding-cancel":
			if FactsString(row, "provision_operation_id") != "" {
				return nil, httperror.New(409, "onboarding_status_not_cancellable", "已有开通操作，请按离职流程处理")
			}
			if !onboardingEditableStatuses[status] && status != "reserving_identity" {
				return nil, httperror.New(409, "onboarding_status_not_cancellable", "开通在途，请按离职流程处理")
			}
			if FactsString(row, "reservation_id") != "" && confirmation["released"] != true {
				return nil, httperror.New(409, "onboarding_release_pending", "预留尚未释放")
			}
			sets["status"] = "cancelled"
			sets["cancellation_reason"] = i.Payload["reason"]
			sets["cancelled_by"] = who.Actor
			sets["cancelled_at"] = who.AsOf
		}
	case "onboarding-failure":
		// Failure is accepted only for an existing frozen command and a closed error
		// category signed by Host after a target failure; arbitrary statuses forbidden.
		_, e := confirmedOnboardingCommandTx(ctx, tx, table, row, i, who, "")
		if e != nil {
			return nil, e
		}
		if status != "reserving_identity" && status != "provisioning_account" {
			return nil, httperror.New(409, "onboarding_status_conflict", "Failure stage invalid")
		}
		sets["status"] = "provisioning_failed"
		sets["last_error_code"] = "target_delivery_failed"
	default:
		return nil, factsError("people_provisioning_operation_invalid")
	}
	keys := []string{}
	for k := range sets {
		keys = append(keys, k)
	}
	sortStrings(keys)
	clauses := []string{}
	args := []any{}
	for _, k := range keys {
		clauses = append(clauses, k+"=?")
		args = append(args, sets[k])
	}
	clauses = append(clauses, "object_version=object_version+1", "updated_by=?", "updated_at=UTC_TIMESTAMP(3)")
	args = append(args, who.Actor, i.ID, version)
	res, e := tx.ExecContext(ctx, "UPDATE "+cases+" SET "+strings.Join(clauses, ",")+" WHERE id=? AND object_version=?", args...)
	if e != nil {
		return nil, e
	}
	n, e := res.RowsAffected()
	if e != nil {
		return nil, e
	}
	if n != 1 {
		return nil, httperror.New(409, "people_version_conflict", "Version changed")
	}
	return map[string]any{"id": i.ID, "row_version": version + 1}, nil
}
func freezeOnboardingCommandTx(ctx context.Context, tx *sql.Tx, table func(string) (string, error), row map[string]any, op string, who FactsContext) (map[string]any, error) {
	kind := ProvisioningOperations[op]
	code, cap, e := onboardingContract(kind)
	if e != nil {
		return nil, e
	}
	if kind == "identity-release" && FactsString(row, "provision_operation_id") != "" {
		return nil, httperror.New(409, "onboarding_status_not_cancellable", "已有开通操作，请按离职流程处理")
	}
	status := FactsString(row, "status")
	valid := kind == "identity-reserve" && status == "reserving_identity" || kind == "identity-release" && (onboardingEditableStatuses[status] || status == "reserving_identity") || kind == "user-provision" && status == "reserving_identity" || (kind == "operation-status" || kind == "activation-link") && (status == "provisioning_account" || onboardingAggregationStatuses[status] || status == "completed")
	if !valid {
		return nil, httperror.New(409, "onboarding_status_conflict", "Frozen command stage invalid")
	}
	command := map[string]any{"onboardingCode": row["onboarding_code"], "sourceApp": "enterprise", "sourceBizCode": row["onboarding_code"], "uid": row["canonical_uid"], "objectVersion": row["object_version"], "actorUid": who.Actor, "originalActorUid": who.Actor, "providerCode": "dingtalk", "providerSubject": row["provider_subject"], "username": row["canonical_uid"], "email": row["corporate_email"], "displayName": row["candidate_name"], "mobile": row["mobile"], "deptCode": row["dept_code"], "positionName": row["position_code"]}
	if kind == "user-provision" || kind == "identity-release" {
		if FactsString(row, "reservation_id") == "" {
			return nil, httperror.New(409, "onboarding_reservation_required", "预留尚未完成")
		}
		command["reservationId"] = row["reservation_id"]
	}
	if kind == "operation-status" || kind == "activation-link" {
		if FactsString(row, "provision_operation_id") == "" {
			return nil, httperror.New(409, "onboarding_operation_pending", "尚未生成开通操作")
		}
		command["provisionOperationId"] = row["provision_operation_id"]
	}
	digest, e := integrationoperation.ValidateAndDigestCommand(command)
	if e != nil {
		return nil, e
	}
	raw, e := json.Marshal(command)
	if e != nil {
		return nil, e
	}
	operations, e := table("integration_operation")
	if e != nil {
		return nil, e
	}
	key := OnboardingFrozenKey(who, op)
	_, e = tx.ExecContext(ctx, "INSERT INTO "+operations+"(operation_id,operation_key,correlation_key,tenant_code,deployment_code,source_app,target_app,operation_code,required_capability,source_biz_type,source_biz_code,idempotency_key,command_schema_version,command_json,command_sha256,status,next_attempt_at,original_request_id,original_actor_uid,service_client_id,created_by,updated_by) VALUES(?,?,?, ?,?,'enterprise','console',?,?,'onboarding_case',?,?,'v1',?,?,'pending',UTC_TIMESTAMP(3),?,?,?,?,?)", uuid.NewString(), key, key, who.Tenant, who.Deployment, code, cap, row["onboarding_code"], key, string(raw), digest, who.RequestID, who.Actor, who.Client, who.Actor, who.Actor)
	return map[string]any{"id": fmt.Sprint(row["id"]), "row_version": row["object_version"]}, e
}
func confirmedOnboardingCommandTx(ctx context.Context, tx *sql.Tx, table func(string) (string, error), row map[string]any, i EnterpriseFactsInput, who FactsContext, kind string) (map[string]any, error) {
	operations, e := table("integration_operation")
	if e != nil {
		return nil, e
	}
	frozen, e := FactsRowTx(ctx, tx, operations, "BINARY operation_key=BINARY ? AND tenant_code=? AND deployment_code=? AND source_app='enterprise' AND service_client_id='enterprise.runtime' AND target_app='console' AND source_biz_type='onboarding_case' AND BINARY source_biz_code=BINARY ?", FactsString(i.Payload, "operationKey"), who.Tenant, who.Deployment, row["onboarding_code"])
	if e != nil {
		return nil, e
	}
	var cmd map[string]any
	raw := []byte(fmt.Sprint(frozen["command_json"]))
	if e = json.Unmarshal(raw, &cmd); e != nil {
		return nil, e
	}
	digest, e := integrationoperation.ValidateAndDigestCommand(cmd)
	if e != nil || digest != frozen["command_sha256"] || cmd["sourceApp"] != "enterprise" || cmd["sourceBizCode"] != row["onboarding_code"] {
		return nil, httperror.New(409, "onboarding_confirmation_mismatch", "Frozen command integrity invalid")
	}
	if kind != "" {
		code, cap, e := onboardingContract(kind)
		if e != nil {
			return nil, e
		}
		if frozen["operation_code"] != code || frozen["required_capability"] != cap {
			return nil, httperror.New(403, "onboarding_confirmation_mismatch", "Wrong target operation")
		}
	}
	confirmation, ok := i.Payload["confirmation"].(map[string]any)
	if !ok || confirmation["uid"] != row["canonical_uid"] || cmd["uid"] != row["canonical_uid"] {
		return nil, httperror.New(403, "onboarding_confirmation_mismatch", "Wrong target UID")
	}
	if kind == "operation-status" && confirmation["operationId"] != row["provision_operation_id"] {
		return nil, httperror.New(403, "onboarding_confirmation_mismatch", "Wrong provision operation")
	}
	if kind != "" {
		digest, e := integrationoperation.ValidateAndDigestCommand(confirmation)
		if e != nil {
			return nil, e
		}
		_, e = tx.ExecContext(ctx, "UPDATE "+operations+" SET status='succeeded',response_summary_sha256=?,succeeded_at=UTC_TIMESTAMP(3),version_no=version_no+1 WHERE operation_id=? AND status<>'succeeded'", digest, frozen["operation_id"])
		if e != nil {
			return nil, e
		}
	}
	return confirmation, nil
}
func activateEnterpriseOnboardingTx(ctx context.Context, tx *sql.Tx, table func(string) (string, error), row map[string]any, who FactsContext) error {
	// The new canonical schema has no legacy monthly_standard_cost column.
	uid := FactsString(row, "canonical_uid")
	if !factsUID.MatchString(uid) || strings.HasPrefix(strings.ToLower(uid), "dt-") {
		return factsError("people_uid_invalid")
	}
	date := FactsString(row, "planned_onboard_date")
	if _, e := time.Parse("2006-01-02", date); e != nil {
		return factsError("people_date_invalid")
	}
	employees, e := table("people_employees")
	if e != nil {
		return e
	}
	assignments, e := table("people_assignments")
	if e != nil {
		return e
	}
	metadata, _ := json.Marshal(map[string]any{"source_app": "enterprise", "onboarding_code": row["onboarding_code"], "directory_user": map[string]any{"provider_code": "dingtalk", "provider_subject": row["provider_subject"], "email": row["corporate_email"]}})
	status := "inactive"
	if date <= who.AsOf.UTC().Format("2006-01-02") {
		status = "active"
	}
	_, e = factsInsertTx(ctx, tx, employees, map[string]any{"employee_uid": uid, "employee_no": row["employee_no"], "display_name": row["candidate_name"], "login_name": uid, "employment_status": status, "employment_type": row["employment_type"], "onboard_date": date, "onboard_date_source": "manual", "metadata": string(metadata), "created_by": who.Actor, "updated_by": who.Actor})
	if e != nil {
		return e
	}
	_, e = factsInsertTx(ctx, tx, assignments, map[string]any{"assignment_code": stableDirectoryCode("ASN-ONB", FactsString(row, "onboarding_code")), "employee_uid": uid, "change_type": "onboard", "effective_from": date, "dept_code": row["dept_code"], "position_code": row["position_code"], "rank_code": row["rank_code"], "manager_uid": row["manager_uid"], "is_primary": 1, "approval_status": "approved", "source_app": "enterprise", "source_biz_type": "onboarding_case", "source_biz_id": row["onboarding_code"], "created_by": who.Actor, "updated_by": who.Actor})
	if e != nil {
		return e
	}
	if date > who.AsOf.UTC().Format("2006-01-02") {
		return nil
	}
	if e = ProjectEnterprisePrimaryTx(ctx, tx, table, uid, who); e != nil {
		return e
	}
	_, e = FreezeEnterpriseLifecycleTx(ctx, tx, table, uid, who)
	return e
}
