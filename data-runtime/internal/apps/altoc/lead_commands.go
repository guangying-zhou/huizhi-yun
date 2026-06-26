package altoc

import (
	"context"
	"database/sql"
	"fmt"
	"net/http"
	"net/url"
	"sort"
	"strconv"
	"strings"
	"time"

	"github.com/huizhi-yun/data-runtime/internal/httperror"
)

var leadDetailUpdateFields = []string{
	"name",
	"org_name",
	"source_type",
	"source_detail",
	"need_summary",
	"project_type",
	"budget_status",
	"estimated_budget",
	"procurement_mode",
	"expected_procurement_date",
	"source_evidence_url",
	"contact_name",
	"contact_mobile",
	"contact_email",
	"next_action",
	"next_action_due_at",
	"remark",
}

func (a *Adapter) convertLead(ctx context.Context, identifier string, body map[string]any) (map[string]any, error) {
	leadID, err := altocIdentifierID(identifier, "lead_id")
	if err != nil {
		return nil, err
	}

	tx, err := a.DB().BeginTx(ctx, nil)
	if err != nil {
		return nil, err
	}
	defer tx.Rollback()

	lead, err := altocQueryOneMap(ctx, tx, `
		SELECT *
		FROM `+"`lead`"+`
		WHERE id = ?
		  AND deleted_at IS NULL
		LIMIT 1
		FOR UPDATE
	`, leadID)
	if err != nil {
		return nil, err
	}
	if lead == nil {
		return nil, httperror.New(http.StatusNotFound, "record_not_found", "lead not found")
	}

	operator := altocActor(body)
	if err := altocRequireRecordWrite(body, "lead", lead, "owner_user_id", "owner_dept_code"); err != nil {
		return nil, err
	}
	if err := altocRequireActionScope(body, "lead", "convert"); err != nil {
		return nil, err
	}
	status := altocMapText(lead, "status")
	if status == "closed_invalid" {
		return nil, httperror.New(http.StatusConflict, "lead_closed_invalid", "closed invalid lead cannot be converted")
	}
	if status == "converted" && altocPositiveID(lead["converted_opportunity_id"]) > 0 {
		result, err := a.leadConversionResultTx(ctx, tx, lead, true)
		if err != nil {
			return nil, err
		}
		if err := tx.Commit(); err != nil {
			return nil, err
		}
		return result, nil
	}

	if result, ok, err := a.leadConversionByIdempotencyKeyTx(ctx, tx, leadID, body); err != nil || ok {
		if err != nil {
			return nil, err
		}
		if err := tx.Commit(); err != nil {
			return nil, err
		}
		return result, nil
	}

	if err := validateLeadConversionQualification(lead, body, operator); err != nil {
		return nil, err
	}

	customer, customerReused, err := a.resolveLeadConversionCustomerTx(ctx, tx, lead, body, operator)
	if err != nil {
		return nil, err
	}
	contact, contactReused, err := a.resolveLeadConversionContactTx(ctx, tx, lead, body, customer, operator)
	if err != nil {
		return nil, err
	}
	stage, err := a.resolveLeadConversionStageTx(ctx, tx, body)
	if err != nil {
		return nil, err
	}
	if !opportunityStageAllowsInitialCreate(stage) {
		return nil, httperror.New(http.StatusBadRequest, "invalid_initial_stage", "initial opportunity stage must be an open active stage")
	}
	if err := a.requireLeadConversionSimilarOpportunityAckTx(ctx, tx, customer["id"], lead, body); err != nil {
		return nil, err
	}
	nextAction := firstNonEmptyText(altocBodyText(body, "next_action"), altocMapText(lead, "next_action"))
	nextActionDueAtText := firstNonEmptyText(altocBodyText(body, "next_action_due_at"), altocMapText(lead, "next_action_due_at"))
	if nextAction == "" || nextActionDueAtText == "" {
		return nil, httperror.New(http.StatusBadRequest, "missing_next_action", "next_action and next_action_due_at are required")
	}

	opportunityID, opportunityCode, err := a.createLeadOpportunityTx(ctx, tx, lead, customer, stage, body, operator)
	if err != nil {
		return nil, err
	}
	opportunitySnapshot, err := a.opportunityByIDTx(ctx, tx, opportunityID)
	if err != nil {
		return nil, err
	}
	if err := insertOpportunityStageLogTx(ctx, tx, opportunityID, nil, stage["id"], operator, firstNonEmptyText(firstBodyText(body, "changeReason", "change_reason"), "线索转商机"), opportunitySnapshot); err != nil {
		return nil, err
	}
	if err := a.recordOpportunityContactRoleTx(ctx, tx, opportunityID, contact, body, operator); err != nil {
		return nil, err
	}
	if err := a.attachLeadActivitiesToConversionTx(ctx, tx, leadID, customer["id"], contactIDOrNil(contact), opportunityID, operator); err != nil {
		return nil, err
	}
	if err := a.copyLeadAttachmentsToOpportunityTx(ctx, tx, leadID, opportunityID); err != nil {
		return nil, err
	}
	if err := a.copyLeadDocumentLinksToOpportunityTx(ctx, tx, leadID, opportunityID); err != nil {
		return nil, err
	}

	nextActionDueAt := altocDateTimeText(nextActionDueAtText)
	owner := firstNonEmptyText(altocBodyText(body, "owner_user_id"), altocMapText(lead, "owner_user_id"), operator)
	if err := insertAltocSalesTaskIfNeededTx(ctx, tx, "opportunity", opportunityID, nextAction, nextActionDueAt, owner, operator); err != nil {
		return nil, err
	}

	leadSet := []string{
		"status = 'converted'",
		"converted_customer_id = ?",
		"converted_opportunity_id = ?",
		"converted_at = CURRENT_TIMESTAMP",
	}
	leadArgs := []any{customer["id"], opportunityID}
	leadUpdates := leadConversionQualificationUpdates(body)
	scoreUpdates := make(map[string]any, len(leadUpdates)+1)
	for column, value := range leadUpdates {
		scoreUpdates[column] = value
	}
	scoreUpdates["status"] = "converted"
	leadUpdates["score"] = leadRuleScoreAfterUpdate(lead, scoreUpdates)
	for column, value := range leadUpdates {
		leadSet = append(leadSet, quoteAltocColumn(column)+" = ?")
		leadArgs = append(leadArgs, value)
	}
	leadSet = append(leadSet, "updated_by = ?", "updated_at = CURRENT_TIMESTAMP")
	leadArgs = append(leadArgs, operator, leadID)
	if _, err := tx.ExecContext(ctx, "UPDATE `lead` SET "+strings.Join(leadSet, ", ")+" WHERE id = ?", leadArgs...); err != nil {
		return nil, err
	}

	if err := a.recordLeadConversionTx(ctx, tx, leadID, customer["id"], contactIDOrNil(contact), opportunityID, body, operator); err != nil {
		return nil, err
	}
	if err := a.recordLeadConvertedOutboxTx(ctx, tx, leadID, customer["id"], contactIDOrNil(contact), opportunityID, customerReused, contactReused, body, operator); err != nil {
		return nil, err
	}
	if err := insertAltocAuditTx(ctx, tx, "lead", leadID, "status_change", map[string]any{
		"status": status,
	}, map[string]any{
		"status":                   "converted",
		"converted_customer_id":    customer["id"],
		"converted_contact_id":     contactIDOrNil(contact),
		"converted_opportunity_id": opportunityID,
	}, operator); err != nil {
		return nil, err
	}
	if err := insertAltocAuditTx(ctx, tx, "opportunity", opportunityID, "create", nil, map[string]any{
		"code":        opportunityCode,
		"name":        firstNonEmptyText(altocBodyText(body, "opportunity_name"), altocMapText(lead, "name")),
		"source":      "lead_convert",
		"lead_id":     leadID,
		"customer_id": customer["id"],
	}, operator); err != nil {
		return nil, err
	}

	updatedLead, err := altocQueryOneMap(ctx, tx, `
		SELECT *
		FROM `+"`lead`"+`
		WHERE id = ?
		LIMIT 1
	`, leadID)
	if err != nil {
		return nil, err
	}
	opportunity, err := a.opportunityByIDTx(ctx, tx, opportunityID)
	if err != nil {
		return nil, err
	}
	if err := tx.Commit(); err != nil {
		return nil, err
	}

	return map[string]any{
		"lead":               updatedLead,
		"customer":           customer,
		"contact":            contact,
		"opportunity":        opportunity,
		"lead_id":            leadID,
		"customer_id":        customer["id"],
		"contact_id":         contactIDOrNil(contact),
		"opportunity_id":     opportunityID,
		"customer_reused":    customerReused,
		"contact_reused":     contactReused,
		"opportunity_reused": false,
		"idempotent":         false,
	}, nil
}

func validateLeadConversionQualification(lead map[string]any, body map[string]any, operator string) error {
	customerID := altocPositiveID(firstNonEmptyText(altocBodyText(body, "customer_id"), altocBodyText(body, "customerId")))
	customerName := firstNonEmptyText(
		altocBodyText(body, "customer_name"),
		altocBodyText(body, "customerName"),
		altocMapText(lead, "org_name"),
		altocMapText(lead, "name"),
	)
	if customerID <= 0 && customerName == "" {
		return httperror.New(http.StatusBadRequest, "missing_customer", "customer_id or customer_name is required")
	}
	if firstNonEmptyText(altocBodyText(body, "need_summary"), altocMapText(lead, "need_summary")) == "" {
		return httperror.New(http.StatusBadRequest, "missing_need_summary", "need_summary is required before lead conversion")
	}
	hasContactOrEvidence := altocPositiveID(firstNonEmptyText(altocBodyText(body, "contact_id"), altocBodyText(body, "contactId"))) > 0 ||
		firstNonEmptyText(
			altocBodyText(body, "contact_name"),
			altocBodyText(body, "contactName"),
			altocBodyText(body, "contact_mobile"),
			altocBodyText(body, "contactMobile"),
			altocBodyText(body, "contact_email"),
			altocBodyText(body, "contactEmail"),
			altocMapText(lead, "contact_name"),
			altocMapText(lead, "contact_mobile"),
			altocMapText(lead, "contact_email"),
			altocBodyText(body, "source_evidence_url"),
			altocBodyText(body, "sourceEvidenceUrl"),
			altocMapText(lead, "source_evidence_url"),
		) != ""
	if !hasContactOrEvidence {
		return httperror.New(http.StatusBadRequest, "missing_contact_or_evidence", "contact or source_evidence_url is required before lead conversion")
	}
	if firstNonEmptyText(altocBodyText(body, "owner_user_id"), altocMapText(lead, "owner_user_id"), operator) == "" {
		return httperror.New(http.StatusBadRequest, "missing_owner_user_id", "owner_user_id is required")
	}
	if firstNonEmptyText(altocBodyText(body, "next_action"), altocMapText(lead, "next_action")) == "" ||
		firstNonEmptyText(altocBodyText(body, "next_action_due_at"), altocMapText(lead, "next_action_due_at")) == "" {
		return httperror.New(http.StatusBadRequest, "missing_next_action", "next_action and next_action_due_at are required")
	}
	return nil
}

func validateLeadCreateQualification(body map[string]any) error {
	if firstNonEmptyText(altocBodyText(body, "name")) == "" {
		return httperror.New(http.StatusBadRequest, "missing_lead_name", "name is required")
	}
	if firstNonEmptyText(altocBodyText(body, "org_name"), altocBodyText(body, "orgName")) == "" {
		return httperror.New(http.StatusBadRequest, "missing_customer", "org_name is required")
	}
	if firstNonEmptyText(altocBodyText(body, "source_type"), altocBodyText(body, "sourceType")) == "" {
		return httperror.New(http.StatusBadRequest, "missing_source_type", "source_type is required")
	}
	if firstNonEmptyText(altocBodyText(body, "need_summary"), altocBodyText(body, "needSummary")) == "" {
		return httperror.New(http.StatusBadRequest, "missing_need_summary", "need_summary is required")
	}
	hasContactOrEvidence := firstNonEmptyText(
		altocBodyText(body, "contact_name"),
		altocBodyText(body, "contactName"),
		altocBodyText(body, "contact_mobile"),
		altocBodyText(body, "contactMobile"),
		altocBodyText(body, "contact_email"),
		altocBodyText(body, "contactEmail"),
		altocBodyText(body, "source_evidence_url"),
		altocBodyText(body, "sourceEvidenceUrl"),
	) != ""
	if !hasContactOrEvidence {
		return httperror.New(http.StatusBadRequest, "missing_contact_or_evidence", "contact or source_evidence_url is required")
	}
	actor := altocActor(body)
	if actor == "system" {
		actor = ""
	}
	if firstNonEmptyText(altocBodyText(body, "owner_user_id"), altocBodyText(body, "ownerUserId"), actor) == "" {
		return httperror.New(http.StatusBadRequest, "missing_owner_user_id", "owner_user_id is required")
	}
	if firstNonEmptyText(altocBodyText(body, "next_action"), altocBodyText(body, "nextAction")) == "" ||
		firstNonEmptyText(altocBodyText(body, "next_action_due_at"), altocBodyText(body, "nextActionDueAt")) == "" {
		return httperror.New(http.StatusBadRequest, "missing_next_action", "next_action and next_action_due_at are required")
	}
	return nil
}

func (a *Adapter) createLead(ctx context.Context, body map[string]any) (map[string]any, error) {
	if err := validateLeadCreateQualification(body); err != nil {
		return nil, err
	}

	tx, err := a.DB().BeginTx(ctx, nil)
	if err != nil {
		return nil, err
	}
	defer tx.Rollback()

	code, err := nextAltocCode(ctx, tx, "LE", "lead")
	if err != nil {
		return nil, err
	}
	operator := altocActor(body)
	fields, err := leadCreateFields(body, operator, code)
	if err != nil {
		return nil, err
	}
	if err := altocRequireRecordWrite(body, "lead", fields, "owner_user_id", "owner_dept_code"); err != nil {
		return nil, err
	}
	leadID, err := altocInsertRecordTx(ctx, tx, "lead", fields)
	if err != nil {
		return nil, err
	}
	if err := insertAltocSalesTaskIfNeededTx(ctx, tx, "lead", leadID, fmt.Sprint(fields["next_action"]), fields["next_action_due_at"], fmt.Sprint(fields["owner_user_id"]), operator); err != nil {
		return nil, err
	}
	if err := insertAltocAuditTx(ctx, tx, "lead", leadID, "create", nil, map[string]any{
		"code":            code,
		"name":            fields["name"],
		"org_name":        fields["org_name"],
		"source_type":     fields["source_type"],
		"owner_user_id":   fields["owner_user_id"],
		"owner_dept_code": fields["owner_dept_code"],
		"next_action":     fields["next_action"],
	}, operator); err != nil {
		return nil, err
	}
	lead, err := a.leadByIDTx(ctx, tx, leadID)
	if err != nil {
		return nil, err
	}
	if err := tx.Commit(); err != nil {
		return nil, err
	}
	return map[string]any{
		"id":   leadID,
		"code": code,
		"lead": lead,
	}, nil
}

func leadCreateFields(body map[string]any, operator string, code string) (map[string]any, error) {
	operatorOwner := operator
	if operatorOwner == "system" {
		operatorOwner = ""
	}
	owner := firstNonEmptyText(altocBodyText(body, "owner_user_id"), altocBodyText(body, "ownerUserId"), operatorOwner)
	if owner == "" {
		return nil, httperror.New(http.StatusBadRequest, "missing_owner_user_id", "owner_user_id is required")
	}

	fields := map[string]any{
		"code":                      code,
		"name":                      firstNonEmptyText(altocBodyText(body, "name")),
		"org_name":                  firstNonEmptyText(altocBodyText(body, "org_name"), altocBodyText(body, "orgName")),
		"source_type":               firstNonEmptyText(altocBodyText(body, "source_type"), altocBodyText(body, "sourceType")),
		"source_detail":             nullableText(firstNonEmptyText(altocBodyText(body, "source_detail"), altocBodyText(body, "sourceDetail"))),
		"need_summary":              firstNonEmptyText(altocBodyText(body, "need_summary"), altocBodyText(body, "needSummary")),
		"project_type":              nullableText(firstNonEmptyText(altocBodyText(body, "project_type"), altocBodyText(body, "projectType"))),
		"budget_status":             firstNonEmptyText(altocBodyText(body, "budget_status"), altocBodyText(body, "budgetStatus"), "unknown"),
		"estimated_budget":          altocOptionalMoney(body, "estimated_budget", "estimatedBudget"),
		"procurement_mode":          nullableText(firstNonEmptyText(altocBodyText(body, "procurement_mode"), altocBodyText(body, "procurementMode"))),
		"expected_procurement_date": altocDateText(firstNonEmptyText(altocBodyText(body, "expected_procurement_date"), altocBodyText(body, "expectedProcurementDate"))),
		"source_evidence_url":       nullableText(firstNonEmptyText(altocBodyText(body, "source_evidence_url"), altocBodyText(body, "sourceEvidenceUrl"))),
		"contact_name":              nullableText(firstNonEmptyText(altocBodyText(body, "contact_name"), altocBodyText(body, "contactName"))),
		"contact_mobile":            nullableText(firstNonEmptyText(altocBodyText(body, "contact_mobile"), altocBodyText(body, "contactMobile"))),
		"contact_email":             nullableText(firstNonEmptyText(altocBodyText(body, "contact_email"), altocBodyText(body, "contactEmail"))),
		"status":                    "following",
		"owner_user_id":             owner,
		"owner_dept_code":           nullableText(firstNonEmptyText(altocBodyText(body, "owner_dept_code"), altocBodyText(body, "ownerDeptCode"), altocActorDeptCode(body))),
		"next_action":               firstNonEmptyText(altocBodyText(body, "next_action"), altocBodyText(body, "nextAction")),
		"next_action_due_at":        altocDateTimeText(firstNonEmptyText(altocBodyText(body, "next_action_due_at"), altocBodyText(body, "nextActionDueAt"))),
		"remark":                    nullableText(firstNonEmptyText(altocBodyText(body, "remark"))),
		"created_by":                nullableText(operator),
		"updated_by":                nullableText(operator),
	}
	fields["score"] = leadRuleScore(fields)
	return fields, nil
}

func (a *Adapter) updateLeadDetails(ctx context.Context, identifier string, body map[string]any) (map[string]any, error) {
	leadID, err := altocIdentifierID(identifier, "lead_id")
	if err != nil {
		return nil, err
	}
	updates, err := leadDetailUpdates(body)
	if err != nil {
		return nil, err
	}

	tx, err := a.DB().BeginTx(ctx, nil)
	if err != nil {
		return nil, err
	}
	defer tx.Rollback()

	lead, err := a.lockLeadTx(ctx, tx, leadID)
	if err != nil {
		return nil, err
	}
	if lead == nil {
		return nil, httperror.New(http.StatusNotFound, "record_not_found", "lead not found")
	}
	if err := altocRequireRecordWrite(body, "lead", lead, "owner_user_id", "owner_dept_code"); err != nil {
		return nil, err
	}
	if err := altocRequireActionScope(body, "lead", "edit"); err != nil {
		return nil, err
	}
	status := altocMapText(lead, "status")
	if status == "converted" || status == "closed_invalid" {
		return nil, httperror.New(http.StatusConflict, "invalid_lead_status", "converted or closed invalid lead cannot be updated")
	}

	operator := altocActor(body)
	if nextAction, ok := updates["next_action"]; ok && altocValuePresent(nextAction) {
		dueAt := firstNonEmptyValue(updates["next_action_due_at"], lead["next_action_due_at"])
		if !altocValuePresent(dueAt) {
			return nil, httperror.New(http.StatusBadRequest, "missing_next_action", "next_action_due_at is required when next_action changes")
		}
		updates["status"] = "following"
		assignee := firstNonEmptyText(altocMapText(updates, "owner_user_id"), altocMapText(lead, "owner_user_id"), operator)
		if err := insertAltocSalesTaskIfNeededTx(ctx, tx, "lead", leadID, strings.TrimSpace(fmt.Sprint(nextAction)), dueAt, assignee, operator); err != nil {
			return nil, err
		}
	}
	if len(updates) > 0 {
		updates["score"] = leadRuleScoreAfterUpdate(lead, updates)
		if err := updateLeadDetailsTx(ctx, tx, leadID, updates, operator); err != nil {
			return nil, err
		}
		if err := insertAltocAuditTx(ctx, tx, "lead", leadID, "update", leadAuditSnapshot(lead, updates), updates, operator); err != nil {
			return nil, err
		}
	}
	updated, err := a.leadByIDTx(ctx, tx, leadID)
	if err != nil {
		return nil, err
	}
	if err := tx.Commit(); err != nil {
		return nil, err
	}
	return map[string]any{
		"lead":    updated,
		"changed": len(updates) > 0,
	}, nil
}

func leadDetailUpdates(body map[string]any) (map[string]any, error) {
	updates := map[string]any{}
	for _, field := range leadDetailUpdateFields {
		value, ok := altocBodyValue(body, field)
		if !ok {
			continue
		}
		switch field {
		case "name":
			text := strings.TrimSpace(fmt.Sprint(value))
			if text == "" || text == "<nil>" {
				return nil, httperror.New(http.StatusBadRequest, "missing_lead_name", "name is required")
			}
			updates[field] = text
		case "org_name":
			text := strings.TrimSpace(fmt.Sprint(value))
			if text == "" || text == "<nil>" {
				return nil, httperror.New(http.StatusBadRequest, "missing_customer", "org_name is required")
			}
			updates[field] = text
		case "source_type":
			text := strings.TrimSpace(fmt.Sprint(value))
			if text == "" || text == "<nil>" {
				return nil, httperror.New(http.StatusBadRequest, "missing_source_type", "source_type is required")
			}
			updates[field] = text
		case "need_summary":
			text := strings.TrimSpace(fmt.Sprint(value))
			if text == "" || text == "<nil>" {
				return nil, httperror.New(http.StatusBadRequest, "missing_need_summary", "need_summary is required")
			}
			updates[field] = text
		case "owner_user_id":
			text := strings.TrimSpace(fmt.Sprint(value))
			if text == "" || text == "<nil>" {
				return nil, httperror.New(http.StatusBadRequest, "missing_owner_user_id", "owner_user_id is required")
			}
			updates[field] = text
		case "next_action":
			text := strings.TrimSpace(fmt.Sprint(value))
			if text == "" || text == "<nil>" {
				return nil, httperror.New(http.StatusBadRequest, "missing_next_action", "next_action is required")
			}
			updates[field] = text
		case "expected_procurement_date":
			updates[field] = altocDateText(strings.TrimSpace(fmt.Sprint(value)))
		case "next_action_due_at":
			text := strings.TrimSpace(fmt.Sprint(value))
			if text == "" || text == "<nil>" {
				return nil, httperror.New(http.StatusBadRequest, "missing_next_action", "next_action_due_at is required")
			}
			updates[field] = altocDateTimeText(text)
		default:
			if text, ok := value.(string); ok && strings.TrimSpace(text) == "" {
				updates[field] = nil
			} else {
				updates[field] = value
			}
		}
	}
	return updates, nil
}

func updateLeadDetailsTx(ctx context.Context, tx *sql.Tx, leadID int64, updates map[string]any, operator string) error {
	columns, err := altocTableColumns(ctx, tx, "lead")
	if err != nil {
		return err
	}
	names := make([]string, 0, len(updates))
	for name := range updates {
		if columns[name] {
			names = append(names, name)
		}
	}
	if len(names) == 0 {
		return nil
	}
	sort.Strings(names)

	set := make([]string, 0, len(names)+2)
	args := make([]any, 0, len(names)+2)
	for _, name := range names {
		set = append(set, altocQuoteID(name)+" = ?")
		args = append(args, altocNormalizeInsertValue(updates[name]))
	}
	if columns["updated_by"] {
		set = append(set, "updated_by = ?")
		args = append(args, operator)
	}
	if columns["updated_at"] {
		set = append(set, "updated_at = CURRENT_TIMESTAMP")
	}
	args = append(args, leadID)
	_, err = tx.ExecContext(ctx, "UPDATE `lead` SET "+strings.Join(set, ", ")+" WHERE id = ?", args...)
	return err
}

func leadAuditSnapshot(lead map[string]any, updates map[string]any) map[string]any {
	snapshot := map[string]any{}
	for key := range updates {
		snapshot[key] = lead[key]
	}
	return snapshot
}

func leadConversionForecastCategory(body map[string]any) (string, error) {
	category := firstNonEmptyText(altocBodyText(body, "forecast_category"), altocBodyText(body, "forecastCategory"))
	switch category {
	case "", "pipeline":
		return "pipeline", nil
	case "best_case":
		return category, nil
	default:
		return "", httperror.New(http.StatusBadRequest, "invalid_forecast_category", "lead conversion can only create pipeline or best_case opportunities")
	}
}

func leadConversionOpportunityRemark(body map[string]any, lead map[string]any) any {
	return nullableText(firstNonEmptyText(
		altocBodyText(body, "opportunity_remark"),
		altocBodyText(body, "remark"),
		altocMapText(lead, "remark"),
		altocMapText(lead, "need_summary"),
	))
}

func leadConversionSimilarOpportunityAcknowledged(body map[string]any) bool {
	for _, key := range []string{
		"ack_similar_opportunity",
		"ack_similar_open_opportunity",
		"confirm_similar_opportunity",
	} {
		value, ok := altocBodyValue(body, key)
		if ok && altocBool(value) {
			return true
		}
	}
	return false
}

func leadConversionOpportunityName(body map[string]any, lead map[string]any) string {
	return firstNonEmptyText(altocBodyText(body, "opportunity_name"), altocMapText(lead, "name"))
}

func leadSimilarOpenOpportunityFilters(customerID any, opportunityName string, body map[string]any) ([]string, []any, error) {
	id := altocPositiveID(customerID)
	opportunityName = strings.TrimSpace(opportunityName)
	if id <= 0 || opportunityName == "" {
		return nil, nil, nil
	}

	where := []string{
		"op.deleted_at IS NULL",
		"op.customer_id = ?",
		"op.status IN ('active', 'paused')",
		"(op.name = ? OR op.name LIKE ? OR ? LIKE CONCAT('%', op.name, '%'))",
	}
	args := []any{id, opportunityName, "%" + opportunityName + "%", opportunityName}
	scopeWhere, scopeArgs, err := altocReadScopeWhereFromBody(body, "opportunity", "op", "owner_user_id", "owner_dept_code")
	if err != nil {
		return nil, nil, err
	}
	where = append(where, scopeWhere...)
	args = append(args, scopeArgs...)
	return where, args, nil
}

func leadConversionQualificationUpdates(body map[string]any) map[string]any {
	updates := map[string]any{
		"qualification_result": "passed",
	}
	for column, keys := range map[string][]string{
		"need_summary":        {"need_summary", "needSummary"},
		"project_type":        {"project_type", "projectType"},
		"budget_status":       {"budget_status", "budgetStatus"},
		"procurement_mode":    {"procurement_mode", "procurementMode"},
		"source_evidence_url": {"source_evidence_url", "sourceEvidenceUrl"},
	} {
		if value := firstNonEmptyText(bodyTexts(body, keys...)...); value != "" {
			updates[column] = value
		}
	}
	if value := firstNonEmptyText(bodyTexts(body, "expected_procurement_date", "expectedProcurementDate")...); value != "" {
		if date := altocDateText(value); date != nil {
			updates["expected_procurement_date"] = date
		}
	}
	return updates
}

func bodyTexts(body map[string]any, keys ...string) []string {
	values := make([]string, 0, len(keys))
	for _, key := range keys {
		values = append(values, altocBodyText(body, key))
	}
	return values
}

func quoteAltocColumn(column string) string {
	return "`" + strings.ReplaceAll(column, "`", "``") + "`"
}

func (a *Adapter) assignLead(ctx context.Context, identifier string, body map[string]any) (map[string]any, error) {
	leadID, err := altocIdentifierID(identifier, "lead_id")
	if err != nil {
		return nil, err
	}
	assignee := firstNonEmptyText(firstBodyText(body, "ownerUserId", "owner_user_id", "assigneeUserId", "assignee_user_id"))
	if assignee == "" {
		return nil, httperror.New(http.StatusBadRequest, "missing_owner_user_id", "owner_user_id is required")
	}

	tx, err := a.DB().BeginTx(ctx, nil)
	if err != nil {
		return nil, err
	}
	defer tx.Rollback()

	lead, err := a.lockLeadTx(ctx, tx, leadID)
	if err != nil {
		return nil, err
	}
	if lead == nil {
		return nil, httperror.New(http.StatusNotFound, "record_not_found", "lead not found")
	}
	if err := altocRequireRecordWrite(body, "lead", lead, "owner_user_id", "owner_dept_code"); err != nil {
		return nil, err
	}
	if err := altocRequireActionScope(body, "lead", "assign"); err != nil {
		return nil, err
	}
	if altocMapText(lead, "status") == "converted" || altocMapText(lead, "status") == "closed_invalid" {
		return nil, httperror.New(http.StatusConflict, "invalid_lead_status", "converted or closed invalid lead cannot be assigned")
	}

	operator := altocActor(body)
	columns, err := altocTableColumns(ctx, tx, "lead")
	if err != nil {
		return nil, err
	}
	set := []string{
		"owner_user_id = ?",
		"status = 'following'",
	}
	args := []any{assignee}
	if columns["score"] {
		args = append(args, leadRuleScoreAfterUpdate(lead, map[string]any{
			"owner_user_id": assignee,
			"status":        "following",
		}))
		set = append(set, "score = ?")
	}
	set = append(set, "updated_by = ?", "updated_at = CURRENT_TIMESTAMP")
	args = append(args, operator, leadID)
	if _, err := tx.ExecContext(ctx, "UPDATE `lead` SET "+strings.Join(set, ", ")+" WHERE id = ?", args...); err != nil {
		return nil, err
	}
	if err := insertAltocAuditTx(ctx, tx, "lead", leadID, "update", map[string]any{
		"owner_user_id": lead["owner_user_id"],
		"status":        lead["status"],
	}, map[string]any{
		"owner_user_id": assignee,
		"status":        "following",
	}, operator); err != nil {
		return nil, err
	}
	updated, err := a.leadByIDTx(ctx, tx, leadID)
	if err != nil {
		return nil, err
	}
	if err := tx.Commit(); err != nil {
		return nil, err
	}
	return map[string]any{"lead": updated, "changed": true}, nil
}

func (a *Adapter) disqualifyLead(ctx context.Context, identifier string, body map[string]any) (map[string]any, error) {
	leadID, err := altocIdentifierID(identifier, "lead_id")
	if err != nil {
		return nil, err
	}
	reason := firstNonEmptyText(firstBodyText(body, "reason", "invalidReason", "invalid_reason"))
	if reason == "" {
		return nil, httperror.New(http.StatusBadRequest, "missing_invalid_reason", "invalid reason is required")
	}

	tx, err := a.DB().BeginTx(ctx, nil)
	if err != nil {
		return nil, err
	}
	defer tx.Rollback()

	lead, err := a.lockLeadTx(ctx, tx, leadID)
	if err != nil {
		return nil, err
	}
	if lead == nil {
		return nil, httperror.New(http.StatusNotFound, "record_not_found", "lead not found")
	}
	if err := altocRequireRecordWrite(body, "lead", lead, "owner_user_id", "owner_dept_code"); err != nil {
		return nil, err
	}
	if err := altocRequireActionScope(body, "lead", "disqualify"); err != nil {
		return nil, err
	}
	if altocMapText(lead, "status") == "converted" {
		return nil, httperror.New(http.StatusConflict, "lead_already_converted", "converted lead cannot be closed invalid")
	}
	if altocMapText(lead, "status") == "closed_invalid" {
		updated, err := a.leadByIDTx(ctx, tx, leadID)
		if err != nil {
			return nil, err
		}
		if err := tx.Commit(); err != nil {
			return nil, err
		}
		return map[string]any{"lead": updated, "changed": false, "idempotent": true}, nil
	}

	operator := altocActor(body)
	reasonCode := firstNonEmptyText(firstBodyText(body, "invalidReasonCode", "invalid_reason_code", "reasonCode", "reason_code"))
	columns, err := altocTableColumns(ctx, tx, "lead")
	if err != nil {
		return nil, err
	}
	set := []string{
		"status = 'closed_invalid'",
		"invalid_reason_code = ?",
		"invalid_reason = ?",
	}
	args := []any{nullableText(reasonCode), reason}
	if columns["score"] {
		set = append(set, "score = 0")
	}
	if columns["qualification_result"] {
		set = append(set, "qualification_result = 'invalid'")
	}
	if columns["qualification_reason_code"] {
		set = append(set, "qualification_reason_code = ?")
		args = append(args, nullableText(reasonCode))
	}
	set = append(set, "updated_by = ?", "updated_at = CURRENT_TIMESTAMP")
	args = append(args, operator, leadID)
	if _, err := tx.ExecContext(ctx, "UPDATE `lead` SET "+strings.Join(set, ", ")+" WHERE id = ?", args...); err != nil {
		return nil, err
	}
	if err := insertAltocAuditTx(ctx, tx, "lead", leadID, "status_change", map[string]any{
		"status":                    lead["status"],
		"invalid_reason_code":       lead["invalid_reason_code"],
		"invalid_reason":            lead["invalid_reason"],
		"qualification_result":      lead["qualification_result"],
		"qualification_reason_code": lead["qualification_reason_code"],
	}, map[string]any{
		"status":                    "closed_invalid",
		"invalid_reason_code":       nullableText(reasonCode),
		"invalid_reason":            reason,
		"qualification_result":      "invalid",
		"qualification_reason_code": nullableText(reasonCode),
	}, operator); err != nil {
		return nil, err
	}
	updated, err := a.leadByIDTx(ctx, tx, leadID)
	if err != nil {
		return nil, err
	}
	if err := tx.Commit(); err != nil {
		return nil, err
	}
	return map[string]any{"lead": updated, "changed": true}, nil
}

func (a *Adapter) getLead(ctx context.Context, identifier string, query url.Values) (map[string]any, error) {
	leadID, err := altocIdentifierID(identifier, "lead_id")
	if err != nil {
		return nil, err
	}
	filters := []string{"id = ?", "deleted_at IS NULL"}
	args := []any{leadID}
	scopeWhere, scopeArgs, err := altocReadScopeWhere(query, "lead", "", "owner_user_id", "owner_dept_code")
	if err != nil {
		return nil, err
	}
	filters = append(filters, scopeWhere...)
	args = append(args, scopeArgs...)
	lead, err := altocQueryOneMap(ctx, a.DB(), `
		SELECT *
		FROM `+"`lead`"+`
		WHERE `+strings.Join(filters, " AND ")+`
		LIMIT 1
	`, args...)
	if err != nil {
		return nil, err
	}
	if lead == nil {
		return nil, httperror.New(http.StatusNotFound, "record_not_found", "lead not found")
	}
	activities, err := altocQueryMaps(ctx, a.DB(), `
		SELECT *
		FROM sales_activity
		WHERE lead_id = ?
		  AND deleted_at IS NULL
		ORDER BY activity_at DESC, id DESC
		LIMIT 20
	`, leadID)
	if err != nil {
		return nil, err
	}
	lead["activities"] = activities
	return lead, nil
}

func (a *Adapter) createLeadActivity(ctx context.Context, identifier string, body map[string]any) (map[string]any, error) {
	leadID, err := altocIdentifierID(identifier, "lead_id")
	if err != nil {
		return nil, err
	}
	subject := strings.TrimSpace(firstBodyText(body, "subject"))
	if subject == "" {
		return nil, httperror.New(http.StatusBadRequest, "missing_subject", "activity subject is required")
	}

	tx, err := a.DB().BeginTx(ctx, nil)
	if err != nil {
		return nil, err
	}
	defer tx.Rollback()

	lead, err := a.lockLeadTx(ctx, tx, leadID)
	if err != nil {
		return nil, err
	}
	if lead == nil {
		return nil, httperror.New(http.StatusNotFound, "record_not_found", "lead not found")
	}
	if err := altocRequireRecordWrite(body, "lead", lead, "owner_user_id", "owner_dept_code"); err != nil {
		return nil, err
	}
	if err := altocRequireActionScope(body, "lead", "activity"); err != nil {
		return nil, err
	}
	status := altocMapText(lead, "status")
	if status == "converted" || status == "closed_invalid" {
		return nil, httperror.New(http.StatusConflict, "invalid_lead_status", "converted or closed invalid lead cannot record activities")
	}

	operator := altocActor(body)
	owner := firstNonEmptyText(firstBodyText(body, "ownerUserId", "owner_user_id"), operator, altocMapText(lead, "owner_user_id"))
	code, err := nextAltocCode(ctx, tx, "SA", "sales_activity")
	if err != nil {
		return nil, err
	}
	nextAction := firstBodyText(body, "nextAction", "next_action")
	nextActionDueAt := altocDateTimeText(firstBodyText(body, "nextActionDueAt", "next_action_due_at"))
	if err := validateLeadActivityNextActionDue(nextAction, nextActionDueAt); err != nil {
		return nil, err
	}
	activityID, err := altocInsertRecordTx(ctx, tx, "sales_activity", map[string]any{
		"code":               code,
		"activity_type":      firstNonEmptyText(firstBodyText(body, "activityType", "activity_type"), "memo"),
		"subject":            subject,
		"lead_id":            leadID,
		"activity_at":        altocDateTimeText(firstNonEmptyText(firstBodyText(body, "activityAt", "activity_at"), timeNowSQLText())),
		"participants_json":  body["participants_json"],
		"content":            nullableText(firstBodyText(body, "content")),
		"result_summary":     nullableText(firstBodyText(body, "resultSummary", "result_summary")),
		"next_action":        nullableText(nextAction),
		"next_action_due_at": nextActionDueAt,
		"owner_user_id":      owner,
		"status":             "active",
		"created_by":         nullableText(operator),
		"updated_by":         nullableText(operator),
	})
	if err != nil {
		return nil, err
	}

	leadColumns, err := altocTableColumns(ctx, tx, "lead")
	if err != nil {
		return nil, err
	}
	set, args := leadActivityLeadUpdateParts(leadColumns, nextAction, nextActionDueAt, operator)
	if leadColumns["score"] {
		scoreUpdates := map[string]any{"status": "following"}
		if nextAction != "" {
			scoreUpdates["next_action"] = nextAction
			scoreUpdates["next_action_due_at"] = nextActionDueAt
		}
		set = append(set, "score = ?")
		args = append(args, leadRuleScoreAfterUpdate(lead, scoreUpdates))
	}
	if nextAction != "" {
		if err := insertAltocSalesTaskIfNeededTx(ctx, tx, "lead", leadID, nextAction, nextActionDueAt, firstNonEmptyText(altocMapText(lead, "owner_user_id"), owner), operator); err != nil {
			return nil, err
		}
	}
	args = append(args, leadID)
	if _, err := tx.ExecContext(ctx, "UPDATE `lead` SET "+strings.Join(set, ", ")+" WHERE id = ?", args...); err != nil {
		return nil, err
	}
	if err := insertAltocAuditTx(ctx, tx, "sales_activity", activityID, "create", nil, map[string]any{
		"code":          code,
		"lead_id":       leadID,
		"activity_type": firstNonEmptyText(firstBodyText(body, "activityType", "activity_type"), "memo"),
		"subject":       subject,
	}, operator); err != nil {
		return nil, err
	}
	activity, err := altocQueryOneMap(ctx, tx, `
		SELECT *
		FROM sales_activity
		WHERE id = ?
		LIMIT 1
	`, activityID)
	if err != nil {
		return nil, err
	}
	if err := tx.Commit(); err != nil {
		return nil, err
	}
	return map[string]any{
		"activity": activity,
		"id":       activityID,
		"code":     code,
	}, nil
}

func leadActivityLeadUpdateParts(columns map[string]bool, nextAction string, nextActionDueAt any, operator string) ([]string, []any) {
	set := make([]string, 0, 6)
	args := make([]any, 0, 4)
	if columns["last_follow_up_at"] {
		set = append(set, "last_follow_up_at = CURRENT_TIMESTAMP")
	}
	if columns["status"] {
		set = append(set, "status = 'following'")
	}
	if nextAction != "" && columns["next_action"] && columns["next_action_due_at"] {
		set = append(set, "next_action = ?", "next_action_due_at = ?")
		args = append(args, nextAction, nextActionDueAt)
	}
	if columns["updated_by"] {
		set = append(set, "updated_by = ?")
		args = append(args, operator)
	}
	if columns["updated_at"] {
		set = append(set, "updated_at = CURRENT_TIMESTAMP")
	}
	if len(set) == 0 {
		set = append(set, "id = id")
	}
	return set, args
}

func validateLeadActivityNextActionDue(nextAction string, nextActionDueAt any) error {
	if strings.TrimSpace(nextAction) == "" {
		return nil
	}
	if !altocValuePresent(nextActionDueAt) {
		return httperror.New(http.StatusBadRequest, "missing_next_action", "next_action_due_at is required when next_action is provided")
	}
	return nil
}

func leadRuleScore(record map[string]any) int {
	if altocMapText(record, "status") == "closed_invalid" {
		return 0
	}

	score := 0
	if firstNonEmptyText(altocMapText(record, "org_name"), altocMapText(record, "name")) != "" {
		score += 15
	}
	if altocMapText(record, "need_summary") != "" {
		score += 20
	}
	if firstNonEmptyText(
		altocMapText(record, "contact_name"),
		altocMapText(record, "contact_mobile"),
		altocMapText(record, "contact_email"),
		altocMapText(record, "source_evidence_url"),
	) != "" {
		score += 15
	}
	if altocMapText(record, "owner_user_id") != "" {
		score += 10
	}
	if altocMapText(record, "next_action") != "" && altocMapText(record, "next_action_due_at") != "" {
		score += 10
	}
	if leadScoreHasPositiveAmount(record["estimated_budget"]) || leadScoreHasBudgetSignal(altocMapText(record, "budget_status")) {
		score += 10
	}
	if firstNonEmptyText(altocMapText(record, "procurement_mode"), altocMapText(record, "expected_procurement_date")) != "" {
		score += 10
	}
	if firstNonEmptyText(altocMapText(record, "source_type"), altocMapText(record, "source_evidence_url")) != "" {
		score += 10
	}
	if score < 0 {
		return 0
	}
	if score > 100 {
		return 100
	}
	return score
}

func leadRuleScoreAfterUpdate(record map[string]any, updates map[string]any) int {
	merged := make(map[string]any, len(record)+len(updates))
	for key, value := range record {
		merged[key] = value
	}
	for key, value := range updates {
		merged[key] = value
	}
	return leadRuleScore(merged)
}

func leadScoreHasPositiveAmount(value any) bool {
	switch typed := value.(type) {
	case int:
		return typed > 0
	case int64:
		return typed > 0
	case float64:
		return typed > 0
	case float32:
		return typed > 0
	case string:
		parsed, err := strconv.ParseFloat(strings.TrimSpace(typed), 64)
		return err == nil && parsed > 0
	default:
		parsed, err := strconv.ParseFloat(strings.TrimSpace(fmt.Sprint(value)), 64)
		return err == nil && parsed > 0
	}
}

func leadScoreHasBudgetSignal(value string) bool {
	switch strings.TrimSpace(value) {
	case "applying", "approved", "allocated":
		return true
	default:
		return false
	}
}

func (a *Adapter) resolveLeadConversionCustomerTx(ctx context.Context, tx *sql.Tx, lead map[string]any, body map[string]any, operator string) (map[string]any, bool, error) {
	customerID := altocPositiveID(firstNonEmptyText(altocBodyText(body, "customer_id"), altocBodyText(body, "customerId")))
	if customerID > 0 {
		customer, err := altocQueryOneMap(ctx, tx, `
			SELECT *
			FROM customer
			WHERE id = ?
			  AND deleted_at IS NULL
			LIMIT 1
			FOR UPDATE
		`, customerID)
		if err != nil {
			return nil, false, err
		}
		if customer == nil {
			return nil, false, httperror.New(http.StatusNotFound, "customer_not_found", "customer not found")
		}
		allowed, err := altocRecordMatchesReadScope(body, "customer", customer, "owner_user_id", "owner_dept_code")
		if err != nil {
			return nil, false, err
		}
		if !allowed {
			return nil, false, httperror.New(http.StatusNotFound, "customer_not_found", "customer not found")
		}
		return customer, true, nil
	}

	customerName := firstNonEmptyText(
		altocBodyText(body, "customer_name"),
		altocBodyText(body, "customerName"),
		altocMapText(lead, "org_name"),
		altocMapText(lead, "name"),
	)
	if customerName == "" {
		return nil, false, httperror.New(http.StatusBadRequest, "missing_customer", "customer_id or customer_name is required")
	}
	customer, err := lookupLeadCustomerTx(ctx, tx, customerName, body)
	if err != nil {
		return nil, false, err
	}
	if customer != nil {
		return customer, true, nil
	}

	code, err := nextAltocCode(ctx, tx, "CU", "customer")
	if err != nil {
		return nil, false, err
	}
	owner := firstNonEmptyText(altocBodyText(body, "owner_user_id"), altocMapText(lead, "owner_user_id"), operator)
	customerID, err = altocInsertRecordTx(ctx, tx, "customer", map[string]any{
		"code":                       code,
		"name":                       customerName,
		"normalized_name":            altocNormalizeEntityName(customerName),
		"unified_social_credit_code": nullableText(firstBodyText(body, "unifiedSocialCreditCode", "unified_social_credit_code")),
		"organization_domain":        nullableText(altocNormalizeDomain(firstBodyText(body, "organizationDomain", "organization_domain"))),
		"source_type":                firstNonEmptyText(altocBodyText(body, "source_type"), altocMapText(lead, "source_type")),
		"status":                     "active",
		"owner_user_id":              owner,
		"owner_dept_code": firstNonEmptyText(
			altocBodyText(body, "owner_dept_code"),
			altocMapText(lead, "owner_dept_code"),
			altocActorDeptCode(body),
		),
		"created_by": nullableText(operator),
		"updated_by": nullableText(operator),
	})
	if err != nil {
		return nil, false, err
	}
	customer, err = altocQueryOneMap(ctx, tx, `
		SELECT *
		FROM customer
		WHERE id = ?
		LIMIT 1
	`, customerID)
	return customer, false, err
}

func (a *Adapter) resolveLeadConversionContactTx(ctx context.Context, tx *sql.Tx, lead map[string]any, body map[string]any, customer map[string]any, operator string) (map[string]any, bool, error) {
	contactID := altocPositiveID(firstNonEmptyText(altocBodyText(body, "contact_id"), altocBodyText(body, "contactId")))
	if contactID > 0 {
		contact, err := altocQueryOneMap(ctx, tx, `
			SELECT *
			FROM contact
			WHERE id = ?
			  AND customer_id = ?
			  AND deleted_at IS NULL
			LIMIT 1
		`, contactID, customer["id"])
		if err != nil {
			return nil, false, err
		}
		if contact == nil {
			return nil, false, httperror.New(http.StatusNotFound, "contact_not_found", "contact not found under customer")
		}
		return contact, true, nil
	}

	contactName := firstNonEmptyText(altocBodyText(body, "contact_name"), altocMapText(lead, "contact_name"))
	mobile := firstNonEmptyText(altocBodyText(body, "contact_mobile"), altocMapText(lead, "contact_mobile"))
	email := firstNonEmptyText(altocBodyText(body, "contact_email"), altocMapText(lead, "contact_email"))
	if contactName == "" && mobile == "" && email == "" {
		return nil, false, nil
	}

	contact, err := lookupLeadContactTx(ctx, tx, customer["id"], contactName, mobile, email)
	if err != nil {
		return nil, false, err
	}
	if contact != nil {
		return contact, true, nil
	}
	if contactName == "" {
		contactName = firstNonEmptyText(mobile, email, "未命名联系人")
	}
	owner := firstNonEmptyText(altocBodyText(body, "owner_user_id"), altocMapText(lead, "owner_user_id"), operator)
	newContactID, err := altocInsertRecordTx(ctx, tx, "contact", map[string]any{
		"customer_id":       customer["id"],
		"name":              contactName,
		"mobile":            nullableText(mobile),
		"normalized_mobile": nullableText(altocNormalizeMobile(mobile)),
		"email":             nullableText(email),
		"normalized_email":  nullableText(altocNormalizeEmail(email)),
		"status":            "active",
		"owner_user_id":     owner,
		"created_by":        nullableText(operator),
		"updated_by":        nullableText(operator),
	})
	if err != nil {
		return nil, false, err
	}
	contact, err = altocQueryOneMap(ctx, tx, `
		SELECT *
		FROM contact
		WHERE id = ?
		LIMIT 1
	`, newContactID)
	return contact, false, err
}

func lookupLeadContactTx(ctx context.Context, tx *sql.Tx, customerID any, name string, mobile string, email string) (map[string]any, error) {
	columns, err := altocTableColumns(ctx, tx, "contact")
	if err != nil {
		return nil, err
	}
	normalizedMobile := altocNormalizeMobile(mobile)
	normalizedEmail := altocNormalizeEmail(email)
	switch {
	case mobile != "":
		mobileCondition := "mobile = ?"
		args := []any{customerID, mobile}
		if columns["normalized_mobile"] && normalizedMobile != "" {
			mobileCondition = "(normalized_mobile = ? OR mobile = ?)"
			args = []any{customerID, normalizedMobile, mobile}
		}
		return altocQueryOneMap(ctx, tx, `
			SELECT *
			FROM contact
			WHERE customer_id = ?
			  AND `+mobileCondition+`
			  AND deleted_at IS NULL
			ORDER BY id ASC
			LIMIT 1
		`, args...)
	case email != "":
		emailCondition := "LOWER(email) = ?"
		args := []any{customerID, normalizedEmail}
		if columns["normalized_email"] && normalizedEmail != "" {
			emailCondition = "(normalized_email = ? OR LOWER(email) = ?)"
			args = []any{customerID, normalizedEmail, normalizedEmail}
		}
		return altocQueryOneMap(ctx, tx, `
			SELECT *
			FROM contact
			WHERE customer_id = ?
			  AND `+emailCondition+`
			  AND deleted_at IS NULL
			ORDER BY id ASC
			LIMIT 1
		`, args...)
	case name != "":
		return altocQueryOneMap(ctx, tx, `
			SELECT *
			FROM contact
			WHERE customer_id = ?
			  AND name = ?
			  AND deleted_at IS NULL
			ORDER BY id ASC
			LIMIT 1
		`, customerID, name)
	default:
		return nil, nil
	}
}

func lookupLeadCustomerTx(ctx context.Context, tx *sql.Tx, customerName string, body map[string]any) (map[string]any, error) {
	columns, err := altocTableColumns(ctx, tx, "customer")
	if err != nil {
		return nil, err
	}
	conditions, args := leadCustomerLookupConditions(columns, customerName, body)
	if len(conditions) == 0 {
		return nil, nil
	}
	where := []string{
		"cu.deleted_at IS NULL",
		"(" + strings.Join(conditions, " OR ") + ")",
	}
	scopeWhere, scopeArgs, err := altocReadScopeWhereFromBody(body, "customer", "cu", "owner_user_id", "owner_dept_code")
	if err != nil {
		return nil, err
	}
	where = append(where, scopeWhere...)
	args = append(args, scopeArgs...)
	return altocQueryOneMap(ctx, tx, `
		SELECT *
		FROM customer cu
		WHERE `+strings.Join(where, " AND ")+`
		ORDER BY cu.id ASC
		LIMIT 1
		FOR UPDATE
	`, args...)
}

func leadCustomerLookupConditions(columns map[string]bool, customerName string, body map[string]any) ([]string, []any) {
	conditions := make([]string, 0, 5)
	args := make([]any, 0, 8)

	creditCode := strings.TrimSpace(firstBodyText(body, "unifiedSocialCreditCode", "unified_social_credit_code"))
	if creditCode != "" && columns["unified_social_credit_code"] {
		conditions = append(conditions, "cu.unified_social_credit_code = ?")
		args = append(args, creditCode)
	}

	domain := altocNormalizeDomain(firstBodyText(body, "organizationDomain", "organization_domain"))
	if domain != "" && columns["organization_domain"] {
		conditions = append(conditions, "cu.organization_domain = ?")
		args = append(args, domain)
	}

	customerName = strings.TrimSpace(customerName)
	normalizedName := altocNormalizeEntityName(customerName)
	if customerName != "" {
		conditions = append(conditions, "cu.name = ?")
		args = append(args, customerName)
		if columns["normalized_name"] && normalizedName != "" {
			conditions = append(conditions, "cu.normalized_name = ?")
			args = append(args, normalizedName)
		}
		if normalizedName != "" {
			conditions = append(conditions, "LOWER(REPLACE(REPLACE(REPLACE(REPLACE(TRIM(cu.name), ' ', ''), '　', ''), '（', '('), '）', ')')) = ?")
			args = append(args, normalizedName)
		}
	}

	return conditions, args
}

func (a *Adapter) lockLeadTx(ctx context.Context, tx *sql.Tx, leadID int64) (map[string]any, error) {
	return altocQueryOneMap(ctx, tx, `
		SELECT *
		FROM `+"`lead`"+`
		WHERE id = ?
		  AND deleted_at IS NULL
		LIMIT 1
		FOR UPDATE
	`, leadID)
}

func (a *Adapter) leadByIDTx(ctx context.Context, tx *sql.Tx, leadID any) (map[string]any, error) {
	return altocQueryOneMap(ctx, tx, `
		SELECT *
		FROM `+"`lead`"+`
		WHERE id = ?
		  AND deleted_at IS NULL
		LIMIT 1
	`, leadID)
}

func (a *Adapter) attachLeadActivitiesToConversionTx(ctx context.Context, tx *sql.Tx, leadID any, customerID any, contactID any, opportunityID any, operator string) error {
	exists, err := altocTableExists(ctx, tx, "sales_activity")
	if err != nil || !exists {
		return err
	}
	columns, err := altocTableColumns(ctx, tx, "sales_activity")
	if err != nil {
		return err
	}
	if !columns["lead_id"] {
		return nil
	}
	set, args := leadActivityConversionUpdateParts(columns, customerID, contactID, opportunityID, operator)
	if len(set) == 0 {
		return nil
	}
	where := "lead_id = ?"
	if columns["deleted_at"] {
		where += " AND deleted_at IS NULL"
	}
	args = append(args, leadID)
	_, err = tx.ExecContext(ctx, "UPDATE sales_activity SET "+strings.Join(set, ", ")+" WHERE "+where, args...)
	return err
}

func leadActivityConversionUpdateParts(columns map[string]bool, customerID any, contactID any, opportunityID any, operator string) ([]string, []any) {
	set := make([]string, 0, 5)
	args := make([]any, 0, 4)
	if columns["customer_id"] && customerID != nil {
		set = append(set, "customer_id = COALESCE(customer_id, ?)")
		args = append(args, customerID)
	}
	if columns["contact_id"] && contactID != nil {
		set = append(set, "contact_id = COALESCE(contact_id, ?)")
		args = append(args, contactID)
	}
	if columns["opportunity_id"] && opportunityID != nil {
		set = append(set, "opportunity_id = COALESCE(opportunity_id, ?)")
		args = append(args, opportunityID)
	}
	if columns["updated_by"] {
		set = append(set, "updated_by = ?")
		args = append(args, operator)
	}
	if columns["updated_at"] {
		set = append(set, "updated_at = CURRENT_TIMESTAMP")
	}
	return set, args
}

func (a *Adapter) copyLeadAttachmentsToOpportunityTx(ctx context.Context, tx *sql.Tx, leadID any, opportunityID any) error {
	exists, err := altocTableExists(ctx, tx, "attachment")
	if err != nil || !exists {
		return err
	}
	columns, err := altocTableColumns(ctx, tx, "attachment")
	if err != nil {
		return err
	}
	statement, args := leadAttachmentCopyStatement(columns, leadID, opportunityID)
	if statement == "" {
		return nil
	}
	_, err = tx.ExecContext(ctx, statement, args...)
	return err
}

func leadAttachmentCopyStatement(columns map[string]bool, leadID any, opportunityID any) (string, []any) {
	required := []string{"entity_type", "entity_id", "file_name", "file_key", "uploaded_by"}
	for _, column := range required {
		if !columns[column] {
			return "", nil
		}
	}

	insertColumns := []string{"entity_type", "entity_id"}
	selectExprs := []string{"?", "?"}
	args := []any{"opportunity", opportunityID}
	for _, column := range []string{"attachment_type", "file_name", "file_key", "file_size", "content_type", "uploaded_by", "created_at"} {
		if columns[column] {
			insertColumns = append(insertColumns, column)
			selectExprs = append(selectExprs, "src."+altocQuoteID(column))
		}
	}

	where := []string{"src.entity_type = ?", "src.entity_id = ?"}
	args = append(args, "lead", leadID, "opportunity", opportunityID)
	if columns["deleted_at"] {
		where = append(where, "src.deleted_at IS NULL")
	}

	statement := "INSERT INTO attachment (" + altocQuoteIDList(insertColumns) + ") " +
		"SELECT " + strings.Join(selectExprs, ", ") + " FROM attachment src " +
		"WHERE " + strings.Join(where, " AND ") + " " +
		"AND NOT EXISTS (SELECT 1 FROM attachment dst WHERE dst.entity_type = ? AND dst.entity_id = ? AND dst.file_key = src.file_key)"
	return statement, args
}

func (a *Adapter) copyLeadDocumentLinksToOpportunityTx(ctx context.Context, tx *sql.Tx, leadID any, opportunityID any) error {
	exists, err := altocTableExists(ctx, tx, "document_link")
	if err != nil || !exists {
		return err
	}
	columns, err := altocTableColumns(ctx, tx, "document_link")
	if err != nil {
		return err
	}
	statement, args := leadDocumentLinkCopyStatement(columns, leadID, opportunityID)
	if statement == "" {
		return nil
	}
	_, err = tx.ExecContext(ctx, statement, args...)
	return err
}

func leadDocumentLinkCopyStatement(columns map[string]bool, leadID any, opportunityID any) (string, []any) {
	if !columns["entity_type"] || !columns["entity_id"] {
		return "", nil
	}
	dedupParts := make([]string, 0, 2)
	if columns["document_uuid"] {
		dedupParts = append(dedupParts, "(src.document_uuid IS NOT NULL AND dst.document_uuid = src.document_uuid)")
	}
	if columns["external_url"] {
		dedupParts = append(dedupParts, "(src.document_uuid IS NULL AND src.external_url IS NOT NULL AND dst.external_url = src.external_url)")
	}
	if len(dedupParts) == 0 {
		return "", nil
	}

	insertColumns := []string{"entity_type", "entity_id"}
	selectExprs := []string{"?", "?"}
	args := []any{"opportunity", opportunityID}
	for _, column := range []string{"document_uuid", "external_url", "external_mime_type", "document_title", "link_type", "source_type", "created_by", "created_at"} {
		if columns[column] {
			insertColumns = append(insertColumns, column)
			selectExprs = append(selectExprs, "src."+altocQuoteID(column))
		}
	}

	where := []string{"src.entity_type = ?", "src.entity_id = ?"}
	args = append(args, "lead", leadID, "opportunity", opportunityID)
	if columns["deleted_at"] {
		where = append(where, "src.deleted_at IS NULL")
	}

	statement := "INSERT INTO document_link (" + altocQuoteIDList(insertColumns) + ") " +
		"SELECT " + strings.Join(selectExprs, ", ") + " FROM document_link src " +
		"WHERE " + strings.Join(where, " AND ") + " " +
		"AND NOT EXISTS (SELECT 1 FROM document_link dst WHERE dst.entity_type = ? AND dst.entity_id = ? AND (" + strings.Join(dedupParts, " OR ") + "))"
	return statement, args
}

func (a *Adapter) resolveLeadConversionStageTx(ctx context.Context, tx *sql.Tx, body map[string]any) (map[string]any, error) {
	return a.resolveInitialOpportunityStageTx(ctx, tx, body)
}

func (a *Adapter) createLeadOpportunityTx(ctx context.Context, tx *sql.Tx, lead map[string]any, customer map[string]any, stage map[string]any, body map[string]any, operator string) (int64, string, error) {
	code, err := nextAltocCode(ctx, tx, "OP", "opportunity")
	if err != nil {
		return 0, "", err
	}
	forecastCategory, err := leadConversionForecastCategory(body)
	if err != nil {
		return 0, "", err
	}
	owner := firstNonEmptyText(altocBodyText(body, "owner_user_id"), altocMapText(lead, "owner_user_id"), operator)
	if owner == "" {
		return 0, "", httperror.New(http.StatusBadRequest, "missing_owner_user_id", "owner_user_id is required")
	}
	nextAction := firstNonEmptyText(altocBodyText(body, "next_action"), altocMapText(lead, "next_action"))
	nextActionDueAt := firstNonEmptyText(altocBodyText(body, "next_action_due_at"), altocMapText(lead, "next_action_due_at"))
	amount := altocOptionalMoney(body, "amount_tax_inclusive", "amount", "estimated_budget")
	if amount == nil && moneyValue(lead["estimated_budget"]) > 0 {
		amount = lead["estimated_budget"]
	}
	opportunityID, err := altocInsertRecordTx(ctx, tx, "opportunity", map[string]any{
		"code":                 code,
		"name":                 firstNonEmptyText(altocBodyText(body, "opportunity_name"), altocMapText(lead, "name")),
		"customer_id":          customer["id"],
		"lead_id":              lead["id"],
		"source_type":          firstNonEmptyText(altocBodyText(body, "source_type"), altocMapText(lead, "source_type")),
		"source_detail":        firstNonEmptyText(altocBodyText(body, "source_detail"), altocMapText(lead, "source_detail")),
		"stage_id":             stage["id"],
		"forecast_category":    forecastCategory,
		"status":               "active",
		"amount_tax_inclusive": amount,
		"expected_sign_date": altocDateText(firstNonEmptyText(
			altocBodyText(body, "expected_sign_date"),
			altocBodyText(body, "expectedSignDate"),
			altocBodyText(body, "expected_procurement_date"),
			altocBodyText(body, "expectedProcurementDate"),
		)),
		"expected_payment_date": altocDateText(
			altocBodyText(body, "expected_payment_date"),
		),
		"win_rate":           stage["win_rate"],
		"owner_user_id":      owner,
		"owner_dept_code":    firstNonEmptyText(altocBodyText(body, "owner_dept_code"), altocMapText(lead, "owner_dept_code"), altocActorDeptCode(body)),
		"next_action":        nullableText(nextAction),
		"next_action_due_at": altocDateTimeText(nextActionDueAt),
		"remark":             leadConversionOpportunityRemark(body, lead),
		"created_by":         nullableText(operator),
		"updated_by":         nullableText(operator),
		"last_status_changed_by": nullableText(
			operator,
		),
		"last_status_changed_at": timeNowSQLText(),
	})
	if err != nil {
		return 0, "", err
	}
	return opportunityID, code, nil
}

func (a *Adapter) requireLeadConversionSimilarOpportunityAckTx(ctx context.Context, tx *sql.Tx, customerID any, lead map[string]any, body map[string]any) error {
	if leadConversionSimilarOpportunityAcknowledged(body) {
		return nil
	}
	where, args, err := leadSimilarOpenOpportunityFilters(customerID, leadConversionOpportunityName(body, lead), body)
	if err != nil || len(where) == 0 {
		return err
	}
	var existingID int64
	err = tx.QueryRowContext(ctx, `
		SELECT op.id
		FROM opportunity op
		WHERE `+strings.Join(where, " AND ")+`
		ORDER BY op.updated_at DESC, op.id DESC
		LIMIT 1
	`, args...).Scan(&existingID)
	if err == sql.ErrNoRows {
		return nil
	}
	if err != nil {
		return err
	}
	return httperror.New(http.StatusConflict, "similar_open_opportunity_exists", "similar open opportunity exists; acknowledge before conversion")
}

func (a *Adapter) opportunityByIDTx(ctx context.Context, tx *sql.Tx, id any) (map[string]any, error) {
	return altocQueryOneMap(ctx, tx, `
		SELECT
		  op.*,
		  cu.code AS customer_code,
		  cu.name AS customer_name,
		  os.name AS stage_name,
		  os.win_rate AS stage_win_rate
		FROM opportunity op
		LEFT JOIN customer cu ON cu.id = op.customer_id
		LEFT JOIN opportunity_stage os ON os.id = op.stage_id
		WHERE op.id = ?
		  AND op.deleted_at IS NULL
		LIMIT 1
	`, id)
}

func (a *Adapter) leadConversionByIdempotencyKeyTx(ctx context.Context, tx *sql.Tx, leadID int64, body map[string]any) (map[string]any, bool, error) {
	key := firstNonEmptyText(firstBodyText(body, "idempotencyKey", "idempotency_key"))
	if key == "" {
		return nil, false, nil
	}
	exists, err := altocTableExists(ctx, tx, "lead_conversion")
	if err != nil || !exists {
		return nil, false, err
	}
	conversion, err := altocQueryOneMap(ctx, tx, `
		SELECT *
		FROM lead_conversion
		WHERE idempotency_key = ?
		LIMIT 1
	`, key)
	if err != nil || conversion == nil {
		return nil, false, err
	}
	if altocPositiveID(conversion["lead_id"]) != leadID {
		return nil, false, httperror.New(http.StatusConflict, "idempotency_key_conflict", "idempotency key belongs to another lead")
	}
	result := map[string]any{
		"lead_id":            conversion["lead_id"],
		"customer_id":        conversion["customer_id"],
		"contact_id":         conversion["contact_id"],
		"opportunity_id":     conversion["opportunity_id"],
		"customer_reused":    true,
		"contact_reused":     true,
		"opportunity_reused": true,
		"idempotent":         true,
	}
	return result, true, nil
}

func (a *Adapter) recordLeadConversionTx(ctx context.Context, tx *sql.Tx, leadID any, customerID any, contactID any, opportunityID any, body map[string]any, operator string) error {
	exists, err := altocTableExists(ctx, tx, "lead_conversion")
	if err != nil || !exists {
		return err
	}
	key := firstBodyText(body, "idempotencyKey", "idempotency_key")
	_, err = altocInsertRecordTx(ctx, tx, "lead_conversion", map[string]any{
		"lead_id":                  leadID,
		"customer_id":              customerID,
		"contact_id":               contactID,
		"opportunity_id":           opportunityID,
		"converted_by":             nullableText(operator),
		"idempotency_key":          nullableText(key),
		"conversion_snapshot_json": map[string]any{"request": body},
	})
	return err
}

func (a *Adapter) recordLeadConvertedOutboxTx(ctx context.Context, tx *sql.Tx, leadID any, customerID any, contactID any, opportunityID any, customerReused bool, contactReused bool, body map[string]any, operator string) error {
	exists, err := altocTableExists(ctx, tx, "domain_event_outbox")
	if err != nil || !exists {
		return err
	}
	_, err = altocInsertRecordTx(ctx, tx, "domain_event_outbox", leadConvertedOutboxFields(leadID, customerID, contactID, opportunityID, customerReused, contactReused, body, operator))
	return err
}

func leadConvertedOutboxFields(leadID any, customerID any, contactID any, opportunityID any, customerReused bool, contactReused bool, body map[string]any, operator string) map[string]any {
	key := leadConvertedEventKey(leadID)
	return map[string]any{
		"event_key":      key,
		"event_type":     "LeadConverted",
		"aggregate_type": "lead",
		"aggregate_id":   leadID,
		"payload_json":   leadConvertedEventPayload(leadID, customerID, contactID, opportunityID, customerReused, contactReused, body, operator),
		"status":         "pending",
		"attempts":       0,
		"created_by":     nullableText(operator),
		"updated_by":     nullableText(operator),
	}
}

func leadConvertedEventKey(leadID any) string {
	return "altoc.lead.converted:" + strings.TrimSpace(fmt.Sprint(leadID))
}

func leadConvertedEventPayload(leadID any, customerID any, contactID any, opportunityID any, customerReused bool, contactReused bool, body map[string]any, operator string) map[string]any {
	return map[string]any{
		"event_type":      "LeadConverted",
		"lead_id":         leadID,
		"customer_id":     customerID,
		"contact_id":      contactID,
		"opportunity_id":  opportunityID,
		"customer_reused": customerReused,
		"contact_reused":  contactReused,
		"converted_by":    operator,
		"idempotency_key": nullableText(firstBodyText(body, "idempotencyKey", "idempotency_key")),
		"source_app":      "altoc",
		"schema_version":  1,
	}
}

func (a *Adapter) leadConversionResultTx(ctx context.Context, tx *sql.Tx, lead map[string]any, idempotent bool) (map[string]any, error) {
	customerID := lead["converted_customer_id"]
	opportunityID := lead["converted_opportunity_id"]
	var contactID any
	if conversionExists, err := altocTableExists(ctx, tx, "lead_conversion"); err != nil {
		return nil, err
	} else if conversionExists {
		conversion, err := altocQueryOneMap(ctx, tx, `
			SELECT *
			FROM lead_conversion
			WHERE lead_id = ?
			LIMIT 1
		`, lead["id"])
		if err != nil {
			return nil, err
		}
		if conversion != nil {
			contactID = conversion["contact_id"]
		}
	}
	return map[string]any{
		"lead_id":            lead["id"],
		"customer_id":        customerID,
		"contact_id":         contactID,
		"opportunity_id":     opportunityID,
		"customer_reused":    true,
		"contact_reused":     contactID != nil,
		"opportunity_reused": true,
		"idempotent":         idempotent,
	}, nil
}

func contactIDOrNil(contact map[string]any) any {
	if contact == nil {
		return nil
	}
	return contact["id"]
}

func timeNowSQLText() string {
	return strings.TrimSpace(fmt.Sprint(altocDateTimeText(time.Now().UTC().Format(time.RFC3339))))
}
