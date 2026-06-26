package assets

import (
	"context"
	"database/sql"
	"net/http"
	"net/url"
	"strings"

	"github.com/huizhi-yun/data-runtime/internal/httperror"
)

func (a *Adapter) handleCustomerDeliveryAssetRoutes(ctx context.Context, method string, path string, query url.Values, body map[string]any) (bool, any, string, error) {
	if method == http.MethodPost && path == "/v1/assets/service/customer-delivery-assets/plans" {
		data, err := a.upsertCustomerDeliveryAssetPlans(ctx, body, actorFromRequest(query, body))
		return true, okWithMessage(data, "客户交付资产已同步"), "assets.service.customer_delivery_assets.plans.upsert", err
	}
	if method == http.MethodGet && path == "/v1/assets/service/customer-delivery-assets/by-customer" {
		data, err := a.listCustomerDeliveryAssets(ctx, query)
		return true, okWithMessage(data, "ok"), "assets.service.customer_delivery_assets.by_customer", err
	}
	if method == http.MethodGet {
		if contractCode, ok := pathParamWithSuffix(path, "/v1/assets/service/customer-delivery-assets/by-contract/", ""); ok {
			contractCode, _ = url.PathUnescape(contractCode)
			values := cloneValues(query)
			values.Set("contract_code", contractCode)
			data, err := a.listCustomerDeliveryAssets(ctx, values)
			return true, okWithMessage(data, "ok"), "assets.service.customer_delivery_assets.by_contract", err
		}
	}
	if method == http.MethodPost {
		if assetCode, ok := pathParamWithSuffix(path, "/v1/assets/service/customer-delivery-assets/", "/activate"); ok {
			assetCode, _ = url.PathUnescape(assetCode)
			data, err := a.activateCustomerDeliveryAsset(ctx, assetCode, body, actorFromRequest(query, body))
			return true, okWithMessage(data, "客户交付资产状态已更新"), "assets.service.customer_delivery_assets.activate", err
		}
	}
	return false, nil, "", nil
}

func (a *Adapter) upsertCustomerDeliveryAssetPlans(ctx context.Context, body map[string]any, operatorUID string) (map[string]any, error) {
	items := customerDeliveryAssetBodies(body)
	if len(items) == 0 {
		return nil, httperror.New(http.StatusBadRequest, "missing_delivery_assets", "deliveryAssets is required")
	}

	created := 0
	updated := 0
	results := make([]map[string]any, 0, len(items))
	_, err := a.withTx(ctx, func(tx *sql.Tx) (any, error) {
		for _, item := range items {
			upserted, wasCreated, err := a.upsertCustomerDeliveryAssetTx(ctx, tx, item, operatorUID)
			if err != nil {
				return nil, err
			}
			if wasCreated {
				created++
			} else {
				updated++
			}
			results = append(results, upserted)
		}
		return nil, nil
	})
	if err != nil {
		return nil, err
	}
	return map[string]any{
		"items":      results,
		"total":      len(results),
		"created":    created,
		"updated":    updated,
		"idempotent": created == 0,
	}, nil
}

func (a *Adapter) upsertCustomerDeliveryAssetTx(ctx context.Context, tx *sql.Tx, body map[string]any, operatorUID string) (map[string]any, bool, error) {
	customerCode := firstText(bodyText(body, "customerCode"), bodyText(body, "customer_code"))
	contractCode := firstText(bodyText(body, "contractCode"), bodyText(body, "contract_code"), bodyText(body, "source_contract_code"))
	assetCode := firstText(bodyText(body, "deliveryAssetCode"), bodyText(body, "delivery_asset_code"))
	sourcePlanCode := firstText(bodyText(body, "sourcePlanCode"), bodyText(body, "source_plan_code"), bodyText(body, "source_asset_plan_code"), bodyText(body, "code"))
	contractLineCode := firstText(bodyText(body, "contractLineCode"), bodyText(body, "contract_line_code"), bodyText(body, "source_contract_line_code"))
	instanceKey := firstText(bodyText(body, "instanceKey"), bodyText(body, "instance_key"))
	if customerDeliveryAssetPlanCodeLike(assetCode) {
		return nil, false, httperror.New(http.StatusBadRequest, "invalid_delivery_asset_code", "deliveryAssetCode must be an Assets formal code, not an Altoc plan code")
	}
	if assetCode == "" {
		assetCode = customerDeliveryAssetCode(contractCode, sourcePlanCode, contractLineCode, instanceKey)
	}
	if assetCode == "" || customerCode == "" {
		return nil, false, httperror.New(http.StatusBadRequest, "missing_required_field", "deliveryAssetCode and customerCode are required")
	}

	var id int64
	if err := tx.QueryRowContext(ctx, `
		SELECT id
		FROM customer_delivery_assets
		WHERE delivery_asset_code = ?
		  AND deleted_at IS NULL
		LIMIT 1
		FOR UPDATE
	`, assetCode).Scan(&id); err != nil && err != sql.ErrNoRows {
		return nil, false, err
	}
	if id == 0 && sourcePlanCode != "" {
		if err := tx.QueryRowContext(ctx, `
			SELECT id, delivery_asset_code
			FROM customer_delivery_assets
			WHERE source_plan_code = ?
			  AND deleted_at IS NULL
			ORDER BY id ASC
			LIMIT 1
			FOR UPDATE
		`, sourcePlanCode).Scan(&id, &assetCode); err != nil && err != sql.ErrNoRows {
			return nil, false, err
		}
	}
	if id == 0 && contractCode != "" && contractLineCode != "" {
		if err := tx.QueryRowContext(ctx, `
			SELECT id, delivery_asset_code
			FROM customer_delivery_assets
			WHERE contract_code = ?
			  AND contract_line_code = ?
			  AND COALESCE(instance_key, '') = COALESCE(?, '')
			  AND deleted_at IS NULL
			ORDER BY id ASC
			LIMIT 1
			FOR UPDATE
		`, contractCode, contractLineCode, nullableString(instanceKey)).Scan(&id, &assetCode); err != nil && err != sql.ErrNoRows {
			return nil, false, err
		}
	}

	name := firstText(bodyText(body, "name"), bodyText(body, "assetName"), bodyText(body, "asset_name"), bodyText(body, "productName"), bodyText(body, "product_name"), assetCode)
	status := normalizeCustomerDeliveryAssetStatus(firstText(bodyText(body, "status"), "planned"))
	created := id == 0
	if created {
		insert, err := tx.ExecContext(ctx, `
			INSERT INTO customer_delivery_assets (
			  delivery_asset_code, customer_code, contract_code, contract_line_code, obligation_code, project_code,
			  delivery_view_code, asset_item_code, product_code, product_name, product_version, catalog_item_code,
			  product_origin, asset_kind, deployment_mode, instance_key, tenant_key, environment_code,
			  license_model, license_quantity, capacity, unit, status, planned_delivery_at,
			  delivered_at, go_live_at, accepted_at, expired_at, terminated_at, warranty_start_at,
			  warranty_end_at, support_expiry_at, source_app, source_biz_code, source_plan_code,
			  idempotency_key, created_by, updated_by
			) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
		`,
			assetCode,
			customerCode,
			nullableString(contractCode),
			nullableString(contractLineCode),
			nullableString(firstText(bodyText(body, "obligationCode"), bodyText(body, "obligation_code"), bodyText(body, "source_obligation_code"))),
			nullableString(firstText(bodyText(body, "projectCode"), bodyText(body, "project_code"), bodyText(body, "source_project_code"))),
			nullableString(firstText(bodyText(body, "deliveryViewCode"), bodyText(body, "delivery_view_code"))),
			nullableString(firstText(bodyText(body, "assetItemCode"), bodyText(body, "asset_item_code"), bodyText(body, "external_asset_code"))),
			nullableString(firstText(bodyText(body, "productCode"), bodyText(body, "product_code"))),
			name,
			nullableString(firstText(bodyText(body, "productVersion"), bodyText(body, "product_version"))),
			nullableString(firstText(bodyText(body, "catalogItemCode"), bodyText(body, "catalog_item_code"))),
			nullableString(firstText(bodyText(body, "productOrigin"), bodyText(body, "product_origin"))),
			firstText(bodyText(body, "assetKind"), bodyText(body, "asset_kind"), "software"),
			nullableString(firstText(bodyText(body, "deploymentMode"), bodyText(body, "deployment_mode"))),
			nullableString(instanceKey),
			nullableString(firstText(bodyText(body, "tenantKey"), bodyText(body, "tenant_key"))),
			nullableString(firstText(bodyText(body, "environmentCode"), bodyText(body, "environment_code"))),
			nullableString(firstText(bodyText(body, "licenseModel"), bodyText(body, "license_model"))),
			nullableBodyFloatAlias(body, "licenseQuantity", "license_quantity"),
			nullableBodyFloatAlias(body, "capacity"),
			nullableString(firstText(bodyText(body, "unit"))),
			status,
			nullableString(firstText(bodyText(body, "plannedDeliveryAt"), bodyText(body, "planned_delivery_at"))),
			nullableString(firstText(bodyText(body, "deliveredAt"), bodyText(body, "delivered_at"))),
			nullableString(firstText(bodyText(body, "goLiveAt"), bodyText(body, "go_live_at"))),
			nullableString(firstText(bodyText(body, "acceptedAt"), bodyText(body, "accepted_at"))),
			nullableString(firstText(bodyText(body, "expiredAt"), bodyText(body, "expired_at"))),
			nullableString(firstText(bodyText(body, "terminatedAt"), bodyText(body, "terminated_at"))),
			nullableString(firstText(bodyText(body, "warrantyStartAt"), bodyText(body, "warranty_start_at"))),
			nullableString(firstText(bodyText(body, "warrantyEndAt"), bodyText(body, "warranty_end_at"))),
			nullableString(firstText(bodyText(body, "supportExpiryAt"), bodyText(body, "support_expiry_at"))),
			firstText(bodyText(body, "sourceApp"), bodyText(body, "source_app"), "altoc"),
			nullableString(firstText(bodyText(body, "sourceBizCode"), bodyText(body, "source_biz_code"), contractCode)),
			nullableString(sourcePlanCode),
			nullableString(firstText(bodyText(body, "idempotencyKey"), bodyText(body, "idempotency_key"))),
			nullableString(operatorUID),
			nullableString(operatorUID),
		)
		if err != nil {
			return nil, false, err
		}
		id, err = insert.LastInsertId()
		if err != nil {
			return nil, false, err
		}
	} else {
		if _, err := tx.ExecContext(ctx, `
			UPDATE customer_delivery_assets
			SET customer_code = ?,
			    contract_code = COALESCE(?, contract_code),
			    contract_line_code = COALESCE(?, contract_line_code),
			    obligation_code = COALESCE(?, obligation_code),
			    project_code = COALESCE(?, project_code),
			    delivery_view_code = COALESCE(?, delivery_view_code),
			    asset_item_code = COALESCE(?, asset_item_code),
			    product_code = COALESCE(?, product_code),
			    product_name = ?,
			    product_version = COALESCE(?, product_version),
			    catalog_item_code = COALESCE(?, catalog_item_code),
			    product_origin = COALESCE(?, product_origin),
			    asset_kind = COALESCE(?, asset_kind),
			    deployment_mode = COALESCE(?, deployment_mode),
			    instance_key = COALESCE(?, instance_key),
			    tenant_key = COALESCE(?, tenant_key),
			    environment_code = COALESCE(?, environment_code),
			    license_model = COALESCE(?, license_model),
			    license_quantity = COALESCE(?, license_quantity),
			    capacity = COALESCE(?, capacity),
			    unit = COALESCE(?, unit),
			    status = ?,
			    planned_delivery_at = COALESCE(?, planned_delivery_at),
			    delivered_at = COALESCE(?, delivered_at),
			    go_live_at = COALESCE(?, go_live_at),
			    accepted_at = COALESCE(?, accepted_at),
			    expired_at = COALESCE(?, expired_at),
			    terminated_at = COALESCE(?, terminated_at),
			    warranty_start_at = COALESCE(?, warranty_start_at),
			    warranty_end_at = COALESCE(?, warranty_end_at),
			    support_expiry_at = COALESCE(?, support_expiry_at),
			    source_app = COALESCE(?, source_app),
			    source_biz_code = COALESCE(?, source_biz_code),
			    source_plan_code = COALESCE(?, source_plan_code),
			    idempotency_key = COALESCE(?, idempotency_key),
			    updated_by = ?,
			    updated_at = CURRENT_TIMESTAMP
			WHERE id = ?
		`,
			customerCode,
			nullableString(contractCode),
			nullableString(contractLineCode),
			nullableString(firstText(bodyText(body, "obligationCode"), bodyText(body, "obligation_code"), bodyText(body, "source_obligation_code"))),
			nullableString(firstText(bodyText(body, "projectCode"), bodyText(body, "project_code"), bodyText(body, "source_project_code"))),
			nullableString(firstText(bodyText(body, "deliveryViewCode"), bodyText(body, "delivery_view_code"))),
			nullableString(firstText(bodyText(body, "assetItemCode"), bodyText(body, "asset_item_code"), bodyText(body, "external_asset_code"))),
			nullableString(firstText(bodyText(body, "productCode"), bodyText(body, "product_code"))),
			name,
			nullableString(firstText(bodyText(body, "productVersion"), bodyText(body, "product_version"))),
			nullableString(firstText(bodyText(body, "catalogItemCode"), bodyText(body, "catalog_item_code"))),
			nullableString(firstText(bodyText(body, "productOrigin"), bodyText(body, "product_origin"))),
			nullableString(firstText(bodyText(body, "assetKind"), bodyText(body, "asset_kind"))),
			nullableString(firstText(bodyText(body, "deploymentMode"), bodyText(body, "deployment_mode"))),
			nullableString(instanceKey),
			nullableString(firstText(bodyText(body, "tenantKey"), bodyText(body, "tenant_key"))),
			nullableString(firstText(bodyText(body, "environmentCode"), bodyText(body, "environment_code"))),
			nullableString(firstText(bodyText(body, "licenseModel"), bodyText(body, "license_model"))),
			nullableBodyFloatAlias(body, "licenseQuantity", "license_quantity"),
			nullableBodyFloatAlias(body, "capacity"),
			nullableString(firstText(bodyText(body, "unit"))),
			status,
			nullableString(firstText(bodyText(body, "plannedDeliveryAt"), bodyText(body, "planned_delivery_at"))),
			nullableString(firstText(bodyText(body, "deliveredAt"), bodyText(body, "delivered_at"))),
			nullableString(firstText(bodyText(body, "goLiveAt"), bodyText(body, "go_live_at"))),
			nullableString(firstText(bodyText(body, "acceptedAt"), bodyText(body, "accepted_at"))),
			nullableString(firstText(bodyText(body, "expiredAt"), bodyText(body, "expired_at"))),
			nullableString(firstText(bodyText(body, "terminatedAt"), bodyText(body, "terminated_at"))),
			nullableString(firstText(bodyText(body, "warrantyStartAt"), bodyText(body, "warranty_start_at"))),
			nullableString(firstText(bodyText(body, "warrantyEndAt"), bodyText(body, "warranty_end_at"))),
			nullableString(firstText(bodyText(body, "supportExpiryAt"), bodyText(body, "support_expiry_at"))),
			nullableString(firstText(bodyText(body, "sourceApp"), bodyText(body, "source_app"))),
			nullableString(firstText(bodyText(body, "sourceBizCode"), bodyText(body, "source_biz_code"), contractCode)),
			nullableString(sourcePlanCode),
			nullableString(firstText(bodyText(body, "idempotencyKey"), bodyText(body, "idempotency_key"))),
			nullableString(operatorUID),
			id,
		); err != nil {
			return nil, false, err
		}
	}

	eventType := "planned"
	if !created {
		eventType = "updated"
	}
	if err := insertEvent(ctx, tx, "customer_delivery_asset", id, eventType, operatorUID, map[string]any{
		"summary":             "客户交付资产已同步",
		"delivery_asset_code": assetCode,
		"customer_code":       customerCode,
		"contract_code":       contractCode,
		"contract_line_code":  contractLineCode,
		"status":              status,
	}); err != nil {
		return nil, false, err
	}
	asset, err := a.customerDeliveryAssetByIDTx(ctx, tx, id)
	return asset, created, err
}

func (a *Adapter) listCustomerDeliveryAssets(ctx context.Context, query url.Values) (map[string]any, error) {
	where := []string{"deleted_at IS NULL"}
	args := []any{}
	for _, item := range []struct {
		queryKeys []string
		column    string
	}{
		{[]string{"customer_code", "customerCode"}, "customer_code"},
		{[]string{"contract_code", "contractCode"}, "contract_code"},
		{[]string{"project_code", "projectCode"}, "project_code"},
		{[]string{"product_code", "productCode"}, "product_code"},
		{[]string{"status"}, "status"},
	} {
		if value := firstQueryText(query, item.queryKeys...); value != "" {
			where = append(where, item.column+" = ?")
			args = append(args, value)
		}
	}
	if search := firstQueryText(query, "search", "q", "keyword"); search != "" {
		like := "%" + search + "%"
		where = append(where, "(delivery_asset_code LIKE ? OR product_name LIKE ? OR product_code LIKE ? OR contract_code LIKE ?)")
		args = append(args, like, like, like, like)
	}
	limit := int64FromAny(query.Get("limit"), 50)
	if limit <= 0 || limit > 100 {
		limit = 50
	}
	args = append(args, limit)
	items, err := a.queryMaps(ctx, `
		SELECT *
		FROM customer_delivery_assets
		WHERE `+strings.Join(where, " AND ")+`
		ORDER BY updated_at DESC, id DESC
		LIMIT ?
	`, args...)
	if err != nil {
		return nil, err
	}
	return map[string]any{
		"items": items,
		"total": len(items),
		"filters": map[string]any{
			"customer_code": firstQueryText(query, "customer_code", "customerCode"),
			"contract_code": firstQueryText(query, "contract_code", "contractCode"),
			"project_code":  firstQueryText(query, "project_code", "projectCode"),
			"status":        firstQueryText(query, "status"),
		},
	}, nil
}

func (a *Adapter) activateCustomerDeliveryAsset(ctx context.Context, assetCode string, body map[string]any, operatorUID string) (map[string]any, error) {
	assetCode = strings.TrimSpace(assetCode)
	if assetCode == "" {
		return nil, httperror.New(http.StatusBadRequest, "missing_delivery_asset_code", "deliveryAssetCode is required")
	}
	status := normalizeCustomerDeliveryAssetStatus(firstText(bodyText(body, "status"), "delivered"))
	result, err := a.withTx(ctx, func(tx *sql.Tx) (any, error) {
		asset, err := a.customerDeliveryAssetByCodeTx(ctx, tx, assetCode)
		if err != nil {
			return nil, err
		}
		if asset == nil {
			return nil, httperror.New(http.StatusNotFound, "record_not_found", "customer delivery asset not found")
		}
		if _, err := tx.ExecContext(ctx, `
			UPDATE customer_delivery_assets
			SET status = ?,
			    delivered_at = COALESCE(?, delivered_at),
			    go_live_at = COALESCE(?, go_live_at),
			    accepted_at = COALESCE(?, accepted_at),
			    asset_item_code = COALESCE(?, asset_item_code),
			    delivery_view_code = COALESCE(?, delivery_view_code),
			    updated_by = ?,
			    updated_at = CURRENT_TIMESTAMP
			WHERE id = ?
		`,
			status,
			nullableString(firstText(bodyText(body, "deliveredAt"), bodyText(body, "delivered_at"))),
			nullableString(firstText(bodyText(body, "goLiveAt"), bodyText(body, "go_live_at"))),
			nullableString(firstText(bodyText(body, "acceptedAt"), bodyText(body, "accepted_at"))),
			nullableString(firstText(bodyText(body, "assetItemCode"), bodyText(body, "asset_item_code"))),
			nullableString(firstText(bodyText(body, "deliveryViewCode"), bodyText(body, "delivery_view_code"))),
			nullableString(operatorUID),
			asset["id"],
		); err != nil {
			return nil, err
		}
		if err := insertEvent(ctx, tx, "customer_delivery_asset", asInt(asset["id"]), status, operatorUID, map[string]any{
			"summary":             "客户交付资产状态已更新",
			"delivery_asset_code": assetCode,
			"status":              status,
		}); err != nil {
			return nil, err
		}
		return a.customerDeliveryAssetByIDTx(ctx, tx, asInt(asset["id"]))
	})
	if err != nil {
		return nil, err
	}
	return result.(map[string]any), nil
}

func customerDeliveryAssetBodies(body map[string]any) []map[string]any {
	for _, key := range []string{"deliveryAssets", "delivery_assets", "customerDeliveryAssets", "customer_delivery_assets", "items", "assets"} {
		switch typed := body[key].(type) {
		case []map[string]any:
			return typed
		case []any:
			result := make([]map[string]any, 0, len(typed))
			for _, item := range typed {
				if value, ok := item.(map[string]any); ok && value != nil {
					result = append(result, value)
				}
			}
			if len(result) > 0 {
				return result
			}
		}
	}
	if len(body) > 0 {
		return []map[string]any{body}
	}
	return nil
}

func (a *Adapter) customerDeliveryAssetByIDTx(ctx context.Context, tx *sql.Tx, id int64) (map[string]any, error) {
	rows, err := tx.QueryContext(ctx, `
		SELECT *
		FROM customer_delivery_assets
		WHERE id = ?
		LIMIT 1
	`, id)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	items, err := rowsToMaps(rows)
	if err != nil || len(items) == 0 {
		return nil, err
	}
	return items[0], nil
}

func (a *Adapter) customerDeliveryAssetByCodeTx(ctx context.Context, tx *sql.Tx, assetCode string) (map[string]any, error) {
	rows, err := tx.QueryContext(ctx, `
		SELECT *
		FROM customer_delivery_assets
		WHERE delivery_asset_code = ?
		  AND deleted_at IS NULL
		LIMIT 1
		FOR UPDATE
	`, assetCode)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	items, err := rowsToMaps(rows)
	if err != nil || len(items) == 0 {
		return nil, err
	}
	return items[0], nil
}

func customerDeliveryAssetCode(contractCode string, sourcePlanCode string, contractLineCode string, instanceKey string) string {
	parts := []string{"CDA"}
	for _, value := range []string{contractCode, contractLineCode, instanceKey} {
		token := normalizeCodeToken(value, "")
		if token != "" {
			parts = append(parts, token)
		}
	}
	if len(parts) > 1 {
		return strings.Join(parts, "-")
	}
	if token := normalizeCodeToken(sourcePlanCode, ""); token != "" {
		return "CDA-PLAN-" + token
	}
	return buildCode("CDA")
}

func customerDeliveryAssetPlanCodeLike(value string) bool {
	value = strings.ToUpper(strings.TrimSpace(value))
	return strings.HasPrefix(value, "CDAP-") || strings.HasPrefix(value, "DAP-")
}

func normalizeCustomerDeliveryAssetStatus(value string) string {
	switch strings.ToLower(strings.TrimSpace(value)) {
	case "planned", "provisioning", "delivered", "online", "accepted", "suspended", "expired", "terminated":
		return strings.ToLower(strings.TrimSpace(value))
	default:
		return "planned"
	}
}

func nullableBodyFloatAlias(body map[string]any, keys ...string) any {
	for _, key := range keys {
		if value, ok := body[key]; ok {
			if result := float64FromAny(value); result != 0 {
				return result
			}
		}
	}
	return nil
}

func firstQueryText(query url.Values, keys ...string) string {
	for _, key := range keys {
		if value := strings.TrimSpace(query.Get(key)); value != "" {
			return value
		}
	}
	return ""
}

func cloneValues(values url.Values) url.Values {
	result := url.Values{}
	for key, items := range values {
		for _, item := range items {
			result.Add(key, item)
		}
	}
	return result
}
