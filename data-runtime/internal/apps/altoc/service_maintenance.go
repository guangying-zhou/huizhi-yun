package altoc

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"net/url"
	"strings"
	"time"

	"github.com/huizhi-yun/data-runtime/internal/httperror"
	"github.com/huizhi-yun/data-runtime/internal/integrationoperation"
)

func (a *Adapter) customerMaintenanceSummary(ctx context.Context, customerCode string, query url.Values) (map[string]any, error) {
	customerCode = strings.TrimSpace(customerCode)
	if customerCode == "" {
		return nil, httperror.New(http.StatusBadRequest, "missing_customer_code", "customerCode is required")
	}

	db := a.DB()
	customerWhere := []string{"cu.code = ?", "cu.deleted_at IS NULL"}
	customerArgs := []any{customerCode}
	scopeWhere, scopeArgs, err := altocReadScopeWhere(query, "customer", "cu", "owner_user_id", "owner_dept_code")
	if err != nil {
		return nil, err
	}
	customerWhere = append(customerWhere, scopeWhere...)
	customerArgs = append(customerArgs, scopeArgs...)
	customer, err := altocQueryOneMap(ctx, db, `
		SELECT cu.id, cu.code, cu.name, cu.short_name, cu.status, cu.owner_user_id, cu.owner_dept_code
		FROM customer cu
		WHERE `+strings.Join(customerWhere, " AND ")+`
		LIMIT 1
	`, customerArgs...)
	if err != nil {
		return nil, err
	}
	if customer == nil {
		return nil, httperror.New(http.StatusNotFound, "record_not_found", "customer not found")
	}

	contracts, err := altocQueryMaps(ctx, db, `
		SELECT
		  mc.*,
		  ct.code AS contract_code,
		  ct.name AS contract_name,
		  op.code AS opportunity_code,
		  op.name AS opportunity_name
		FROM maintenance_contract mc
		LEFT JOIN contract ct ON ct.id = mc.contract_id
		LEFT JOIN opportunity op ON op.id = mc.opportunity_id
		WHERE mc.customer_id = ?
		  AND mc.deleted_at IS NULL
		ORDER BY
		  CASE mc.status
		    WHEN 'expiring' THEN 0
		    WHEN 'active' THEN 1
		    WHEN 'draft' THEN 2
		    WHEN 'expired' THEN 3
		    ELSE 4
		  END,
		  mc.service_end_date ASC,
		  mc.id DESC
	`, customer["id"])
	if err != nil {
		return nil, err
	}

	entitlements, err := altocQueryMaps(ctx, db, `
		SELECT
		  se.*,
		  mc.code AS maintenance_contract_code,
		  mc.name AS maintenance_contract_name
		FROM service_entitlement se
		INNER JOIN maintenance_contract mc ON mc.id = se.maintenance_contract_id
		WHERE mc.customer_id = ?
		  AND mc.deleted_at IS NULL
		ORDER BY se.id DESC
	`, customer["id"])
	if err != nil {
		return nil, err
	}

	serviceAgreements, err := altocQueryMaps(ctx, db, `
		SELECT
		  sa.*,
		  ct.code AS contract_code,
		  ct.name AS contract_name
		FROM service_agreement sa
		LEFT JOIN contract ct ON ct.id = sa.contract_id
		WHERE (sa.customer_code = ? OR ct.customer_id = ?)
		  AND sa.deleted_at IS NULL
		ORDER BY
		  CASE sa.status
		    WHEN 'active' THEN 0
		    WHEN 'planned' THEN 1
		    WHEN 'suspended' THEN 2
		    WHEN 'expired' THEN 3
		    ELSE 4
		  END,
		  sa.service_end_date ASC,
		  sa.id DESC
	`, customerCode, customer["id"])
	if err != nil {
		return nil, err
	}

	tickets, err := altocQueryMaps(ctx, db, `
		SELECT
		  st.*,
		  mc.code AS maintenance_contract_code,
		  ct.code AS contract_code
		FROM service_ticket st
		LEFT JOIN maintenance_contract mc ON mc.id = st.maintenance_contract_id
		LEFT JOIN contract ct ON ct.id = st.contract_id
		WHERE st.customer_id = ?
		  AND st.deleted_at IS NULL
		ORDER BY st.updated_at DESC, st.id DESC
		LIMIT 50
	`, customer["id"])
	if err != nil {
		return nil, err
	}

	renewals, err := altocQueryMaps(ctx, db, `
		SELECT
		  ro.*,
		  mc.code AS maintenance_contract_code,
		  st.code AS source_ticket_code,
		  op.code AS opportunity_code
		FROM renewal_opportunity ro
		LEFT JOIN maintenance_contract mc ON mc.id = ro.maintenance_contract_id
		LEFT JOIN service_ticket st ON st.id = ro.source_ticket_id
		LEFT JOIN opportunity op ON op.id = ro.opportunity_id
		WHERE ro.customer_id = ?
		  AND ro.deleted_at IS NULL
		ORDER BY ro.expected_sign_date ASC, ro.id DESC
		LIMIT 50
	`, customer["id"])
	if err != nil {
		return nil, err
	}

	return map[string]any{
		"customer":             customer,
		"summary":              maintenanceSummaryCounts(contracts, serviceAgreements, tickets, renewals),
		"maintenanceContracts": contracts,
		"serviceEntitlements":  entitlements,
		"serviceAgreements":    serviceAgreements,
		"serviceTickets":       tickets,
		"renewalOpportunities": renewals,
	}, nil
}

func (a *Adapter) serviceTicketDispatchContext(ctx context.Context, ticketCode string, query url.Values) (map[string]any, error) {
	ticketCode = strings.TrimSpace(ticketCode)
	if ticketCode == "" {
		return nil, httperror.New(http.StatusBadRequest, "missing_ticket_code", "ticketCode is required")
	}
	if err := altocRequireActionScope(altocRuntimeBodyFromQuery(query), "service_ticket", "view"); err != nil {
		return nil, err
	}

	where := []string{"st.code = ?", "st.deleted_at IS NULL"}
	args := []any{ticketCode}
	scopeWhere, scopeArgs, err := altocReadScopeWhere(query, "service_ticket", "st", "owner_user_id", "")
	if err != nil {
		return nil, err
	}
	where = append(where, scopeWhere...)
	args = append(args, scopeArgs...)

	ticket, err := altocQueryOneMap(ctx, a.DB(), `
		SELECT
		  st.*,
		  cu.code AS customer_code,
		  cu.name AS customer_name,
		  ct.code AS contract_code,
		  ct.name AS contract_name,
		  mc.code AS maintenance_contract_code,
		  mc.name AS maintenance_contract_name,
		  COALESCE(st.delivery_code, mc.delivery_code) AS resolved_delivery_code,
		  sa.code AS resolved_service_agreement_code,
		  sa.name AS service_agreement_name
		FROM service_ticket st
		INNER JOIN customer cu ON cu.id = st.customer_id AND cu.deleted_at IS NULL
		LEFT JOIN contract ct ON ct.id = st.contract_id AND ct.deleted_at IS NULL
		LEFT JOIN maintenance_contract mc ON mc.id = st.maintenance_contract_id AND mc.deleted_at IS NULL
		LEFT JOIN service_agreement sa ON sa.id = st.service_agreement_id AND sa.deleted_at IS NULL
		WHERE `+strings.Join(where, " AND ")+`
		LIMIT 1
	`, args...)
	if err != nil {
		return nil, err
	}
	if ticket == nil {
		return nil, httperror.New(http.StatusNotFound, "record_not_found", "service ticket not found")
	}
	return ticket, nil
}

func (a *Adapter) syncServiceTicketDeliveryResult(ctx context.Context, ticketCode string, body map[string]any) (map[string]any, error) {
	ticketCode = strings.TrimSpace(ticketCode)
	if ticketCode == "" {
		return nil, httperror.New(http.StatusBadRequest, "missing_ticket_code", "ticketCode is required")
	}
	receiptInput, command, err := integrationoperation.ReceiptCommandFromBody(
		body,
		"altoc",
		"aims.work-item.ticket-result.v1",
		"altoc:service-ticket:delivery-result:sync",
	)
	if err != nil {
		return nil, serviceCommandReceiptError(err)
	}
	if receiptInput.TrustedContext.SourceApp != "aims" {
		return nil, httperror.New(http.StatusForbidden, "service_command_source_forbidden", "service command source must be aims")
	}
	if strings.TrimSpace(fmt.Sprint(command["ticketCode"])) != ticketCode {
		return nil, httperror.New(http.StatusConflict, "service_command_path_mismatch", "service command ticket does not match the target path")
	}
	integrationoperation.CopyTrustedRuntimeCommandContext(command, body)
	repository, err := integrationoperation.NewReceiptRepository(a.DB())
	if err != nil {
		return nil, err
	}
	executed, err := repository.Execute(ctx, receiptInput, func(ctx context.Context, tx *sql.Tx, _ json.RawMessage) (integrationoperation.ReceiptBusinessResult, error) {
		result, err := a.syncServiceTicketDeliveryResultTx(ctx, tx, ticketCode, command)
		if err != nil {
			return integrationoperation.ReceiptBusinessResult{}, err
		}
		return integrationoperation.ReceiptBusinessResult{
			TargetBizType: "service_ticket",
			TargetBizCode: ticketCode,
			HTTPStatus:    http.StatusOK,
			Value:         result,
		}, nil
	})
	if err != nil {
		return nil, serviceCommandReceiptError(err)
	}
	return map[string]any{
		"receiptId":             executed.ReceiptID,
		"receiptStatus":         "succeeded",
		"operationId":           receiptInput.OperationID,
		"operationCode":         receiptInput.OperationCode,
		"idempotencyKey":        receiptInput.IdempotencyKey,
		"commandSchemaVersion":  receiptInput.CommandSchemaVersion,
		"commandSha256":         receiptInput.CommandSHA256,
		"idempotent":            executed.Existing,
		"targetBizType":         executed.TargetBizType,
		"targetBizCode":         executed.TargetBizCode,
		"responseSummarySha256": executed.ResponseSummarySHA256,
		"result":                executed.Value,
	}, nil
}

func (a *Adapter) syncServiceTicketDeliveryResultTx(ctx context.Context, tx *sql.Tx, ticketCode string, body map[string]any) (map[string]any, error) {

	ticket, err := altocQueryOneMap(ctx, tx, `
		SELECT *
		FROM service_ticket
		WHERE code = ?
		  AND deleted_at IS NULL
		LIMIT 1
		FOR UPDATE
	`, ticketCode)
	if err != nil {
		return nil, err
	}
	if ticket == nil {
		return nil, httperror.New(http.StatusNotFound, "record_not_found", "service ticket not found")
	}
	if err := altocRequireActionScope(body, "service_ticket", "delivery-result:sync"); err != nil {
		return nil, err
	}
	if altocDataAccessMode(body) != "" {
		if err := altocRequireRecordWrite(body, "service_ticket", ticket, "owner_user_id", ""); err != nil {
			return nil, err
		}
	}

	nextStatus := serviceTicketStatusFromDeliveryResult(body)
	if nextStatus == "" {
		return nil, httperror.New(http.StatusBadRequest, "missing_delivery_status", "deliveryStatus is required")
	}
	incomingProjectCode := serviceResultText(body, "aimsProjectCode", "aims_project_code", "projectCode", "project_code")
	incomingWorkItemKey := serviceResultText(body, "workItemKey", "work_item_key", "aimsWorkItemKey", "aims_work_item_key")
	boundProjectCode := firstNonEmptyText(altocMapText(ticket, "aims_project_code"), altocMapText(ticket, "project_code"))
	boundWorkItemKey := altocMapText(ticket, "aims_work_item_key")
	incomingGeneration := intBodyValue(body, "deliveryGeneration", "delivery_generation")
	boundGeneration := intBodyValue(ticket, "aims_delivery_generation")
	if incomingGeneration <= 0 {
		return nil, httperror.New(http.StatusConflict, "service_ticket_delivery_generation_invalid", "delivery generation is required")
	}
	if (boundProjectCode != "" && incomingProjectCode != "" && boundProjectCode != incomingProjectCode) ||
		(boundWorkItemKey != "" && incomingWorkItemKey != "" && boundWorkItemKey != incomingWorkItemKey) {
		return nil, httperror.New(http.StatusConflict, "service_ticket_delivery_binding_conflict", "Aims project or work item does not match the existing ticket binding")
	}
	if incomingGeneration < boundGeneration || serviceTicketDeliveryStatusIsStale(altocMapText(ticket, "status"), nextStatus) {
		return map[string]any{"ticket": ticket, "updated": false, "idempotent": true}, nil
	}
	handler := firstNonEmptyText(
		serviceResultText(body, "handlerUserId", "handler_user_id", "assigneeUid", "assignee_uid"),
		serviceResultText(body, "operatorUid", "operator_uid", "updatedBy", "updated_by"),
	)
	firstRespondedAt := serviceResultText(body, "firstRespondedAt", "first_responded_at", "respondedAt", "responded_at")
	resolvedAt := serviceResultText(body, "resolvedAt", "resolved_at", "completedAt", "completed_at")
	closedAt := serviceResultText(body, "closedAt", "closed_at")

	if _, err := tx.ExecContext(ctx, `
		UPDATE service_ticket
		SET aims_project_code = COALESCE(?, aims_project_code),
		    project_code = COALESCE(?, project_code),
		    aims_work_item_key = COALESCE(?, aims_work_item_key),
		    aims_work_item_type = COALESCE(?, aims_work_item_type),
		    aims_delivery_generation = GREATEST(aims_delivery_generation, ?),
		    aims_delivery_status = ?,
		    status = COALESCE(?, status),
		    sla_status = CASE
		      WHEN ? IN ('resolved', 'closed') AND sla_status <> 'breached' THEN 'met'
		      ELSE sla_status
		    END,
		    handler_user_id = COALESCE(?, handler_user_id),
		    first_responded_at = CASE
		      WHEN ? <> '' THEN COALESCE(first_responded_at, ?)
		      ELSE first_responded_at
		    END,
		    resolved_at = CASE
		      WHEN ? IN ('resolved', 'closed') THEN COALESCE(resolved_at, COALESCE(?, CURRENT_TIMESTAMP))
		      ELSE resolved_at
		    END,
		    closed_at = CASE
		      WHEN ? = 'closed' THEN COALESCE(closed_at, COALESCE(?, CURRENT_TIMESTAMP))
		      ELSE closed_at
		    END,
		    codocs_document_uuid = COALESCE(?, codocs_document_uuid),
		    updated_by = COALESCE(?, updated_by),
		    updated_at = CURRENT_TIMESTAMP
		WHERE id = ?
	`, nullableText(incomingProjectCode),
		nullableText(incomingProjectCode),
		nullableText(incomingWorkItemKey),
		nullableText(serviceResultText(body, "workItemType", "work_item_type", "aimsWorkItemType", "aims_work_item_type")),
		incomingGeneration,
		nextStatus,
		nullableText(nextStatus),
		nextStatus,
		nullableText(handler),
		firstRespondedAt,
		nullableText(firstRespondedAt),
		nextStatus,
		nullableText(resolvedAt),
		nextStatus,
		nullableText(closedAt),
		nullableText(serviceResultText(body, "documentUuid", "document_uuid", "codocsDocumentUuid", "codocs_document_uuid")),
		nullableText(handler),
		ticket["id"]); err != nil {
		return nil, err
	}

	resolvedProjectCode := serviceResultText(body, "aimsProjectCode", "aims_project_code", "projectCode", "project_code")
	resolvedProjectSource := serviceResultText(body, "projectSource", "project_source")
	if resolvedProjectCode != "" || resolvedProjectSource != "" {
		if err := insertAltocAuditTx(ctx, tx, "service_ticket", ticket["id"], "project_resolve", map[string]any{
			"aims_project_code": ticket["aims_project_code"],
		}, map[string]any{
			"aims_project_code": resolvedProjectCode,
			"project_source":    resolvedProjectSource,
			"work_item_key":     serviceResultText(body, "workItemKey", "work_item_key", "aimsWorkItemKey", "aims_work_item_key"),
			"idempotency_key":   serviceResultText(body, "idempotencyKey", "idempotency_key"),
		}, altocActor(body)); err != nil {
			return nil, err
		}
	}

	ticketID := altocPositiveID(ticket["id"])
	if ticketID > 0 {
		ticket, err = a.resolveServiceTicketAgreementTx(ctx, tx, ticketID, body)
	} else {
		ticket, err = altocQueryOneMap(ctx, tx, "SELECT * FROM service_ticket WHERE id = ? LIMIT 1", ticket["id"])
	}
	if err != nil {
		return nil, err
	}
	return map[string]any{"ticket": ticket, "updated": true}, nil
}

func serviceCommandReceiptError(err error) error {
	switch {
	case errors.Is(err, integrationoperation.ErrIdempotencyPayloadMismatch):
		return httperror.New(http.StatusConflict, "idempotency_payload_mismatch", "service command identity or payload does not match the existing receipt")
	case errors.Is(err, integrationoperation.ErrReceiptInProgress):
		return httperror.New(http.StatusConflict, "service_command_in_progress", "service command receipt is still processing")
	case errors.Is(err, integrationoperation.ErrReceiptRejected):
		return httperror.New(http.StatusConflict, "service_command_rejected", "service command receipt was rejected")
	default:
		return err
	}
}

func altocQueryMaps(ctx context.Context, conn altocQueryer, query string, args ...any) ([]map[string]any, error) {
	rows, err := conn.QueryContext(ctx, query, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	return altocRowsToMaps(rows)
}

func serviceTicketStatusFromDeliveryResult(body map[string]any) string {
	status := strings.ToLower(strings.TrimSpace(firstNonEmptyText(
		serviceResultText(body, "ticketStatus", "ticket_status"),
		serviceResultText(body, "deliveryStatus", "delivery_status", "workItemStatus", "work_item_status", "status"),
	)))
	switch status {
	case "closed":
		return "closed"
	case "resolved", "completed", "done":
		return "resolved"
	case "cancelled", "canceled":
		return "cancelled"
	case "open", "accepted", "processing", "waiting_customer":
		return status
	case "planning", "todo", "in_progress", "in_review":
		return "processing"
	default:
		return ""
	}
}

func serviceTicketDeliveryStatusIsStale(current string, next string) bool {
	current = strings.ToLower(strings.TrimSpace(current))
	next = strings.ToLower(strings.TrimSpace(next))
	if current == "cancelled" {
		return next != "cancelled"
	}
	if current == "closed" {
		return next != "closed"
	}
	if current == "resolved" {
		return next != "resolved" && next != "closed"
	}
	rank := func(status string) int {
		switch status {
		case "open":
			return 0
		case "accepted":
			return 1
		case "processing", "waiting_customer":
			return 2
		case "resolved":
			return 3
		case "closed":
			return 4
		default:
			return -1
		}
	}
	currentRank := rank(current)
	nextRank := rank(next)
	return currentRank >= 0 && nextRank >= 0 && nextRank < currentRank
}

func serviceResultText(body map[string]any, keys ...string) string {
	if value := firstBodyText(body, keys...); value != "" {
		return value
	}
	for _, container := range []string{"workItem", "work_item", "result", "deliveryResult", "delivery_result"} {
		nested, ok := body[container].(map[string]any)
		if !ok {
			continue
		}
		if value := firstBodyText(nested, keys...); value != "" {
			return value
		}
	}
	return ""
}

func maintenanceSummaryCounts(contracts []map[string]any, agreements []map[string]any, tickets []map[string]any, renewals []map[string]any) map[string]any {
	now := time.Now().UTC()
	expiringBefore := now.AddDate(0, 0, 60)
	activeContracts := 0
	expiringContracts := 0
	totalAmount := 0.0
	for _, contract := range contracts {
		status := strings.TrimSpace(fmt.Sprint(contract["status"]))
		if status == "active" {
			activeContracts++
		}
		if status == "expiring" || (status == "active" && isDateBetween(contract["service_end_date"], now, expiringBefore)) {
			expiringContracts++
		}
		totalAmount += moneyValue(contract["amount"])
	}

	activeAgreements := 0
	expiringAgreements := 0
	for _, agreement := range agreements {
		status := strings.TrimSpace(fmt.Sprint(agreement["status"]))
		if status == "active" {
			activeAgreements++
		}
		if status == "active" && isDateBetween(agreement["service_end_date"], now, expiringBefore) {
			expiringAgreements++
		}
	}

	openTickets := 0
	breachedTickets := 0
	for _, ticket := range tickets {
		status := strings.TrimSpace(fmt.Sprint(ticket["status"]))
		switch status {
		case "resolved", "closed", "cancelled":
		default:
			openTickets++
		}
		if strings.TrimSpace(fmt.Sprint(ticket["sla_status"])) == "breached" {
			breachedTickets++
		}
	}

	openRenewals := 0
	for _, renewal := range renewals {
		if strings.TrimSpace(fmt.Sprint(renewal["status"])) == "open" {
			openRenewals++
		}
	}

	return map[string]any{
		"maintenanceContracts":         len(contracts),
		"activeMaintenanceContracts":   activeContracts,
		"expiringMaintenanceContracts": expiringContracts,
		"maintenanceAmount":            totalAmount,
		"serviceAgreements":            len(agreements),
		"activeServiceAgreements":      activeAgreements,
		"expiringServiceAgreements":    expiringAgreements,
		"recentServiceTickets":         len(tickets),
		"openServiceTickets":           openTickets,
		"breachedServiceTickets":       breachedTickets,
		"openRenewalOpportunities":     openRenewals,
	}
}

func isDateBetween(value any, start time.Time, end time.Time) bool {
	text := strings.TrimSpace(fmt.Sprint(value))
	if text == "" || text == "<nil>" {
		return false
	}
	if len(text) >= 10 {
		text = text[:10]
	}
	parsed, err := time.Parse("2006-01-02", text)
	if err != nil {
		return false
	}
	return !parsed.Before(start.Truncate(24*time.Hour)) && !parsed.After(end)
}
