package assets

import (
	"context"
	"database/sql"
	"net/http"
	"net/url"
	"strings"

	"github.com/huizhi-yun/data-runtime/internal/httperror"
)

func (a *Adapter) handleCustomRuntime(ctx context.Context, method string, path string, query url.Values, body map[string]any) (any, string, bool, error) {
	if method == http.MethodGet && path == "/v1/assets/integration-operations" {
		data, err := a.listAssetsIntegrationOperationDiagnostics(ctx, query)
		return ok(data), "assets.integration_operations.diagnostics.list", true, err
	}
	if method == http.MethodGet {
		if operationID, matched := pathParamWithSuffix(path, "/v1/assets/integration-operations/", "/attempts"); matched {
			data, err := a.listAssetsIntegrationOperationAttempts(ctx, operationID, query)
			return ok(data), "assets.integration_operations.attempts.list", true, err
		}
	}
	if result, operation, handled, err := a.handleAssetsIntegrationOperation(ctx, method, path, body); handled {
		return result, operation, true, err
	}
	if path == "/v1/assets/ip-assets" && method == http.MethodGet {
		access, _, err := assetsObjectAccess(query)
		if err != nil {
			return nil, "assets.ip_assets.list", true, err
		}
		if access == "relation" {
			data, err := a.listScopedIPAssets(ctx, query)
			return okWithMessage(data, "ok"), "assets.ip_assets.list", true, err
		}
	}
	if rawID, ok := singlePathParam(path, "/v1/assets/ip-assets/"); ok {
		if err := a.requireIPAssetObjectAccess(ctx, query, rawID); err != nil {
			return nil, "assets.ip_assets.object_scope", true, err
		}
	}
	if result, operation, handled, err := a.handleOffboardingRecoveryRuntime(ctx, method, path, query, body); handled {
		return result, operation, true, err
	}
	if result, operation, handled, err := a.handleDueNotificationRuntime(ctx, method, path, body); handled {
		return result, operation, true, err
	}
	if result, operation, handled, err := a.handleNotificationDetailAuthorizationRuntime(ctx, method, path, query, body); handled {
		return result, operation, true, err
	}
	if handled, result, operation, err := a.handleServiceDeliveryRoutes(ctx, method, path, query, body); handled {
		return result, operation, true, err
	}
	if handled, result, operation, err := a.handleCustomerDeliveryAssetEnvironmentRoutes(ctx, method, path, query, body); handled {
		return result, operation, true, err
	}
	if handled, result, operation, err := a.handleCustomerDeliveryAssetRoutes(ctx, method, path, query, body); handled {
		return result, operation, true, err
	}
	if handled, result, operation, err := a.handleDeliveryDocumentRoutes(ctx, method, path, query, body); handled {
		return result, operation, true, err
	}

	switch {
	case method == http.MethodGet && path == "/v1/assets/dashboard/overview":
		data, err := a.dashboardOverview(ctx, query)
		return okWithMessage(data, "ok"), "assets.dashboard.overview", true, err
	case method == http.MethodGet && path == "/v1/assets/reports/assets-summary":
		data, err := a.reports(ctx)
		return okWithMessage(data["assets_summary"], "ok"), "assets.reports.assets_summary", true, err
	case method == http.MethodGet && path == "/v1/assets/reports/expiring":
		data, err := a.reports(ctx)
		return okWithMessage(data["expiring"], "ok"), "assets.reports.expiring", true, err
	case method == http.MethodGet && path == "/v1/assets/reports/project-costs":
		data, err := a.reports(ctx)
		return okWithMessage(data["project_costs"], "ok"), "assets.reports.project_costs", true, err
	case method == http.MethodGet && path == "/v1/assets/reports/delivery-costs":
		data, err := a.reports(ctx)
		return okWithMessage(data["delivery_costs"], "ok"), "assets.reports.delivery_costs", true, err
	case method == http.MethodGet && path == "/v1/assets/reports/environment-resources":
		data, err := a.reports(ctx)
		return okWithMessage(data["environment_resources"], "ok"), "assets.reports.environment_resources", true, err
	case method == http.MethodGet && path == "/v1/assets/asset-categories":
		scope, err := normalizeAssetCategoryScope(query.Get("scope"))
		if err != nil {
			return nil, "", true, err
		}
		items, err := a.listAssetCategories(ctx, scope, false)
		return okWithMessage(map[string]any{"items": items}, "ok"), "assets.asset_categories.list", true, err
	case method == http.MethodGet && path == "/v1/assets/admin/asset-categories":
		scope, err := normalizeAssetCategoryScope(query.Get("scope"))
		if err != nil {
			return nil, "", true, err
		}
		items, err := a.listAssetCategories(ctx, scope, true)
		return okWithMessage(map[string]any{"items": items}, "ok"), "assets.admin.asset_categories.list", true, err
	case method == http.MethodPost && path == "/v1/assets/admin/asset-categories":
		scope, err := normalizeAssetCategoryScope(firstText(bodyText(body, "scope"), query.Get("scope")))
		if err != nil {
			return nil, "", true, err
		}
		item, err := a.saveAssetCategory(ctx, scope, 0, body, actorFromRequest(query, body))
		return okWithMessage(item, "资产类别已创建"), "assets.admin.asset_categories.create", true, err
	case method == http.MethodPut && hasAdminAssetCategoryID(path):
		rawID, _ := singlePathParam(path, "/v1/assets/admin/asset-categories/")
		id, err := parsePositiveID(rawID)
		if err != nil {
			return nil, "", true, err
		}
		scope := firstText(bodyText(body, "scope"), query.Get("scope"))
		if scope == "" {
			scope, err = a.assetCategoryScopeByID(ctx, id)
		} else {
			scope, err = normalizeAssetCategoryScope(scope)
		}
		if err != nil {
			return nil, "", true, err
		}
		item, err := a.saveAssetCategory(ctx, scope, id, body, actorFromRequest(query, body))
		return okWithMessage(item, "资产类别已更新"), "assets.admin.asset_categories.update", true, err
	}

	if handled, result, operation, err := a.handleAssetRoutes(ctx, method, path, query, body); handled {
		return result, operation, true, err
	}
	if handled, result, operation, err := a.handleCatalogRoutes(ctx, method, path, query, body); handled {
		return result, operation, true, err
	}
	if handled, result, operation, err := a.handleProcurementRoutes(ctx, method, path, query, body); handled {
		return result, operation, true, err
	}
	return nil, "", false, nil
}

func hasAdminAssetCategoryID(path string) bool {
	_, ok := singlePathParam(path, "/v1/assets/admin/asset-categories/")
	return ok
}

func (a *Adapter) dashboardOverview(ctx context.Context, query url.Values) (map[string]any, error) {
	access, actor, err := assetsObjectAccess(query)
	if err != nil {
		return nil, err
	}
	scopeWhere := ""
	scopeArgs := []any{}
	alertWhere := "1=1"
	alertArgs := []any{}
	if access == "relation" {
		units, unitErr := assetsScopeUnits(query)
		if unitErr != nil {
			return nil, unitErr
		}
		scopeWhere, scopeArgs = assetItemScopeWhere("ai", actor, units)
		alertWhere, alertArgs = alertScopeWhere("alert", "asset", actor, units)
	}
	assetCountWhere := "ai.archived_at IS NULL"
	if scopeWhere != "" {
		assetCountWhere += " AND " + scopeWhere
	}
	countRow, err := a.queryRowMap(ctx, `
		SELECT COUNT(DISTINCT ai.id) AS total_assets,
		       COUNT(DISTINCT CASE WHEN env.status='active' THEN env.id END) AS active_environments,
		       COALESCE(SUM(CASE WHEN cost.cost_month=DATE_FORMAT(CURDATE(), '%Y-%m-01') THEN cost.amount ELSE 0 END), 0) AS monthly_cost
		FROM asset_items ai
		LEFT JOIN asset_environments env ON env.id=ai.environment_id
		LEFT JOIN asset_monthly_costs cost ON cost.asset_id=ai.id
		WHERE `+assetCountWhere, scopeArgs...)
	if err != nil {
		return nil, err
	}
	var pendingAlerts int64
	if err := a.DB().QueryRowContext(ctx, `SELECT COUNT(*) FROM asset_alerts alert LEFT JOIN asset_items asset ON asset.id=alert.asset_id WHERE alert.status='pending' AND `+alertWhere, alertArgs...).Scan(&pendingAlerts); err != nil {
		return nil, err
	}
	alertQuery := url.Values{}
	for key, values := range query {
		alertQuery[key] = append([]string(nil), values...)
	}
	alertQuery.Set("pageSize", "5")
	alerts, err := a.listAlerts(ctx, alertQuery)
	if err != nil {
		return nil, err
	}
	assetListQuery, err := a.assetListSQL(ctx)
	if err != nil {
		return nil, err
	}
	if scopeWhere != "" {
		assetListQuery += " AND " + scopeWhere
	}
	assetListArgs := []any{
		nil, nil,
		nil, nil,
		nil,
		nil, nil, nil, nil, nil, nil, nil, nil, nil, nil, nil,
	}
	assetListArgs = append(assetListArgs, scopeArgs...)
	expiringAssets, err := a.queryMaps(ctx, assetListQuery+`
		AND ard.expires_at IS NOT NULL
		ORDER BY ard.expires_at ASC
		LIMIT 5`,
		assetListArgs...,
	)
	if err != nil {
		return nil, err
	}
	for _, item := range expiringAssets {
		normalizeAssetMap(item)
	}

	urgentAlerts, _ := alerts["items"].([]map[string]any)
	if urgentAlerts == nil {
		urgentAlerts = []map[string]any{}
	}
	return map[string]any{
		"metrics": []summaryMetric{
			metric("资产总数", asInt(countRow["total_assets"]), "P0 台账对象", "primary"),
			metric("活跃环境", asInt(countRow["active_environments"]), "当前运行中", "success"),
			metric("待处理预警", pendingAlerts, "需要闭环", "warning"),
			metric("月度资源成本", formatMoney(countRow["monthly_cost"]), "当月月度成本表", "info"),
		},
		"quick_links": []map[string]any{
			{"label": "实物资产", "description": "查看办公设备、家具设施和IT基础设施等资产台账", "to": "/physical", "icon": "i-lucide-laptop"},
			{"label": "资源资产", "description": "查看云资源、Seat、额度与证书", "to": "/resources", "icon": "i-lucide-cloud-cog"},
			{"label": "产品资产", "description": "查看产品主档、技术底座与运行资源关系", "to": "/products", "icon": "i-lucide-box"},
			{"label": "环境视图", "description": "按环境查看资源、责任人与成本", "to": "/environments", "icon": "i-lucide-server-cog"},
			{"label": "采购单", "description": "进入采购申请与入库激活台", "to": "/procurement/orders", "icon": "i-lucide-shopping-cart"},
		},
		"urgent_alerts":   urgentAlerts,
		"expiring_assets": expiringAssets,
	}, nil
}

func (a *Adapter) handleAssetRoutes(ctx context.Context, method string, path string, query url.Values, body map[string]any) (bool, any, string, error) {
	if method == http.MethodGet && path == "/v1/assets/assets" {
		data, err := a.listAssetsForUser(ctx, query)
		return true, okWithMessage(data, "ok"), "assets.assets.list", err
	}
	if method == http.MethodPost && path == "/v1/assets/assets" {
		id, err := a.createAsset(ctx, body, actorFromRequest(query, body))
		return true, okWithMessage(id, "资产已创建"), "assets.assets.create", err
	}
	if rawID, ok := pathParamWithSuffix(path, "/v1/assets/assets/", "/status"); ok && method == http.MethodPost {
		id, err := parsePositiveID(rawID)
		if err != nil {
			return true, nil, "", err
		}
		status := bodyText(body, "status")
		if status == "" {
			return true, nil, "", httperror.New(http.StatusBadRequest, "missing_status", "缺少 status")
		}
		err = a.changeAssetStatus(ctx, id, status, actorFromRequest(query, body))
		return true, okWithMessage(map[string]any{"id": id, "status": status}, "资产状态已更新"), "assets.assets.status", err
	}
	if rawID, ok := pathParamWithSuffix(path, "/v1/assets/assets/", "/events"); ok && method == http.MethodGet {
		id, err := parsePositiveID(rawID)
		if err != nil {
			return true, nil, "", err
		}
		data, err := a.listAssetEvents(ctx, id)
		return true, okWithMessage(data, "ok"), "assets.assets.events", err
	}
	if rawID, ok := pathParamWithSuffix(path, "/v1/assets/assets/", "/documents"); ok && method == http.MethodPost {
		id, err := parsePositiveID(rawID)
		if err != nil {
			return true, nil, "", err
		}
		err = a.linkDocument(ctx, "asset", id, body, actorFromRequest(query, body))
		return true, okWithMessage(map[string]any{"id": id}, "资产文档已关联"), "assets.assets.documents.link", err
	}
	if rawID, ok := singlePathParam(path, "/v1/assets/assets/"); ok {
		if method == http.MethodGet {
			data, err := a.getAssetForUser(ctx, query, rawID)
			return true, okWithMessage(data, "ok"), "assets.assets.get", err
		}
		if method == http.MethodPatch {
			if err := a.requireAssetItemObjectAccess(ctx, query, rawID); err != nil {
				return true, nil, "assets.assets.update", err
			}
			id, err := parsePositiveID(rawID)
			if err != nil {
				return true, nil, "", err
			}
			err = a.updateAsset(ctx, id, body, actorFromRequest(query, body))
			return true, okWithMessage(map[string]any{"id": id}, "资产已更新"), "assets.assets.update", err
		}
	}
	return false, nil, "", nil
}

func (a *Adapter) assetListSQL(ctx context.Context) (string, error) {
	configDetailSelect, err := a.physicalConfigDetailSelect(ctx)
	if err != nil {
		return "", err
	}

	query := `
		SELECT
		  ai.id,
		  ai.public_id,
		  ai.asset_code,
		  ai.asset_name,
		  ai.asset_category,
		  ai.asset_subtype,
		  apd.physical_type AS physical_item_type,
		  ai.asset_purpose,
		  ai.ownership_type,
		  ai.status,
		  ai.dept_code,
		  ai.project_code,
		  ai.customer_code,
		  ai.contract_code,
		  ai.owner_uid,
		  ai.user_uid,
		  ai.custodian_uid,
		  ai.notes,
		  ai.tags,
		  apd.brand,
		  apd.model,
		  {{config_detail_select}},
		  apd.serial_number,
		  apd.qr_code,
		  apd.location,
		  DATE_FORMAT(apd.purchased_at, '%Y-%m-%d') AS purchased_at,
		  env.environment_name,
		  COALESCE(ard.monthly_cost, 0) AS monthly_cost,
		  DATE_FORMAT(ard.expires_at, '%Y-%m-%d') AS expires_at
		FROM asset_items ai
		LEFT JOIN asset_physical_details apd ON apd.asset_id = ai.id
		LEFT JOIN asset_resource_details ard ON ard.asset_id = ai.id
		LEFT JOIN asset_environments env ON env.id = ai.environment_id
		WHERE ai.archived_at IS NULL
		  AND (? IS NULL OR ai.asset_category = ?)
		  AND (? IS NULL OR ai.status = ?)
		  AND (
		    ? IS NULL
		    OR ai.asset_code LIKE ?
		    OR ai.asset_name LIKE ?
		    OR ai.asset_subtype LIKE ?
		    OR apd.physical_type LIKE ?
		    OR ai.asset_purpose LIKE ?
		    OR ai.project_code LIKE ?
		    OR ai.customer_code LIKE ?
		    OR ai.contract_code LIKE ?
		    OR ai.owner_uid LIKE ?
		    OR ai.user_uid LIKE ?
		    OR env.environment_name LIKE ?
		  )`
	return strings.Replace(query, "{{config_detail_select}}", configDetailSelect, 1), nil
}

func (a *Adapter) assetSummary(ctx context.Context) ([]summaryMetric, error) {
	return a.assetSummaryWithScope(ctx, "", nil)
}

func (a *Adapter) assetSummaryWithScope(ctx context.Context, scopeWhere string, scopeArgs []any) ([]summaryMetric, error) {
	query := `
		SELECT
		  COUNT(*) AS total,
		  SUM(CASE WHEN asset_category = 'resource' THEN 1 ELSE 0 END) AS resource_count,
		  SUM(CASE WHEN ownership_type = 'customer_delivery' THEN 1 ELSE 0 END) AS delivery_count
		FROM asset_items ai
		WHERE ai.archived_at IS NULL`
	if scopeWhere != "" {
		query += " AND " + scopeWhere
	}
	row, err := a.queryRowMap(ctx, query, scopeArgs...)
	if err != nil {
		return nil, err
	}
	return []summaryMetric{
		metric("总资产", asInt(row["total"]), "统一资产主表", "primary"),
		metric("资源资产", asInt(row["resource_count"]), "云资源 / Seat / 额度", "info"),
		metric("客户交付", asInt(row["delivery_count"]), "交付项目使用中", "warning"),
	}, nil
}

func (a *Adapter) listAssets(ctx context.Context, query url.Values) (map[string]any, error) {
	return a.listAssetsWithScope(ctx, query, "", nil)
}

func (a *Adapter) listAssetsForUser(ctx context.Context, query url.Values) (map[string]any, error) {
	access, actor, err := assetsObjectAccess(query)
	if err != nil {
		return nil, err
	}
	if access == "all" {
		return a.listAssets(ctx, query)
	}
	units, err := assetsScopeUnits(query)
	if err != nil {
		return nil, err
	}
	where, args := assetItemScopeWhere("ai", actor, units)
	return a.listAssetsWithScope(ctx, query, where, args)
}

// EnterpriseAssetItemsList reuses the owning Assets list query and its
// object-scope predicate.  The Enterprise Host compiles the trusted query;
// callers cannot select a Runtime path or bypass this predicate.
func (a *Adapter) EnterpriseAssetItemsList(ctx context.Context, query url.Values) (map[string]any, error) {
	return a.listAssetsForUser(ctx, query)
}

func (a *Adapter) listAssetsWithScope(ctx context.Context, query url.Values, scopeWhere string, scopeArgs []any) (map[string]any, error) {
	category := firstText(query.Get("category"))
	var categoryArg any
	if category != "" {
		categoryArg = category
	}
	status := statusFilter(query)
	search := likeSearch(query)
	assetListQuery, err := a.assetListSQL(ctx)
	if err != nil {
		return nil, err
	}
	if scopeWhere != "" {
		assetListQuery += " AND " + scopeWhere
	}
	args := []any{
		categoryArg, categoryArg,
		status, status,
		search,
		search, search, search, search, search, search, search, search, search, search, search,
	}
	args = append(args, scopeArgs...)
	items, err := a.queryMaps(ctx, assetListQuery+` ORDER BY ai.id DESC`, args...)
	if err != nil {
		return nil, err
	}
	for _, item := range items {
		normalizeAssetMap(item)
	}
	summary, err := a.assetSummaryWithScope(ctx, scopeWhere, scopeArgs)
	if err != nil {
		return nil, err
	}
	return map[string]any{"summary": summary, "total": len(items), "items": items}, nil
}

func (a *Adapter) getAsset(ctx context.Context, identifier string) (map[string]any, error) {
	return a.getAssetWithScope(ctx, identifier, "", nil)
}

func (a *Adapter) getAssetForUser(ctx context.Context, query url.Values, identifier string) (map[string]any, error) {
	access, actor, err := assetsObjectAccess(query)
	if err != nil {
		return nil, err
	}
	if access == "all" {
		return a.getAsset(ctx, identifier)
	}
	units, err := assetsScopeUnits(query)
	if err != nil {
		return nil, err
	}
	where, args := assetItemScopeWhere("ai", actor, units)
	return a.getAssetWithScope(ctx, identifier, where, args)
}

// EnterpriseAssetItemView is the corresponding exact object read entrypoint.
func (a *Adapter) EnterpriseAssetItemView(ctx context.Context, query url.Values, identifier string) (map[string]any, error) {
	return a.getAssetForUser(ctx, query, identifier)
}

func (a *Adapter) getAssetWithScope(ctx context.Context, identifier, scopeWhere string, scopeArgs []any) (map[string]any, error) {
	where := "ai.public_id = ?"
	args := []any{identifier}
	if id, err := parsePositiveID(identifier); err == nil {
		where = "(ai.public_id = ? OR ai.id = ?)"
		args = []any{identifier, id}
	}
	configDetailSelect, err := a.physicalConfigDetailSelect(ctx)
	if err != nil {
		return nil, err
	}
	queryText := `
		SELECT
		  ai.id,
		  ai.public_id,
		  ai.asset_code,
		  ai.asset_name,
		  ai.asset_category,
		  ai.asset_subtype,
		  apd.physical_type AS physical_item_type,
		  ai.asset_purpose,
		  ai.ownership_type,
		  ai.status,
		  ai.dept_code,
		  ai.project_code,
		  ai.customer_code,
		  ai.contract_code,
		  ai.owner_uid,
		  ai.user_uid,
		  ai.custodian_uid,
		  ai.notes,
		  ai.tags,
		  apd.brand,
		  apd.model,
		  {{config_detail_select}},
		  apd.serial_number,
		  apd.qr_code,
		  apd.location,
		  DATE_FORMAT(apd.purchased_at, '%Y-%m-%d') AS purchased_at,
		  env.environment_name,
		  COALESCE(ard.monthly_cost, 0) AS monthly_cost,
		  DATE_FORMAT(ard.expires_at, '%Y-%m-%d') AS expires_at
		FROM asset_items ai
		LEFT JOIN asset_physical_details apd ON apd.asset_id = ai.id
		LEFT JOIN asset_resource_details ard ON ard.asset_id = ai.id
		LEFT JOIN asset_environments env ON env.id = ai.environment_id
		WHERE ` + where + ` AND ai.archived_at IS NULL`
	if scopeWhere != "" {
		queryText += " AND " + scopeWhere
		args = append(args, scopeArgs...)
	}
	rows, err := a.queryMaps(ctx, strings.Replace(queryText, "{{config_detail_select}}", configDetailSelect, 1), args...)
	if err != nil {
		return nil, err
	}
	if len(rows) == 0 {
		return nil, notFound("资产不存在")
	}
	asset := normalizeAssetMap(rows[0])
	assetID := asInt(asset["id"])
	documents, err := a.documentsFor(ctx, "asset", assetID)
	if err != nil {
		return nil, err
	}
	events, err := a.assetEvents(ctx, "asset", assetID, 20)
	if err != nil {
		return nil, err
	}
	asset["documents"] = documents
	asset["latest_events"] = events
	return asset, nil
}

func (a *Adapter) documentsFor(ctx context.Context, objectType string, objectID int64) ([]map[string]any, error) {
	tx, err := a.DB().BeginTx(ctx, &sql.TxOptions{Isolation: sql.LevelRepeatableRead, ReadOnly: true})
	if err != nil {
		return nil, err
	}
	defer tx.Rollback()
	result, err := (productMasterReader{tx: tx}).documentsFor(ctx, objectType, objectID)
	if err != nil {
		return nil, err
	}
	if err := tx.Commit(); err != nil {
		return nil, err
	}
	return result, nil
}

func artifactTypeFromDocumentType(documentType string) string {
	switch documentType {
	case "requirement":
		return "requirement"
	case "design", "api":
		return "design"
	case "ops":
		return "ops_knowledge"
	case "delivery":
		return "acceptance_report"
	default:
		return "solution"
	}
}

func (a *Adapter) assetEvents(ctx context.Context, objectType string, objectID int64, limit int) ([]map[string]any, error) {
	limitSQL := ""
	args := []any{objectType, objectID}
	if limit > 0 {
		limitSQL = " LIMIT ?"
		args = append(args, limit)
	}
	return a.queryMaps(ctx, `
		SELECT
		  id,
		  event_type,
		  operator_uid,
		  DATE_FORMAT(occurred_at, '%Y-%m-%d %H:%i:%s') AS occurred_at,
		  COALESCE(
		    JSON_UNQUOTE(JSON_EXTRACT(event_data, '$.summary')),
		    JSON_UNQUOTE(JSON_EXTRACT(event_data, '$.status')),
		    event_type
		  ) AS summary
		FROM asset_events
		WHERE object_type = ? AND object_id = ?
		ORDER BY occurred_at DESC`+limitSQL, args...)
}

func (a *Adapter) listAssetEvents(ctx context.Context, id int64) (map[string]any, error) {
	items, err := a.assetEvents(ctx, "asset", id, 0)
	if err != nil {
		return nil, err
	}
	return map[string]any{"total": len(items), "items": items}, nil
}
