package altoc

import (
	"context"
	"database/sql"
	"encoding/json"
	"fmt"
	"strings"

	"github.com/huizhi-yun/data-runtime/internal/integrationoperation"
)

const (
	altocActivationProjectOperation   = "altoc.contract-activation.aims-project.v1"
	altocActivationMilestoneOperation = "altoc.contract-activation.aims-milestones.v1"
	altocActivationAimsCapability     = "aims:write"
)

type contractActivationOperationRecord struct {
	OperationID     string   `json:"operationId"`
	OperationKey    string   `json:"operationKey"`
	OperationCode   string   `json:"operationCode"`
	PlanKey         string   `json:"planKey"`
	ProjectCode     string   `json:"projectCode"`
	ProjectRole     string   `json:"projectRole"`
	LineCodes       []string `json:"lineCodes,omitempty"`
	ObligationCodes []string `json:"obligationCodes,omitempty"`
	Status          string   `json:"status"`
	Sequence        int      `json:"sequence"`
	DependsOn       string   `json:"dependsOn,omitempty"`
}

func (a *Adapter) freezeContractActivationOperationsTx(ctx context.Context, tx *sql.Tx, contract map[string]any, body map[string]any, operator string) ([]contractActivationOperationRecord, error) {
	trusted, err := integrationoperation.TrustedContextFromMap(body, "altoc")
	if err != nil {
		return nil, err
	}
	if err := a.enrichContractActivationInputsTx(ctx, tx, contract); err != nil {
		return nil, err
	}
	job, err := a.contractActivationJobByIdempotencyTx(ctx, tx, contract["id"], contractActivationIdempotencyKey(contract, body))
	if err != nil {
		return nil, err
	}
	if job == nil {
		return nil, fmt.Errorf("contract activation job is required before freezing integration commands")
	}
	contractCode := altocMapText(contract, "code")
	jobCode := altocMapText(job, "code")
	correlationKey := fmt.Sprintf("altoc:contract:%s:activation:%s:v1", stableActivationKeyPart(contractCode), stableActivationKeyPart(jobCode))
	plans := activationProjectPlans(contract, activationMapSlice(contract["lines"]), activationMapSlice(contract["obligations"]), activationMapSlice(contract["project_links"]))
	terms := activationMapSlice(contract["payment_terms"])
	schedules := activationMapSlice(contract["billing_schedules"])
	records := make([]contractActivationOperationRecord, 0, len(plans)*2)
	for index, plan := range plans {
		planKey := firstNonEmptyText(altocMapText(plan, "plan_key"), fmt.Sprintf("project-%d", index+1))
		stablePlanKey := stableActivationKeyPart(planKey)
		projectCode := contractActivationNormalizeProjectCode(firstNonEmptyText(altocMapText(plan, "project_code"), contractActivationProjectCode(contractCode, planKey, altocMapText(plan, "project_role"))))
		projectOperationKey := correlationKey + ":plan:" + stablePlanKey + ":project"
		projectCommand := map[string]any{
			"contractCode": contractCode, "contractId": contract["id"], "contractName": contract["name"],
			"projectCode": projectCode, "projectName": firstNonEmptyText(altocMapText(plan, "project_name"), altocMapText(contract, "name")),
			"projectRole": firstNonEmptyText(altocMapText(plan, "project_role"), "delivery"), "planKey": planKey,
			"lineCodes": activationStringSlice(plan["line_codes"]), "obligationCodes": activationStringSlice(plan["obligation_codes"]),
			"customerCode": contract["customer_code"], "customerName": contract["customer_name"],
			"oppId": contract["opportunity_id"], "opportunityCode": contract["opportunity_code"],
			"ownerUserId": contract["owner_user_id"], "ownerDeptCode": contract["owner_dept_code"],
			"category":      contractActivationProjectCategory(altocMapText(plan, "project_role")),
			"effectiveDate": contract["effective_date"], "startDate": contract["effective_date"], "endDate": contract["end_date"],
		}
		operationID, operationStatus, err := insertContractActivationOperationTx(ctx, tx, trusted, operator, contractCode, correlationKey, projectOperationKey, "", index*10+1, altocActivationProjectOperation, projectCommand)
		if err != nil {
			return nil, err
		}
		records = append(records, contractActivationOperationRecord{OperationID: operationID, OperationKey: projectOperationKey, OperationCode: altocActivationProjectOperation, PlanKey: planKey, ProjectCode: projectCode, ProjectRole: firstNonEmptyText(altocMapText(plan, "project_role"), "delivery"), LineCodes: activationStringSlice(plan["line_codes"]), ObligationCodes: activationStringSlice(plan["obligation_codes"]), Status: operationStatus, Sequence: index*10 + 1})

		planTerms, planSchedules := contractActivationMilestonesForPlan(terms, schedules, plan, index)
		if len(planTerms) == 0 && len(planSchedules) == 0 {
			continue
		}
		milestoneOperationKey := correlationKey + ":plan:" + stablePlanKey + ":milestones"
		milestoneCommand := map[string]any{
			"contractCode": contractCode, "projectCode": projectCode, "projectPlanKey": planKey,
			"projectRole":  firstNonEmptyText(altocMapText(plan, "project_role"), "delivery"),
			"paymentTerms": planTerms, "billingSchedules": planSchedules,
		}
		operationID, operationStatus, err = insertContractActivationOperationTx(ctx, tx, trusted, operator, contractCode, correlationKey, milestoneOperationKey, projectOperationKey, index*10+2, altocActivationMilestoneOperation, milestoneCommand)
		if err != nil {
			return nil, err
		}
		records = append(records, contractActivationOperationRecord{OperationID: operationID, OperationKey: milestoneOperationKey, OperationCode: altocActivationMilestoneOperation, PlanKey: planKey, ProjectCode: projectCode, ProjectRole: firstNonEmptyText(altocMapText(plan, "project_role"), "delivery"), Status: operationStatus, Sequence: index*10 + 2, DependsOn: projectOperationKey})
	}
	return records, nil
}

func insertContractActivationOperationTx(ctx context.Context, tx *sql.Tx, trusted integrationoperation.TrustedContext, actor, contractCode, correlationKey, operationKey, dependsOn string, sequence int, operationCode string, command map[string]any) (string, string, error) {
	commandSHA, err := integrationoperation.ValidateAndDigestCommand(command)
	if err != nil {
		return "", "", err
	}
	commandJSON, err := json.Marshal(command)
	if err != nil {
		return "", "", err
	}
	var existingID, existingCode, existingCapability, existingHash, existingStatus string
	err = tx.QueryRowContext(ctx, `
		SELECT operation_id, operation_code, required_capability, command_sha256, status
		FROM integration_operation
		WHERE tenant_code = ? AND deployment_code = ? AND source_app = 'altoc' AND operation_key = ?
		FOR UPDATE`, trusted.TenantCode, trusted.DeploymentCode, operationKey).Scan(&existingID, &existingCode, &existingCapability, &existingHash, &existingStatus)
	if err == nil {
		if existingCode != operationCode || existingCapability != altocActivationAimsCapability || existingHash != commandSHA {
			return "", "", integrationoperation.ErrImmutableIdentity
		}
		return existingID, existingStatus, nil
	}
	if err != sql.ErrNoRows {
		return "", "", err
	}
	operationID, err := integrationoperation.NewOperationID()
	if err != nil {
		return "", "", err
	}
	identity := integrationoperation.Identity{TenantCode: trusted.TenantCode, DeploymentCode: trusted.DeploymentCode, SourceApp: "altoc", TargetApp: "aims", OperationCode: operationCode, SourceBizType: "contract", SourceBizCode: contractCode, IdempotencyKey: operationKey, CommandSHA256: commandSHA}
	if err := identity.Validate(); err != nil {
		return "", "", err
	}
	createdBy := firstNonEmptyText(strings.TrimSpace(actor), trusted.ServiceClientID)
	_, err = tx.ExecContext(ctx, `
		INSERT INTO integration_operation (
		  operation_id, operation_key, correlation_key, sequence_no, depends_on_operation_key,
		  tenant_code, deployment_code, source_app, target_app, operation_code, required_capability,
		  source_biz_type, source_biz_code, idempotency_key, command_schema_version, command_json,
		  command_sha256, status, original_request_id, original_actor_uid, service_client_id, created_by, updated_by, next_attempt_at) VALUES (?, ?, ?, ?, ?, ?, ?, 'altoc', 'aims', ?, ?, 'contract', ?, ?, 'v1', ?, ?, 'pending', ?, ?, ?, ?, ?, UTC_TIMESTAMP(3))`,
		operationID, operationKey, correlationKey, sequence, nullableText(dependsOn), trusted.TenantCode, trusted.DeploymentCode,
		operationCode, altocActivationAimsCapability, contractCode, operationKey, string(commandJSON), commandSHA,
		nullableText(trusted.RequestID), nullableText(actor), nullableText(trusted.ServiceClientID), nullableText(createdBy), nullableText(createdBy))
	return operationID, string(integrationoperation.StatusPending), err
}

func stableActivationKeyPart(value string) string {
	value = strings.ToLower(strings.TrimSpace(value))
	var b strings.Builder
	lastDash := false
	for _, r := range value {
		if (r >= 'a' && r <= 'z') || (r >= '0' && r <= '9') {
			b.WriteRune(r)
			lastDash = false
		} else if !lastDash {
			b.WriteByte('-')
			lastDash = true
		}
	}
	result := strings.Trim(b.String(), "-")
	if result == "" {
		return "unknown"
	}
	return result
}

func contractActivationProjectCode(contractCode, planKey, role string) string {
	base := strings.ToUpper(stableActivationKeyPart(contractCode))
	if !strings.HasPrefix(base, "PRJ-") {
		base = "PRJ-" + base
	}
	suffix := strings.ToUpper(stableActivationKeyPart(firstNonEmptyText(planKey, role)))
	if suffix != "" && suffix != "DELIVERY-MAIN" && suffix != "UNKNOWN" {
		base += "-" + strings.TrimPrefix(suffix, "PROJECT-")
	}
	if len(base) > 50 {
		base = strings.TrimRight(base[:50], "-")
	}
	return base
}

func contractActivationNormalizeProjectCode(value string) string {
	value = strings.ToUpper(strings.TrimSpace(value))
	var b strings.Builder
	lastDash := false
	for _, r := range value {
		if (r >= 'A' && r <= 'Z') || (r >= '0' && r <= '9') {
			b.WriteRune(r)
			lastDash = false
		} else if !lastDash {
			b.WriteByte('-')
			lastDash = true
		}
	}
	result := strings.Trim(b.String(), "-")
	if len(result) > 50 {
		result = strings.TrimRight(result[:50], "-")
	}
	return result
}

func contractActivationProjectCategory(role string) string {
	switch strings.ToLower(strings.TrimSpace(role)) {
	case "maintenance", "operation":
		return "maintenance"
	case "development":
		return "product_dev"
	default:
		return "delivery"
	}
}

func contractActivationMilestonesForPlan(terms, schedules []map[string]any, plan map[string]any, index int) ([]map[string]any, []map[string]any) {
	lines := map[string]bool{}
	for _, value := range activationStringSlice(plan["line_codes"]) {
		lines[value] = true
	}
	obligations := map[string]bool{}
	for _, value := range activationStringSlice(plan["obligation_codes"]) {
		obligations[value] = true
	}
	filtered := make([]map[string]any, 0)
	hasUnscoped := false
	for _, schedule := range schedules {
		line := altocMapText(schedule, "contract_line_code")
		obligation := altocMapText(schedule, "obligation_code")
		if line == "" && obligation == "" {
			hasUnscoped = true
			filtered = append(filtered, schedule)
			continue
		}
		if lines[line] || obligations[obligation] {
			filtered = append(filtered, schedule)
		}
	}
	planTerms := []map[string]any{}
	if index == 0 && (len(schedules) == 0 || hasUnscoped) {
		planTerms = terms
	}
	return planTerms, filtered
}
