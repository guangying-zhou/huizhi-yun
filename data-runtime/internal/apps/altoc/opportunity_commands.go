package altoc

import (
	"context"
	"database/sql"
	"encoding/json"
	"fmt"
	"net/http"
	"sort"
	"strings"

	"github.com/huizhi-yun/data-runtime/internal/httperror"
)

var opportunityTransitionFields = []string{
	"forecast_category",
	"amount_tax_inclusive",
	"amount_tax_exclusive",
	"expected_sign_date",
	"expected_payment_date",
	"next_action",
	"next_action_due_at",
	"risk_level",
	"risk_reason",
	"competitor_info",
	"won_reason_code",
	"won_reason",
	"lost_reason_code",
	"lost_reason",
	"pause_reason_code",
	"pause_reason",
	"remark",
}

var opportunityDetailUpdateFields = []string{
	"name",
	"customer_id",
	"source_type",
	"source_detail",
	"amount_tax_inclusive",
	"amount_tax_exclusive",
	"currency_code",
	"expected_sign_date",
	"expected_payment_date",
	"pre_sales_user_id",
	"delivery_user_id",
	"next_action",
	"next_action_due_at",
	"risk_level",
	"risk_reason",
	"competitor_info",
	"remark",
}

func (a *Adapter) createOpportunity(ctx context.Context, body map[string]any) (map[string]any, error) {
	if err := validateOpportunityCreateInput(body); err != nil {
		return nil, err
	}

	customerID := altocPositiveID(firstNonEmptyText(altocBodyText(body, "customer_id"), altocBodyText(body, "customerId")))
	tx, err := a.DB().BeginTx(ctx, nil)
	if err != nil {
		return nil, err
	}
	defer tx.Rollback()

	customer, err := altocQueryOneMap(ctx, tx, `
		SELECT *
		FROM customer
		WHERE id = ?
		  AND deleted_at IS NULL
		LIMIT 1
		FOR UPDATE
	`, customerID)
	if err != nil {
		return nil, err
	}
	if customer == nil {
		return nil, httperror.New(http.StatusNotFound, "customer_not_found", "customer not found")
	}
	allowed, err := altocRecordMatchesReadScope(body, "customer", customer, "owner_user_id", "owner_dept_code")
	if err != nil {
		return nil, err
	}
	if !allowed {
		return nil, httperror.New(http.StatusNotFound, "customer_not_found", "customer not found")
	}

	stage, err := a.resolveInitialOpportunityStageTx(ctx, tx, body)
	if err != nil {
		return nil, err
	}
	if !opportunityStageAllowsInitialCreate(stage) {
		return nil, httperror.New(http.StatusBadRequest, "invalid_initial_stage", "initial opportunity stage must be an open active stage")
	}
	operator := altocActor(body)
	fields, code, err := opportunityCreateFields(ctx, tx, body, customer, stage, operator)
	if err != nil {
		return nil, err
	}
	if err := altocRequireRecordWrite(body, "opportunity", fields, "owner_user_id", "owner_dept_code"); err != nil {
		return nil, err
	}
	if err := validateOpportunityStageRequirements(stage, fields, nil); err != nil {
		return nil, err
	}

	opportunityID, err := altocInsertRecordTx(ctx, tx, "opportunity", fields)
	if err != nil {
		return nil, err
	}
	opportunity, err := a.opportunityByIDTx(ctx, tx, opportunityID)
	if err != nil {
		return nil, err
	}
	if err := insertOpportunityStageLogTx(ctx, tx, opportunityID, nil, stage["id"], operator, firstNonEmptyText(firstBodyText(body, "changeReason", "change_reason"), "新建商机"), opportunity); err != nil {
		return nil, err
	}
	nextAction := firstNonEmptyText(altocBodyText(body, "next_action"), altocBodyText(body, "nextAction"))
	nextActionDueAt := altocDateTimeText(firstNonEmptyText(altocBodyText(body, "next_action_due_at"), altocBodyText(body, "nextActionDueAt")))
	if err := insertAltocSalesTaskIfNeededTx(ctx, tx, "opportunity", opportunityID, nextAction, nextActionDueAt, fmt.Sprint(fields["owner_user_id"]), operator); err != nil {
		return nil, err
	}
	if err := insertAltocAuditTx(ctx, tx, "opportunity", opportunityID, "create", nil, map[string]any{
		"code":        code,
		"name":        fields["name"],
		"customer_id": customerID,
		"stage_id":    stage["id"],
		"status":      fields["status"],
		"win_rate":    stage["win_rate"],
	}, operator); err != nil {
		return nil, err
	}
	if err := tx.Commit(); err != nil {
		return nil, err
	}
	return map[string]any{
		"id":          opportunityID,
		"code":        code,
		"opportunity": opportunity,
	}, nil
}

func (a *Adapter) updateOpportunityDetails(ctx context.Context, identifier string, body map[string]any) (map[string]any, error) {
	opportunityID, err := altocIdentifierID(identifier, "opportunity_id")
	if err != nil {
		return nil, err
	}
	updates, err := opportunityDetailUpdates(body)
	if err != nil {
		return nil, err
	}

	tx, err := a.DB().BeginTx(ctx, nil)
	if err != nil {
		return nil, err
	}
	defer tx.Rollback()

	opportunity, err := altocQueryOneMap(ctx, tx, `
		SELECT *
		FROM opportunity
		WHERE id = ?
		  AND deleted_at IS NULL
		LIMIT 1
		FOR UPDATE
	`, opportunityID)
	if err != nil {
		return nil, err
	}
	if opportunity == nil {
		return nil, httperror.New(http.StatusNotFound, "record_not_found", "opportunity not found")
	}
	operator := altocActor(body)
	if err := altocRequireRecordWrite(body, "opportunity", opportunity, "owner_user_id", "owner_dept_code"); err != nil {
		return nil, err
	}
	if err := altocRequireActionScope(body, "opportunity", "edit"); err != nil {
		return nil, err
	}
	if err := validateOpportunityNextActionDuePair(opportunity, updates); err != nil {
		return nil, err
	}
	if customerID, ok := updates["customer_id"]; ok {
		customer, err := altocQueryOneMap(ctx, tx, `
			SELECT *
			FROM customer
			WHERE id = ?
			  AND deleted_at IS NULL
			LIMIT 1
			FOR UPDATE
		`, customerID)
		if err != nil {
			return nil, err
		}
		if customer == nil {
			return nil, httperror.New(http.StatusNotFound, "customer_not_found", "customer not found")
		}
		allowed, err := altocRecordMatchesReadScope(body, "customer", customer, "owner_user_id", "owner_dept_code")
		if err != nil {
			return nil, err
		}
		if !allowed {
			return nil, httperror.New(http.StatusNotFound, "customer_not_found", "customer not found")
		}
	}
	if len(updates) > 0 {
		if err := updateOpportunityDetailsTx(ctx, tx, opportunityID, updates, operator); err != nil {
			return nil, err
		}
		if nextAction, ok := updates["next_action"]; ok && altocValuePresent(nextAction) {
			dueAt := firstNonEmptyValue(updates["next_action_due_at"], opportunity["next_action_due_at"])
			assignee := firstNonEmptyText(altocMapText(updates, "owner_user_id"), altocMapText(opportunity, "owner_user_id"), operator)
			if err := insertAltocSalesTaskIfNeededTx(ctx, tx, "opportunity", opportunityID, strings.TrimSpace(fmt.Sprint(nextAction)), dueAt, assignee, operator); err != nil {
				return nil, err
			}
		}
		if err := insertAltocAuditTx(ctx, tx, "opportunity", opportunityID, "update", opportunityAuditSnapshot(opportunity, updates), updates, operator); err != nil {
			return nil, err
		}
	}
	updated, err := a.opportunityByIDTx(ctx, tx, opportunityID)
	if err != nil {
		return nil, err
	}
	if err := tx.Commit(); err != nil {
		return nil, err
	}
	return map[string]any{
		"opportunity": updated,
		"changed":     len(updates) > 0,
	}, nil
}

func (a *Adapter) assignOpportunity(ctx context.Context, identifier string, body map[string]any) (map[string]any, error) {
	opportunityID, err := altocIdentifierID(identifier, "opportunity_id")
	if err != nil {
		return nil, err
	}
	assignee := firstNonEmptyText(firstBodyText(body, "assignee", "ownerUserId", "owner_user_id"))
	if assignee == "" {
		return nil, httperror.New(http.StatusBadRequest, "missing_owner_user_id", "owner_user_id is required")
	}

	tx, err := a.DB().BeginTx(ctx, nil)
	if err != nil {
		return nil, err
	}
	defer tx.Rollback()

	opportunity, err := altocQueryOneMap(ctx, tx, `
		SELECT *
		FROM opportunity
		WHERE id = ?
		  AND deleted_at IS NULL
		LIMIT 1
		FOR UPDATE
	`, opportunityID)
	if err != nil {
		return nil, err
	}
	if opportunity == nil {
		return nil, httperror.New(http.StatusNotFound, "record_not_found", "opportunity not found")
	}
	if err := altocRequireRecordWrite(body, "opportunity", opportunity, "owner_user_id", "owner_dept_code"); err != nil {
		return nil, err
	}
	if err := altocRequireActionScope(body, "opportunity", "assign"); err != nil {
		return nil, err
	}

	operator := altocActor(body)
	set := []string{"owner_user_id = ?", "updated_by = ?", "updated_at = CURRENT_TIMESTAMP"}
	args := []any{assignee, operator}
	newValue := map[string]any{"owner_user_id": assignee}
	if deptCode, ok := altocBodyValue(body, "owner_dept_code"); ok {
		set = append(set, "owner_dept_code = ?")
		normalizedDept := nullableBodyValue(deptCode)
		args = append(args, normalizedDept)
		newValue["owner_dept_code"] = normalizedDept
	}
	args = append(args, opportunityID)
	if _, err := tx.ExecContext(ctx, "UPDATE opportunity SET "+strings.Join(set, ", ")+" WHERE id = ?", args...); err != nil {
		return nil, err
	}
	oldValue := map[string]any{
		"owner_user_id":   opportunity["owner_user_id"],
		"owner_dept_code": opportunity["owner_dept_code"],
	}
	if err := insertAltocAuditTx(ctx, tx, "opportunity", opportunityID, "assign", oldValue, newValue, operator); err != nil {
		return nil, err
	}
	updated, err := a.opportunityByIDTx(ctx, tx, opportunityID)
	if err != nil {
		return nil, err
	}
	if err := tx.Commit(); err != nil {
		return nil, err
	}
	return map[string]any{"opportunity": updated, "changed": true}, nil
}

func (a *Adapter) transitionOpportunity(ctx context.Context, identifier string, body map[string]any) (map[string]any, error) {
	opportunityID, err := altocIdentifierID(identifier, "opportunity_id")
	if err != nil {
		return nil, err
	}

	tx, err := a.DB().BeginTx(ctx, nil)
	if err != nil {
		return nil, err
	}
	defer tx.Rollback()

	opportunity, err := altocQueryOneMap(ctx, tx, `
		SELECT *
		FROM opportunity
		WHERE id = ?
		  AND deleted_at IS NULL
		LIMIT 1
		FOR UPDATE
	`, opportunityID)
	if err != nil {
		return nil, err
	}
	if opportunity == nil {
		return nil, httperror.New(http.StatusNotFound, "record_not_found", "opportunity not found")
	}

	stage, err := a.resolveOpportunityTransitionStageTx(ctx, tx, opportunity, body)
	if err != nil {
		return nil, err
	}
	operator := altocActor(body)
	if err := altocRequireRecordWrite(body, "opportunity", opportunity, "owner_user_id", "owner_dept_code"); err != nil {
		return nil, err
	}
	if err := altocRequireActionScope(body, "opportunity", "transition"); err != nil {
		return nil, err
	}
	updates, err := opportunityTransitionUpdates(body)
	if err != nil {
		return nil, err
	}
	if err := validateOpportunityNextActionDuePair(opportunity, updates); err != nil {
		return nil, err
	}
	targetStatus := opportunityStatusForStage(stage)
	stageChanged := altocPositiveID(opportunity["stage_id"]) != altocPositiveID(stage["id"])
	statusChanged := strings.TrimSpace(fmt.Sprint(opportunity["status"])) != targetStatus
	if err := validateOpportunityTerminalReasons(targetStatus, opportunity, updates); err != nil {
		return nil, err
	}
	if err := validateOpportunityStageRequirements(stage, opportunity, updates); err != nil {
		return nil, err
	}
	if err := a.validateOpportunityStageExitCriteriaTx(ctx, tx, opportunity, updates, stage); err != nil {
		return nil, err
	}

	oldValue := map[string]any{
		"stage_id":          opportunity["stage_id"],
		"status":            opportunity["status"],
		"win_rate":          opportunity["win_rate"],
		"won_reason_code":   opportunity["won_reason_code"],
		"won_reason":        opportunity["won_reason"],
		"lost_reason_code":  opportunity["lost_reason_code"],
		"lost_reason":       opportunity["lost_reason"],
		"pause_reason_code": opportunity["pause_reason_code"],
		"pause_reason":      opportunity["pause_reason"],
	}

	if err := updateOpportunityTransitionTx(ctx, tx, opportunityID, stage, targetStatus, updates, operator); err != nil {
		return nil, err
	}
	updated, err := a.opportunityByIDTx(ctx, tx, opportunityID)
	if err != nil {
		return nil, err
	}
	if stageChanged || statusChanged {
		if err := insertOpportunityStageLogTx(ctx, tx, opportunityID, opportunity["stage_id"], stage["id"], operator, nullableText(firstBodyText(body, "changeReason", "change_reason", "reason")), updated); err != nil {
			return nil, err
		}
	}
	if err := insertAltocAuditTx(ctx, tx, "opportunity", opportunityID, "status_change", oldValue, map[string]any{
		"stage_id": stage["id"],
		"status":   targetStatus,
		"win_rate": stage["win_rate"],
		"updates":  updates,
	}, operator); err != nil {
		return nil, err
	}
	if nextAction, ok := updates["next_action"]; ok && altocValuePresent(nextAction) {
		dueAt := opportunityValueAfterUpdate(opportunity, updates, "next_action_due_at")
		if err := insertAltocSalesTaskIfNeededTx(ctx, tx, "opportunity", opportunityID, strings.TrimSpace(fmt.Sprint(nextAction)), dueAt, firstNonEmptyText(altocMapText(opportunity, "owner_user_id"), operator), operator); err != nil {
			return nil, err
		}
	}

	if err := tx.Commit(); err != nil {
		return nil, err
	}
	return map[string]any{
		"opportunity": updated,
		"changed":     stageChanged || statusChanged || len(updates) > 0,
	}, nil
}

func (a *Adapter) createOpportunityActivity(ctx context.Context, identifier string, body map[string]any) (map[string]any, error) {
	opportunityID, err := altocIdentifierID(identifier, "opportunity_id")
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

	opportunity, err := altocQueryOneMap(ctx, tx, `
		SELECT id, customer_id, owner_user_id, owner_dept_code
		FROM opportunity
		WHERE id = ?
		  AND deleted_at IS NULL
		LIMIT 1
		FOR UPDATE
	`, opportunityID)
	if err != nil {
		return nil, err
	}
	if opportunity == nil {
		return nil, httperror.New(http.StatusNotFound, "record_not_found", "opportunity not found")
	}

	operator := altocActor(body)
	if err := altocRequireRecordWrite(body, "opportunity", opportunity, "owner_user_id", "owner_dept_code"); err != nil {
		return nil, err
	}
	if err := altocRequireActionScope(body, "opportunity", "activity"); err != nil {
		return nil, err
	}
	owner := firstNonEmptyText(firstBodyText(body, "ownerUserId", "owner_user_id"), operator, altocMapText(opportunity, "owner_user_id"))
	code, err := nextAltocCode(ctx, tx, "SA", "sales_activity")
	if err != nil {
		return nil, err
	}
	nextAction := firstBodyText(body, "nextAction", "next_action")
	nextActionDueAt := altocDateTimeText(firstBodyText(body, "nextActionDueAt", "next_action_due_at"))
	if nextAction != "" && !altocValuePresent(nextActionDueAt) {
		return nil, httperror.New(http.StatusBadRequest, "missing_next_action", "next_action_due_at is required when next_action is provided")
	}
	activityID, err := altocInsertRecordTx(ctx, tx, "sales_activity", map[string]any{
		"code":               code,
		"activity_type":      firstNonEmptyText(firstBodyText(body, "activityType", "activity_type"), "memo"),
		"subject":            subject,
		"customer_id":        opportunity["customer_id"],
		"contact_id":         nullablePositiveID(firstBodyText(body, "contactId", "contact_id")),
		"opportunity_id":     opportunityID,
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
	opportunityColumns, err := altocTableColumns(ctx, tx, "opportunity")
	if err != nil {
		return nil, err
	}
	set, args := opportunityActivityOpportunityUpdateParts(opportunityColumns, nextAction, nextActionDueAt, operator)
	args = append(args, opportunityID)
	if _, err := tx.ExecContext(ctx, "UPDATE opportunity SET "+strings.Join(set, ", ")+" WHERE id = ?", args...); err != nil {
		return nil, err
	}
	if nextAction != "" {
		if err := insertAltocSalesTaskIfNeededTx(ctx, tx, "opportunity", opportunityID, nextAction, nextActionDueAt, firstNonEmptyText(altocMapText(opportunity, "owner_user_id"), owner), operator); err != nil {
			return nil, err
		}
	}
	customerColumns, err := altocTableColumns(ctx, tx, "customer")
	if err != nil {
		return nil, err
	}
	customerSet, customerArgs := opportunityActivityCustomerUpdateParts(customerColumns, operator)
	customerArgs = append(customerArgs, opportunity["customer_id"])
	if _, err := tx.ExecContext(ctx, "UPDATE customer SET "+strings.Join(customerSet, ", ")+" WHERE id = ?", customerArgs...); err != nil {
		return nil, err
	}
	if err := insertAltocAuditTx(ctx, tx, "sales_activity", activityID, "create", nil, map[string]any{
		"code":           code,
		"opportunity_id": opportunityID,
		"customer_id":    opportunity["customer_id"],
		"activity_type":  firstNonEmptyText(firstBodyText(body, "activityType", "activity_type"), "memo"),
		"subject":        subject,
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

func opportunityActivityOpportunityUpdateParts(columns map[string]bool, nextAction string, nextActionDueAt any, operator string) ([]string, []any) {
	set := make([]string, 0, 5)
	args := make([]any, 0, 4)
	if columns["last_follow_up_at"] {
		set = append(set, "last_follow_up_at = CURRENT_TIMESTAMP")
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

func opportunityActivityCustomerUpdateParts(columns map[string]bool, operator string) ([]string, []any) {
	set := make([]string, 0, 3)
	args := make([]any, 0, 1)
	if columns["last_follow_up_at"] {
		set = append(set, "last_follow_up_at = CURRENT_TIMESTAMP")
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

func (a *Adapter) resolveOpportunityTransitionStageTx(ctx context.Context, tx *sql.Tx, opportunity map[string]any, body map[string]any) (map[string]any, error) {
	stageColumns, err := altocTableColumns(ctx, tx, "opportunity_stage")
	if err != nil {
		return nil, err
	}
	pipelineCode, hasPipelineColumn, err := a.opportunityPipelineCodeForTransitionTx(ctx, tx, opportunity, stageColumns)
	if err != nil {
		return nil, err
	}
	stageID := altocPositiveID(firstNonEmptyText(
		firstBodyText(body, "stageId", "stage_id", "toStageId", "to_stage_id"),
	))
	if stageID == 0 {
		action := strings.TrimSpace(firstBodyText(body, "action"))
		stageID, err = a.stageIDForActionTx(ctx, tx, action, stageColumns, pipelineCode)
		if err != nil {
			return nil, err
		}
	}
	if stageID == 0 {
		return nil, httperror.New(http.StatusBadRequest, "missing_stage_id", "stage_id is required")
	}
	stage, err := altocQueryOneMap(ctx, tx, `
		SELECT *
		FROM opportunity_stage
		WHERE id = ?
		  AND is_enabled = 1
		LIMIT 1
	`, stageID)
	if err != nil {
		return nil, err
	}
	if stage == nil {
		return nil, httperror.New(http.StatusNotFound, "stage_not_found", "opportunity stage not found")
	}
	if hasPipelineColumn && !opportunityStagePipelineMatches(stage, pipelineCode) {
		return nil, httperror.New(http.StatusBadRequest, "invalid_stage_pipeline", "target stage belongs to another sales pipeline")
	}
	return stage, nil
}

func (a *Adapter) stageIDForActionTx(ctx context.Context, tx *sql.Tx, action string, stageColumns map[string]bool, pipelineCode string) (int64, error) {
	where, ok := opportunityStageActionWhere(action, stageColumns)
	if !ok {
		return 0, nil
	}
	filters := []string{"is_enabled = 1", where}
	args := make([]any, 0, 1)
	if stageColumns["pipeline_code"] {
		filters = append(filters, "pipeline_code = ?")
		args = append(args, firstNonEmptyText(pipelineCode, "default"))
	}
	stage, err := altocQueryOneMap(ctx, tx, `
		SELECT id
		FROM opportunity_stage
		WHERE `+strings.Join(filters, " AND ")+`
		ORDER BY sort_no ASC, id ASC
		LIMIT 1
	`, args...)
	if err != nil || stage == nil {
		return 0, err
	}
	return altocPositiveID(stage["id"]), nil
}

func opportunityStageActionWhere(action string, stageColumns map[string]bool) (string, bool) {
	switch strings.TrimSpace(action) {
	case "close_won", "close-won", "won":
		return "is_won = 1", true
	case "close_lost", "close-lost", "lost":
		return "is_lost = 1", true
	case "pause", "paused":
		if stageColumns["stage_kind"] {
			return "(stage_kind = 'paused' OR code = 'paused')", true
		}
		return "code = 'paused'", true
	case "reopen", "active":
		if stageColumns["stage_kind"] {
			return "is_closed = 0 AND COALESCE(is_won, 0) = 0 AND COALESCE(is_lost, 0) = 0 AND COALESCE(stage_kind, 'normal') <> 'paused' AND code <> 'paused'", true
		}
		return "is_closed = 0 AND COALESCE(is_won, 0) = 0 AND COALESCE(is_lost, 0) = 0 AND code <> 'paused'", true
	default:
		return "", false
	}
}

func validateOpportunityCreateInput(body map[string]any) error {
	if firstNonEmptyText(altocBodyText(body, "name")) == "" {
		return httperror.New(http.StatusBadRequest, "missing_opportunity_name", "name is required")
	}
	if altocPositiveID(firstNonEmptyText(altocBodyText(body, "customer_id"), altocBodyText(body, "customerId"))) <= 0 {
		return httperror.New(http.StatusBadRequest, "missing_customer", "customer_id is required")
	}
	if altocPositiveID(firstNonEmptyText(altocBodyText(body, "lead_id"), altocBodyText(body, "leadId"))) > 0 {
		return httperror.New(http.StatusBadRequest, "lead_conversion_required", "lead_id can only be set by lead conversion")
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
	if _, err := opportunityCreateForecastCategory(body); err != nil {
		return err
	}
	return nil
}

func opportunityCreateForecastCategory(body map[string]any) (string, error) {
	category := firstNonEmptyText(altocBodyText(body, "forecast_category"), altocBodyText(body, "forecastCategory"))
	switch category {
	case "", "pipeline":
		return "pipeline", nil
	case "best_case":
		return category, nil
	case "commit":
		return "", httperror.New(http.StatusBadRequest, "invalid_forecast_category", "new opportunities can only start as pipeline or best_case")
	default:
		return "", httperror.New(http.StatusBadRequest, "invalid_forecast_category", "forecast_category is invalid")
	}
}

func opportunityStageAllowsInitialCreate(stage map[string]any) bool {
	return opportunityStatusForStage(stage) == "active" && !altocBool(stage["is_closed"]) && opportunityStageKind(stage) != "paused"
}

func (a *Adapter) resolveInitialOpportunityStageTx(ctx context.Context, tx *sql.Tx, body map[string]any) (map[string]any, error) {
	stageColumns, err := altocTableColumns(ctx, tx, "opportunity_stage")
	if err != nil {
		return nil, err
	}
	pipelineCode, pipelineRequested, err := opportunityPipelineCodeFromBody(body)
	if err != nil {
		return nil, err
	}
	stageID := altocPositiveID(firstNonEmptyText(altocBodyText(body, "stage_id"), altocBodyText(body, "initial_stage_id")))
	if stageID > 0 {
		stage, err := altocQueryOneMap(ctx, tx, `
			SELECT *
			FROM opportunity_stage
			WHERE id = ?
			  AND is_enabled = 1
			LIMIT 1
		`, stageID)
		if err != nil {
			return nil, err
		}
		if stage == nil {
			return nil, httperror.New(http.StatusNotFound, "stage_not_found", "opportunity stage not found")
		}
		if stageColumns["pipeline_code"] && pipelineRequested && !opportunityStagePipelineMatches(stage, pipelineCode) {
			return nil, httperror.New(http.StatusBadRequest, "invalid_stage_pipeline", "initial stage belongs to another sales pipeline")
		}
		return stage, nil
	}
	where, args, pipelineCode, _, err := initialOpportunityStageWhere(stageColumns, body)
	if err != nil {
		return nil, err
	}
	stage, err := altocQueryOneMap(ctx, tx, `
		SELECT *
		FROM opportunity_stage
		WHERE `+strings.Join(where, " AND ")+`
		ORDER BY sort_no ASC, id ASC
		LIMIT 1
	`, args...)
	if err != nil {
		return nil, err
	}
	if stage == nil {
		return nil, httperror.New(http.StatusInternalServerError, "stage_missing", "opportunity stage config is missing for pipeline "+pipelineCode)
	}
	return stage, nil
}

func initialOpportunityStageWhere(stageColumns map[string]bool, body map[string]any) ([]string, []any, string, bool, error) {
	pipelineCode, _, err := opportunityPipelineCodeFromBody(body)
	if err != nil {
		return nil, nil, "", false, err
	}
	where := []string{"is_enabled = 1", "is_closed = 0"}
	args := make([]any, 0, 1)
	if stageColumns["stage_kind"] {
		where = append(where, "COALESCE(stage_kind, 'normal') <> 'paused'")
	} else {
		where = append(where, "code <> 'paused'")
	}
	hasPipelineColumn := stageColumns["pipeline_code"]
	if hasPipelineColumn {
		where = append(where, "pipeline_code = ?")
		args = append(args, pipelineCode)
	}
	return where, args, pipelineCode, hasPipelineColumn, nil
}

func opportunityPipelineCodeFromBody(body map[string]any) (string, bool, error) {
	raw := firstNonEmptyText(
		altocBodyText(body, "pipeline_code"),
		altocBodyText(body, "pipelineCode"),
		altocBodyText(body, "sales_pipeline_code"),
		altocBodyText(body, "salesPipelineCode"),
	)
	if raw == "" {
		return "default", false, nil
	}
	pipelineCode, err := normalizeOpportunityPipelineCode(raw)
	return pipelineCode, true, err
}

func normalizeOpportunityPipelineCode(value string) (string, error) {
	code := strings.ToLower(strings.TrimSpace(value))
	switch code {
	case "", "standard":
		return "default", nil
	case "tob", "tob_solution", "solution_sales":
		return "solution", nil
	case "tog", "government", "government_project":
		return "tog_project", nil
	}
	if len(code) > 50 {
		return "", httperror.New(http.StatusBadRequest, "invalid_pipeline_code", "pipeline_code is too long")
	}
	for _, r := range code {
		if (r >= 'a' && r <= 'z') || (r >= '0' && r <= '9') || r == '_' || r == '-' {
			continue
		}
		return "", httperror.New(http.StatusBadRequest, "invalid_pipeline_code", "pipeline_code must use lowercase letters, digits, dash, or underscore")
	}
	return code, nil
}

func opportunityStageKind(stage map[string]any) string {
	kind := strings.ToLower(strings.TrimSpace(altocMapText(stage, "stage_kind")))
	if kind != "" {
		return kind
	}
	switch {
	case altocBool(stage["is_won"]):
		return "won"
	case altocBool(stage["is_lost"]):
		return "lost"
	case strings.TrimSpace(altocMapText(stage, "code")) == "paused":
		return "paused"
	default:
		return "normal"
	}
}

func opportunityStagePipelineMatches(stage map[string]any, pipelineCode string) bool {
	stagePipeline, err := normalizeOpportunityPipelineCode(altocMapText(stage, "pipeline_code"))
	if err != nil {
		return false
	}
	return stagePipeline == firstNonEmptyText(pipelineCode, "default")
}

func (a *Adapter) opportunityPipelineCodeForTransitionTx(ctx context.Context, tx *sql.Tx, opportunity map[string]any, stageColumns map[string]bool) (string, bool, error) {
	if !stageColumns["pipeline_code"] {
		return "default", false, nil
	}
	stageID := altocPositiveID(opportunity["stage_id"])
	if stageID <= 0 {
		return "default", true, nil
	}
	stage, err := altocQueryOneMap(ctx, tx, `
		SELECT pipeline_code
		FROM opportunity_stage
		WHERE id = ?
		LIMIT 1
	`, stageID)
	if err != nil {
		return "", true, err
	}
	if stage == nil {
		return "default", true, nil
	}
	pipelineCode, err := normalizeOpportunityPipelineCode(altocMapText(stage, "pipeline_code"))
	if err != nil {
		return "", true, err
	}
	return pipelineCode, true, nil
}

func opportunityCreateFields(ctx context.Context, tx *sql.Tx, body map[string]any, customer map[string]any, stage map[string]any, operator string) (map[string]any, string, error) {
	code, err := nextAltocCode(ctx, tx, "OP", "opportunity")
	if err != nil {
		return nil, "", err
	}
	forecastCategory, err := opportunityCreateForecastCategory(body)
	if err != nil {
		return nil, "", err
	}
	owner := firstNonEmptyText(altocBodyText(body, "owner_user_id"), altocBodyText(body, "ownerUserId"), operator)
	nextAction := firstNonEmptyText(altocBodyText(body, "next_action"), altocBodyText(body, "nextAction"))
	nextActionDueAt := firstNonEmptyText(altocBodyText(body, "next_action_due_at"), altocBodyText(body, "nextActionDueAt"))
	fields := map[string]any{
		"code":                  code,
		"name":                  firstNonEmptyText(altocBodyText(body, "name")),
		"customer_id":           customer["id"],
		"source_type":           nullableText(altocBodyText(body, "source_type")),
		"source_detail":         nullableText(altocBodyText(body, "source_detail")),
		"stage_id":              stage["id"],
		"forecast_category":     forecastCategory,
		"status":                "active",
		"amount_tax_inclusive":  altocOptionalMoney(body, "amount_tax_inclusive", "amount"),
		"amount_tax_exclusive":  altocOptionalMoney(body, "amount_tax_exclusive"),
		"currency_code":         firstNonEmptyText(altocBodyText(body, "currency_code"), "CNY"),
		"expected_sign_date":    altocDateText(altocBodyText(body, "expected_sign_date")),
		"expected_payment_date": altocDateText(altocBodyText(body, "expected_payment_date")),
		"win_rate":              stage["win_rate"],
		"owner_user_id":         owner,
		"owner_dept_code":       firstNonEmptyText(altocBodyText(body, "owner_dept_code"), altocActorDeptCode(body)),
		"pre_sales_user_id":     nullableText(altocBodyText(body, "pre_sales_user_id")),
		"delivery_user_id":      nullableText(altocBodyText(body, "delivery_user_id")),
		"next_action":           nextAction,
		"next_action_due_at":    altocDateTimeText(nextActionDueAt),
		"competitor_info":       nullableText(altocBodyText(body, "competitor_info")),
		"remark":                nullableText(altocBodyText(body, "remark")),
		"created_by":            nullableText(operator),
		"updated_by":            nullableText(operator),
		"last_status_changed_by": nullableText(
			operator,
		),
		"last_status_changed_at": timeNowSQLText(),
	}
	return fields, code, nil
}

func opportunityDetailUpdates(body map[string]any) (map[string]any, error) {
	updates := map[string]any{}
	for _, field := range opportunityDetailUpdateFields {
		value, ok := altocBodyValue(body, field)
		if !ok {
			continue
		}
		switch field {
		case "name", "owner_user_id":
			text := strings.TrimSpace(fmt.Sprint(value))
			if text == "" || text == "<nil>" {
				return nil, httperror.New(http.StatusBadRequest, "missing_"+field, field+" is required")
			}
			updates[field] = text
		case "customer_id":
			id := altocPositiveID(value)
			if id <= 0 {
				return nil, httperror.New(http.StatusBadRequest, "missing_customer", "customer_id is required")
			}
			updates[field] = id
		case "forecast_category":
			category := strings.TrimSpace(fmt.Sprint(value))
			switch category {
			case "":
				updates[field] = nil
			case "pipeline", "best_case", "commit":
				updates[field] = category
			default:
				return nil, httperror.New(http.StatusBadRequest, "invalid_forecast_category", "forecast_category is invalid")
			}
		case "expected_sign_date", "expected_payment_date":
			updates[field] = altocDateText(strings.TrimSpace(fmt.Sprint(value)))
		case "next_action_due_at":
			updates[field] = altocDateTimeText(strings.TrimSpace(fmt.Sprint(value)))
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

func updateOpportunityDetailsTx(ctx context.Context, tx *sql.Tx, opportunityID int64, updates map[string]any, operator string) error {
	columns, err := altocTableColumns(ctx, tx, "opportunity")
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

	set := make([]string, 0, len(names)+3)
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
	if columns["version_no"] {
		set = append(set, "version_no = COALESCE(version_no, 0) + 1")
	}
	args = append(args, opportunityID)
	_, err = tx.ExecContext(ctx, "UPDATE opportunity SET "+strings.Join(set, ", ")+" WHERE id = ?", args...)
	return err
}

func opportunityAuditSnapshot(opportunity map[string]any, updates map[string]any) map[string]any {
	snapshot := map[string]any{}
	for key := range updates {
		snapshot[key] = opportunity[key]
	}
	return snapshot
}

func opportunityTransitionUpdates(body map[string]any) (map[string]any, error) {
	updates := map[string]any{}
	for _, field := range opportunityTransitionFields {
		value, ok := altocBodyValue(body, field)
		if !ok {
			continue
		}
		switch field {
		case "expected_sign_date", "expected_payment_date":
			updates[field] = altocDateText(strings.TrimSpace(fmt.Sprint(value)))
		case "next_action_due_at":
			updates[field] = altocDateTimeText(strings.TrimSpace(fmt.Sprint(value)))
		case "forecast_category":
			category := strings.TrimSpace(fmt.Sprint(value))
			switch category {
			case "":
				updates[field] = nil
			case "pipeline", "best_case", "commit":
				updates[field] = category
			default:
				return nil, httperror.New(http.StatusBadRequest, "invalid_forecast_category", "forecast_category is invalid")
			}
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

func validateOpportunityNextActionDuePair(opportunity map[string]any, updates map[string]any) error {
	_, actionTouched := updates["next_action"]
	_, dueTouched := updates["next_action_due_at"]
	if !actionTouched && !dueTouched {
		return nil
	}

	nextAction := opportunityValueAfterUpdate(opportunity, updates, "next_action")
	if !altocValuePresent(nextAction) {
		return nil
	}
	nextActionDueAt := opportunityValueAfterUpdate(opportunity, updates, "next_action_due_at")
	if !altocValuePresent(nextActionDueAt) {
		return httperror.New(http.StatusBadRequest, "missing_next_action", "next_action_due_at is required when next_action is provided")
	}
	return nil
}

func opportunityValueAfterUpdate(opportunity map[string]any, updates map[string]any, key string) any {
	if updates != nil {
		if value, ok := updates[key]; ok {
			return value
		}
	}
	if opportunity == nil {
		return nil
	}
	return opportunity[key]
}

func validateOpportunityTerminalReasons(targetStatus string, opportunity map[string]any, updates map[string]any) error {
	switch targetStatus {
	case "won":
		if !altocValuePresent(opportunityValueAfterUpdate(opportunity, updates, "won_reason_code")) {
			return httperror.New(http.StatusBadRequest, "missing_won_reason_code", "won_reason_code is required")
		}
		if !altocValuePresent(opportunityValueAfterUpdate(opportunity, updates, "won_reason")) {
			return httperror.New(http.StatusBadRequest, "missing_won_reason", "won_reason is required")
		}
	case "lost":
		if !altocValuePresent(opportunityValueAfterUpdate(opportunity, updates, "lost_reason_code")) {
			return httperror.New(http.StatusBadRequest, "missing_lost_reason_code", "lost_reason_code is required")
		}
		if !altocValuePresent(opportunityValueAfterUpdate(opportunity, updates, "lost_reason")) {
			return httperror.New(http.StatusBadRequest, "missing_lost_reason", "lost_reason is required")
		}
	case "paused":
		if !altocValuePresent(opportunityValueAfterUpdate(opportunity, updates, "pause_reason_code")) {
			return httperror.New(http.StatusBadRequest, "missing_pause_reason_code", "pause_reason_code is required")
		}
		if !altocValuePresent(opportunityValueAfterUpdate(opportunity, updates, "pause_reason")) {
			return httperror.New(http.StatusBadRequest, "missing_pause_reason", "pause_reason is required")
		}
	}
	return nil
}

func updateOpportunityTransitionTx(ctx context.Context, tx *sql.Tx, opportunityID int64, stage map[string]any, status string, updates map[string]any, operator string) error {
	columns, err := altocTableColumns(ctx, tx, "opportunity")
	if err != nil {
		return err
	}
	set, args := opportunityTransitionSetParts(columns, stage, status, updates, operator)
	args = append(args, opportunityID)

	_, err = tx.ExecContext(ctx, "UPDATE opportunity SET "+strings.Join(set, ", ")+" WHERE id = ?", args...)
	return err
}

func opportunityTransitionSetParts(columns map[string]bool, stage map[string]any, status string, updates map[string]any, operator string) ([]string, []any) {
	names := make([]string, 0, len(updates))
	for name := range updates {
		if !columns[name] {
			continue
		}
		if opportunityTransitionStatusControlledField(status, name) {
			continue
		}
		names = append(names, name)
	}
	sort.Strings(names)

	set := make([]string, 0, len(names)+12)
	args := make([]any, 0, len(names)+8)
	for _, name := range names {
		set = append(set, altocQuoteID(name)+" = ?")
		args = append(args, altocNormalizeInsertValue(updates[name]))
	}
	appendSet := func(name string, value any) {
		if columns[name] {
			set = append(set, altocQuoteID(name)+" = ?")
			args = append(args, value)
		}
	}
	appendSetExpr := func(name string, expr string) {
		if columns[name] {
			set = append(set, altocQuoteID(name)+" = "+expr)
		}
	}
	appendSet("stage_id", stage["id"])
	appendSet("win_rate", stage["win_rate"])
	appendSet("status", status)

	switch status {
	case "won":
		appendSetExpr("won_at", "COALESCE(won_at, CURRENT_TIMESTAMP)")
		appendSet("lost_at", nil)
		appendSet("lost_reason_code", nil)
		appendSet("lost_reason", nil)
		appendSet("pause_reason_code", nil)
		appendSet("pause_reason", nil)
	case "lost":
		appendSetExpr("lost_at", "COALESCE(lost_at, CURRENT_TIMESTAMP)")
		appendSet("won_at", nil)
		appendSet("won_reason_code", nil)
		appendSet("won_reason", nil)
		appendSet("pause_reason_code", nil)
		appendSet("pause_reason", nil)
	case "paused":
		appendSet("won_at", nil)
		appendSet("won_reason_code", nil)
		appendSet("won_reason", nil)
		appendSet("lost_at", nil)
		appendSet("lost_reason_code", nil)
		appendSet("lost_reason", nil)
	default:
		appendSet("won_at", nil)
		appendSet("won_reason_code", nil)
		appendSet("won_reason", nil)
		appendSet("lost_at", nil)
		appendSet("lost_reason_code", nil)
		appendSet("lost_reason", nil)
		appendSet("pause_reason_code", nil)
		appendSet("pause_reason", nil)
	}
	appendSetExpr("last_status_changed_at", "CURRENT_TIMESTAMP")
	appendSet("last_status_changed_by", operator)
	appendSet("updated_by", operator)
	appendSetExpr("updated_at", "CURRENT_TIMESTAMP")
	appendSetExpr("version_no", "COALESCE(version_no, 0) + 1")
	return set, args
}

func opportunityTransitionStatusControlledField(status string, name string) bool {
	switch status {
	case "won":
		return name == "lost_reason_code" || name == "lost_reason" || name == "pause_reason_code" || name == "pause_reason"
	case "lost":
		return name == "won_reason_code" || name == "won_reason" || name == "pause_reason_code" || name == "pause_reason"
	case "paused":
		return name == "won_reason_code" || name == "won_reason" || name == "lost_reason_code" || name == "lost_reason"
	default:
		return name == "won_reason_code" || name == "won_reason" || name == "lost_reason_code" || name == "lost_reason" || name == "pause_reason_code" || name == "pause_reason"
	}
}

func validateOpportunityStageRequirements(stage map[string]any, opportunity map[string]any, updates map[string]any) error {
	fields, err := opportunityRequiredFields(stage["required_fields_json"])
	if err != nil {
		return err
	}
	for _, field := range fields {
		if !altocValuePresent(opportunityValueAfterUpdate(opportunity, updates, field)) {
			return httperror.New(http.StatusBadRequest, "missing_required_field", "required field "+field+" is missing for target stage")
		}
	}
	return nil
}

func (a *Adapter) validateOpportunityStageExitCriteriaTx(ctx context.Context, tx *sql.Tx, opportunity map[string]any, updates map[string]any, targetStage map[string]any) error {
	if altocPositiveID(opportunity["stage_id"]) == altocPositiveID(targetStage["id"]) {
		return nil
	}
	currentStageID := altocPositiveID(opportunity["stage_id"])
	if currentStageID <= 0 {
		return nil
	}
	currentStage, err := altocQueryOneMap(ctx, tx, `
		SELECT *
		FROM opportunity_stage
		WHERE id = ?
		LIMIT 1
	`, currentStageID)
	if err != nil || currentStage == nil {
		return err
	}
	if opportunityStatusForStage(targetStage) != "active" {
		return nil
	}
	fields, err := opportunityCriteriaFields(currentStage["exit_criteria_json"], "exit_criteria_json")
	if err != nil {
		return err
	}
	return validateOpportunityStageExitCriteria(currentStage, targetStage, opportunity, updates, fields)
}

func validateOpportunityStageExitCriteria(currentStage map[string]any, targetStage map[string]any, opportunity map[string]any, updates map[string]any, fields []string) error {
	if altocPositiveID(currentStage["id"]) == altocPositiveID(targetStage["id"]) {
		return nil
	}
	if opportunityStatusForStage(targetStage) != "active" {
		return nil
	}
	for _, field := range fields {
		if !altocValuePresent(opportunityValueAfterUpdate(opportunity, updates, field)) {
			return httperror.New(http.StatusBadRequest, "missing_exit_criteria", "exit criteria field "+field+" is missing for current stage")
		}
	}
	return nil
}

func opportunityRequiredFields(raw any) ([]string, error) {
	return opportunityCriteriaFields(raw, "required_fields_json")
}

func opportunityCriteriaFields(raw any, configName string) ([]string, error) {
	text := strings.TrimSpace(fmt.Sprint(raw))
	if raw == nil || text == "" || text == "<nil>" {
		return nil, nil
	}
	var fields []string
	if err := json.Unmarshal([]byte(text), &fields); err == nil {
		return fields, nil
	}
	var config map[string]any
	if err := json.Unmarshal([]byte(text), &config); err != nil {
		return nil, httperror.New(http.StatusInternalServerError, "invalid_stage_config", "stage "+configName+" is invalid")
	}
	for _, key := range []string{"fields", "required_fields", "requiredFields"} {
		parsed, ok := opportunityCriteriaFieldsFromConfig(config[key])
		if ok {
			return parsed, nil
		}
	}
	return nil, nil
}

func opportunityCriteriaFieldsFromConfig(raw any) ([]string, bool) {
	switch typed := raw.(type) {
	case nil:
		return nil, false
	case []string:
		return append([]string(nil), typed...), true
	case []any:
		fields := make([]string, 0, len(typed))
		for _, item := range typed {
			if text := strings.TrimSpace(fmt.Sprint(item)); text != "" && text != "<nil>" {
				fields = append(fields, text)
			}
		}
		return fields, true
	case string:
		text := strings.TrimSpace(typed)
		if text == "" {
			return nil, true
		}
		var fields []string
		if err := json.Unmarshal([]byte(text), &fields); err == nil {
			return fields, true
		}
		return nil, false
	default:
		return nil, false
	}
}

func opportunityStatusForStage(stage map[string]any) string {
	switch {
	case altocBool(stage["is_won"]):
		return "won"
	case altocBool(stage["is_lost"]):
		return "lost"
	case altocMapText(stage, "code") == "paused":
		return "paused"
	default:
		return "active"
	}
}

func firstNonEmptyValue(values ...any) any {
	for _, value := range values {
		if altocValuePresent(value) {
			return value
		}
	}
	return nil
}

func altocValuePresent(value any) bool {
	if value == nil {
		return false
	}
	text := strings.TrimSpace(fmt.Sprint(value))
	return text != "" && text != "<nil>"
}

func nullablePositiveID(value string) any {
	id := altocPositiveID(value)
	if id <= 0 {
		return nil
	}
	return id
}

func insertOpportunityStageLogTx(ctx context.Context, tx *sql.Tx, opportunityID any, fromStageID any, toStageID any, operator string, reason any, snapshot map[string]any) error {
	fields := map[string]any{
		"opportunity_id":              opportunityID,
		"from_stage_id":               fromStageID,
		"to_stage_id":                 toStageID,
		"changed_by":                  firstNonEmptyText(operator, "system"),
		"change_reason":               reason,
		"amount_snapshot":             nil,
		"forecast_category_snapshot":  nil,
		"expected_sign_date_snapshot": nil,
		"win_rate_snapshot":           nil,
		"version_no":                  nil,
	}
	if snapshot != nil {
		fields["amount_snapshot"] = snapshot["amount_tax_inclusive"]
		fields["forecast_category_snapshot"] = nullableText(altocMapText(snapshot, "forecast_category"))
		fields["expected_sign_date_snapshot"] = altocDateText(altocMapText(snapshot, "expected_sign_date"))
		fields["win_rate_snapshot"] = snapshot["win_rate"]
		fields["version_no"] = snapshot["version_no"]
	}
	_, err := altocInsertRecordTx(ctx, tx, "opportunity_stage_log", fields)
	return err
}

func (a *Adapter) recordOpportunityContactRoleTx(ctx context.Context, tx *sql.Tx, opportunityID any, contact map[string]any, body map[string]any, operator string) error {
	if contact == nil {
		return nil
	}
	exists, err := altocTableExists(ctx, tx, "opportunity_contact_role")
	if err != nil || !exists {
		return err
	}
	contactID := contact["id"]
	existing, err := altocQueryOneMap(ctx, tx, `
		SELECT *
		FROM opportunity_contact_role
		WHERE opportunity_id = ?
		  AND contact_id = ?
		  AND deleted_at IS NULL
		LIMIT 1
		FOR UPDATE
	`, opportunityID, contactID)
	if err != nil {
		return err
	}
	role := firstNonEmptyText(firstBodyText(body, "contactRole", "contact_role"), "sponsor")
	influenceLevel := firstNonEmptyText(firstBodyText(body, "contactInfluenceLevel", "contact_influence_level"), altocMapText(contact, "influence_level"), "medium")
	attitude := firstNonEmptyText(firstBodyText(body, "contactAttitude", "contact_attitude"), "neutral")
	remark := nullableText(firstBodyText(body, "contactRoleRemark", "contact_role_remark"))
	if _, err := tx.ExecContext(ctx, `
		UPDATE opportunity_contact_role
		SET is_primary = 0,
		    updated_by = ?,
		    updated_at = CURRENT_TIMESTAMP
		WHERE opportunity_id = ?
		  AND deleted_at IS NULL
	`, operator, opportunityID); err != nil {
		return err
	}
	if existing != nil {
		_, err = tx.ExecContext(ctx, `
			UPDATE opportunity_contact_role
			SET role = ?,
			    influence_level = ?,
			    attitude = ?,
			    is_primary = 1,
			    remark = COALESCE(?, remark),
			    updated_by = ?,
			    updated_at = CURRENT_TIMESTAMP
			WHERE id = ?
		`, role, influenceLevel, attitude, remark, operator, existing["id"])
		return err
	}
	_, err = altocInsertRecordTx(ctx, tx, "opportunity_contact_role", map[string]any{
		"opportunity_id":  opportunityID,
		"contact_id":      contactID,
		"role":            role,
		"influence_level": influenceLevel,
		"attitude":        attitude,
		"is_primary":      1,
		"remark":          remark,
		"created_by":      nullableText(operator),
		"updated_by":      nullableText(operator),
	})
	return err
}
