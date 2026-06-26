package altoc

import (
	"context"
	"database/sql"
	"fmt"
	"net/http"
	"net/url"
	"strings"
	"time"

	"github.com/huizhi-yun/data-runtime/internal/httperror"
)

func serviceTicketGenericMutation(method string, path string) bool {
	if method == http.MethodPost && path == "/v1/altoc/service-tickets" {
		return true
	}
	if method != http.MethodPut && method != http.MethodPatch {
		return false
	}
	identifier, ok := pathParam(path, "/v1/altoc/service-tickets/", "")
	return ok && strings.TrimSpace(identifier) != ""
}

func (a *Adapter) handleServiceTicketGenericMutation(ctx context.Context, method string, path string, query url.Values, body map[string]any) (any, string, error) {
	response, operation, err := a.Adapter.HandleRuntime(ctx, method, path, query, body)
	if err != nil {
		return response, operation, err
	}
	ticket, err := a.resolveServiceTicketAgreementFromResponse(ctx, response, body)
	if err != nil {
		return nil, operation, err
	}
	if ticket != nil {
		setRuntimeResponseData(response, ticket)
	}
	return response, operation, nil
}

func (a *Adapter) resolveServiceTicketAgreementFromResponse(ctx context.Context, response any, body map[string]any) (map[string]any, error) {
	data, ok := runtimeResponseData(response)
	if !ok {
		return nil, nil
	}
	ticketID := altocPositiveID(data["id"])
	if ticketID <= 0 {
		return nil, nil
	}
	return a.resolveServiceTicketAgreement(ctx, ticketID, body)
}

func runtimeResponseData(response any) (map[string]any, bool) {
	responseMap, ok := response.(map[string]any)
	if !ok {
		return nil, false
	}
	data, ok := responseMap["data"].(map[string]any)
	return data, ok
}

func setRuntimeResponseData(response any, data map[string]any) {
	responseMap, ok := response.(map[string]any)
	if !ok {
		return
	}
	responseMap["data"] = data
}

func (a *Adapter) resolveServiceTicketAgreement(ctx context.Context, ticketID int64, body map[string]any) (map[string]any, error) {
	tx, err := a.DB().BeginTx(ctx, nil)
	if err != nil {
		return nil, err
	}
	defer tx.Rollback()

	ticket, err := a.resolveServiceTicketAgreementTx(ctx, tx, ticketID, body)
	if err != nil {
		return nil, err
	}
	if err := tx.Commit(); err != nil {
		return nil, err
	}
	return ticket, nil
}

func (a *Adapter) resolveServiceTicketAgreementTx(ctx context.Context, tx *sql.Tx, ticketID int64, body map[string]any) (map[string]any, error) {
	ticketColumns, err := altocTableColumns(ctx, tx, "service_ticket")
	if err != nil {
		return nil, err
	}
	if !ticketColumns["service_agreement_id"] || !ticketColumns["service_agreement_code"] || !ticketColumns["delivery_asset_code"] || !ticketColumns["entitlement_status"] {
		return altocQueryOneMap(ctx, tx, "SELECT * FROM service_ticket WHERE id = ? LIMIT 1", ticketID)
	}
	agreementColumns, err := altocTableColumns(ctx, tx, "service_agreement")
	if err != nil {
		return nil, err
	}
	if !agreementColumns["response_minutes"] || !agreementColumns["resolution_minutes"] || !agreementColumns["included_quota"] || !agreementColumns["quota_unit"] || !agreementColumns["consumed_quota"] {
		return altocQueryOneMap(ctx, tx, "SELECT * FROM service_ticket WHERE id = ? LIMIT 1", ticketID)
	}

	ticket, err := altocQueryOneMap(ctx, tx, `
		SELECT
		  st.*,
		  cu.code AS customer_code,
		  mc.delivery_code AS maintenance_delivery_code,
		  mc.contract_id AS maintenance_contract_ref_id
		FROM service_ticket st
		INNER JOIN customer cu ON cu.id = st.customer_id
		LEFT JOIN maintenance_contract mc ON mc.id = st.maintenance_contract_id
		WHERE st.id = ?
		  AND st.deleted_at IS NULL
		LIMIT 1
		FOR UPDATE
	`, ticketID)
	if err != nil {
		return nil, err
	}
	if ticket == nil {
		return nil, httperror.New(http.StatusNotFound, "record_not_found", "service ticket not found")
	}

	assetCodes := serviceTicketAssetCodes(ticket, body)
	agreement, err := matchingServiceAgreement(ctx, tx, ticket, assetCodes, agreementColumns)
	if err != nil {
		return nil, err
	}

	now := time.Now().UTC()
	entitlementStatus := "out_of_service"
	var agreementID any
	var agreementCode any
	var matchedAssetCode any
	var responseDue any
	var resolutionDue any
	quotaConsume := 0.0

	if agreement != nil {
		agreementID = agreement["id"]
		agreementCode = nullableText(altocMapText(agreement, "code"))
		matchedAssetCode = nullableText(firstNonEmptyText(
			altocMapText(agreement, "matched_delivery_asset_code"),
			firstNonEmptyText(assetCodes...),
			altocMapText(ticket, "delivery_asset_code"),
		))
		entitlementStatus = serviceAgreementEntitlementStatus(agreement, now)
		if entitlementStatus == "in_service" && serviceAgreementQuotaExceeded(agreement) {
			entitlementStatus = "over_quota"
		}
		responseMinutes, resolutionMinutes := serviceTicketSLAMinutes(ticket, agreement)
		responseDue = serviceTicketDueAt(ticket, "response_due_at", responseMinutes)
		resolutionDue = serviceTicketDueAt(ticket, "resolution_due_at", resolutionMinutes)
		if entitlementStatus == "in_service" && serviceTicketShouldConsumeQuota(ticket, agreement) {
			quotaConsume = 1
		}
	} else {
		matchedAssetCode = nullableText(firstNonEmptyText(assetCodes...))
	}

	if quotaConsume > 0 {
		if _, err := tx.ExecContext(ctx, `
			UPDATE service_agreement
			SET consumed_quota = COALESCE(consumed_quota, 0) + ?,
			    updated_by = COALESCE(?, updated_by),
			    updated_at = CURRENT_TIMESTAMP
			WHERE id = ?
		`, fmt.Sprintf("%.2f", quotaConsume), nullableText(altocActor(body)), agreementID); err != nil {
			return nil, err
		}
	}

	slaStatus := serviceTicketSLAStatus(ticket, entitlementStatus, responseDue, resolutionDue, now)
	set := []string{
		"service_agreement_id = ?",
		"service_agreement_code = ?",
		"delivery_asset_code = COALESCE(?, delivery_asset_code)",
		"entitlement_status = ?",
		"sla_status = ?",
		"response_due_at = COALESCE(response_due_at, ?)",
		"resolution_due_at = COALESCE(resolution_due_at, ?)",
		"updated_by = COALESCE(?, updated_by)",
		"updated_at = CURRENT_TIMESTAMP",
	}
	args := []any{
		agreementID,
		agreementCode,
		matchedAssetCode,
		entitlementStatus,
		slaStatus,
		responseDue,
		resolutionDue,
		nullableText(altocActor(body)),
	}
	if ticketColumns["quota_consumed"] {
		set = append(set, "quota_consumed = quota_consumed + ?")
		args = append(args, fmt.Sprintf("%.2f", quotaConsume))
	}
	args = append(args, ticketID)
	if _, err := tx.ExecContext(ctx, `
		UPDATE service_ticket
		SET `+strings.Join(set, ", ")+`
		WHERE id = ?
	`, args...); err != nil {
		return nil, err
	}

	return altocQueryOneMap(ctx, tx, "SELECT * FROM service_ticket WHERE id = ? LIMIT 1", ticketID)
}

func matchingServiceAgreement(ctx context.Context, tx *sql.Tx, ticket map[string]any, assetCodes []string, columns map[string]bool) (map[string]any, error) {
	if id := altocPositiveID(ticket["service_agreement_id"]); id > 0 {
		agreement, err := altocQueryOneMap(ctx, tx, `
			SELECT sa.*
			FROM service_agreement sa
			WHERE sa.id = ?
			  AND sa.deleted_at IS NULL
			LIMIT 1
		`, id)
		if err != nil || agreement != nil {
			return agreement, err
		}
	}
	if len(assetCodes) > 0 {
		placeholders := strings.TrimRight(strings.Repeat("?,", len(assetCodes)), ",")
		args := make([]any, 0, len(assetCodes)+2)
		for _, code := range assetCodes {
			args = append(args, code)
		}
		customerCode := altocMapText(ticket, "customer_code")
		if coverageExists, existsErr := altocTableExists(ctx, tx, "service_agreement_coverage"); existsErr != nil {
			return nil, existsErr
		} else if coverageExists {
			coverageWhere := []string{
				"sa.deleted_at IS NULL",
				"sac.deleted_at IS NULL",
				"sac.included = 1",
				"sac.resolution_status = 'resolved'",
				"sac.coverage_status IN ('planned', 'active')",
				"sac.delivery_asset_code IN (" + placeholders + ")",
			}
			coverageArgs := append([]any{}, args...)
			if customerCode != "" {
				coverageWhere = append(coverageWhere, "(sa.customer_code = ? OR sa.customer_code IS NULL OR sa.customer_code = '')")
				coverageArgs = append(coverageArgs, customerCode)
			}
			agreement, err := altocQueryOneMap(ctx, tx, `
				SELECT
				  sa.*,
				  sac.delivery_asset_code AS matched_delivery_asset_code,
				  sac.environment_code AS matched_environment_code,
				  sac.coverage_code AS matched_coverage_code
				FROM service_agreement sa
				INNER JOIN service_agreement_coverage sac ON sac.service_agreement_id = sa.id
				WHERE `+strings.Join(coverageWhere, " AND ")+`
				ORDER BY `+serviceAgreementMatchOrderSQL()+`
				LIMIT 1
			`, coverageArgs...)
			if err != nil || agreement != nil {
				return agreement, err
			}
		}
		where := []string{
			"sa.deleted_at IS NULL",
			"saa.deleted_at IS NULL",
			"saa.included = 1",
			"saa.delivery_asset_code IN (" + placeholders + ")",
		}
		if customerCode != "" {
			where = append(where, "(sa.customer_code = ? OR sa.customer_code IS NULL OR sa.customer_code = '')")
			args = append(args, customerCode)
		}
		agreement, err := altocQueryOneMap(ctx, tx, `
			SELECT sa.*, saa.delivery_asset_code AS matched_delivery_asset_code
			FROM service_agreement sa
			INNER JOIN service_agreement_asset saa ON saa.service_agreement_id = sa.id
			WHERE `+strings.Join(where, " AND ")+`
			ORDER BY `+serviceAgreementMatchOrderSQL()+`
			LIMIT 1
		`, args...)
		if err != nil || agreement != nil {
			return agreement, err
		}
	}

	where, args := serviceAgreementIdentityWhere(ticket, columns)
	if len(where) > 0 {
		agreement, err := altocQueryOneMap(ctx, tx, `
			SELECT sa.*
			FROM service_agreement sa
			WHERE sa.deleted_at IS NULL
			  AND (`+strings.Join(where, " OR ")+`)
			ORDER BY `+serviceAgreementMatchOrderSQL()+`
			LIMIT 1
		`, args...)
		if err != nil || agreement != nil {
			return agreement, err
		}
	}

	customerCode := altocMapText(ticket, "customer_code")
	if customerCode == "" {
		return nil, nil
	}
	return altocQueryOneMap(ctx, tx, `
		SELECT sa.*
		FROM service_agreement sa
		WHERE sa.deleted_at IS NULL
		  AND sa.customer_code = ?
		ORDER BY `+serviceAgreementMatchOrderSQL()+`
		LIMIT 1
	`, customerCode)
}

func serviceAgreementIdentityWhere(ticket map[string]any, columns map[string]bool) ([]string, []any) {
	where := []string{}
	args := []any{}
	for _, value := range []any{ticket["contract_id"], ticket["maintenance_contract_ref_id"]} {
		if id := altocPositiveID(value); id > 0 {
			where = append(where, "sa.contract_id = ?")
			args = append(args, id)
		}
	}
	if columns["maintenance_contract_id"] {
		if id := altocPositiveID(ticket["maintenance_contract_id"]); id > 0 {
			where = append(where, "sa.maintenance_contract_id = ?")
			args = append(args, id)
		}
	}
	return where, args
}

func serviceAgreementMatchOrderSQL() string {
	return `
		CASE sa.status
		  WHEN 'active' THEN 0
		  WHEN 'planned' THEN 1
		  WHEN 'suspended' THEN 2
		  ELSE 3
		END ASC,
		CASE
		  WHEN (sa.service_start_date IS NULL OR sa.service_start_date <= CURRENT_DATE)
		   AND (sa.service_end_date IS NULL OR sa.service_end_date >= CURRENT_DATE) THEN 0
		  ELSE 1
		END ASC,
		sa.service_end_date ASC,
		sa.id DESC`
}

func serviceTicketAssetCodes(ticket map[string]any, body map[string]any) []string {
	seen := map[string]bool{}
	codes := []string{}
	for _, value := range []string{
		firstBodyText(body, "deliveryAssetCode", "delivery_asset_code"),
		altocMapText(ticket, "delivery_asset_code"),
		altocMapText(ticket, "delivery_code"),
		altocMapText(ticket, "maintenance_delivery_code"),
		firstBodyText(body, "deliveryCode", "delivery_code"),
	} {
		value = strings.TrimSpace(value)
		if value == "" || seen[value] {
			continue
		}
		seen[value] = true
		codes = append(codes, value)
	}
	return codes
}

func serviceAgreementEntitlementStatus(agreement map[string]any, now time.Time) string {
	status := strings.TrimSpace(altocMapText(agreement, "status"))
	if status != "active" {
		return "out_of_service"
	}
	if !serviceAgreementCoversDate(agreement, now) {
		return "out_of_service"
	}
	return "in_service"
}

func serviceAgreementCoversDate(agreement map[string]any, now time.Time) bool {
	today := now.Format("2006-01-02")
	start := firstNonEmptyDate(agreement["service_start_date"])
	end := firstNonEmptyDate(agreement["service_end_date"])
	if start != "" && today < start {
		return false
	}
	if end != "" && today > end {
		return false
	}
	return true
}

func serviceAgreementQuotaExceeded(agreement map[string]any) bool {
	included := moneyValue(agreement["included_quota"])
	if included <= 0 {
		return false
	}
	return moneyValue(agreement["consumed_quota"]) >= included
}

func serviceTicketShouldConsumeQuota(ticket map[string]any, agreement map[string]any) bool {
	status := strings.TrimSpace(altocMapText(ticket, "status"))
	if status != "resolved" && status != "closed" {
		return false
	}
	if moneyValue(ticket["quota_consumed"]) > 0 {
		return false
	}
	if moneyValue(agreement["included_quota"]) <= 0 {
		return false
	}
	unit := strings.ToLower(strings.TrimSpace(altocMapText(agreement, "quota_unit")))
	return unit == "" || unit == "ticket" || unit == "tickets" || unit == "case"
}

func serviceTicketSLAMinutes(ticket map[string]any, agreement map[string]any) (int, int) {
	response := numberValue(agreement["response_minutes"], 0)
	resolution := numberValue(agreement["resolution_minutes"], 0)
	defaultResponse, defaultResolution := defaultServiceTicketSLAMinutes(altocMapText(ticket, "priority"), altocMapText(agreement, "service_level"))
	if response <= 0 {
		response = defaultResponse
	}
	if resolution <= 0 {
		resolution = defaultResolution
	}
	return response, resolution
}

func defaultServiceTicketSLAMinutes(priority string, serviceLevel string) (int, int) {
	switch strings.TrimSpace(priority) {
	case "urgent":
		return 30, 240
	case "high":
		return 120, 480
	case "low":
		return 480, 4320
	default:
		if strings.TrimSpace(serviceLevel) == "premium" {
			return 120, 720
		}
		return 240, 1440
	}
}

func serviceTicketDueAt(ticket map[string]any, column string, minutes int) any {
	if existing := altocDateTimeText(altocMapText(ticket, column)); existing != nil {
		return existing
	}
	if minutes <= 0 {
		return nil
	}
	base := parseAltocTime(ticket["created_at"])
	if base.IsZero() {
		base = time.Now().UTC()
	}
	return base.Add(time.Duration(minutes) * time.Minute).UTC().Format("2006-01-02 15:04:05")
}

func serviceTicketSLAStatus(ticket map[string]any, entitlementStatus string, responseDue any, resolutionDue any, now time.Time) string {
	status := strings.TrimSpace(altocMapText(ticket, "status"))
	if status == "cancelled" {
		return "not_started"
	}
	resolutionDeadline := parseAltocTime(resolutionDue)
	if status == "resolved" || status == "closed" {
		resolvedAt := parseAltocTime(ticket["resolved_at"])
		if resolvedAt.IsZero() {
			resolvedAt = parseAltocTime(ticket["closed_at"])
		}
		if !resolutionDeadline.IsZero() && !resolvedAt.IsZero() && resolvedAt.After(resolutionDeadline) {
			return "breached"
		}
		if altocMapText(ticket, "sla_status") == "breached" {
			return "breached"
		}
		return "met"
	}
	if entitlementStatus != "in_service" {
		return "warning"
	}
	responseDeadline := parseAltocTime(responseDue)
	if !responseDeadline.IsZero() && strings.TrimSpace(altocMapText(ticket, "first_responded_at")) == "" && now.After(responseDeadline) {
		return "breached"
	}
	if !resolutionDeadline.IsZero() && now.After(resolutionDeadline) {
		return "breached"
	}
	return "on_track"
}

func parseAltocTime(value any) time.Time {
	text := strings.TrimSpace(fmt.Sprint(value))
	if value == nil || text == "" || text == "<nil>" {
		return time.Time{}
	}
	if typed, ok := value.(time.Time); ok {
		return typed.UTC()
	}
	if len(text) >= 19 {
		text = strings.ReplaceAll(text[:19], "T", " ")
	}
	for _, layout := range []string{"2006-01-02 15:04:05", time.RFC3339, "2006-01-02"} {
		if parsed, err := time.Parse(layout, text); err == nil {
			return parsed.UTC()
		}
	}
	return time.Time{}
}
