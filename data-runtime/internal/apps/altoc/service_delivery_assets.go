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

func (a *Adapter) syncCustomerDeliveryAssetStatus(ctx context.Context, deliveryAssetCode string, body map[string]any) (map[string]any, error) {
	deliveryAssetCode = strings.TrimSpace(deliveryAssetCode)
	if deliveryAssetCode == "" {
		return nil, httperror.New(http.StatusBadRequest, "missing_delivery_asset_code", "deliveryAssetCode is required")
	}
	if err := altocRequireActionScope(body, "contract", "delivery-asset-status:sync"); err != nil {
		return nil, err
	}

	tx, err := a.DB().BeginTx(ctx, nil)
	if err != nil {
		return nil, err
	}
	defer tx.Rollback()

	asset, contract, err := lockDeliveryAssetPlanForSyncTx(ctx, tx, deliveryAssetCode, body)
	if err != nil {
		return nil, err
	}
	if asset == nil || contract == nil {
		return nil, httperror.New(http.StatusNotFound, "record_not_found", "contract delivery asset plan not found")
	}
	if err := assertStatusSyncPayloadCustomer(asset, body); err != nil {
		return nil, err
	}

	operator := altocActor(body)
	status := normalizeContractDeliveryAssetStatus(syncBodyText(body, "status"))
	oldStatus := altocMapText(asset, "status")
	oldExternalAssetCode := altocMapText(asset, "external_asset_code")
	oldEnvironmentCode := altocMapText(asset, "environment_code")
	externalAssetCode, err := formalDeliveryAssetCodeForStatusSync(deliveryAssetCode, body)
	if err != nil {
		return nil, err
	}
	environmentCode := firstNonEmptyText(
		syncBodyText(body, "environmentCode", "environment_code"),
		oldEnvironmentCode,
	)
	deliveredAt, goLiveAt, acceptedAt := syncAssetLifecycleTimes(status, body)

	if _, err := tx.ExecContext(ctx, `
		UPDATE contract_delivery_asset_plan
		SET status = ?,
		    external_asset_code = COALESCE(?, external_asset_code),
		    environment_code = COALESCE(?, environment_code),
		    delivered_at = COALESCE(?, delivered_at),
		    go_live_at = COALESCE(?, go_live_at),
		    accepted_at = COALESCE(?, accepted_at),
		    updated_by = COALESCE(?, updated_by),
		    updated_at = CURRENT_TIMESTAMP
		WHERE id = ?
		  AND deleted_at IS NULL
	`, status, nullableText(externalAssetCode), nullableText(environmentCode), nullableText(deliveredAt), nullableText(goLiveAt), nullableText(acceptedAt), nullableText(operator), asset["id"]); err != nil {
		return nil, err
	}

	coverageUpdated, err := syncServiceAgreementAssetCodeTx(ctx, tx, asset, externalAssetCode, operator)
	if err != nil {
		return nil, err
	}
	formalCoverageUpdated, err := syncServiceAgreementCoverageFromAssetTx(ctx, tx, asset, externalAssetCode, environmentCode, status, operator)
	if err != nil {
		return nil, err
	}

	var obligationStatus string
	var billableSchedules int64
	var activatedServiceAgreements int64
	if status == "accepted" {
		obligationStatus, billableSchedules, err = acceptDeliveryAssetObligationTx(ctx, tx, asset, contract, operator)
		if err != nil {
			return nil, err
		}
		activatedServiceAgreements, err = activateServiceAgreementsForAssetTx(ctx, tx, externalAssetCode, operator)
		if err != nil {
			return nil, err
		}
		formalActivated, err := activateServiceAgreementsForCoverageTx(ctx, tx, externalAssetCode, environmentCode, operator)
		if err != nil {
			return nil, err
		}
		activatedServiceAgreements += formalActivated
	}

	fulfillmentStatus, err := a.updateContractFulfillmentStatusTx(ctx, tx, contract["id"], operator)
	if err != nil {
		return nil, err
	}
	updatedAsset, err := deliveryAssetPlanByIDTx(ctx, tx, asset["id"])
	if err != nil {
		return nil, err
	}
	if err := insertAltocAuditTx(ctx, tx, "contract_delivery_asset_plan", asset["id"], "status_sync", map[string]any{
		"status":              oldStatus,
		"external_asset_code": asset["external_asset_code"],
		"environment_code":    oldEnvironmentCode,
	}, map[string]any{
		"status":                     status,
		"external_asset_code":        externalAssetCode,
		"environment_code":           environmentCode,
		"obligation_status":          obligationStatus,
		"billable_schedule_count":    billableSchedules,
		"service_asset_coverages":    coverageUpdated,
		"service_coverages":          formalCoverageUpdated,
		"service_agreements_active":  activatedServiceAgreements,
		"contract_fulfillment_state": fulfillmentStatus,
	}, operator); err != nil {
		return nil, err
	}
	if err := insertContractDomainEventTx(ctx, tx, contractDomainEventKey("contract.delivery_asset", asset["id"], "status_sync", oldStatus, status, externalAssetCode), "ContractDeliveryAssetStatusSynced", "contract_delivery_asset_plan", asset["id"], map[string]any{
		"contract_id":                  contract["id"],
		"contract_code":                contract["code"],
		"delivery_asset_plan_id":       asset["id"],
		"delivery_asset_plan_code":     asset["code"],
		"delivery_asset_code":          externalAssetCode,
		"environment_code":             environmentCode,
		"old_status":                   oldStatus,
		"new_status":                   status,
		"obligation_status":            obligationStatus,
		"billable_schedule_count":      billableSchedules,
		"service_asset_coverage_count": coverageUpdated,
		"service_coverage_count":       formalCoverageUpdated,
		"service_agreements_active":    activatedServiceAgreements,
		"contract_fulfillment_state":   fulfillmentStatus,
	}, operator); err != nil {
		return nil, err
	}
	if err := tx.Commit(); err != nil {
		return nil, err
	}

	return map[string]any{
		"contractCode":                contract["code"],
		"deliveryAssetPlan":           updatedAsset,
		"status":                      status,
		"changed":                     oldStatus != status || oldExternalAssetCode != externalAssetCode || oldEnvironmentCode != environmentCode || billableSchedules > 0 || coverageUpdated > 0 || formalCoverageUpdated > 0 || activatedServiceAgreements > 0,
		"idempotent":                  oldStatus == status && oldExternalAssetCode == externalAssetCode && oldEnvironmentCode == environmentCode && billableSchedules == 0 && coverageUpdated == 0 && formalCoverageUpdated == 0 && activatedServiceAgreements == 0,
		"obligationStatus":            obligationStatus,
		"billableScheduleCount":       billableSchedules,
		"serviceAssetCoverageCount":   coverageUpdated,
		"serviceCoverageCount":        formalCoverageUpdated,
		"serviceAgreementActiveCount": activatedServiceAgreements,
		"fulfillmentStatus":           fulfillmentStatus,
	}, nil
}

func (a *Adapter) customerDeliveryAssetStatusSyncContext(ctx context.Context, deliveryAssetCode string, query url.Values) (map[string]any, error) {
	deliveryAssetCode = strings.TrimSpace(deliveryAssetCode)
	if deliveryAssetCode == "" {
		return nil, httperror.New(http.StatusBadRequest, "missing_delivery_asset_code", "deliveryAssetCode is required")
	}
	matches, args := deliveryAssetPlanSyncMatches(
		deliveryAssetCode,
		firstNonEmptyText(query.Get("sourcePlanCode"), query.Get("source_plan_code")),
		firstNonEmptyText(query.Get("contractCode"), query.Get("contract_code"), query.Get("sourceContractCode"), query.Get("source_contract_code")),
		firstNonEmptyText(query.Get("contractLineCode"), query.Get("contract_line_code"), query.Get("sourceContractLineCode"), query.Get("source_contract_line_code")),
	)
	row, err := altocQueryOneMap(ctx, a.DB(), `
		SELECT
		  dap.*,
		  c.code AS contract_code,
		  c.customer_id AS contract_customer_id,
		  cu.code AS contract_customer_code,
		  sa.customer_code AS service_agreement_customer_code
		FROM contract_delivery_asset_plan dap
		JOIN contract c ON c.id = dap.contract_id
		LEFT JOIN customer cu ON cu.id = c.customer_id
		LEFT JOIN service_agreement sa ON sa.contract_id = c.id AND sa.deleted_at IS NULL
		WHERE dap.deleted_at IS NULL
		  AND (`+strings.Join(matches, " OR ")+`)
		  AND c.deleted_at IS NULL
		ORDER BY dap.id ASC, sa.id ASC
		LIMIT 1
	`, args...)
	if err != nil {
		return nil, err
	}
	if row == nil {
		return nil, httperror.New(http.StatusNotFound, "record_not_found", "contract delivery asset plan not found")
	}
	expectedCustomerCode := firstNonEmptyText(
		altocMapText(row, "customer_code"),
		altocMapText(row, "service_agreement_customer_code"),
		altocMapText(row, "contract_customer_code"),
	)
	return map[string]any{
		"delivery_asset_plan":    row,
		"contract_code":          row["contract_code"],
		"expectedCustomerCode":   expectedCustomerCode,
		"expected_customer_code": expectedCustomerCode,
	}, nil
}

func formalDeliveryAssetCodeForStatusSync(pathDeliveryAssetCode string, body map[string]any) (string, error) {
	externalAssetCode := firstNonEmptyText(
		syncBodyText(body, "externalAssetCode", "external_asset_code"),
		syncBodyText(body, "deliveryAssetCode", "delivery_asset_code", "code"),
	)
	if externalAssetCode == "" && !serviceAgreementCoveragePlanCodeLike(pathDeliveryAssetCode) {
		externalAssetCode = strings.TrimSpace(pathDeliveryAssetCode)
	}
	if serviceAgreementCoveragePlanCodeLike(externalAssetCode) {
		return "", httperror.New(http.StatusBadRequest, "invalid_delivery_asset_code", "deliveryAssetCode must be an Assets formal delivery asset code")
	}
	return externalAssetCode, nil
}

func lockDeliveryAssetPlanForSyncTx(ctx context.Context, tx *sql.Tx, deliveryAssetCode string, body map[string]any) (map[string]any, map[string]any, error) {
	matches, args := deliveryAssetPlanSyncMatches(
		deliveryAssetCode,
		syncBodyText(body, "sourcePlanCode", "source_plan_code"),
		syncBodyText(body, "contractCode", "contract_code", "sourceContractCode", "source_contract_code"),
		syncBodyText(body, "contractLineCode", "contract_line_code", "sourceContractLineCode", "source_contract_line_code"),
	)

	rows, err := tx.QueryContext(ctx, `
		SELECT
		  dap.*,
		  c.code AS contract_code,
		  c.customer_id AS contract_customer_id,
		  cu.code AS contract_customer_code,
		  c.owner_user_id AS contract_owner_user_id,
		  c.owner_dept_code AS contract_owner_dept_code
		FROM contract_delivery_asset_plan dap
		JOIN contract c ON c.id = dap.contract_id
		LEFT JOIN customer cu ON cu.id = c.customer_id
		WHERE dap.deleted_at IS NULL
		  AND (`+strings.Join(matches, " OR ")+`)
		  AND c.deleted_at IS NULL
		ORDER BY dap.id ASC
		LIMIT 1
		FOR UPDATE
	`, args...)
	if err != nil {
		return nil, nil, err
	}
	defer rows.Close()
	items, err := altocRowsToMaps(rows)
	if err != nil || len(items) == 0 {
		return nil, nil, err
	}
	asset := items[0]
	contract := map[string]any{
		"id":              asset["contract_id"],
		"code":            asset["contract_code"],
		"customer_id":     asset["contract_customer_id"],
		"customer_code":   asset["contract_customer_code"],
		"owner_user_id":   asset["contract_owner_user_id"],
		"owner_dept_code": asset["contract_owner_dept_code"],
	}
	return asset, contract, nil
}

func deliveryAssetPlanSyncMatches(deliveryAssetCode string, sourcePlanCode string, contractCode string, contractLineCode string) ([]string, []any) {
	matches := []string{"(dap.external_asset_code = ? OR dap.code = ?)"}
	args := []any{strings.TrimSpace(deliveryAssetCode), strings.TrimSpace(deliveryAssetCode)}
	if sourcePlanCode = strings.TrimSpace(sourcePlanCode); sourcePlanCode != "" {
		matches = append(matches, "dap.code = ?")
		args = append(args, sourcePlanCode)
	}
	if contractCode = strings.TrimSpace(contractCode); contractCode != "" {
		contractLineCode = strings.TrimSpace(contractLineCode)
		if contractLineCode != "" {
			matches = append(matches, "(dap.source_contract_code = ? AND dap.source_contract_line_code = ?)")
			args = append(args, contractCode, contractLineCode)
		}
	}
	return matches, args
}

func assertStatusSyncPayloadCustomer(asset map[string]any, body map[string]any) error {
	expectedCustomer := altocMapText(asset, "customer_code")
	if expectedCustomer == "" {
		expectedCustomer = altocMapText(asset, "contract_customer_code")
	}
	assetCustomer := firstNonEmptyText(
		syncBodyText(body, "customerCode", "customer_code"),
		syncBodyText(body, "deliveryAssetCustomerCode", "delivery_asset_customer_code"),
		nestedSyncBodyText(body, "asset", "customerCode", "customer_code"),
		nestedSyncBodyText(body, "deliveryAsset", "customerCode", "customer_code"),
		nestedSyncBodyText(body, "delivery_asset", "customerCode", "customer_code"),
	)
	environmentCustomer := firstNonEmptyText(
		syncBodyText(body, "environmentCustomerCode", "environment_customer_code"),
		nestedSyncBodyText(body, "environment", "customerCode", "customer_code"),
		nestedSyncBodyText(body, "assetEnvironment", "customerCode", "customer_code"),
		nestedSyncBodyText(body, "asset_environment", "customerCode", "customer_code"),
	)
	if expectedCustomer != "" {
		if assetCustomer != "" && assetCustomer != expectedCustomer {
			return httperror.New(http.StatusConflict, "delivery_asset_customer_conflict", "delivery asset belongs to another customer")
		}
		if environmentCustomer != "" && environmentCustomer != expectedCustomer {
			return httperror.New(http.StatusConflict, "environment_customer_conflict", "environment belongs to another customer")
		}
	}
	if assetCustomer != "" && environmentCustomer != "" && assetCustomer != environmentCustomer {
		return httperror.New(http.StatusConflict, "delivery_asset_environment_conflict", "delivery asset and environment belong to different customers")
	}
	return nil
}

func nestedSyncBodyText(body map[string]any, parent string, keys ...string) string {
	value, ok := body[parent]
	if !ok {
		return ""
	}
	nested, ok := value.(map[string]any)
	if !ok {
		return ""
	}
	return syncBodyText(nested, keys...)
}

func syncServiceAgreementAssetCodeTx(ctx context.Context, tx *sql.Tx, asset map[string]any, externalAssetCode string, operator string) (int64, error) {
	externalAssetCode = strings.TrimSpace(externalAssetCode)
	planCode := altocMapText(asset, "code")
	oldExternalCode := altocMapText(asset, "external_asset_code")
	if externalAssetCode == "" || planCode == "" {
		return 0, nil
	}

	rows, err := tx.QueryContext(ctx, `
		SELECT saa.id, saa.service_agreement_id, saa.delivery_asset_code
		FROM service_agreement_asset saa
		JOIN service_agreement sa ON sa.id = saa.service_agreement_id
		WHERE sa.contract_id = ?
		  AND saa.delivery_asset_code IN (?, ?)
		  AND saa.deleted_at IS NULL
		FOR UPDATE
	`, asset["contract_id"], planCode, oldExternalCode)
	if err != nil {
		return 0, err
	}
	items, err := altocRowsToMaps(rows)
	rows.Close()
	if err != nil {
		return 0, err
	}

	var updated int64
	for _, item := range items {
		agreementID := item["service_agreement_id"]
		currentCode := altocMapText(item, "delivery_asset_code")
		if currentCode == externalAssetCode {
			continue
		}
		exists, err := serviceAgreementAssetExistsTx(ctx, tx, agreementID, externalAssetCode)
		if err != nil {
			return updated, err
		}
		if exists {
			if _, err := tx.ExecContext(ctx, `
				UPDATE service_agreement_asset
				SET deleted_at = CURRENT_TIMESTAMP,
				    updated_by = COALESCE(?, updated_by),
				    updated_at = CURRENT_TIMESTAMP
				WHERE id = ?
			`, nullableText(operator), item["id"]); err != nil {
				return updated, err
			}
		} else {
			if _, err := tx.ExecContext(ctx, `
				UPDATE service_agreement_asset
				SET delivery_asset_code = ?,
				    coverage_type = 'customer_delivery_asset',
				    updated_by = COALESCE(?, updated_by),
				    updated_at = CURRENT_TIMESTAMP
				WHERE id = ?
			`, externalAssetCode, nullableText(operator), item["id"]); err != nil {
				return updated, err
			}
		}
		updated++
	}
	return updated, nil
}

func activateServiceAgreementsForAssetTx(ctx context.Context, tx *sql.Tx, deliveryAssetCode string, operator string) (int64, error) {
	deliveryAssetCode = strings.TrimSpace(deliveryAssetCode)
	if deliveryAssetCode == "" {
		return 0, nil
	}
	result, err := tx.ExecContext(ctx, `
		UPDATE service_agreement sa
		INNER JOIN service_agreement_asset saa ON saa.service_agreement_id = sa.id
		SET sa.status = 'active',
		    sa.updated_by = COALESCE(?, sa.updated_by),
		    sa.updated_at = CURRENT_TIMESTAMP
		WHERE saa.delivery_asset_code = ?
		  AND saa.included = 1
		  AND saa.deleted_at IS NULL
		  AND sa.deleted_at IS NULL
		  AND sa.status IN ('planned', 'suspended')
		  AND (sa.service_start_date IS NULL OR sa.service_start_date <= CURRENT_DATE)
		  AND (sa.service_end_date IS NULL OR sa.service_end_date >= CURRENT_DATE)
	`, nullableText(operator), deliveryAssetCode)
	if err != nil {
		return 0, err
	}
	affected, _ := result.RowsAffected()
	return affected, nil
}

func serviceAgreementAssetExistsTx(ctx context.Context, tx *sql.Tx, agreementID any, deliveryAssetCode string) (bool, error) {
	var id int64
	err := tx.QueryRowContext(ctx, `
		SELECT id
		FROM service_agreement_asset
		WHERE service_agreement_id = ?
		  AND delivery_asset_code = ?
		  AND deleted_at IS NULL
		LIMIT 1
	`, agreementID, deliveryAssetCode).Scan(&id)
	if err == sql.ErrNoRows {
		return false, nil
	}
	return err == nil && id > 0, err
}

func acceptDeliveryAssetObligationTx(ctx context.Context, tx *sql.Tx, asset map[string]any, contract map[string]any, operator string) (string, int64, error) {
	obligationID := altocPositiveID(asset["obligation_id"])
	if obligationID <= 0 {
		return "", 0, nil
	}
	obligation, err := altocQueryOneMap(ctx, tx, `
		SELECT *
		FROM contract_obligation
		WHERE id = ?
		  AND contract_id = ?
		  AND deleted_at IS NULL
		LIMIT 1
		FOR UPDATE
	`, obligationID, contract["id"])
	if err != nil || obligation == nil {
		return "", 0, err
	}
	currentStatus := altocMapText(obligation, "status")
	if currentStatus == "accepted" || currentStatus == "completed" || currentStatus == "waived" || currentStatus == "cancelled" {
		return currentStatus, 0, nil
	}
	targetStatus := "accepted"
	if !altocBool(fmt.Sprint(obligation["acceptance_required"])) {
		targetStatus = "completed"
	}
	if _, err := tx.ExecContext(ctx, `
		UPDATE contract_obligation
		SET status = ?,
		    accepted_at = COALESCE(accepted_at, CURRENT_TIMESTAMP),
		    actual_completed_at = COALESCE(actual_completed_at, CURRENT_TIMESTAMP),
		    evidence_note = COALESCE(NULLIF(?, ''), evidence_note),
		    rejected_at = NULL,
		    reject_reason = NULL,
		    version_no = version_no + 1,
		    updated_by = COALESCE(?, updated_by),
		    updated_at = CURRENT_TIMESTAMP
		WHERE id = ?
	`, targetStatus, deliveryAssetEvidenceNote(asset), nullableText(operator), obligationID); err != nil {
		return "", 0, err
	}
	billableSchedules, err := markBillingSchedulesForObligationTx(ctx, tx, obligationID, "accept", operator)
	if err != nil {
		return "", 0, err
	}
	if err := insertAltocAuditTx(ctx, tx, "contract_obligation", obligationID, "status_change", map[string]any{
		"status": currentStatus,
	}, map[string]any{
		"status":                   targetStatus,
		"source":                   "customer_delivery_asset",
		"delivery_asset_plan_id":   asset["id"],
		"delivery_asset_plan_code": asset["code"],
		"billable_schedule_count":  billableSchedules,
	}, operator); err != nil {
		return "", 0, err
	}
	return targetStatus, billableSchedules, nil
}

func deliveryAssetPlanByIDTx(ctx context.Context, tx *sql.Tx, id any) (map[string]any, error) {
	rows, err := tx.QueryContext(ctx, `
		SELECT *
		FROM contract_delivery_asset_plan
		WHERE id = ?
		LIMIT 1
	`, id)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	items, err := altocRowsToMaps(rows)
	if err != nil || len(items) == 0 {
		return nil, err
	}
	return items[0], nil
}

func normalizeContractDeliveryAssetStatus(value string) string {
	switch strings.ToLower(strings.TrimSpace(value)) {
	case "planned", "provisioning", "delivered", "online", "accepted", "suspended", "expired", "terminated":
		return strings.ToLower(strings.TrimSpace(value))
	default:
		return "delivered"
	}
}

func syncAssetLifecycleTimes(status string, body map[string]any) (string, string, string) {
	now := time.Now().UTC().Format("2006-01-02 15:04:05")
	deliveredAt := syncBodyText(body, "deliveredAt", "delivered_at")
	goLiveAt := syncBodyText(body, "goLiveAt", "go_live_at")
	acceptedAt := syncBodyText(body, "acceptedAt", "accepted_at")
	if deliveredAt == "" && (status == "delivered" || status == "online" || status == "accepted") {
		deliveredAt = now
	}
	if goLiveAt == "" && (status == "online" || status == "accepted") {
		goLiveAt = now
	}
	if acceptedAt == "" && status == "accepted" {
		acceptedAt = now
	}
	return deliveredAt, goLiveAt, acceptedAt
}

func syncBodyText(body map[string]any, keys ...string) string {
	if value := firstBodyText(body, keys...); value != "" {
		return value
	}
	for _, nested := range []map[string]any{
		nestedMap(body, "asset"),
		nestedMap(body, "customerDeliveryAsset", "customer_delivery_asset"),
		nestedMap(body, "deliveryAsset", "delivery_asset"),
	} {
		if value := firstBodyText(nested, keys...); value != "" {
			return value
		}
	}
	return ""
}

func deliveryAssetEvidenceNote(asset map[string]any) string {
	return firstNonEmptyText(
		"Assets 客户交付资产验收同步："+altocMapText(asset, "external_asset_code"),
		"Assets 客户交付资产验收同步",
	)
}
