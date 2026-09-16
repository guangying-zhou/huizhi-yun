package altoc

import (
	"context"
	"database/sql"
	"fmt"
	"net/http"
	"strings"
	"time"

	"github.com/huizhi-yun/data-runtime/internal/httperror"
)

var contractStageLabels = map[string]string{
	"contract_signed": "签订生效",
	"delivery":        "交付完成",
	"acceptance":      "验收完成",
	"service_end":     "服务结束",
}

func (a *Adapter) changeContractStatus(ctx context.Context, identifier string, body map[string]any) (map[string]any, error) {
	contractID, err := altocIdentifierID(identifier, "contract_id")
	if err != nil {
		return nil, err
	}
	action, err := contractStatusAction(body)
	if err != nil {
		return nil, err
	}

	tx, err := a.DB().BeginTx(ctx, nil)
	if err != nil {
		return nil, err
	}
	defer tx.Rollback()

	contract, err := a.lockContractTx(ctx, tx, contractID)
	if err != nil {
		return nil, err
	}
	if contract == nil {
		return nil, httperror.New(http.StatusNotFound, "record_not_found", "contract not found")
	}
	if err := altocRequireRecordWrite(body, "contract", contract, "owner_user_id", "owner_dept_code"); err != nil {
		return nil, err
	}
	if err := altocRequireActionScope(body, "contract", contractStatusRequiredAction(action)); err != nil {
		return nil, err
	}

	operator := altocActor(body)
	reason := firstBodyText(body, "reason", "reject_reason", "rejectReason")
	currentStatus := contractLifecycleStatus(contract)
	alreadyApplied := contractStatusActionAlreadyApplied(action, contract)
	if alreadyApplied && action != "mark_signed" {
		tx.Rollback()
		updated, err := a.getContract(ctx, fmt.Sprint(contractID))
		if err != nil {
			return nil, err
		}
		return map[string]any{
			"contract": updated,
			"action":   action,
			"changed":  false,
		}, nil
	}
	if !contractStatusActionAllowed(action, currentStatus) {
		return nil, httperror.New(http.StatusConflict, "invalid_contract_status", "contract status does not allow this action")
	}
	if action == "submit" {
		if issues := contractSubmissionIssues(contract); len(issues) > 0 {
			return nil, httperror.New(http.StatusBadRequest, "contract_not_ready", "contract is not ready: "+strings.Join(issues, ", "))
		}
	}
	commandSummary := map[string]any{}
	switch action {
	case "mark_signed":
		if signDate := firstBodyText(body, "effective_date", "effectiveDate", "sign_date", "signDate"); signDate != "" {
			contract["effective_date"] = signDate
		}
		summary, err := a.ensureContractObligationBillingPlanTx(ctx, tx, contract, operator)
		if err != nil {
			return nil, err
		}
		commandSummary = summary
		if alreadyApplied && contractCommandSummaryHasNoChanges(commandSummary) {
			tx.Rollback()
			updated, err := a.getContract(ctx, fmt.Sprint(contractID))
			if err != nil {
				return nil, err
			}
			return map[string]any{
				"contract": updated,
				"action":   action,
				"changed":  false,
			}, nil
		}
	case "close_fulfillment":
		if err := a.validateFulfillmentCloseTx(ctx, tx, contract, operator); err != nil {
			return nil, err
		}
	case "suspend":
		if reason == "" {
			return nil, httperror.New(http.StatusBadRequest, "missing_reason", "suspend reason is required")
		}
	case "terminate":
		if reason == "" {
			return nil, httperror.New(http.StatusBadRequest, "missing_reason", "termination reason is required")
		}
		obligations, schedules, err := cancelOpenObligationsAndSchedulesTx(ctx, tx, contract["id"], operator)
		if err != nil {
			return nil, err
		}
		commandSummary["cancelled_obligations"] = obligations
		commandSummary["cancelled_billing_schedules"] = schedules
	}
	columns, err := altocTableColumns(ctx, tx, "contract")
	if err != nil {
		return nil, err
	}
	set, args, err := contractStatusSetParts(columns, action, reason, operator)
	if err != nil {
		return nil, err
	}
	args = append(args, contractID)
	if _, err := tx.ExecContext(ctx, "UPDATE contract SET "+strings.Join(set, ", ")+" WHERE id = ?", args...); err != nil {
		return nil, err
	}

	targetStatus := contractStatusTargetStatus(action)
	newValue := map[string]any{
		"action":             action,
		"status":             targetStatus,
		"legal_status":       contractLegalStatusTargetStatus(action),
		"fulfillment_status": contractFulfillmentStatusTargetStatus(action),
		"activation_status":  contractActivationStatusTargetStatus(action),
		"summary":            commandSummary,
	}
	if action == "reject" {
		newValue["reject_reason"] = nullableText(reason)
	}
	if err := insertAltocAuditTx(ctx, tx, "contract", contractID, "status_change", map[string]any{
		"status":             contract["status"],
		"legal_status":       contract["legal_status"],
		"fulfillment_status": contract["fulfillment_status"],
		"financial_status":   contract["financial_status"],
		"activation_status":  contract["activation_status"],
	}, newValue, operator); err != nil {
		return nil, err
	}
	if err := insertContractDomainEventTx(ctx, tx, contractDomainEventKey("contract.status", contractID, action, currentStatus, targetStatus, altocMapText(contract, "lock_version")), "ContractStatusChanged", "contract", contractID, map[string]any{
		"contract_id":        contractID,
		"contract_code":      contract["code"],
		"action":             action,
		"old_status":         currentStatus,
		"status":             targetStatus,
		"legal_status":       contractLegalStatusTargetStatus(action),
		"fulfillment_status": contractFulfillmentStatusTargetStatus(action),
		"activation_status":  contractActivationStatusTargetStatus(action),
		"summary":            commandSummary,
	}, operator); err != nil {
		return nil, err
	}
	if err := tx.Commit(); err != nil {
		return nil, err
	}

	updated, err := a.getContract(ctx, fmt.Sprint(contractID))
	if err != nil {
		return nil, err
	}
	return map[string]any{
		"contract": updated,
		"action":   action,
		"changed":  true,
	}, nil
}

func (a *Adapter) approveContract(ctx context.Context, identifier string, body map[string]any) (map[string]any, error) {
	action := strings.TrimSpace(firstBodyText(body, "action"))
	if action != "approve" && action != "reject" {
		return nil, httperror.New(http.StatusBadRequest, "invalid_approval_action", "action must be approve or reject")
	}
	return a.changeContractStatus(ctx, identifier, body)
}

func (a *Adapter) completeContractStage(ctx context.Context, identifier string, body map[string]any) (map[string]any, error) {
	contractID, err := altocIdentifierID(identifier, "contract_id")
	if err != nil {
		return nil, err
	}
	stageType, err := contractStageType(body)
	if err != nil {
		return nil, err
	}
	stageDate, err := contractStageDate(body)
	if err != nil {
		return nil, err
	}
	evidenceNote := firstBodyText(body, "evidence_note", "evidenceNote")
	documentUUID := firstBodyText(body, "document_uuid", "documentUuid")
	documentTitle := firstBodyText(body, "document_title", "documentTitle")
	if evidenceNote == "" && documentUUID == "" {
		return nil, httperror.New(http.StatusBadRequest, "missing_stage_evidence", "document_uuid or evidence_note is required")
	}

	tx, err := a.DB().BeginTx(ctx, nil)
	if err != nil {
		return nil, err
	}
	defer tx.Rollback()

	contract, err := a.lockContractTx(ctx, tx, contractID)
	if err != nil {
		return nil, err
	}
	if contract == nil {
		return nil, httperror.New(http.StatusNotFound, "record_not_found", "contract not found")
	}
	if err := altocRequireRecordWrite(body, "contract", contract, "owner_user_id", "owner_dept_code"); err != nil {
		return nil, err
	}
	if err := altocRequireActionScope(body, "contract", "edit"); err != nil {
		return nil, err
	}

	actualStages, completedStages, err := contractCompletedStagesTx(ctx, tx, contractID, altocMapText(contract, "status"))
	if err != nil {
		return nil, err
	}
	if actualStages[stageType] {
		return nil, httperror.New(http.StatusConflict, "contract_stage_already_completed", "contract stage is already completed")
	}
	if !contractStageActionAllowed(stageType, altocMapText(contract, "status"), completedStages) {
		return nil, httperror.New(http.StatusConflict, "invalid_contract_stage", "contract stage cannot be completed in current state")
	}

	operator := altocActor(body)
	code, err := nextAltocCode(ctx, tx, "CS", "contract_stage")
	if err != nil {
		return nil, err
	}
	stageID, err := altocInsertRecordTx(ctx, tx, "contract_stage", map[string]any{
		"code":           code,
		"contract_id":    contractID,
		"stage_type":     stageType,
		"stage_name":     contractStageLabels[stageType],
		"status":         "completed",
		"stage_date":     stageDate,
		"evidence_note":  nullableText(evidenceNote),
		"document_uuid":  nullableText(documentUUID),
		"document_title": nullableText(documentTitle),
		"handled_by":     nullableText(operator),
		"handled_at":     time.Now().UTC().Format("2006-01-02 15:04:05"),
	})
	if err != nil {
		return nil, err
	}
	if documentUUID != "" {
		if _, err := altocInsertRecordTx(ctx, tx, "document_link", map[string]any{
			"entity_type":    "contract_stage",
			"entity_id":      stageID,
			"document_uuid":  documentUUID,
			"document_title": firstNonEmptyText(documentTitle, contractStageLabels[stageType]),
			"link_type":      "stage_evidence",
			"created_by":     nullableText(operator),
		}); err != nil {
			return nil, err
		}
	}

	targetStatus := contractStageTargetStatus(stageType)
	statusChanged := targetStatus != "" && targetStatus != altocMapText(contract, "status")
	if err := updateContractForCompletedStageTx(ctx, tx, contract, stageType, stageDate, targetStatus, operator); err != nil {
		return nil, err
	}
	generatedPlans, err := a.generateReceivablePlansForStageTx(ctx, tx, contract, stageType, operator)
	if err != nil {
		return nil, err
	}
	if err := insertAltocAuditTx(ctx, tx, "contract", contractID, contractStageAuditAction(statusChanged), map[string]any{
		"status": contract["status"],
	}, map[string]any{
		"status":                  firstNonEmptyText(targetStatus, altocMapText(contract, "status")),
		"stage_type":              stageType,
		"stage_id":                stageID,
		"generated_plan_count":    generatedPlans,
		"document_uuid":           nullableText(documentUUID),
		"has_evidence_note":       evidenceNote != "",
		"effective_date_recorded": stageType == "contract_signed",
	}, operator); err != nil {
		return nil, err
	}
	if err := tx.Commit(); err != nil {
		return nil, err
	}

	updated, err := a.getContract(ctx, fmt.Sprint(contractID))
	if err != nil {
		return nil, err
	}
	return map[string]any{
		"id":                      stageID,
		"code":                    code,
		"status":                  firstNonEmptyText(targetStatus, altocMapText(contract, "status")),
		"stageType":               stageType,
		"generatedPlanCount":      generatedPlans,
		"generated_plan_count":    generatedPlans,
		"contract":                updated,
		"effectiveDateRecorded":   stageType == "contract_signed",
		"effective_date_recorded": stageType == "contract_signed",
	}, nil
}

func contractStatusAction(body map[string]any) (string, error) {
	action := strings.TrimSpace(firstBodyText(body, "action"))
	switch action {
	case "submit", "submit_approval":
		return "submit", nil
	case "withdraw":
		return "withdraw", nil
	case "approve":
		return "approve", nil
	case "reject":
		return "reject", nil
	case "mark_signed", "mark-signed", "sign", "activate":
		return "mark_signed", nil
	case "complete", "mark_completed", "close_fulfillment", "fulfillment_close":
		return "close_fulfillment", nil
	case "suspend":
		return "suspend", nil
	case "terminate":
		return "terminate", nil
	default:
		return "", httperror.New(http.StatusBadRequest, "invalid_status_action", "action must be submit, withdraw, approve, reject, mark_signed, close_fulfillment, suspend, or terminate")
	}
}

func contractStatusRequiredAction(action string) string {
	if action == "approve" || action == "reject" {
		return "approve"
	}
	return "edit"
}

func contractStatusTargetStatus(action string) string {
	switch action {
	case "submit":
		return "pending_approval"
	case "withdraw":
		return "draft"
	case "approve":
		return "approved"
	case "reject":
		return "rejected"
	case "mark_signed":
		return "effective"
	case "close_fulfillment":
		return "completed"
	case "suspend":
		return "effective"
	case "terminate":
		return "terminated"
	default:
		return ""
	}
}

func contractLegalStatusTargetStatus(action string) string {
	switch action {
	case "submit":
		return "pending_approval"
	case "withdraw":
		return "draft"
	case "approve":
		return "approved"
	case "reject":
		return "draft"
	case "mark_signed":
		return "effective"
	case "close_fulfillment":
		return "closed"
	case "suspend":
		return "suspended"
	case "terminate":
		return "terminated"
	default:
		return ""
	}
}

func contractFulfillmentStatusTargetStatus(action string) string {
	switch action {
	case "submit", "withdraw", "approve", "reject":
		return "not_started"
	case "mark_signed":
		return "in_progress"
	case "close_fulfillment":
		return "fulfilled"
	case "suspend":
		return "blocked"
	case "terminate":
		return "cancelled"
	default:
		return ""
	}
}

func contractActivationStatusTargetStatus(action string) string {
	switch action {
	case "submit", "withdraw", "reject":
		return "not_planned"
	case "approve", "mark_signed", "suspend":
		return "ready"
	case "close_fulfillment", "terminate":
		return "completed"
	default:
		return ""
	}
}

func contractStatusActionAllowed(action string, currentStatus string) bool {
	currentStatus = strings.TrimSpace(currentStatus)
	switch action {
	case "submit":
		return currentStatus == "draft" || currentStatus == "rejected"
	case "withdraw":
		return currentStatus == "pending_approval" || currentStatus == "under_review"
	case "approve", "reject":
		return currentStatus == "pending_approval"
	case "mark_signed":
		return currentStatus == "approved" || currentStatus == "signing" || currentStatus == "effective"
	case "close_fulfillment":
		return currentStatus == "effective" || currentStatus == "suspended"
	case "suspend":
		return currentStatus == "effective"
	case "terminate":
		return currentStatus != "terminated" && currentStatus != "invalid" && currentStatus != "closed"
	default:
		return false
	}
}

func contractLifecycleStatus(contract map[string]any) string {
	legalStatus := altocMapText(contract, "legal_status")
	if legalStatus != "" {
		return legalStatus
	}
	return altocMapText(contract, "status")
}

func contractStatusActionAlreadyApplied(action string, contract map[string]any) bool {
	legacyStatus := altocMapText(contract, "status")
	legalStatus := altocMapText(contract, "legal_status")
	if legalStatus == "" {
		return legacyStatus == contractStatusTargetStatus(action)
	}
	switch action {
	case "submit":
		return legalStatus == "pending_approval" && legacyStatus == "pending_approval"
	case "withdraw":
		return legalStatus == "draft" && legacyStatus == "draft"
	case "approve":
		return legalStatus == "approved" && legacyStatus == "approved"
	case "reject":
		return legalStatus == "draft" && legacyStatus == "rejected"
	case "mark_signed":
		return legalStatus == "effective" && legacyStatus == "effective"
	case "close_fulfillment":
		return legalStatus == "closed" && altocMapText(contract, "fulfillment_status") == "fulfilled" && legacyStatus == "completed"
	case "suspend":
		return legalStatus == "suspended"
	case "terminate":
		return legalStatus == "terminated" && legacyStatus == "terminated"
	default:
		return false
	}
}

func contractCommandSummaryHasNoChanges(summary map[string]any) bool {
	for _, value := range summary {
		if numberValue(value, 0) != 0 {
			return false
		}
	}
	return true
}

func contractStatusSetParts(columns map[string]bool, action string, reason string, operator string) ([]string, []any, error) {
	targetStatus := contractStatusTargetStatus(action)
	if targetStatus == "" {
		return nil, nil, httperror.New(http.StatusBadRequest, "invalid_status_action", "action must be submit, withdraw, approve, reject, mark_signed, close_fulfillment, suspend, or terminate")
	}

	set := make([]string, 0, 12)
	args := make([]any, 0, 10)
	if columns["status"] {
		set = append(set, "`status` = ?")
		args = append(args, targetStatus)
	}
	if columns["legal_status"] {
		set = append(set, "`legal_status` = ?")
		args = append(args, contractLegalStatusTargetStatus(action))
	}
	if columns["fulfillment_status"] {
		set = append(set, "`fulfillment_status` = ?")
		args = append(args, contractFulfillmentStatusTargetStatus(action))
	}
	if columns["activation_status"] {
		set = append(set, "`activation_status` = ?")
		args = append(args, contractActivationStatusTargetStatus(action))
	}
	switch action {
	case "submit", "withdraw":
		for _, column := range []string{"approved_at", "approved_by", "rejected_at", "rejected_by", "reject_reason"} {
			if columns[column] {
				set = append(set, "`"+column+"` = ?")
				args = append(args, nil)
			}
		}
	case "approve":
		if columns["approved_at"] {
			set = append(set, "`approved_at` = CURRENT_TIMESTAMP")
		}
		if columns["approved_by"] {
			set = append(set, "`approved_by` = ?")
			args = append(args, operator)
		}
		for _, column := range []string{"rejected_at", "rejected_by", "reject_reason"} {
			if columns[column] {
				set = append(set, "`"+column+"` = ?")
				args = append(args, nil)
			}
		}
	case "reject":
		if columns["rejected_at"] {
			set = append(set, "`rejected_at` = CURRENT_TIMESTAMP")
		}
		if columns["rejected_by"] {
			set = append(set, "`rejected_by` = ?")
			args = append(args, operator)
		}
		if columns["reject_reason"] {
			set = append(set, "`reject_reason` = ?")
			args = append(args, nullableText(reason))
		}
		for _, column := range []string{"approved_at", "approved_by"} {
			if columns[column] {
				set = append(set, "`"+column+"` = ?")
				args = append(args, nil)
			}
		}
	case "mark_signed":
		if columns["effective_date"] {
			set = append(set, "`effective_date` = COALESCE(`effective_date`, CURRENT_DATE)")
		}
		if columns["financial_status"] {
			set = append(set, "`financial_status` = CASE WHEN `financial_status` = 'unplanned' THEN 'planned' ELSE `financial_status` END")
		}
	case "close_fulfillment":
		if columns["completed_at"] {
			set = append(set, "`completed_at` = CURRENT_TIMESTAMP")
		}
	case "suspend":
	case "terminate":
		if columns["terminated_at"] {
			set = append(set, "`terminated_at` = CURRENT_TIMESTAMP")
		}
	default:
		return nil, nil, httperror.New(http.StatusBadRequest, "invalid_status_action", "action must be submit, withdraw, approve, reject, mark_signed, close_fulfillment, suspend, or terminate")
	}
	if columns["lock_version"] {
		set = append(set, "`lock_version` = `lock_version` + 1")
	}
	if columns["last_status_changed_at"] {
		set = append(set, "`last_status_changed_at` = CURRENT_TIMESTAMP")
	}
	if columns["last_status_changed_by"] {
		set = append(set, "`last_status_changed_by` = ?")
		args = append(args, operator)
	}
	if columns["updated_by"] {
		set = append(set, "`updated_by` = ?")
		args = append(args, operator)
	}
	if columns["updated_at"] {
		set = append(set, "`updated_at` = CURRENT_TIMESTAMP")
	}
	if len(set) == 0 {
		return nil, nil, httperror.New(http.StatusBadRequest, "empty_record", "No writable fields provided")
	}
	return set, args, nil
}

func contractSubmissionIssues(contract map[string]any) []string {
	issues := make([]string, 0, 3)
	if moneyValue(contract["amount_tax_inclusive"]) <= 0 {
		issues = append(issues, "amount_tax_inclusive")
	}
	if altocMapText(contract, "customer_id") == "" {
		issues = append(issues, "customer_id")
	}
	if altocMapText(contract, "sign_date") == "" {
		issues = append(issues, "sign_date")
	}
	return issues
}

func (a *Adapter) validateContractCompletionTx(ctx context.Context, tx *sql.Tx, contract map[string]any) error {
	_, completed, err := contractCompletedStagesTx(ctx, tx, altocPositiveID(contract["id"]), altocMapText(contract, "status"))
	if err != nil {
		return err
	}
	if !completed["service_end"] {
		return httperror.New(http.StatusConflict, "missing_service_end_stage", "service_end stage must be completed before completing contract")
	}
	summary, err := a.contractFinancialSummaryForTx(ctx, tx, contract, moneyValue(contract["amount_tax_inclusive"]))
	if err != nil {
		return err
	}
	if summary.ReceivablePlanCount == 0 && moneyPositive(summary.ContractAmount) {
		return httperror.New(http.StatusConflict, "missing_receivable_plan", "contract has no receivable plan")
	}
	if moneyPositive(summary.OutstandingAmount) {
		return httperror.New(http.StatusConflict, "contract_receivable_outstanding", "contract still has outstanding receivable")
	}
	return nil
}

func contractStageType(body map[string]any) (string, error) {
	stageType := strings.TrimSpace(firstBodyText(body, "stage_type", "stageType"))
	if contractStageLabels[stageType] == "" {
		return "", httperror.New(http.StatusBadRequest, "invalid_contract_stage", "stage_type is invalid")
	}
	return stageType, nil
}

func contractStageDate(body map[string]any) (any, error) {
	value := strings.TrimSpace(firstBodyText(body, "stage_date", "stageDate"))
	if value == "" {
		return nil, nil
	}
	if len(value) >= 10 {
		value = value[:10]
	}
	if _, err := time.Parse("2006-01-02", value); err != nil {
		return nil, httperror.New(http.StatusBadRequest, "invalid_stage_date", "stage_date is invalid")
	}
	return value, nil
}

func contractCompletedStagesTx(ctx context.Context, tx *sql.Tx, contractID int64, currentStatus string) (map[string]bool, map[string]bool, error) {
	rows, err := altocQueryMaps(ctx, tx, `
		SELECT stage_type
		FROM contract_stage
		WHERE contract_id = ?
		  AND status = 'completed'
		FOR UPDATE
	`, contractID)
	if err != nil {
		return nil, nil, err
	}
	actual := map[string]bool{}
	completed := map[string]bool{}
	for _, row := range rows {
		stageType := altocMapText(row, "stage_type")
		if stageType == "" {
			continue
		}
		actual[stageType] = true
		completed[stageType] = true
	}
	for _, stageType := range contractImpliedCompletedStages(currentStatus) {
		completed[stageType] = true
	}
	return actual, completed, nil
}

func contractImpliedCompletedStages(status string) []string {
	switch strings.TrimSpace(status) {
	case "effective", "executing":
		return []string{"contract_signed"}
	case "delivering":
		return []string{"contract_signed", "delivery"}
	case "accepted":
		return []string{"contract_signed", "delivery", "acceptance"}
	case "service_ended", "expired":
		return []string{"contract_signed", "delivery", "acceptance", "service_end"}
	default:
		return nil
	}
}

func contractStageActionAllowed(stageType string, currentStatus string, completed map[string]bool) bool {
	currentStatus = strings.TrimSpace(currentStatus)
	if currentStatus == "completed" || currentStatus == "terminated" || currentStatus == "invalid" {
		return false
	}
	switch stageType {
	case "contract_signed":
		return currentStatus == "approved" || contractIsRuntimeActive(currentStatus)
	case "delivery":
		return contractIsRuntimeActive(currentStatus) && completed["contract_signed"]
	case "acceptance":
		return contractIsRuntimeActive(currentStatus) && completed["contract_signed"] && completed["delivery"]
	case "service_end":
		return contractIsRuntimeActive(currentStatus) && completed["contract_signed"] && completed["delivery"] && completed["acceptance"]
	default:
		return false
	}
}

func contractStageTargetStatus(stageType string) string {
	if contractStageLabels[stageType] == "" {
		return ""
	}
	return "effective"
}

func contractIsRuntimeActive(status string) bool {
	switch strings.TrimSpace(status) {
	case "effective", "executing", "delivering", "accepted", "service_ended", "expired":
		return true
	default:
		return false
	}
}

func updateContractForCompletedStageTx(ctx context.Context, tx *sql.Tx, contract map[string]any, stageType string, stageDate any, targetStatus string, operator string) error {
	set := []string{
		"`updated_by` = ?",
		"`updated_at` = CURRENT_TIMESTAMP",
	}
	args := []any{operator}
	if targetStatus != "" && targetStatus != altocMapText(contract, "status") {
		set = append([]string{
			"`status` = ?",
			"`last_status_changed_at` = CURRENT_TIMESTAMP",
			"`last_status_changed_by` = ?",
		}, set...)
		args = append([]any{targetStatus, operator}, args...)
	}
	if stageType == "contract_signed" && stageDate != nil {
		set = append(set, "`effective_date` = COALESCE(`effective_date`, ?)")
		args = append(args, stageDate)
	}
	args = append(args, contract["id"])
	_, err := tx.ExecContext(ctx, "UPDATE contract SET "+strings.Join(set, ", ")+" WHERE id = ?", args...)
	return err
}

func contractStageAuditAction(statusChanged bool) string {
	if statusChanged {
		return "status_change"
	}
	return "stage_complete"
}

func (a *Adapter) lockContractTx(ctx context.Context, tx *sql.Tx, contractID int64) (map[string]any, error) {
	return altocQueryOneMap(ctx, tx, `
		SELECT
		  ct.*,
		  cu.code AS customer_code,
		  cu.name AS customer_name
		FROM contract ct
		LEFT JOIN customer cu ON cu.id = ct.customer_id
		WHERE ct.id = ?
		  AND ct.deleted_at IS NULL
		LIMIT 1
		FOR UPDATE
	`, contractID)
}
