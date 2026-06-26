package altoc

import (
	"context"
	"fmt"
	"net/http"
	"net/url"
	"strings"
	"time"

	"github.com/huizhi-yun/data-runtime/internal/httperror"
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

func (a *Adapter) syncServiceTicketDeliveryResult(ctx context.Context, ticketCode string, body map[string]any) (map[string]any, error) {
	ticketCode = strings.TrimSpace(ticketCode)
	if ticketCode == "" {
		return nil, httperror.New(http.StatusBadRequest, "missing_ticket_code", "ticketCode is required")
	}

	tx, err := a.DB().BeginTx(ctx, nil)
	if err != nil {
		return nil, err
	}
	defer tx.Rollback()

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
	handler := firstNonEmptyText(
		serviceResultText(body, "handlerUserId", "handler_user_id", "assigneeUid", "assignee_uid"),
		serviceResultText(body, "operatorUid", "operator_uid", "updatedBy", "updated_by"),
	)
	resolvedAt := serviceResultText(body, "resolvedAt", "resolved_at", "completedAt", "completed_at")
	closedAt := serviceResultText(body, "closedAt", "closed_at")

	if _, err := tx.ExecContext(ctx, `
		UPDATE service_ticket
		SET aims_project_code = COALESCE(?, aims_project_code),
		    aims_work_item_key = COALESCE(?, aims_work_item_key),
		    aims_work_item_type = COALESCE(?, aims_work_item_type),
		    status = COALESCE(?, status),
		    sla_status = CASE
		      WHEN ? IN ('resolved', 'closed') AND sla_status <> 'breached' THEN 'met'
		      ELSE sla_status
		    END,
		    handler_user_id = COALESCE(?, handler_user_id),
		    resolved_at = CASE
		      WHEN ? = 'resolved' THEN COALESCE(resolved_at, COALESCE(?, CURRENT_TIMESTAMP))
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
	`, nullableText(serviceResultText(body, "aimsProjectCode", "aims_project_code", "projectCode", "project_code")),
		nullableText(serviceResultText(body, "workItemKey", "work_item_key", "aimsWorkItemKey", "aims_work_item_key")),
		nullableText(serviceResultText(body, "workItemType", "work_item_type", "aimsWorkItemType", "aims_work_item_type")),
		nullableText(nextStatus),
		nextStatus,
		nullableText(handler),
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
	if err := tx.Commit(); err != nil {
		return nil, err
	}
	return map[string]any{"ticket": ticket, "updated": true}, nil
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
