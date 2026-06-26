package altoc

import (
	"context"
	"database/sql"
	"encoding/json"
	"fmt"
	"math"
	"net/http"
	"strings"

	"github.com/huizhi-yun/data-runtime/internal/httperror"
)

func (a *Adapter) changeContractObligationStatus(ctx context.Context, identifier string, body map[string]any) (map[string]any, error) {
	obligationID, err := altocIdentifierID(identifier, "contract_obligation_id")
	if err != nil {
		return nil, err
	}
	action := strings.TrimSpace(firstBodyText(body, "action"))
	if !contractObligationActionKnown(action) {
		return nil, httperror.New(http.StatusBadRequest, "invalid_obligation_action", "action must be start, submit, accept, or reject")
	}
	if err := altocRequireActionScope(body, "contract", "edit"); err != nil {
		return nil, err
	}

	tx, err := a.DB().BeginTx(ctx, nil)
	if err != nil {
		return nil, err
	}
	defer tx.Rollback()

	obligation, contract, err := a.lockObligationAndContractTx(ctx, tx, obligationID)
	if err != nil {
		return nil, err
	}
	if obligation == nil || contract == nil {
		return nil, httperror.New(http.StatusNotFound, "record_not_found", "contract obligation not found")
	}
	if err := altocRequireRecordWrite(body, "contract", contract, "owner_user_id", "owner_dept_code"); err != nil {
		return nil, err
	}

	currentStatus := altocMapText(obligation, "status")
	if !contractObligationActionAllowed(action, currentStatus) {
		return nil, httperror.New(http.StatusConflict, "invalid_obligation_status", "contract obligation status does not allow this action")
	}
	rejectReason := firstBodyText(body, "reason", "reject_reason", "rejectReason")
	if action == "reject" && rejectReason == "" {
		return nil, httperror.New(http.StatusBadRequest, "missing_reject_reason", "reject reason is required")
	}

	operator := altocActor(body)
	targetStatus := contractObligationTargetStatus(action, altocBool(fmt.Sprint(obligation["acceptance_required"])))
	set := []string{"`status` = ?", "`version_no` = `version_no` + 1", "`updated_by` = ?", "`updated_at` = CURRENT_TIMESTAMP"}
	args := []any{targetStatus, operator}
	evidenceNote := firstBodyText(body, "evidence_note", "evidenceNote")
	evidenceDocumentUUID := firstBodyText(body, "evidence_document_uuid", "evidenceDocumentUuid", "document_uuid", "documentUuid")

	switch action {
	case "start":
		set = append(set, "`rejected_at` = NULL", "`reject_reason` = NULL")
	case "submit":
		set = append(set, "`submitted_at` = CURRENT_TIMESTAMP")
		if targetStatus == "completed" {
			set = append(set, "`actual_completed_at` = COALESCE(`actual_completed_at`, CURRENT_TIMESTAMP)")
		}
	case "accept":
		set = append(set, "`accepted_at` = CURRENT_TIMESTAMP", "`actual_completed_at` = COALESCE(`actual_completed_at`, CURRENT_TIMESTAMP)", "`rejected_at` = NULL", "`reject_reason` = NULL")
	case "reject":
		set = append(set, "`rejected_at` = CURRENT_TIMESTAMP", "`reject_reason` = ?")
		args = append(args, rejectReason)
	}
	if evidenceNote != "" {
		set = append(set, "`evidence_note` = ?")
		args = append(args, evidenceNote)
	}
	if evidenceDocumentUUID != "" {
		set = append(set, "`evidence_document_uuid` = ?")
		args = append(args, evidenceDocumentUUID)
	}
	args = append(args, obligationID)
	if _, err := tx.ExecContext(ctx, "UPDATE contract_obligation SET "+strings.Join(set, ", ")+" WHERE id = ?", args...); err != nil {
		return nil, err
	}

	billableSchedules, err := markBillingSchedulesForObligationTx(ctx, tx, obligationID, action, operator)
	if err != nil {
		return nil, err
	}
	fulfillmentStatus, err := a.updateContractFulfillmentStatusTx(ctx, tx, contract["id"], operator)
	if err != nil {
		return nil, err
	}
	if err := insertAltocAuditTx(ctx, tx, "contract_obligation", obligationID, "status_change", map[string]any{
		"status": currentStatus,
	}, map[string]any{
		"status":                     targetStatus,
		"action":                     action,
		"billable_schedule_count":    billableSchedules,
		"contract_fulfillment_state": fulfillmentStatus,
	}, operator); err != nil {
		return nil, err
	}
	if err := insertContractDomainEventTx(ctx, tx, contractDomainEventKey("contract.obligation", obligationID, action, currentStatus, targetStatus, altocMapText(obligation, "version_no")), "ContractObligationStatusChanged", "contract_obligation", obligationID, map[string]any{
		"contract_id":                contract["id"],
		"contract_code":              contract["code"],
		"obligation_id":              obligationID,
		"obligation_code":            obligation["code"],
		"old_status":                 currentStatus,
		"new_status":                 targetStatus,
		"action":                     action,
		"billable_schedule_count":    billableSchedules,
		"contract_fulfillment_state": fulfillmentStatus,
	}, operator); err != nil {
		return nil, err
	}
	if err := tx.Commit(); err != nil {
		return nil, err
	}

	updated, err := a.getContract(ctx, fmt.Sprint(contract["id"]))
	if err != nil {
		return nil, err
	}
	return map[string]any{
		"contract":                updated,
		"obligationId":            obligationID,
		"obligation_id":           obligationID,
		"status":                  targetStatus,
		"billableScheduleCount":   billableSchedules,
		"billable_schedule_count": billableSchedules,
	}, nil
}

func (a *Adapter) contractObligations(ctx context.Context, conn altocQueryer, contractID any) ([]map[string]any, error) {
	rows, err := conn.QueryContext(ctx, `
		SELECT *
		FROM contract_obligation
		WHERE contract_id = ?
		  AND deleted_at IS NULL
		ORDER BY sort_no ASC, id ASC
	`, contractID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	return altocRowsToMaps(rows)
}

func (a *Adapter) contractBillingSchedules(ctx context.Context, conn altocQueryer, contractID any) ([]map[string]any, error) {
	rows, err := conn.QueryContext(ctx, `
		SELECT
		  bs.*,
		  ob.code AS obligation_code,
		  ob.name AS obligation_name,
		  ob.status AS obligation_status,
		  cl.code AS contract_line_code,
		  cl.name AS contract_line_name
		FROM contract_billing_schedule bs
		LEFT JOIN contract_obligation ob ON ob.id = bs.obligation_id
		LEFT JOIN contract_line cl ON cl.id = bs.contract_line_id
		WHERE bs.contract_id = ?
		  AND bs.deleted_at IS NULL
		ORDER BY bs.expected_date ASC, bs.id ASC
	`, contractID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	return altocRowsToMaps(rows)
}

func contractObligationSummary(obligations []map[string]any) map[string]any {
	summary := map[string]any{
		"total_count":       len(obligations),
		"not_started_count": 0,
		"in_progress_count": 0,
		"submitted_count":   0,
		"accepted_count":    0,
		"completed_count":   0,
		"rejected_count":    0,
		"blocked_count":     0,
		"done_count":        0,
		"open_count":        0,
	}
	doneStatuses := map[string]bool{"accepted": true, "completed": true, "waived": true, "cancelled": true}
	for _, obligation := range obligations {
		status := altocMapText(obligation, "status")
		key := status + "_count"
		if _, ok := summary[key]; ok {
			summary[key] = numberValue(summary[key], 0) + 1
		}
		if doneStatuses[status] {
			summary["done_count"] = numberValue(summary["done_count"], 0) + 1
		} else {
			summary["open_count"] = numberValue(summary["open_count"], 0) + 1
		}
	}
	return summary
}

func contractBillingScheduleSummary(schedules []map[string]any, contractAmount any) map[string]any {
	total := 0.0
	billable := 0.0
	planned := 0.0
	for _, schedule := range schedules {
		amount := moneyValue(schedule["amount"])
		total += amount
		switch altocMapText(schedule, "status") {
		case "billable":
			billable += amount
		case "planned":
			planned += amount
		}
	}
	contractAmountValue := moneyValue(contractAmount)
	return map[string]any{
		"schedule_count":          len(schedules),
		"amount":                  moneyText(total),
		"planned_amount":          moneyText(planned),
		"billable_amount":         moneyText(billable),
		"amount_difference":       moneyText(contractAmountValue - total),
		"amount_matches_contract": !moneyPositive(contractAmountValue) || math.Abs(contractAmountValue-total) <= contractAmountEpsilon,
	}
}

func (a *Adapter) lockObligationAndContractTx(ctx context.Context, tx *sql.Tx, obligationID int64) (map[string]any, map[string]any, error) {
	obligation, err := altocQueryOneMap(ctx, tx, `
		SELECT *
		FROM contract_obligation
		WHERE id = ?
		  AND deleted_at IS NULL
		LIMIT 1
		FOR UPDATE
	`, obligationID)
	if err != nil || obligation == nil {
		return obligation, nil, err
	}
	contract, err := a.lockContractTx(ctx, tx, altocPositiveID(obligation["contract_id"]))
	return obligation, contract, err
}

func contractObligationActionKnown(action string) bool {
	switch strings.TrimSpace(action) {
	case "start", "submit", "accept", "reject":
		return true
	default:
		return false
	}
}

func contractObligationActionAllowed(action string, currentStatus string) bool {
	currentStatus = strings.TrimSpace(currentStatus)
	switch action {
	case "start":
		return currentStatus == "not_started" || currentStatus == "rejected" || currentStatus == "blocked"
	case "submit":
		return currentStatus == "in_progress" || currentStatus == "rejected"
	case "accept":
		return currentStatus == "submitted" || currentStatus == "completed"
	case "reject":
		return currentStatus == "submitted"
	default:
		return false
	}
}

func contractObligationTargetStatus(action string, acceptanceRequired bool) string {
	switch action {
	case "start":
		return "in_progress"
	case "submit":
		if acceptanceRequired {
			return "submitted"
		}
		return "completed"
	case "accept":
		return "accepted"
	case "reject":
		return "rejected"
	default:
		return ""
	}
}

func markBillingSchedulesForObligationTx(ctx context.Context, tx *sql.Tx, obligationID int64, action string, operator string) (int64, error) {
	triggerTypes := []string{}
	switch action {
	case "submit":
		triggerTypes = []string{"obligation_completed"}
	case "accept":
		triggerTypes = []string{"obligation_completed", "obligation_accepted"}
	default:
		return 0, nil
	}
	placeholders := make([]string, 0, len(triggerTypes))
	args := make([]any, 0, len(triggerTypes)+2)
	args = append(args, operator, obligationID)
	for _, triggerType := range triggerTypes {
		placeholders = append(placeholders, "?")
		args = append(args, triggerType)
	}
	result, err := tx.ExecContext(ctx, `
		UPDATE contract_billing_schedule
		SET status = 'billable',
		    updated_by = ?,
		    updated_at = CURRENT_TIMESTAMP
		WHERE obligation_id = ?
		  AND status = 'planned'
		  AND deleted_at IS NULL
		  AND trigger_type IN (`+strings.Join(placeholders, ", ")+`)
	`, args...)
	if err != nil {
		return 0, err
	}
	affected, _ := result.RowsAffected()
	return affected, nil
}

func (a *Adapter) ensureContractObligationBillingPlanTx(ctx context.Context, tx *sql.Tx, contract map[string]any, operator string) (map[string]any, error) {
	contractID := altocPositiveID(contract["id"])
	if contractID <= 0 {
		return map[string]any{"generated_obligations": int64(0), "generated_billing_schedules": int64(0)}, nil
	}
	lines, err := a.contractLines(ctx, tx, contractID)
	if err != nil {
		return nil, err
	}
	generatedObligations := int64(0)
	generatedSchedules := int64(0)
	for _, line := range lines {
		inserted, err := insertDefaultObligationsForLineTx(ctx, tx, contract, line, operator)
		if err != nil {
			return nil, err
		}
		generatedObligations += inserted
		insertedSchedules, err := insertDefaultBillingScheduleForLineTx(ctx, tx, contract, line, operator)
		if err != nil {
			return nil, err
		}
		generatedSchedules += insertedSchedules
	}
	legacySchedules, err := insertBillingSchedulesForLegacyPaymentTermsTx(ctx, tx, contract, operator)
	if err != nil {
		return nil, err
	}
	generatedSchedules += legacySchedules
	return map[string]any{
		"generated_obligations":       generatedObligations,
		"generated_billing_schedules": generatedSchedules,
	}, nil
}

func insertDefaultObligationsForLineTx(ctx context.Context, tx *sql.Tx, contract map[string]any, line map[string]any, operator string) (int64, error) {
	inserted := int64(0)
	deliveryCode := fmt.Sprintf("OB-CL-%v-DELIVERY", line["id"])
	result, err := tx.ExecContext(ctx, `
		INSERT IGNORE INTO contract_obligation (
		  code, contract_id, contract_line_id, obligation_type, name, description,
		  fulfillment_method, planned_start_at, planned_due_at, acceptance_required,
		  acceptance_criteria, status, owner_user_id, source_type, source_ref_id,
		  source_ref_code, sort_no, snapshot_json, created_by, updated_by
		) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 0, NULL, 'not_started', ?, 'contract_line', ?, ?, ?, ?, ?, ?)
	`,
		deliveryCode,
		contract["id"],
		line["id"],
		defaultObligationTypeForLine(line),
		firstNonEmptyText(altocMapText(line, "name")+"交付", "合同交付"),
		nullableText(altocMapText(line, "description")),
		nullableText(altocMapText(line, "fulfillment_method")),
		dateTimeStartOfDay(line["service_start_date"]),
		dateTimeEndOfDay(line["service_end_date"]),
		nullableText(altocMapText(contract, "owner_user_id")),
		line["id"],
		nullableText(altocMapText(line, "code")),
		altocPositiveID(line["sort_no"])*10+1,
		jsonColumnText(map[string]any{"line_code": line["code"], "line_type": line["line_type"], "generated_by": "p0b_domain_command"}),
		nullableText(operator),
		nullableText(operator),
	)
	if err != nil {
		return 0, err
	}
	affected, _ := result.RowsAffected()
	inserted += affected
	if !altocBool(fmt.Sprint(line["acceptance_required"])) {
		return inserted, nil
	}
	acceptCode := fmt.Sprintf("OB-CL-%v-ACCEPT", line["id"])
	result, err = tx.ExecContext(ctx, `
		INSERT IGNORE INTO contract_obligation (
		  code, contract_id, contract_line_id, obligation_type, name, description,
		  fulfillment_method, planned_start_at, planned_due_at, acceptance_required,
		  acceptance_criteria, status, owner_user_id, source_type, source_ref_id,
		  source_ref_code, sort_no, snapshot_json, created_by, updated_by
		) VALUES (?, ?, ?, 'acceptance', ?, ?, ?, NULL, ?, 1, ?, 'not_started', ?, 'contract_line', ?, ?, ?, ?, ?, ?)
	`,
		acceptCode,
		contract["id"],
		line["id"],
		firstNonEmptyText(altocMapText(line, "name")+"验收", "合同验收"),
		nullableText(altocMapText(line, "description")),
		nullableText(altocMapText(line, "fulfillment_method")),
		dateTimeEndOfDay(line["service_end_date"]),
		nullableText(altocMapText(line, "acceptance_criteria")),
		nullableText(altocMapText(contract, "owner_user_id")),
		line["id"],
		nullableText(altocMapText(line, "code")),
		altocPositiveID(line["sort_no"])*10+2,
		jsonColumnText(map[string]any{"line_code": line["code"], "line_type": line["line_type"], "generated_by": "p0b_domain_command", "acceptance_required": true}),
		nullableText(operator),
		nullableText(operator),
	)
	if err != nil {
		return 0, err
	}
	affected, _ = result.RowsAffected()
	return inserted + affected, nil
}

func insertDefaultBillingScheduleForLineTx(ctx context.Context, tx *sql.Tx, contract map[string]any, line map[string]any, operator string) (int64, error) {
	amount := moneyValue(line["amount_tax_inclusive"])
	if !moneyPositive(amount) {
		return 0, nil
	}
	acceptanceRequired := altocBool(fmt.Sprint(line["acceptance_required"]))
	obligationCode := fmt.Sprintf("OB-CL-%v-DELIVERY", line["id"])
	triggerType := "obligation_completed"
	if acceptanceRequired {
		obligationCode = fmt.Sprintf("OB-CL-%v-ACCEPT", line["id"])
		triggerType = "obligation_accepted"
	}
	obligation, err := altocQueryOneMap(ctx, tx, `
		SELECT id, code
		FROM contract_obligation
		WHERE code = ?
		  AND deleted_at IS NULL
		LIMIT 1
	`, obligationCode)
	if err != nil {
		return 0, err
	}
	result, err := tx.ExecContext(ctx, `
		INSERT IGNORE INTO contract_billing_schedule (
		  code, contract_id, contract_line_id, obligation_id, direction, name,
		  trigger_type, trigger_ref_code, amount, ratio, currency_code, expected_date,
		  invoice_required, status, source_type, source_ref_id, source_ref_code,
		  snapshot_json, created_by, updated_by
		) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, 'planned', 'contract_line', ?, ?, ?, ?, ?)
	`,
		fmt.Sprintf("BS-CL-%v", line["id"]),
		contract["id"],
		line["id"],
		nullableBodyValue(obligation["id"]),
		contractBillingDirection(contract),
		firstNonEmptyText(altocMapText(line, "name")+"结算", "合同结算"),
		triggerType,
		nullableText(altocMapText(obligation, "code")),
		moneyText(amount),
		billingRatio(contract, amount),
		firstNonEmptyText(altocMapText(line, "currency_code"), altocMapText(contract, "currency_code"), "CNY"),
		altocDateText(altocMapText(line, "service_end_date")),
		line["id"],
		nullableText(altocMapText(line, "code")),
		jsonColumnText(map[string]any{"line_code": line["code"], "billing_method": line["billing_method"], "generated_by": "p0b_domain_command"}),
		nullableText(operator),
		nullableText(operator),
	)
	if err != nil {
		return 0, err
	}
	affected, _ := result.RowsAffected()
	return affected, nil
}

func insertBillingSchedulesForLegacyPaymentTermsTx(ctx context.Context, tx *sql.Tx, contract map[string]any, operator string) (int64, error) {
	exists, err := altocTableExists(ctx, tx, "contract_payment_term")
	if err != nil || !exists {
		return 0, err
	}
	receivablePlanExists, err := altocTableExists(ctx, tx, "receivable_plan")
	if err != nil {
		return 0, err
	}
	receivablePlanColumns := map[string]bool{}
	if receivablePlanExists {
		receivablePlanColumns, err = altocTableColumns(ctx, tx, "receivable_plan")
		if err != nil {
			return 0, err
		}
	}
	financePlanCodeExpr, receivablePlanJoin := legacyPaymentTermReceivablePlanSQLParts(receivablePlanExists, receivablePlanColumns)
	result, err := tx.ExecContext(ctx, `
		INSERT IGNORE INTO contract_billing_schedule (
		  code, contract_id, contract_line_id, obligation_id, direction, name,
		  trigger_type, trigger_ref_code, amount, ratio, currency_code, expected_date,
		  recurrence_rule_json, invoice_required, status, finance_plan_code,
		  source_type, source_ref_id, source_ref_code, snapshot_json, created_by, updated_by
		)
		SELECT
		  CONCAT('BS-CPT-', cpt.id),
		  cpt.contract_id,
		  NULL,
		  (
		    SELECT ob.id
		    FROM contract_obligation ob
		    WHERE ob.contract_id = cpt.contract_id
		      AND ob.deleted_at IS NULL
		      AND (
		        (cpt.trigger_stage_type = 'contract_signed' AND ob.obligation_type = 'contract_effective') OR
		        (cpt.trigger_stage_type = 'delivery' AND ob.obligation_type IN ('delivery', 'service_delivery', 'goods_delivery')) OR
		        (cpt.trigger_stage_type = 'acceptance' AND ob.obligation_type = 'acceptance') OR
		        (cpt.trigger_stage_type = 'service_end' AND ob.obligation_type = 'service_period_end')
		      )
		    ORDER BY ob.sort_no ASC, ob.id ASC
		    LIMIT 1
		  ),
		  ?,
		  cpt.term_name,
		  CASE
		    WHEN cpt.trigger_stage_type = 'contract_signed' THEN 'contract_effective'
		    WHEN cpt.trigger_stage_type = 'delivery' THEN 'obligation_completed'
		    WHEN cpt.trigger_stage_type IN ('acceptance', 'service_end') THEN 'obligation_accepted'
		    WHEN cpt.expected_date IS NOT NULL THEN 'fixed_date'
		    ELSE 'manual_approval'
		  END,
		  cpt.trigger_stage_type,
		  cpt.amount,
		  cpt.ratio,
		  COALESCE(?, 'CNY'),
		  cpt.expected_date,
		  CASE
		    WHEN cpt.recurrence_interval IS NULL THEN NULL
		    ELSE JSON_OBJECT(
		      'interval', cpt.recurrence_interval,
		      'month', cpt.recurrence_month,
		      'day', cpt.recurrence_day,
		      'service_start_date', cpt.service_start_date,
		      'service_end_date', cpt.service_end_date
		    )
		  END,
		  1,
		  'planned',
		  `+financePlanCodeExpr+`,
		  'legacy_payment_term',
		  cpt.id,
		  CAST(cpt.id AS CHAR),
		  JSON_OBJECT(
		    'term_type', cpt.term_type,
		    'billing_mode', cpt.billing_mode,
		    'condition_desc', cpt.condition_desc,
		    'generated_by', 'p0b_domain_command'
		  ),
		  ?,
		  ?
		FROM contract_payment_term cpt
		`+receivablePlanJoin+`
		WHERE cpt.contract_id = ?
	`,
		contractBillingDirection(contract),
		firstNonEmptyText(altocMapText(contract, "currency_code"), "CNY"),
		nullableText(operator),
		nullableText(operator),
		contract["id"],
	)
	if err != nil {
		return 0, err
	}
	affected, _ := result.RowsAffected()
	return affected, nil
}

func legacyPaymentTermReceivablePlanSQLParts(receivablePlanExists bool, columns map[string]bool) (string, string) {
	if !receivablePlanExists || !columns["payment_term_id"] || !columns["code"] {
		return "NULL", ""
	}
	deletedFilter := ""
	if columns["deleted_at"] {
		deletedFilter = " AND rp.deleted_at IS NULL"
	}
	return "rp.code", "LEFT JOIN receivable_plan rp ON rp.payment_term_id = cpt.id" + deletedFilter
}

func defaultObligationTypeForLine(line map[string]any) string {
	switch altocMapText(line, "line_type") {
	case "maintenance_service", "subscription", "cloud_service":
		return "service_delivery"
	case "hardware", "third_party_product":
		return "goods_delivery"
	default:
		return "delivery"
	}
}

func contractBillingDirection(contract map[string]any) string {
	if altocMapText(contract, "direction") == "purchase" {
		return "payable"
	}
	return "receivable"
}

func billingRatio(contract map[string]any, amount float64) any {
	contractAmount := moneyValue(contract["amount_tax_inclusive"])
	if !moneyPositive(contractAmount) {
		return nil
	}
	return fmt.Sprintf("%.4f", amount/contractAmount*100)
}

func dateTimeStartOfDay(value any) any {
	date := firstNonEmptyDate(value)
	if date == "" {
		return nil
	}
	return date + " 00:00:00"
}

func dateTimeEndOfDay(value any) any {
	date := firstNonEmptyDate(value)
	if date == "" {
		return nil
	}
	return date + " 23:59:59"
}

func (a *Adapter) updateContractFulfillmentStatusTx(ctx context.Context, tx *sql.Tx, contractID any, operator string) (string, error) {
	row, err := altocQueryOneMap(ctx, tx, `
		SELECT
		  COUNT(*) AS total_count,
		  COALESCE(SUM(CASE WHEN status = 'blocked' THEN 1 ELSE 0 END), 0) AS blocked_count,
		  COALESCE(SUM(CASE WHEN status IN ('accepted', 'completed', 'waived', 'cancelled') THEN 1 ELSE 0 END), 0) AS done_count,
		  COALESCE(SUM(CASE WHEN status IN ('in_progress', 'submitted', 'rejected') THEN 1 ELSE 0 END), 0) AS active_count
		FROM contract_obligation
		WHERE contract_id = ?
		  AND deleted_at IS NULL
	`, contractID)
	if err != nil {
		return "", err
	}
	total := numberValue(row["total_count"], 0)
	blocked := numberValue(row["blocked_count"], 0)
	done := numberValue(row["done_count"], 0)
	active := numberValue(row["active_count"], 0)
	status := "not_started"
	switch {
	case total == 0:
		status = "not_started"
	case blocked > 0:
		status = "blocked"
	case done >= total:
		status = "fulfilled"
	case done > 0:
		status = "partially_fulfilled"
	case active > 0:
		status = "in_progress"
	}
	columns, err := altocTableColumns(ctx, tx, "contract")
	if err != nil {
		return "", err
	}
	set := []string{"`updated_by` = ?", "`updated_at` = CURRENT_TIMESTAMP"}
	args := []any{operator}
	if columns["fulfillment_status"] {
		set = append([]string{"`fulfillment_status` = ?"}, set...)
		args = append([]any{status}, args...)
	}
	if columns["lock_version"] {
		set = append(set, "`lock_version` = `lock_version` + 1")
	}
	args = append(args, contractID)
	if _, err := tx.ExecContext(ctx, "UPDATE contract SET "+strings.Join(set, ", ")+" WHERE id = ?", args...); err != nil {
		return "", err
	}
	return status, nil
}

func (a *Adapter) validateFulfillmentCloseTx(ctx context.Context, tx *sql.Tx, contract map[string]any, operator string) error {
	if _, err := a.ensureContractObligationBillingPlanTx(ctx, tx, contract, operator); err != nil {
		return err
	}
	row, err := altocQueryOneMap(ctx, tx, `
		SELECT
		  COUNT(*) AS total_count,
		  COALESCE(SUM(CASE WHEN status NOT IN ('accepted', 'completed', 'waived', 'cancelled') THEN 1 ELSE 0 END), 0) AS open_count
		FROM contract_obligation
		WHERE contract_id = ?
		  AND deleted_at IS NULL
	`, contract["id"])
	if err != nil {
		return err
	}
	if numberValue(row["total_count"], 0) == 0 {
		return httperror.New(http.StatusConflict, "missing_contract_obligation", "contract has no fulfillment obligations")
	}
	if numberValue(row["open_count"], 0) > 0 {
		return httperror.New(http.StatusConflict, "open_contract_obligation", "contract has open fulfillment obligations")
	}
	return nil
}

func cancelOpenObligationsAndSchedulesTx(ctx context.Context, tx *sql.Tx, contractID any, operator string) (int64, int64, error) {
	obResult, err := tx.ExecContext(ctx, `
		UPDATE contract_obligation
		SET status = 'cancelled',
		    updated_by = ?,
		    updated_at = CURRENT_TIMESTAMP,
		    version_no = version_no + 1
		WHERE contract_id = ?
		  AND deleted_at IS NULL
		  AND status NOT IN ('accepted', 'completed', 'waived', 'cancelled')
	`, operator, contractID)
	if err != nil {
		return 0, 0, err
	}
	billingResult, err := tx.ExecContext(ctx, `
		UPDATE contract_billing_schedule
		SET status = 'cancelled',
		    updated_by = ?,
		    updated_at = CURRENT_TIMESTAMP
		WHERE contract_id = ?
		  AND deleted_at IS NULL
		  AND status IN ('planned', 'billable')
	`, operator, contractID)
	if err != nil {
		return 0, 0, err
	}
	obligations, _ := obResult.RowsAffected()
	schedules, _ := billingResult.RowsAffected()
	return obligations, schedules, nil
}

func insertContractDomainEventTx(ctx context.Context, tx *sql.Tx, eventKey string, eventType string, aggregateType string, aggregateID any, payload map[string]any, operator string) error {
	exists, err := altocTableExists(ctx, tx, "domain_event_outbox")
	if err != nil || !exists {
		return err
	}
	payloadJSON, _ := json.Marshal(payload)
	_, err = tx.ExecContext(ctx, `
		INSERT IGNORE INTO domain_event_outbox (
		  event_key, event_type, aggregate_type, aggregate_id, payload_json, created_by, updated_by
		) VALUES (?, ?, ?, ?, ?, ?, ?)
	`, eventKey, eventType, aggregateType, aggregateID, payloadJSON, nullableText(operator), nullableText(operator))
	return err
}

func contractDomainEventKey(prefix string, aggregateID any, parts ...string) string {
	segments := []string{"altoc", strings.TrimSpace(prefix), strings.TrimSpace(fmt.Sprint(aggregateID))}
	for _, part := range parts {
		normalized := strings.TrimSpace(strings.ToLower(part))
		if normalized == "" || normalized == "<nil>" {
			normalized = "_"
		}
		segments = append(segments, strings.ReplaceAll(normalized, " ", "_"))
	}
	return strings.Join(segments, ":")
}

func jsonColumnText(value map[string]any) string {
	encoded, err := json.Marshal(value)
	if err != nil {
		return "{}"
	}
	return string(encoded)
}
