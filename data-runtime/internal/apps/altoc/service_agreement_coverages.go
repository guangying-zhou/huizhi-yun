package altoc

import (
	"context"
	"database/sql"
	"encoding/json"
	"fmt"
	"net/http"
	"net/url"
	"strings"
	"time"

	"github.com/huizhi-yun/data-runtime/internal/httperror"
)

type serviceAgreementCoverageInput struct {
	coverageCode      string
	targetType        string
	sourcePlanCode    string
	deliveryAssetCode string
	environmentCode   string
	legacyReference   string
	resolutionStatus  string
	coverageStatus    string
	coverageScope     string
	productScopeJSON  string
	effectiveFrom     any
	effectiveTo       any
	included          bool
	exclusionNote     string
	sourceType        string
}

func (a *Adapter) handleServiceAgreementCoverageGet(ctx context.Context, path string, query url.Values) (any, string, bool, error) {
	if agreementCode, ok := pathParam(path, "/v1/altoc/service/service-agreements/", "/coverages"); ok {
		if err := altocRequireActionScope(altocRuntimeBodyFromQuery(query), "contract", "view"); err != nil {
			return nil, "", true, err
		}
		data, err := a.listServiceAgreementCoverages(ctx, unescapePathParam(agreementCode), true)
		return runtimeOK(data), "altoc.service.service_agreements.coverages.list", true, err
	}
	if environmentCode, ok := pathParam(path, "/v1/altoc/service/service-agreement-coverages/by-environment/", ""); ok {
		if err := altocRequireActionScope(altocRuntimeBodyFromQuery(query), "contract", "view"); err != nil {
			return nil, "", true, err
		}
		data, err := a.serviceAgreementCoveragesByEnvironment(ctx, unescapePathParam(environmentCode))
		return runtimeOK(data), "altoc.service.service_agreement_coverages.by_environment", true, err
	}
	if deliveryAssetCode, ok := pathParam(path, "/v1/altoc/service/service-agreement-coverages/by-delivery-asset/", ""); ok {
		if err := altocRequireActionScope(altocRuntimeBodyFromQuery(query), "contract", "view"); err != nil {
			return nil, "", true, err
		}
		data, err := a.serviceAgreementCoveragesByDeliveryAsset(ctx, unescapePathParam(deliveryAssetCode))
		return runtimeOK(data), "altoc.service.service_agreement_coverages.by_delivery_asset", true, err
	}
	return nil, "", false, nil
}

func (a *Adapter) handleServiceAgreementCoveragePost(ctx context.Context, path string, body map[string]any) (any, string, bool, error) {
	if agreementCode, ok := pathParam(path, "/v1/altoc/service/service-agreements/", "/coverages"); ok {
		data, err := a.upsertServiceAgreementCoverage(ctx, unescapePathParam(agreementCode), body)
		return runtimeOK(data), "altoc.service.service_agreements.coverages.upsert", true, err
	}
	if agreementCode, coverageCode, action, ok := serviceAgreementCoverageCommandPath(path); ok {
		data, err := a.changeServiceAgreementCoverage(ctx, agreementCode, coverageCode, action, body)
		return runtimeOK(data), "altoc.service.service_agreements.coverages." + action, true, err
	}
	return nil, "", false, nil
}

func (a *Adapter) listServiceAgreementCoverages(ctx context.Context, agreementCode string, includeLegacyFallback bool) (map[string]any, error) {
	agreement, err := serviceAgreementByCode(ctx, a.DB(), agreementCode)
	if err != nil {
		return nil, err
	}
	if agreement == nil {
		return nil, httperror.New(http.StatusNotFound, "service_agreement_not_found", "service agreement not found")
	}
	items, err := serviceAgreementCoverageRows(ctx, a.DB(), agreement["id"])
	if err != nil {
		return nil, err
	}
	source := "coverage"
	if len(items) == 0 && includeLegacyFallback {
		items, err = legacyServiceAgreementAssetCoverageRows(ctx, a.DB(), agreement["id"])
		if err != nil {
			return nil, err
		}
		source = "legacy_service_agreement_asset"
	}
	return map[string]any{"service_agreement": agreement, "items": items, "total": len(items), "source": source}, nil
}

func (a *Adapter) upsertServiceAgreementCoverage(ctx context.Context, agreementCode string, body map[string]any) (map[string]any, error) {
	if err := altocRequireActionScope(body, "contract", "edit"); err != nil {
		return nil, err
	}
	tx, err := a.DB().BeginTx(ctx, nil)
	if err != nil {
		return nil, err
	}
	defer tx.Rollback()

	agreement, err := lockServiceAgreementByCodeTx(ctx, tx, agreementCode)
	if err != nil {
		return nil, err
	}
	if agreement == nil {
		return nil, httperror.New(http.StatusNotFound, "service_agreement_not_found", "service agreement not found")
	}
	input, err := serviceAgreementCoverageInputFromBody(body)
	if err != nil {
		return nil, err
	}
	if input.coverageCode == "" {
		input.coverageCode, err = nextServiceAgreementCoverageCode(ctx, tx)
		if err != nil {
			return nil, err
		}
	}
	var excludeCoverageID any = int64(0)
	existingCoverage, err := lockServiceAgreementCoverageByCodeTx(ctx, tx, input.coverageCode)
	if err != nil {
		return nil, err
	}
	if existingCoverage != nil {
		if fmt.Sprint(existingCoverage["service_agreement_id"]) != fmt.Sprint(agreement["id"]) {
			return nil, httperror.New(http.StatusConflict, "coverage_target_conflict", "coverageCode belongs to another service agreement")
		}
		excludeCoverageID = existingCoverage["id"]
	}
	if serviceAgreementCoverageRequiresFormalTarget(input.targetType) {
		duplicate, err := serviceAgreementCoverageTargetExistsTx(ctx, tx, agreement["id"], input.targetType, input.deliveryAssetCode, input.environmentCode, serviceAgreementCoverageDateText(input.effectiveFrom), serviceAgreementCoverageDateText(input.effectiveTo), excludeCoverageID)
		if err != nil {
			return nil, err
		}
		if duplicate {
			return nil, httperror.New(http.StatusConflict, "coverage_target_conflict", "formal coverage target already exists")
		}
	}
	operator := altocActor(body)
	_, err = tx.ExecContext(ctx, `
		INSERT INTO service_agreement_coverage (
		  coverage_code,
		  service_agreement_id,
		  target_type,
		  source_plan_code,
		  delivery_asset_code,
		  environment_code,
		  legacy_reference,
		  resolution_status,
		  coverage_status,
		  coverage_scope,
		  product_scope_json,
		  effective_from,
		  effective_to,
		  included,
		  exclusion_note,
		  source_type,
		  created_by,
		  updated_by
		) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
		ON DUPLICATE KEY UPDATE
		  target_type = VALUES(target_type),
		  source_plan_code = VALUES(source_plan_code),
		  delivery_asset_code = VALUES(delivery_asset_code),
		  environment_code = VALUES(environment_code),
		  legacy_reference = VALUES(legacy_reference),
		  resolution_status = VALUES(resolution_status),
		  coverage_status = VALUES(coverage_status),
		  coverage_scope = VALUES(coverage_scope),
		  product_scope_json = VALUES(product_scope_json),
		  effective_from = VALUES(effective_from),
		  effective_to = VALUES(effective_to),
		  included = VALUES(included),
		  exclusion_note = VALUES(exclusion_note),
		  source_type = VALUES(source_type),
		  deleted_at = NULL,
		  updated_by = VALUES(updated_by),
		  updated_at = CURRENT_TIMESTAMP
	`,
		input.coverageCode,
		agreement["id"],
		input.targetType,
		nullableText(input.sourcePlanCode),
		nullableText(input.deliveryAssetCode),
		nullableText(input.environmentCode),
		nullableText(input.legacyReference),
		input.resolutionStatus,
		input.coverageStatus,
		nullableText(input.coverageScope),
		nullableText(input.productScopeJSON),
		input.effectiveFrom,
		input.effectiveTo,
		boolInt(input.included),
		nullableText(input.exclusionNote),
		input.sourceType,
		nullableText(operator),
		nullableText(operator),
	)
	if err != nil {
		return nil, err
	}
	item, err := serviceAgreementCoverageByCodeTx(ctx, tx, input.coverageCode)
	if err != nil {
		return nil, err
	}
	if err := tx.Commit(); err != nil {
		return nil, err
	}
	return map[string]any{"service_agreement": agreement, "coverage": item}, nil
}

func (a *Adapter) changeServiceAgreementCoverage(ctx context.Context, agreementCode string, coverageCode string, action string, body map[string]any) (map[string]any, error) {
	if err := altocRequireActionScope(body, "contract", "edit"); err != nil {
		return nil, err
	}
	tx, err := a.DB().BeginTx(ctx, nil)
	if err != nil {
		return nil, err
	}
	defer tx.Rollback()

	agreement, err := lockServiceAgreementByCodeTx(ctx, tx, agreementCode)
	if err != nil {
		return nil, err
	}
	if agreement == nil {
		return nil, httperror.New(http.StatusNotFound, "service_agreement_not_found", "service agreement not found")
	}
	coverage, err := lockServiceAgreementCoverageByCodeTx(ctx, tx, coverageCode)
	if err != nil {
		return nil, err
	}
	if coverage == nil || fmt.Sprint(coverage["service_agreement_id"]) != fmt.Sprint(agreement["id"]) {
		return nil, httperror.New(http.StatusNotFound, "coverage_not_found", "service agreement coverage not found")
	}
	operator := altocActor(body)
	switch action {
	case "resolve":
		input, err := serviceAgreementCoverageInputFromBody(body)
		if err != nil {
			return nil, err
		}
		if input.targetType == "pending_plan" || input.targetType == "legacy" {
			return nil, httperror.New(http.StatusConflict, "coverage_target_unresolved", "formal target is required to resolve coverage")
		}
		duplicate, err := serviceAgreementCoverageTargetExistsTx(ctx, tx, agreement["id"], input.targetType, input.deliveryAssetCode, input.environmentCode, serviceAgreementCoverageDateText(input.effectiveFrom), serviceAgreementCoverageDateText(input.effectiveTo), coverage["id"])
		if err != nil {
			return nil, err
		}
		if duplicate {
			return nil, httperror.New(http.StatusConflict, "coverage_target_conflict", "formal coverage target already exists")
		}
		if _, err := tx.ExecContext(ctx, `
			UPDATE service_agreement_coverage
			SET target_type = ?,
			    source_plan_code = COALESCE(?, source_plan_code),
			    delivery_asset_code = ?,
			    environment_code = ?,
			    legacy_reference = NULL,
			    resolution_status = 'resolved',
			    coverage_status = ?,
			    source_type = 'manual',
			    updated_by = COALESCE(?, updated_by),
			    updated_at = CURRENT_TIMESTAMP
			WHERE id = ?
		`, input.targetType, nullableText(input.sourcePlanCode), nullableText(input.deliveryAssetCode), nullableText(input.environmentCode), input.coverageStatus, nullableText(operator), coverage["id"]); err != nil {
			return nil, err
		}
	case "suspend", "end":
		status := "ended"
		if action == "suspend" {
			status = "suspended"
		}
		if _, err := tx.ExecContext(ctx, `
			UPDATE service_agreement_coverage
			SET coverage_status = ?,
			    effective_to = COALESCE(?, effective_to),
			    updated_by = COALESCE(?, updated_by),
			    updated_at = CURRENT_TIMESTAMP
			WHERE id = ?
		`, status, altocDateText(firstNonEmptyText(firstBodyText(body, "effective_to", "effectiveTo"), time.Now().Format("2006-01-02"))), nullableText(operator), coverage["id"]); err != nil {
			return nil, err
		}
	case "confirm-legacy":
		if _, err := tx.ExecContext(ctx, `
			UPDATE service_agreement_coverage
			SET resolution_status = 'needs_review',
			    exclusion_note = COALESCE(?, exclusion_note),
			    updated_by = COALESCE(?, updated_by),
			    updated_at = CURRENT_TIMESTAMP
			WHERE id = ?
		`, nullableText(firstBodyText(body, "exclusion_note", "exclusionNote", "note")), nullableText(operator), coverage["id"]); err != nil {
			return nil, err
		}
	default:
		return nil, httperror.New(http.StatusNotFound, "not_found", "Route not found")
	}
	updated, err := serviceAgreementCoverageByCodeTx(ctx, tx, coverageCode)
	if err != nil {
		return nil, err
	}
	if err := tx.Commit(); err != nil {
		return nil, err
	}
	return map[string]any{"service_agreement": agreement, "coverage": updated}, nil
}

func (a *Adapter) serviceAgreementCoveragesByEnvironment(ctx context.Context, environmentCode string) (map[string]any, error) {
	items, err := altocQueryMaps(ctx, a.DB(), `
		SELECT sac.*, sa.code AS service_agreement_code, sa.name AS service_agreement_name, sa.customer_code, c.code AS contract_code
		FROM service_agreement_coverage sac
		INNER JOIN service_agreement sa ON sa.id = sac.service_agreement_id
		INNER JOIN contract c ON c.id = sa.contract_id
		WHERE sac.environment_code = ?
		  AND sac.deleted_at IS NULL
		  AND sac.included = 1
		  AND sac.resolution_status = 'resolved'
		  AND sac.coverage_status IN ('planned', 'active')
		  AND sa.deleted_at IS NULL
		  AND c.deleted_at IS NULL
		ORDER BY sac.coverage_status ASC, sac.effective_from ASC, sac.id ASC
	`, strings.TrimSpace(environmentCode))
	if err != nil {
		return nil, err
	}
	return map[string]any{"environment_code": environmentCode, "items": items, "total": len(items)}, nil
}

func (a *Adapter) serviceAgreementCoveragesByDeliveryAsset(ctx context.Context, deliveryAssetCode string) (map[string]any, error) {
	items, err := altocQueryMaps(ctx, a.DB(), `
		SELECT sac.*, sa.code AS service_agreement_code, sa.name AS service_agreement_name, sa.customer_code, c.code AS contract_code
		FROM service_agreement_coverage sac
		INNER JOIN service_agreement sa ON sa.id = sac.service_agreement_id
		INNER JOIN contract c ON c.id = sa.contract_id
		WHERE sac.delivery_asset_code = ?
		  AND sac.deleted_at IS NULL
		  AND sac.included = 1
		  AND sac.resolution_status = 'resolved'
		  AND sac.coverage_status IN ('planned', 'active')
		  AND sa.deleted_at IS NULL
		  AND c.deleted_at IS NULL
		ORDER BY sac.coverage_status ASC, sac.effective_from ASC, sac.id ASC
	`, strings.TrimSpace(deliveryAssetCode))
	if err != nil {
		return nil, err
	}
	return map[string]any{"delivery_asset_code": deliveryAssetCode, "items": items, "total": len(items)}, nil
}

func serviceAgreementCoverageRows(ctx context.Context, conn altocQueryer, agreementID any) ([]map[string]any, error) {
	exists, err := altocTableExists(ctx, conn, "service_agreement_coverage")
	if err != nil || !exists {
		return []map[string]any{}, err
	}
	return altocQueryMaps(ctx, conn, `
		SELECT *
		FROM service_agreement_coverage
		WHERE service_agreement_id = ?
		  AND deleted_at IS NULL
		ORDER BY resolution_status ASC, coverage_status ASC, target_type ASC, id ASC
	`, agreementID)
}

func legacyServiceAgreementAssetCoverageRows(ctx context.Context, conn altocQueryer, agreementID any) ([]map[string]any, error) {
	rows, err := altocQueryMaps(ctx, conn, `
		SELECT *
		FROM service_agreement_asset
		WHERE service_agreement_id = ?
		  AND deleted_at IS NULL
		ORDER BY id ASC
	`, agreementID)
	if err != nil {
		return nil, err
	}
	for _, row := range rows {
		row["target_type"] = "legacy"
		row["resolution_status"] = "needs_review"
		row["legacy_reference"] = row["delivery_asset_code"]
	}
	return rows, nil
}

func serviceAgreementCoverageInputFromBody(body map[string]any) (serviceAgreementCoverageInput, error) {
	input := serviceAgreementCoverageInput{
		coverageCode:      firstBodyText(body, "coverageCode", "coverage_code"),
		targetType:        strings.ToLower(strings.TrimSpace(firstBodyText(body, "targetType", "target_type"))),
		sourcePlanCode:    firstBodyText(body, "sourcePlanCode", "source_plan_code"),
		deliveryAssetCode: firstBodyText(body, "deliveryAssetCode", "delivery_asset_code"),
		environmentCode:   firstBodyText(body, "environmentCode", "environment_code"),
		legacyReference:   firstBodyText(body, "legacyReference", "legacy_reference"),
		resolutionStatus:  strings.ToLower(strings.TrimSpace(firstBodyText(body, "resolutionStatus", "resolution_status"))),
		coverageStatus:    strings.ToLower(strings.TrimSpace(firstBodyText(body, "coverageStatus", "coverage_status", "status"))),
		coverageScope:     firstBodyText(body, "coverageScope", "coverage_scope"),
		productScopeJSON:  coverageBodyJSONText(body, "productScope", "product_scope", "productScopeJson", "product_scope_json"),
		effectiveFrom:     altocDateText(firstBodyText(body, "effectiveFrom", "effective_from")),
		effectiveTo:       altocDateText(firstBodyText(body, "effectiveTo", "effective_to")),
		included:          true,
		exclusionNote:     firstBodyText(body, "exclusionNote", "exclusion_note"),
		sourceType:        strings.ToLower(strings.TrimSpace(firstNonEmptyText(firstBodyText(body, "sourceType", "source_type"), "manual"))),
	}
	if coverageBodyHasAnyKey(body, "included") {
		input.included = altocBool(body["included"])
	}
	if input.targetType == "" {
		switch {
		case input.deliveryAssetCode != "" && input.environmentCode != "":
			input.targetType = "delivery_asset_environment"
		case input.deliveryAssetCode != "":
			input.targetType = "delivery_asset"
		case input.environmentCode != "":
			input.targetType = "environment"
		case input.sourcePlanCode != "":
			input.targetType = "pending_plan"
		case input.legacyReference != "":
			input.targetType = "legacy"
		default:
			return input, httperror.New(http.StatusBadRequest, "coverage_target_unresolved", "coverage target is required")
		}
	}
	if input.resolutionStatus == "" {
		if input.targetType == "pending_plan" {
			input.resolutionStatus = "pending"
		} else if input.targetType == "legacy" {
			input.resolutionStatus = "needs_review"
		} else {
			input.resolutionStatus = "resolved"
		}
	}
	if input.coverageStatus == "" {
		input.coverageStatus = "planned"
	}
	if input.sourceType == "" {
		input.sourceType = "manual"
	}
	if err := validateServiceAgreementCoverageInput(input); err != nil {
		return input, err
	}
	return input, nil
}

func coverageBodyHasAnyKey(body map[string]any, keys ...string) bool {
	for _, key := range keys {
		if _, ok := body[key]; ok {
			return true
		}
	}
	return false
}

func coverageBodyJSONText(body map[string]any, keys ...string) string {
	for _, key := range keys {
		value, ok := body[key]
		if !ok || value == nil {
			continue
		}
		if text, ok := value.(string); ok {
			return strings.TrimSpace(text)
		}
		if mapped, ok := value.(map[string]any); ok {
			return jsonColumnText(mapped)
		}
		encoded, err := json.Marshal(value)
		if err != nil {
			return fmt.Sprint(value)
		}
		return string(encoded)
	}
	return ""
}

func validateServiceAgreementCoverageInput(input serviceAgreementCoverageInput) error {
	if serviceAgreementCoverageRequiresFormalTarget(input.targetType) &&
		(serviceAgreementCoveragePlanCodeLike(input.deliveryAssetCode) || serviceAgreementCoveragePlanCodeLike(input.environmentCode)) {
		return httperror.New(http.StatusConflict, "coverage_target_conflict", "formal coverage target cannot use an Altoc plan code")
	}
	switch input.targetType {
	case "delivery_asset":
		if input.deliveryAssetCode == "" {
			return httperror.New(http.StatusBadRequest, "delivery_asset_not_found", "deliveryAssetCode is required")
		}
	case "environment":
		if input.environmentCode == "" {
			return httperror.New(http.StatusBadRequest, "environment_not_found", "environmentCode is required")
		}
	case "delivery_asset_environment":
		if input.deliveryAssetCode == "" || input.environmentCode == "" {
			return httperror.New(http.StatusBadRequest, "delivery_asset_environment_conflict", "deliveryAssetCode and environmentCode are required")
		}
	case "pending_plan":
		if input.sourcePlanCode == "" {
			return httperror.New(http.StatusBadRequest, "coverage_target_unresolved", "sourcePlanCode is required")
		}
		if input.resolutionStatus == "resolved" || input.coverageStatus == "active" {
			return httperror.New(http.StatusConflict, "coverage_target_unresolved", "pending plan coverage cannot be resolved or active")
		}
	case "legacy":
		if input.legacyReference == "" {
			return httperror.New(http.StatusBadRequest, "legacy_coverage_needs_review", "legacyReference is required")
		}
		if input.resolutionStatus == "resolved" {
			return httperror.New(http.StatusConflict, "legacy_coverage_needs_review", "legacy coverage needs review")
		}
	default:
		return httperror.New(http.StatusBadRequest, "coverage_target_unresolved", "invalid coverage target type")
	}
	if input.coverageStatus == "active" && input.resolutionStatus != "resolved" {
		return httperror.New(http.StatusConflict, "coverage_target_unresolved", "active coverage requires a resolved formal target")
	}
	switch input.coverageStatus {
	case "planned", "active", "suspended", "ended", "cancelled":
	default:
		return httperror.New(http.StatusBadRequest, "invalid_coverage_status", "invalid coverageStatus")
	}
	switch input.resolutionStatus {
	case "pending", "resolved", "needs_review":
	default:
		return httperror.New(http.StatusBadRequest, "invalid_resolution_status", "invalid resolutionStatus")
	}
	return nil
}

func serviceAgreementCoverageRequiresFormalTarget(targetType string) bool {
	return targetType == "delivery_asset" || targetType == "environment" || targetType == "delivery_asset_environment"
}

func serviceAgreementCoveragePlanCodeLike(value string) bool {
	value = strings.ToUpper(strings.TrimSpace(value))
	return strings.HasPrefix(value, "CDAP-") || strings.HasPrefix(value, "DAP-")
}

func serviceAgreementCoverageDateText(value any) string {
	if value == nil {
		return ""
	}
	text := strings.TrimSpace(fmt.Sprint(value))
	if text == "<nil>" {
		return ""
	}
	return text
}

func serviceAgreementCoverageByCodeTx(ctx context.Context, tx *sql.Tx, coverageCode string) (map[string]any, error) {
	return altocQueryOneMap(ctx, tx, `
		SELECT *
		FROM service_agreement_coverage
		WHERE coverage_code = ?
		  AND deleted_at IS NULL
		LIMIT 1
	`, strings.TrimSpace(coverageCode))
}

func lockServiceAgreementCoverageByCodeTx(ctx context.Context, tx *sql.Tx, coverageCode string) (map[string]any, error) {
	return altocQueryOneMap(ctx, tx, `
		SELECT *
		FROM service_agreement_coverage
		WHERE coverage_code = ?
		  AND deleted_at IS NULL
		LIMIT 1
		FOR UPDATE
	`, strings.TrimSpace(coverageCode))
}

func serviceAgreementCoverageCommandPath(path string) (string, string, string, bool) {
	const prefix = "/v1/altoc/service/service-agreements/"
	if !strings.HasPrefix(path, prefix) {
		return "", "", "", false
	}
	rest := strings.TrimPrefix(path, prefix)
	parts := strings.Split(rest, "/")
	if len(parts) != 3 || parts[0] == "" || parts[1] != "coverages" || parts[2] == "" {
		return "", "", "", false
	}
	coveragePart := parts[2]
	action := ""
	for _, candidate := range []string{":resolve", ":suspend", ":end", ":confirm-legacy"} {
		if strings.HasSuffix(coveragePart, candidate) {
			action = strings.TrimPrefix(candidate, ":")
			coveragePart = strings.TrimSuffix(coveragePart, candidate)
			break
		}
	}
	if action == "" || coveragePart == "" {
		return "", "", "", false
	}
	agreementCode, _ := url.PathUnescape(parts[0])
	coverageCode, _ := url.PathUnescape(coveragePart)
	return agreementCode, coverageCode, action, true
}

func nextServiceAgreementCoverageCode(ctx context.Context, tx *sql.Tx) (string, error) {
	for index := 0; index < 20; index++ {
		code := "SAC-" + time.Now().UTC().Format("20060102150405") + fmt.Sprintf("%02d", index)
		var count int64
		if err := tx.QueryRowContext(ctx, "SELECT COUNT(*) FROM service_agreement_coverage WHERE coverage_code = ?", code).Scan(&count); err != nil {
			return "", err
		}
		if count == 0 {
			return code, nil
		}
	}
	return "", httperror.New(http.StatusConflict, "code_generation_failed", "unable to generate coverage code")
}

func syncServiceAgreementCoverageFromAssetTx(ctx context.Context, tx *sql.Tx, asset map[string]any, deliveryAssetCode string, environmentCode string, assetStatus string, operator string) (int64, error) {
	deliveryAssetCode = strings.TrimSpace(deliveryAssetCode)
	if deliveryAssetCode == "" {
		return 0, nil
	}
	planCode := altocMapText(asset, "code")
	oldExternalCode := altocMapText(asset, "external_asset_code")
	if planCode == "" && oldExternalCode == "" {
		return 0, nil
	}
	exists, err := altocTableExists(ctx, tx, "service_agreement_coverage")
	if err != nil || !exists {
		return 0, err
	}

	codes := []string{}
	for _, code := range []string{planCode, oldExternalCode, deliveryAssetCode} {
		code = strings.TrimSpace(code)
		if code != "" {
			seen := false
			for _, existing := range codes {
				if existing == code {
					seen = true
					break
				}
			}
			if !seen {
				codes = append(codes, code)
			}
		}
	}
	if len(codes) == 0 {
		return 0, nil
	}
	placeholders := strings.TrimRight(strings.Repeat("?,", len(codes)), ",")
	args := []any{asset["contract_id"]}
	for _, code := range codes {
		args = append(args, code)
	}
	for _, code := range codes {
		args = append(args, code)
	}
	rows, err := altocQueryMaps(ctx, tx, `
		SELECT sac.*
		FROM service_agreement_coverage sac
		INNER JOIN service_agreement sa ON sa.id = sac.service_agreement_id
		WHERE sa.contract_id = ?
		  AND sac.deleted_at IS NULL
		  AND (
		    sac.source_plan_code IN (`+placeholders+`)
		    OR sac.delivery_asset_code IN (`+placeholders+`)
		  )
		FOR UPDATE
	`, args...)
	if err != nil {
		return 0, err
	}
	targetType := "delivery_asset"
	if strings.TrimSpace(environmentCode) != "" {
		targetType = "delivery_asset_environment"
	}
	coverageStatus := "planned"
	if strings.TrimSpace(assetStatus) == "accepted" {
		coverageStatus = "active"
	}
	var updated int64
	for _, coverage := range rows {
		if altocMapText(coverage, "target_type") == "legacy" {
			continue
		}
		duplicate, err := serviceAgreementCoverageTargetExistsTx(
			ctx,
			tx,
			coverage["service_agreement_id"],
			targetType,
			deliveryAssetCode,
			environmentCode,
			altocMapText(coverage, "effective_from"),
			altocMapText(coverage, "effective_to"),
			coverage["id"],
		)
		if err != nil {
			return updated, err
		}
		if duplicate {
			if _, err := tx.ExecContext(ctx, `
				UPDATE service_agreement_coverage
				SET deleted_at = CURRENT_TIMESTAMP,
				    coverage_status = 'cancelled',
				    updated_by = COALESCE(?, updated_by),
				    updated_at = CURRENT_TIMESTAMP
				WHERE id = ?
			`, nullableText(operator), coverage["id"]); err != nil {
				return updated, err
			}
			updated++
			continue
		}
		if _, err := tx.ExecContext(ctx, `
			UPDATE service_agreement_coverage
			SET target_type = ?,
			    source_plan_code = COALESCE(source_plan_code, ?),
			    delivery_asset_code = ?,
			    environment_code = ?,
			    legacy_reference = NULL,
			    resolution_status = 'resolved',
			    coverage_status = ?,
			    source_type = 'callback',
			    updated_by = COALESCE(?, updated_by),
			    updated_at = CURRENT_TIMESTAMP
			WHERE id = ?
		`,
			targetType,
			nullableText(planCode),
			deliveryAssetCode,
			nullableText(environmentCode),
			coverageStatus,
			nullableText(operator),
			coverage["id"],
		); err != nil {
			return updated, err
		}
		updated++
	}
	return updated, nil
}

func serviceAgreementCoverageTargetExistsTx(ctx context.Context, tx *sql.Tx, agreementID any, targetType string, deliveryAssetCode string, environmentCode string, effectiveFrom string, effectiveTo string, excludeID any) (bool, error) {
	where := []string{
		"service_agreement_id = ?",
		"target_type = ?",
		"deleted_at IS NULL",
		"coverage_status <> 'cancelled'",
		"id <> ?",
	}
	args := []any{agreementID, targetType, excludeID}
	if deliveryAssetCode == "" {
		where = append(where, "(delivery_asset_code IS NULL OR delivery_asset_code = '')")
	} else {
		where = append(where, "delivery_asset_code = ?")
		args = append(args, deliveryAssetCode)
	}
	if environmentCode == "" {
		where = append(where, "(environment_code IS NULL OR environment_code = '')")
	} else {
		where = append(where, "environment_code = ?")
		args = append(args, environmentCode)
	}
	if effectiveFrom == "" {
		where = append(where, "effective_from IS NULL")
	} else {
		where = append(where, "effective_from = ?")
		args = append(args, effectiveFrom)
	}
	if effectiveTo == "" {
		where = append(where, "effective_to IS NULL")
	} else {
		where = append(where, "effective_to = ?")
		args = append(args, effectiveTo)
	}
	var count int64
	err := tx.QueryRowContext(ctx, "SELECT COUNT(*) FROM service_agreement_coverage WHERE "+strings.Join(where, " AND "), args...).Scan(&count)
	return count > 0, err
}

func activateServiceAgreementsForCoverageTx(ctx context.Context, tx *sql.Tx, deliveryAssetCode string, environmentCode string, operator string) (int64, error) {
	deliveryAssetCode = strings.TrimSpace(deliveryAssetCode)
	if deliveryAssetCode == "" {
		return 0, nil
	}
	result, err := tx.ExecContext(ctx, `
		UPDATE service_agreement sa
		INNER JOIN service_agreement_coverage sac ON sac.service_agreement_id = sa.id
		SET sa.status = 'active',
		    sa.updated_by = COALESCE(?, sa.updated_by),
		    sa.updated_at = CURRENT_TIMESTAMP
		WHERE sac.delivery_asset_code = ?
		  AND (? = '' OR sac.environment_code = ?)
		  AND sac.included = 1
		  AND sac.deleted_at IS NULL
		  AND sac.resolution_status = 'resolved'
		  AND sac.coverage_status = 'active'
		  AND sa.deleted_at IS NULL
		  AND sa.status IN ('planned', 'suspended')
		  AND (sa.service_start_date IS NULL OR sa.service_start_date <= CURRENT_DATE)
		  AND (sa.service_end_date IS NULL OR sa.service_end_date >= CURRENT_DATE)
	`, nullableText(operator), deliveryAssetCode, strings.TrimSpace(environmentCode), strings.TrimSpace(environmentCode))
	if err != nil {
		return 0, err
	}
	affected, _ := result.RowsAffected()
	return affected, nil
}

func ensureServiceAgreementCoverageForAssetTx(ctx context.Context, tx *sql.Tx, agreement map[string]any, asset map[string]any, operator string) error {
	exists, err := altocTableExists(ctx, tx, "service_agreement_coverage")
	if err != nil || !exists {
		return err
	}
	planCode := altocMapText(asset, "code")
	if planCode == "" {
		return nil
	}
	targetType := "pending_plan"
	resolutionStatus := "pending"
	coverageStatus := "planned"
	deliveryAssetCode := ""
	environmentCode := ""
	if externalCode := altocMapText(asset, "external_asset_code"); externalCode != "" {
		deliveryAssetCode = externalCode
		resolutionStatus = "resolved"
		if envCode := altocMapText(asset, "environment_code"); envCode != "" {
			environmentCode = envCode
			targetType = "delivery_asset_environment"
		} else {
			targetType = "delivery_asset"
		}
		if altocMapText(agreement, "status") == "active" {
			coverageStatus = "active"
		}
	}
	coverageCode := "SAC-ACT-" + fmt.Sprint(agreement["id"]) + "-" + planCode
	_, err = tx.ExecContext(ctx, `
		INSERT INTO service_agreement_coverage (
		  coverage_code,
		  service_agreement_id,
		  target_type,
		  source_plan_code,
		  delivery_asset_code,
		  environment_code,
		  resolution_status,
		  coverage_status,
		  effective_from,
		  effective_to,
		  included,
		  source_type,
		  created_by,
		  updated_by
		) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, 'activation', ?, ?)
		ON DUPLICATE KEY UPDATE
		  target_type = VALUES(target_type),
		  delivery_asset_code = COALESCE(VALUES(delivery_asset_code), delivery_asset_code),
		  environment_code = COALESCE(VALUES(environment_code), environment_code),
		  resolution_status = VALUES(resolution_status),
		  coverage_status = VALUES(coverage_status),
		  effective_from = COALESCE(VALUES(effective_from), effective_from),
		  effective_to = COALESCE(VALUES(effective_to), effective_to),
		  included = 1,
		  deleted_at = NULL,
		  updated_by = VALUES(updated_by),
		  updated_at = CURRENT_TIMESTAMP
	`,
		coverageCode,
		agreement["id"],
		targetType,
		planCode,
		nullableText(deliveryAssetCode),
		nullableText(environmentCode),
		resolutionStatus,
		coverageStatus,
		altocDateText(altocMapText(agreement, "service_start_date")),
		altocDateText(altocMapText(agreement, "service_end_date")),
		nullableText(operator),
		nullableText(operator),
	)
	return err
}
