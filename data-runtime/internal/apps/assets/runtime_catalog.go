package assets

import (
	"context"
	"database/sql"
	"net/http"
	"net/url"
	"strconv"
	"strings"

	"github.com/huizhi-yun/data-runtime/internal/httperror"
)

func (a *Adapter) handleCatalogRoutes(ctx context.Context, method string, path string, query url.Values, body map[string]any) (bool, any, string, error) {
	if handled, result, operation, err := a.handleEnvironmentRoutes(ctx, method, path, query, body); handled {
		return true, result, operation, err
	}
	if handled, result, operation, err := a.handleProductRoutes(ctx, method, path, query, body); handled {
		return true, result, operation, err
	}
	if handled, result, operation, err := a.handleTechnologyBaseRoutes(ctx, method, path, query, body); handled {
		return true, result, operation, err
	}
	if handled, result, operation, err := a.handleIpAssetRoutes(ctx, method, path, query, body); handled {
		return true, result, operation, err
	}
	if handled, result, operation, err := a.handleDigitalAssetRoutes(ctx, method, path, query, body); handled {
		return true, result, operation, err
	}
	if handled, result, operation, err := a.handleDeliveryRoutes(ctx, method, path, query, body); handled {
		return true, result, operation, err
	}
	return false, nil, "", nil
}

func (a *Adapter) handleEnvironmentRoutes(ctx context.Context, method string, path string, query url.Values, body map[string]any) (bool, any, string, error) {
	if method == http.MethodGet && path == "/v1/assets/environments" {
		data, err := a.listEnvironments(ctx, query)
		return true, okWithMessage(data, "ok"), "assets.environments.list", err
	}
	if method == http.MethodPost && path == "/v1/assets/environments" {
		id, err := a.createEnvironment(ctx, body, actorFromRequest(query, body))
		return true, okWithMessage(map[string]any{"id": id}, "环境已创建"), "assets.environments.create", err
	}
	if rawID, ok := pathParamWithSuffix(path, "/v1/assets/environments/", "/assets"); ok && method == http.MethodPost {
		id, err := parsePositiveID(rawID)
		if err != nil {
			return true, nil, "", err
		}
		err = a.bindEnvironmentAsset(ctx, id, body, actorFromRequest(query, body))
		return true, okWithMessage(map[string]any{"id": id}, "环境资产关联已创建"), "assets.environments.assets.bind", err
	}
	if rawID, ok := singlePathParam(path, "/v1/assets/environments/"); ok {
		id, err := parsePositiveID(rawID)
		if err != nil {
			return true, nil, "", err
		}
		if method == http.MethodGet {
			data, err := a.getEnvironment(ctx, id)
			return true, okWithMessage(data, "ok"), "assets.environments.get", err
		}
		if method == http.MethodPatch {
			err := a.updateEnvironment(ctx, id, body, actorFromRequest(query, body))
			return true, okWithMessage(map[string]any{"id": id}, "环境已更新"), "assets.environments.update", err
		}
	}
	return false, nil, "", nil
}

func (a *Adapter) listEnvironments(ctx context.Context, query url.Values) (map[string]any, error) {
	status := statusFilter(query)
	search := likeSearch(query)
	items, err := a.queryMaps(ctx, `
		SELECT
		  env.id,
		  env.environment_code,
		  env.environment_name,
		  env.environment_type,
		  env.status,
		  env.project_code,
		  env.customer_code,
		  env.contract_code,
		  env.owner_uid,
		  env.maintainer_uid,
		  env.topology_summary,
		  env.notes,
		  COUNT(ea.asset_id) AS asset_count,
		  COALESCE(SUM(ard.monthly_cost), 0) AS monthly_cost
		FROM asset_environments env
		LEFT JOIN asset_environment_assets ea ON ea.environment_id = env.id
		LEFT JOIN asset_resource_details ard ON ard.asset_id = ea.asset_id
		WHERE (? IS NULL OR env.status = ?)
		  AND (
		    ? IS NULL
		    OR env.environment_code LIKE ?
		    OR env.environment_name LIKE ?
		    OR env.environment_type LIKE ?
		    OR env.project_code LIKE ?
		    OR env.customer_code LIKE ?
		    OR env.contract_code LIKE ?
		    OR env.owner_uid LIKE ?
		    OR env.maintainer_uid LIKE ?
		  )
		GROUP BY env.id
		ORDER BY env.id DESC`,
		status, status,
		search, search, search, search, search, search, search, search, search,
	)
	if err != nil {
		return nil, err
	}
	active := int64(0)
	customer := int64(0)
	for _, item := range items {
		if cleanAnyString(item["status"]) == "active" {
			active++
		}
		if cleanAnyString(item["customer_code"]) != "" {
			customer++
		}
	}
	return map[string]any{
		"summary": []summaryMetric{
			metric("环境总数", len(items), "横向视图", "primary"),
			metric("活跃环境", active, "当前运行中", "success"),
			metric("客户环境", customer, "交付场景", "info"),
		},
		"total": len(items),
		"items": items,
	}, nil
}

func (a *Adapter) getEnvironment(ctx context.Context, id int64) (map[string]any, error) {
	row, err := a.queryRowMap(ctx, `
		SELECT
		  env.id,
		  env.environment_code,
		  env.environment_name,
		  env.environment_type,
		  env.status,
		  env.project_code,
		  env.customer_code,
		  env.contract_code,
		  env.owner_uid,
		  env.maintainer_uid,
		  env.topology_summary,
		  env.notes,
		  COUNT(ea.asset_id) AS asset_count,
		  COALESCE(SUM(ard.monthly_cost), 0) AS monthly_cost
		FROM asset_environments env
		LEFT JOIN asset_environment_assets ea ON ea.environment_id = env.id
		LEFT JOIN asset_resource_details ard ON ard.asset_id = ea.asset_id
		WHERE env.id = ?
		GROUP BY env.id`, id)
	if err != nil {
		return nil, err
	}
	if row == nil {
		return nil, notFound("环境不存在")
	}
	linkedAssets, err := a.queryMaps(ctx, `
		SELECT
		  ai.id,
		  ai.asset_code,
		  ai.asset_name,
		  ai.asset_category,
		  ai.asset_subtype,
		  ea.relation_type,
		  ai.status,
		  ea.is_primary
		FROM asset_environment_assets ea
		INNER JOIN asset_items ai ON ai.id = ea.asset_id
		WHERE ea.environment_id = ?
		ORDER BY ea.is_primary DESC, ai.id DESC`, id)
	if err != nil {
		return nil, err
	}
	for _, item := range linkedAssets {
		normalizeBoolField(item, "is_primary")
	}
	row["linked_assets"] = linkedAssets
	return row, nil
}

func (a *Adapter) handleProductRoutes(ctx context.Context, method string, path string, query url.Values, body map[string]any) (bool, any, string, error) {
	if method == http.MethodGet && path == "/v1/assets/products" {
		data, err := a.listProducts(ctx, query)
		return true, okWithMessage(data, "ok"), "assets.products.list", err
	}
	if method == http.MethodPost && path == "/v1/assets/products" {
		id, err := a.createProduct(ctx, body, query)
		return true, okWithMessage(map[string]any{"id": id}, "产品主档已创建"), "assets.products.create", err
	}
	if rawID, ok := pathParamWithSuffix(path, "/v1/assets/products/", "/bases"); ok && method == http.MethodPost {
		id, err := parsePositiveID(rawID)
		if err != nil {
			return true, nil, "", err
		}
		err = a.linkProductBase(ctx, id, body, query)
		return true, okWithMessage(map[string]any{"id": id}, "产品关联底座已创建"), "assets.products.bases.link", err
	}
	if rawID, ok := pathParamWithSuffix(path, "/v1/assets/products/", "/assets"); ok && method == http.MethodPost {
		id, err := parsePositiveID(rawID)
		if err != nil {
			return true, nil, "", err
		}
		err = a.linkProductAsset(ctx, id, body, query)
		return true, okWithMessage(map[string]any{"id": id}, "产品关联资产已创建"), "assets.products.assets.link", err
	}
	if rawID, ok := pathParamWithSuffix(path, "/v1/assets/products/", "/documents"); ok && method == http.MethodPost {
		id, err := parsePositiveID(rawID)
		if err != nil {
			return true, nil, "", err
		}
		err = a.linkProductDocument(ctx, id, body, query)
		return true, okWithMessage(map[string]any{"id": id}, "产品文档已关联"), "assets.products.documents.link", err
	}
	if rawID, ok := singlePathParam(path, "/v1/assets/products/"); ok {
		id, err := parsePositiveID(rawID)
		if err != nil {
			return true, nil, "", err
		}
		if method == http.MethodGet {
			data, err := a.getProduct(ctx, id, query)
			return true, okWithMessage(data, "ok"), "assets.products.get", err
		}
		if method == http.MethodPatch {
			err := a.updateProduct(ctx, id, body, query)
			return true, okWithMessage(map[string]any{"id": id}, "产品主档已更新"), "assets.products.update", err
		}
	}
	return false, nil, "", nil
}

func (a *Adapter) listProducts(ctx context.Context, query url.Values) (map[string]any, error) {
	if query.Has("page") || query.Has("pageSize") {
		if _, _, err := productMasterPageBounds(query); err != nil {
			return nil, err
		}
	}
	if err := validateProductMasterReadScope(query); err != nil {
		return nil, err
	}
	tx, err := a.DB().BeginTx(ctx, &sql.TxOptions{Isolation: sql.LevelRepeatableRead, ReadOnly: true})
	if err != nil {
		return nil, err
	}
	defer tx.Rollback()
	result, err := (productMasterReader{tx: tx}).listProducts(ctx, query)
	if err != nil {
		return nil, err
	}
	if err := tx.Commit(); err != nil {
		return nil, err
	}
	return result, nil
}

func (a *Adapter) listServiceProducts(ctx context.Context, query url.Values) (map[string]any, error) {
	return a.listProductsWithScope(ctx, query, "1=1", nil)
}

func (a *Adapter) listProductsWithScope(ctx context.Context, query url.Values, scopeWhere string, scopeArgs []any) (map[string]any, error) {
	tx, err := a.DB().BeginTx(ctx, &sql.TxOptions{Isolation: sql.LevelRepeatableRead, ReadOnly: true})
	if err != nil {
		return nil, err
	}
	defer tx.Rollback()
	result, err := (productMasterReader{tx: tx}).listProductsWithScope(ctx, query, scopeWhere, scopeArgs)
	if err != nil {
		return nil, err
	}
	if err := tx.Commit(); err != nil {
		return nil, err
	}
	return result, nil
}

func uniqueCSVValues(raw string) []string {
	values := make([]string, 0)
	seen := map[string]struct{}{}
	for _, part := range strings.Split(raw, ",") {
		value := strings.TrimSpace(part)
		if value == "" {
			continue
		}
		if _, exists := seen[value]; exists {
			continue
		}
		seen[value] = struct{}{}
		values = append(values, value)
	}
	return values
}

func (a *Adapter) getProduct(ctx context.Context, id int64, query url.Values) (map[string]any, error) {
	if err := validateProductMasterReadScope(query); err != nil {
		return nil, err
	}
	tx, err := a.DB().BeginTx(ctx, &sql.TxOptions{Isolation: sql.LevelRepeatableRead, ReadOnly: true})
	if err != nil {
		return nil, err
	}
	defer tx.Rollback()
	result, err := (productMasterReader{tx: tx}).getProduct(ctx, id, query)
	if err != nil {
		return nil, err
	}
	if err := tx.Commit(); err != nil {
		return nil, err
	}
	return result, nil
}

func (a *Adapter) handleTechnologyBaseRoutes(ctx context.Context, method string, path string, query url.Values, body map[string]any) (bool, any, string, error) {
	if method == http.MethodGet && path == "/v1/assets/technology-bases" {
		data, err := a.listTechnologyBases(ctx, query)
		return true, okWithMessage(data, "ok"), "assets.technology_bases.list", err
	}
	if method == http.MethodPost && path == "/v1/assets/technology-bases" {
		id, err := a.createTechnologyBase(ctx, body, actorFromRequest(query, body))
		return true, okWithMessage(map[string]any{"id": id}, "技术底座已创建"), "assets.technology_bases.create", err
	}
	if rawID, ok := singlePathParam(path, "/v1/assets/technology-bases/"); ok {
		id, err := parsePositiveID(rawID)
		if err != nil {
			return true, nil, "", err
		}
		if method == http.MethodGet {
			data, err := a.getTechnologyBase(ctx, id)
			return true, okWithMessage(data, "ok"), "assets.technology_bases.get", err
		}
		if method == http.MethodPatch {
			err := a.updateTechnologyBase(ctx, id, body, actorFromRequest(query, body))
			return true, okWithMessage(map[string]any{"id": id}, "技术底座已更新"), "assets.technology_bases.update", err
		}
	}
	return false, nil, "", nil
}

func (a *Adapter) listTechnologyBases(ctx context.Context, query url.Values) (map[string]any, error) {
	status := statusFilter(query)
	search := likeSearch(query)
	items, err := a.queryMaps(ctx, `
		SELECT
		  tb.id,
		  tb.base_code,
		  tb.base_name,
		  tb.base_type,
		  tb.status,
		  tb.service_targets,
		  tb.owner_uid,
		  tb.technical_owner_uid,
		  tb.project_code,
		  tb.asset_level,
		  tb.notes,
		  COUNT(DISTINCT pb.product_asset_id) AS product_count
		FROM technology_bases tb
		LEFT JOIN product_asset_bases pb ON pb.technology_base_id = tb.id
		WHERE (? IS NULL OR tb.status = ?)
		  AND (
		    ? IS NULL
		    OR tb.base_code LIKE ?
		    OR tb.base_name LIKE ?
		    OR tb.base_type LIKE ?
		    OR tb.project_code LIKE ?
		    OR tb.owner_uid LIKE ?
		    OR tb.technical_owner_uid LIKE ?
		  )
		GROUP BY tb.id
		ORDER BY tb.id DESC`,
		status, status, search, search, search, search, search, search, search,
	)
	if err != nil {
		return nil, err
	}
	active := int64(0)
	productCount := float64(0)
	for _, item := range items {
		if cleanAnyString(item["status"]) == "active" {
			active++
		}
		productCount += rowNumber(item, "product_count")
	}
	return map[string]any{
		"summary": []summaryMetric{
			metric("技术底座", len(items), "平台与共用模块", "primary"),
			metric("在用底座", active, "当前仍在服务产品", "success"),
			metric("服务产品", productCount, "被产品复用次数", "info"),
		},
		"total": len(items),
		"items": items,
	}, nil
}

func (a *Adapter) getTechnologyBase(ctx context.Context, id int64) (map[string]any, error) {
	row, err := a.queryRowMap(ctx, `
		SELECT
		  tb.id,
		  tb.base_code,
		  tb.base_name,
		  tb.base_type,
		  tb.status,
		  tb.service_targets,
		  tb.owner_uid,
		  tb.technical_owner_uid,
		  tb.project_code,
		  tb.asset_level,
		  tb.notes,
		  COUNT(DISTINCT pb.product_asset_id) AS product_count
		FROM technology_bases tb
		LEFT JOIN product_asset_bases pb ON pb.technology_base_id = tb.id
		WHERE tb.id = ?
		GROUP BY tb.id`, id)
	if err != nil {
		return nil, err
	}
	if row == nil {
		return nil, notFound("技术底座不存在")
	}
	products, err := a.queryMaps(ctx, `
		SELECT p.id, p.product_code, p.product_name, p.status
		FROM product_asset_bases pb
		INNER JOIN product_assets p ON p.id = pb.product_asset_id
		WHERE pb.technology_base_id = ?
		ORDER BY p.id DESC`, id)
	if err != nil {
		return nil, err
	}
	row["related_products"] = products
	return row, nil
}

func (a *Adapter) handleIpAssetRoutes(ctx context.Context, method string, path string, query url.Values, body map[string]any) (bool, any, string, error) {
	if method == http.MethodGet && path == "/v1/assets/ip-assets" {
		data, err := a.listIpAssets(ctx, query)
		return true, okWithMessage(data, "ok"), "assets.ip_assets.list", err
	}
	if method == http.MethodPost && path == "/v1/assets/ip-assets" {
		id, err := a.createIpAsset(ctx, body, actorFromRequest(query, body))
		return true, okWithMessage(map[string]any{"id": id}, "知识产权资产已创建"), "assets.ip_assets.create", err
	}
	if rawID, ok := pathParamWithSuffix(path, "/v1/assets/ip-assets/", "/products"); ok && method == http.MethodPost {
		id, err := parsePositiveID(rawID)
		if err != nil {
			return true, nil, "", err
		}
		err = a.linkIpAssetProduct(ctx, id, body, actorFromRequest(query, body))
		return true, okWithMessage(map[string]any{"id": id}, "知识产权关联产品已创建"), "assets.ip_assets.products.link", err
	}
	if rawID, ok := pathParamWithSuffix(path, "/v1/assets/ip-assets/", "/documents"); ok && method == http.MethodPost {
		id, err := parsePositiveID(rawID)
		if err != nil {
			return true, nil, "", err
		}
		err = a.linkDocument(ctx, "ip_asset", id, body, actorFromRequest(query, body))
		return true, okWithMessage(map[string]any{"id": id}, "知识产权文档已关联"), "assets.ip_assets.documents.link", err
	}
	if rawID, ok := singlePathParam(path, "/v1/assets/ip-assets/"); ok {
		id, err := parsePositiveID(rawID)
		if err != nil {
			return true, nil, "", err
		}
		if method == http.MethodGet {
			data, err := a.getIpAsset(ctx, id)
			return true, okWithMessage(data, "ok"), "assets.ip_assets.get", err
		}
		if method == http.MethodPatch {
			err := a.updateIpAsset(ctx, id, body, actorFromRequest(query, body))
			return true, okWithMessage(map[string]any{"id": id}, "知识产权资产已更新"), "assets.ip_assets.update", err
		}
	}
	return false, nil, "", nil
}

func (a *Adapter) listIpAssets(ctx context.Context, query url.Values) (map[string]any, error) {
	status := statusFilter(query)
	search := likeSearch(query)
	items, err := a.queryMaps(ctx, `
		SELECT
		  ip.id,
		  ip.ip_code,
		  ip.ip_name,
		  ip.ip_type,
		  ip.registration_no,
		  ip.right_holder,
		  DATE_FORMAT(ip.apply_date, '%Y-%m-%d') AS apply_date,
		  DATE_FORMAT(ip.effective_date, '%Y-%m-%d') AS effective_date,
		  DATE_FORMAT(ip.expires_at, '%Y-%m-%d') AS expires_at,
		  ip.status,
		  ip.owner_uid,
		  ip.notes,
		  COUNT(ipr.product_asset_id) AS product_count
		FROM ip_assets ip
		LEFT JOIN ip_asset_products ipr ON ipr.ip_asset_id = ip.id
		WHERE (? IS NULL OR ip.status = ?)
		  AND (
		    ? IS NULL
		    OR ip.ip_code LIKE ?
		    OR ip.ip_name LIKE ?
		    OR ip.ip_type LIKE ?
		    OR ip.registration_no LIKE ?
		    OR ip.right_holder LIKE ?
		    OR ip.owner_uid LIKE ?
		  )
		GROUP BY ip.id
		ORDER BY ip.id DESC`,
		status, status, search, search, search, search, search, search, search,
	)
	if err != nil {
		return nil, err
	}
	active := int64(0)
	productCount := float64(0)
	for _, item := range items {
		if cleanAnyString(item["status"]) == "active" {
			active++
		}
		productCount += rowNumber(item, "product_count")
	}
	return map[string]any{
		"summary": []summaryMetric{
			metric("知识产权资产", len(items), "软著 / 商标 / 专利 / 资质证照", "primary"),
			metric("有效资产", active, "当前有效权利", "success"),
			metric("关联产品", productCount, "已挂接产品资产", "info"),
		},
		"total": len(items),
		"items": items,
	}, nil
}

// EnterpriseIPAssetsList keeps the list/count/page reads behind the Registry
// generation fence. The scope predicate is the owning IP relation predicate;
// project and direct-relation constraints remain conjunctive.
func (a *Adapter) EnterpriseIPAssetsList(ctx context.Context, query url.Values) (map[string]any, error) {
	if a.enterpriseReads == nil || a.enterpriseReads.registry == nil {
		return nil, httperror.New(503, "enterprise_ip_assets_reader_unavailable", "IP-assets unified reader unavailable")
	}
	tx, _, err := a.enterpriseReads.registry.BeginSnapshotReadTransaction(ctx, a.enterpriseReads.request)
	if err != nil {
		return nil, err
	}
	defer tx.Rollback()
	access, actor, err := assetsObjectAccess(query)
	if err != nil {
		return nil, err
	}
	where, args := "1=1", []any{}
	if access != "all" {
		units, e := assetsScopeUnits(query)
		if e != nil {
			return nil, e
		}
		where, args = ipAssetScopeWhere("ip", actor, units)
	}
	status, search := statusFilter(query), likeSearch(query)
	where += " AND (? IS NULL OR ip.status=?) AND (? IS NULL OR ip.ip_code LIKE ? OR ip.ip_name LIKE ? OR ip.ip_type LIKE ? OR ip.registration_no LIKE ? OR ip.right_holder LIKE ? OR ip.owner_uid LIKE ?)"
	args = append(args, status, status, search, search, search, search, search, search, search)
	page, size, err := enterpriseIPAssetPagination(query)
	if err != nil {
		return nil, err
	}
	if page > 1000000 || size > 100 {
		return nil, httperror.New(400, "invalid_ip_asset_pagination", "IP-assets pagination invalid")
	}
	var total, active int
	if err = tx.QueryRowContext(ctx, "SELECT COUNT(*),COALESCE(SUM(CASE WHEN ip.status='active' THEN 1 ELSE 0 END),0) FROM ip_assets ip WHERE "+where, args...).Scan(&total, &active); err != nil {
		return nil, err
	}
	// Product relations have their own object scope. Do not aggregate or invent a
	// count here: an IP grant alone neither discloses nor proves associations.
	rows, err := queryMaps(ctx, tx, "SELECT ip.* FROM ip_assets ip WHERE "+where+" ORDER BY ip.id DESC LIMIT ? OFFSET ?", append(args, size, (page-1)*size)...)
	if err != nil {
		return nil, err
	}
	if err = tx.Commit(); err != nil {
		return nil, err
	}
	return map[string]any{"items": rows, "total": total, "page": page, "pageSize": size, "summary": []summaryMetric{metric("知识产权资产", total, "软著 / 商标 / 专利 / 资质证照", "primary"), metric("有效资产", active, "当前有效权利", "success")}}, nil
}

// enterpriseIPAssetPagination rejects malformed values instead of silently
// falling back: a trusted request must not turn an invalid offset into page 1.
// The bounds also make (page-1)*size safe on every supported platform.
func enterpriseIPAssetPagination(query url.Values) (int, int, error) {
	parse := func(name string, fallback, maximum int) (int, error) {
		raw := strings.TrimSpace(query.Get(name))
		if raw == "" {
			return fallback, nil
		}
		value, err := strconv.Atoi(raw)
		if err != nil || value < 1 || value > maximum {
			return 0, httperror.New(400, "invalid_ip_asset_pagination", "IP-assets pagination invalid")
		}
		return value, nil
	}
	page, err := parse("page", 1, 1000000)
	if err != nil {
		return 0, 0, err
	}
	size, err := parse("pageSize", 20, 100)
	if err != nil {
		return 0, 0, err
	}
	return page, size, nil
}

func (a *Adapter) EnterpriseIPAssetView(ctx context.Context, query url.Values, id int64) (map[string]any, error) {
	if a.enterpriseReads == nil || a.enterpriseReads.registry == nil {
		return nil, httperror.New(503, "enterprise_ip_assets_reader_unavailable", "IP-assets unified reader unavailable")
	}
	tx, _, err := a.enterpriseReads.registry.BeginSnapshotReadTransaction(ctx, a.enterpriseReads.request)
	if err != nil {
		return nil, err
	}
	defer tx.Rollback()
	access, actor, err := assetsObjectAccess(query)
	if err != nil {
		return nil, err
	}
	where, args := "1=1", []any{id}
	if access != "all" {
		units, e := assetsScopeUnits(query)
		if e != nil {
			return nil, e
		}
		scope, scopeArgs := ipAssetScopeWhere("ip", actor, units)
		where = scope
		args = append(args, scopeArgs...)
	}
	row, err := queryMaps(ctx, tx, "SELECT ip.* FROM ip_assets ip WHERE ip.id=? AND "+where, args...)
	if err != nil {
		return nil, err
	}
	if len(row) == 0 {
		return nil, notFound("知识产权资产不存在")
	}
	if err = tx.Commit(); err != nil {
		return nil, err
	}
	return row[0], nil
}

func (a *Adapter) getIpAsset(ctx context.Context, id int64) (map[string]any, error) {
	row, err := a.queryRowMap(ctx, `
		SELECT
		  ip.id,
		  ip.ip_code,
		  ip.ip_name,
		  ip.ip_type,
		  ip.registration_no,
		  ip.right_holder,
		  DATE_FORMAT(ip.apply_date, '%Y-%m-%d') AS apply_date,
		  DATE_FORMAT(ip.effective_date, '%Y-%m-%d') AS effective_date,
		  DATE_FORMAT(ip.expires_at, '%Y-%m-%d') AS expires_at,
		  ip.status,
		  ip.owner_uid,
		  ip.notes,
		  COUNT(ipr.product_asset_id) AS product_count
		FROM ip_assets ip
		LEFT JOIN ip_asset_products ipr ON ipr.ip_asset_id = ip.id
		WHERE ip.id = ?
		GROUP BY ip.id`, id)
	if err != nil {
		return nil, err
	}
	if row == nil {
		return nil, notFound("知识产权资产不存在")
	}
	documents, err := a.documentsFor(ctx, "ip_asset", id)
	if err != nil {
		return nil, err
	}
	products, err := a.queryMaps(ctx, `
		SELECT p.id, p.product_code, p.product_name, p.status
		FROM ip_asset_products ipr
		INNER JOIN product_assets p ON p.id = ipr.product_asset_id
		WHERE ipr.ip_asset_id = ?
		ORDER BY p.id DESC`, id)
	if err != nil {
		return nil, err
	}
	row["documents"] = documents
	row["linked_products"] = products
	return row, nil
}

func (a *Adapter) handleDigitalAssetRoutes(ctx context.Context, method string, path string, query url.Values, body map[string]any) (bool, any, string, error) {
	if method == http.MethodGet && path == "/v1/assets/digital-assets" {
		data, err := a.listDigitalAssets(ctx, query)
		return true, okWithMessage(data, "ok"), "assets.digital_assets.list", err
	}
	if method == http.MethodPost && path == "/v1/assets/digital-assets" {
		id, err := a.createDigitalAsset(ctx, body, actorFromRequest(query, body))
		return true, okWithMessage(map[string]any{"id": id}, "数字资产已创建"), "assets.digital_assets.create", err
	}
	if rawID, ok := pathParamWithSuffix(path, "/v1/assets/digital-assets/", "/products"); ok && method == http.MethodPost {
		id, err := parsePositiveID(rawID)
		if err != nil {
			return true, nil, "", err
		}
		err = a.linkDigitalAssetProduct(ctx, id, body, actorFromRequest(query, body))
		return true, okWithMessage(map[string]any{"id": id}, "数字资产关联产品已创建"), "assets.digital_assets.products.link", err
	}
	if rawID, ok := pathParamWithSuffix(path, "/v1/assets/digital-assets/", "/documents"); ok && method == http.MethodPost {
		id, err := parsePositiveID(rawID)
		if err != nil {
			return true, nil, "", err
		}
		err = a.linkDocument(ctx, "digital_asset", id, body, actorFromRequest(query, body))
		return true, okWithMessage(map[string]any{"id": id}, "数字资产文档已关联"), "assets.digital_assets.documents.link", err
	}
	if rawID, ok := singlePathParam(path, "/v1/assets/digital-assets/"); ok {
		id, err := parsePositiveID(rawID)
		if err != nil {
			return true, nil, "", err
		}
		if method == http.MethodGet {
			data, err := a.getDigitalAsset(ctx, id)
			return true, okWithMessage(data, "ok"), "assets.digital_assets.get", err
		}
		if method == http.MethodPatch {
			err := a.updateDigitalAsset(ctx, id, body, actorFromRequest(query, body))
			return true, okWithMessage(map[string]any{"id": id}, "数字资产已更新"), "assets.digital_assets.update", err
		}
	}
	return false, nil, "", nil
}

func (a *Adapter) listDigitalAssets(ctx context.Context, query url.Values) (map[string]any, error) {
	return a.listDigitalAssetsWithScope(ctx, query, "", nil)
}

// EnterpriseDigitalAssetsList is the bounded Host entrypoint.  It reuses the
// owning digital-assets query and requires the trusted object scope compiled
// by the Enterprise BFF; it never accepts a caller-selected predicate.
func (a *Adapter) EnterpriseDigitalAssetsList(ctx context.Context, query url.Values) (map[string]any, error) {
	access, actor, err := assetsObjectAccess(query)
	if err != nil {
		return nil, err
	}
	if a.enterpriseReads == nil || a.enterpriseReads.registry == nil {
		return nil, httperror.New(http.StatusServiceUnavailable, "enterprise_digital_assets_reader_unavailable", "Digital asset unified reader unavailable")
	}
	tx, _, err := a.enterpriseReads.registry.BeginSnapshotReadTransaction(ctx, a.enterpriseReads.request)
	if err != nil {
		return nil, err
	}
	defer tx.Rollback()
	where, args := "", []any(nil)
	if access != "all" {
		units, scopeErr := assetsScopeUnits(query)
		if scopeErr != nil {
			return nil, scopeErr
		}
		where, args = digitalAssetScopeWhere("da", actor, units)
	}
	data, err := a.listDigitalAssetsWithScopeRunner(ctx, tx, query, where, args)
	if err != nil {
		return nil, err
	}
	if err = tx.Commit(); err != nil {
		return nil, err
	}
	return data, nil
}

func (a *Adapter) listDigitalAssetsWithScope(ctx context.Context, query url.Values, scopeWhere string, scopeArgs []any) (map[string]any, error) {
	return a.listDigitalAssetsWithScopeRunner(ctx, a.DB(), query, scopeWhere, scopeArgs)
}

func (a *Adapter) listDigitalAssetsWithScopeRunner(ctx context.Context, runner interface {
	queryMapRunner
	QueryRowContext(context.Context, string, ...any) *sql.Row
}, query url.Values, scopeWhere string, scopeArgs []any) (map[string]any, error) {
	status := statusFilter(query)
	search := likeSearch(query)
	page := positiveQueryInt(query.Get("page"), 1)
	pageSize := positiveQueryInt(query.Get("pageSize"), 20)
	if page > 1000000 || pageSize > 100 {
		return nil, httperror.New(http.StatusBadRequest, "invalid_digital_asset_pagination", "数字资产分页参数无效")
	}
	where := `(? IS NULL OR da.status = ?)
		  AND (
		    ? IS NULL
		    OR da.digital_code LIKE ?
		    OR da.digital_name LIKE ?
		    OR da.digital_type LIKE ?
		    OR da.storage_location LIKE ?
		    OR da.project_code LIKE ?
			OR da.owner_uid LIKE ?
		  )`
	args := []any{status, status, search, search, search, search, search, search, search}
	if scopeWhere != "" {
		where += " AND " + scopeWhere
		args = append(args, scopeArgs...)
	}
	var total, active int
	if err := runner.QueryRowContext(ctx, "SELECT COUNT(*), COALESCE(SUM(CASE WHEN da.status='active' THEN 1 ELSE 0 END), 0) FROM digital_assets da WHERE "+where, args...).Scan(&total, &active); err != nil {
		return nil, err
	}
	var productCount float64
	if err := runner.QueryRowContext(ctx, "SELECT COUNT(dap.product_asset_id) FROM digital_assets da LEFT JOIN digital_asset_products dap ON dap.digital_asset_id=da.id WHERE "+where, args...).Scan(&productCount); err != nil {
		return nil, err
	}
	queryText := `
		SELECT
		  da.id,
		  da.digital_code,
		  da.digital_name,
		  da.digital_type,
		  da.storage_location,
		  da.owner_uid,
		  da.access_scope,
		  da.project_code,
		  da.environment_id,
		  env.environment_name,
		  da.status,
		  da.notes,
		  COUNT(dap.product_asset_id) AS product_count
		FROM digital_assets da
		LEFT JOIN asset_environments env ON env.id = da.environment_id
		LEFT JOIN digital_asset_products dap ON dap.digital_asset_id = da.id
		WHERE ` + where + ` GROUP BY da.id ORDER BY da.id DESC LIMIT ? OFFSET ?`
	pageArgs := append(append([]any{}, args...), pageSize, (page-1)*pageSize)
	items, err := queryMaps(ctx, runner, queryText, pageArgs...)
	if err != nil {
		return nil, err
	}
	return map[string]any{
		"summary": []summaryMetric{
			metric("数字资产", total, "代码 / 文档 / 数据 / 模型 / 交付物", "primary"),
			metric("活跃资产", active, "当前仍在复用", "success"),
			metric("关联产品", productCount, "已挂接产品主档", "info"),
		},
		"total":    total,
		"page":     page,
		"pageSize": pageSize,
		"items":    items,
	}, nil
}

func (a *Adapter) getDigitalAsset(ctx context.Context, id int64) (map[string]any, error) {
	return a.getDigitalAssetWithScope(ctx, id, "", nil)
}

// EnterpriseDigitalAssetView is the exact object read entrypoint for the
// digital_assets:view user grant.
func (a *Adapter) EnterpriseDigitalAssetView(ctx context.Context, query url.Values, id int64) (map[string]any, error) {
	access, actor, err := assetsObjectAccess(query)
	if err != nil {
		return nil, err
	}
	if access == "all" {
		return a.getDigitalAsset(ctx, id)
	}
	units, err := assetsScopeUnits(query)
	if err != nil {
		return nil, err
	}
	where, args := digitalAssetScopeWhere("da", actor, units)
	return a.getDigitalAssetWithScope(ctx, id, where, args)
}

func (a *Adapter) getDigitalAssetWithScope(ctx context.Context, id int64, scopeWhere string, scopeArgs []any) (map[string]any, error) {
	queryText := `
		SELECT
		  da.id,
		  da.digital_code,
		  da.digital_name,
		  da.digital_type,
		  da.storage_location,
		  da.owner_uid,
		  da.access_scope,
		  da.project_code,
		  da.environment_id,
		  env.environment_name,
		  da.status,
		  da.notes,
		  COUNT(dap.product_asset_id) AS product_count
		FROM digital_assets da
		LEFT JOIN asset_environments env ON env.id = da.environment_id
		LEFT JOIN digital_asset_products dap ON dap.digital_asset_id = da.id
		WHERE da.id = ?
	`
	args := []any{id}
	if scopeWhere != "" {
		queryText += " AND " + scopeWhere
		args = append(args, scopeArgs...)
	}
	queryText += " GROUP BY da.id"
	row, err := a.queryRowMap(ctx, queryText, args...)
	if err != nil {
		return nil, err
	}
	if row == nil {
		return nil, notFound("数字资产不存在")
	}
	products, err := a.queryMaps(ctx, `
		SELECT p.id, p.product_code, p.product_name, p.status
		FROM digital_asset_products dap
		INNER JOIN product_assets p ON p.id = dap.product_asset_id
		WHERE dap.digital_asset_id = ?
		ORDER BY p.id DESC`, id)
	if err != nil {
		return nil, err
	}
	documents, err := a.documentsFor(ctx, "digital_asset", id)
	if err != nil {
		return nil, err
	}
	row["linked_products"] = products
	row["documents"] = documents
	return row, nil
}

func (a *Adapter) handleDeliveryRoutes(ctx context.Context, method string, path string, query url.Values, body map[string]any) (bool, any, string, error) {
	if method == http.MethodGet && path == "/v1/assets/deliveries" {
		data, err := a.listDeliveries(ctx, query)
		return true, okWithMessage(data, "ok"), "assets.deliveries.list", err
	}
	if method == http.MethodPost && path == "/v1/assets/deliveries" {
		id, err := a.createDelivery(ctx, body, actorFromRequest(query, body))
		return true, okWithMessage(map[string]any{"id": id}, "交付视图已创建"), "assets.deliveries.create", err
	}
	if rawID, ok := pathParamWithSuffix(path, "/v1/assets/deliveries/", "/products"); ok && method == http.MethodPost {
		id, err := parsePositiveID(rawID)
		if err != nil {
			return true, nil, "", err
		}
		err = a.linkDeliveryProduct(ctx, id, body, actorFromRequest(query, body))
		return true, okWithMessage(map[string]any{"id": id}, "交付产品关联已创建"), "assets.deliveries.products.link", err
	}
	if rawID, ok := pathParamWithSuffix(path, "/v1/assets/deliveries/", "/environments"); ok && method == http.MethodPost {
		id, err := parsePositiveID(rawID)
		if err != nil {
			return true, nil, "", err
		}
		err = a.linkDeliveryEnvironment(ctx, id, body, actorFromRequest(query, body))
		return true, okWithMessage(map[string]any{"id": id}, "交付环境已关联"), "assets.deliveries.environments.link", err
	}
	if rawID, ok := singlePathParam(path, "/v1/assets/deliveries/"); ok {
		id, err := parsePositiveID(rawID)
		if err != nil {
			return true, nil, "", err
		}
		if method == http.MethodGet {
			data, err := a.getDelivery(ctx, id)
			return true, okWithMessage(data, "ok"), "assets.deliveries.get", err
		}
		if method == http.MethodPatch {
			err := a.updateDelivery(ctx, id, body, actorFromRequest(query, body))
			return true, okWithMessage(map[string]any{"id": id}, "交付视图已更新"), "assets.deliveries.update", err
		}
	}
	return false, nil, "", nil
}

func (a *Adapter) deliveryListRows(ctx context.Context, query url.Values, id any) ([]map[string]any, error) {
	status := statusFilter(query)
	search := likeSearch(query)
	customerCode := firstText(query.Get("customer_code"), query.Get("customerCode"))
	contractCode := firstText(query.Get("contract_code"), query.Get("contractCode"))
	projectCode := firstText(query.Get("project_code"), query.Get("projectCode"))
	deliveryCode := firstText(query.Get("delivery_code"), query.Get("deliveryCode"))
	idWhere := ""
	args := []any{
		status, status,
		nullableString(customerCode), nullableString(customerCode),
		nullableString(contractCode), nullableString(contractCode),
		nullableString(projectCode), nullableString(projectCode),
		nullableString(deliveryCode), nullableString(deliveryCode),
		search, search, search, search, search, search, search,
	}
	if id != nil {
		idWhere = " AND dv.id = ?"
		args = append(args, id)
	}
	return a.queryMaps(ctx, `
		SELECT
		  dv.id,
		  dv.delivery_code,
		  dv.delivery_name,
		  dv.customer_code,
		  dv.contract_code,
		  dv.project_code,
		  dv.status,
		  dv.owner_uid,
		  DATE_FORMAT(dv.go_live_at, '%Y-%m-%d') AS go_live_at,
		  DATE_FORMAT(dv.accepted_at, '%Y-%m-%d') AS accepted_at,
		  dv.notes,
		  COUNT(de.environment_id) AS environment_count,
		  COALESCE(SUM(cost_summary.monthly_cost), 0) AS monthly_cost
		FROM asset_delivery_views dv
		LEFT JOIN asset_delivery_environments de ON de.delivery_view_id = dv.id
		LEFT JOIN (
		  SELECT env.id AS environment_id, COALESCE(SUM(ard.monthly_cost), 0) AS monthly_cost
		  FROM asset_environments env
		  LEFT JOIN asset_environment_assets ea ON ea.environment_id = env.id
		  LEFT JOIN asset_resource_details ard ON ard.asset_id = ea.asset_id
		  GROUP BY env.id
		) AS cost_summary ON cost_summary.environment_id = de.environment_id
		WHERE (? IS NULL OR dv.status = ?)
		  AND (? IS NULL OR dv.customer_code = ?)
		  AND (? IS NULL OR dv.contract_code = ?)
		  AND (? IS NULL OR dv.project_code = ?)
		  AND (? IS NULL OR dv.delivery_code = ?)
		  AND (
		    ? IS NULL
		    OR dv.delivery_code LIKE ?
		    OR dv.delivery_name LIKE ?
		    OR dv.customer_code LIKE ?
		    OR dv.contract_code LIKE ?
		    OR dv.project_code LIKE ?
		    OR dv.owner_uid LIKE ?
		  )`+idWhere+`
		GROUP BY dv.id
		ORDER BY dv.id DESC`, args...)
}

func (a *Adapter) listDeliveries(ctx context.Context, query url.Values) (map[string]any, error) {
	items, err := a.deliveryListRows(ctx, query, nil)
	if err != nil {
		return nil, err
	}
	delivering := int64(0)
	monthlyCost := float64(0)
	for _, item := range items {
		if cleanAnyString(item["status"]) == "delivering" {
			delivering++
		}
		monthlyCost += rowNumber(item, "monthly_cost")
	}
	return map[string]any{
		"summary": []summaryMetric{
			metric("交付视图", len(items), "客户/合同/项目链路", "primary"),
			metric("交付中", delivering, "待上线或待验收", "warning"),
			metric("月度成本", formatMoney(monthlyCost), "资源月均成本", "info"),
		},
		"total": len(items),
		"items": items,
	}, nil
}

func (a *Adapter) getDelivery(ctx context.Context, id int64) (map[string]any, error) {
	rows, err := a.deliveryListRows(ctx, url.Values{}, id)
	if err != nil {
		return nil, err
	}
	if len(rows) == 0 {
		return nil, notFound("交付视图不存在")
	}
	row := rows[0]
	products, err := a.queryMaps(ctx, `
		SELECT p.id, p.product_code, p.product_name, p.status, dp.relation_type
		FROM asset_delivery_products dp
		INNER JOIN product_assets p ON p.id = dp.product_asset_id
		WHERE dp.delivery_view_id = ?
		ORDER BY p.id DESC`, id)
	if err != nil {
		return nil, err
	}
	environments, err := a.queryMaps(ctx, `
		SELECT
		  env.id,
		  env.environment_code,
		  env.environment_name,
		  env.environment_type,
		  env.status,
		  de.relation_type,
		  COALESCE(SUM(ard.monthly_cost), 0) AS monthly_cost
		FROM asset_delivery_environments de
		INNER JOIN asset_environments env ON env.id = de.environment_id
		LEFT JOIN asset_environment_assets ea ON ea.environment_id = env.id
		LEFT JOIN asset_resource_details ard ON ard.asset_id = ea.asset_id
		WHERE de.delivery_view_id = ?
		GROUP BY env.id, de.relation_type
		ORDER BY env.id DESC`, id)
	if err != nil {
		return nil, err
	}
	documents, err := a.documentsFor(ctx, "delivery_view", id)
	if err != nil {
		return nil, err
	}
	row["linked_products"] = products
	row["linked_environments"] = environments
	row["documents"] = documents
	return row, nil
}
