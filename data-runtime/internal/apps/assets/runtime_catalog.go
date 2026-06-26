package assets

import (
	"context"
	"net/http"
	"net/url"
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
		id, err := a.createProduct(ctx, body, actorFromRequest(query, body))
		return true, okWithMessage(map[string]any{"id": id}, "产品主档已创建"), "assets.products.create", err
	}
	if rawID, ok := pathParamWithSuffix(path, "/v1/assets/products/", "/bases"); ok && method == http.MethodPost {
		id, err := parsePositiveID(rawID)
		if err != nil {
			return true, nil, "", err
		}
		err = a.linkProductBase(ctx, id, body, actorFromRequest(query, body))
		return true, okWithMessage(map[string]any{"id": id}, "产品关联底座已创建"), "assets.products.bases.link", err
	}
	if rawID, ok := pathParamWithSuffix(path, "/v1/assets/products/", "/assets"); ok && method == http.MethodPost {
		id, err := parsePositiveID(rawID)
		if err != nil {
			return true, nil, "", err
		}
		err = a.linkProductAsset(ctx, id, body, actorFromRequest(query, body))
		return true, okWithMessage(map[string]any{"id": id}, "产品关联资产已创建"), "assets.products.assets.link", err
	}
	if rawID, ok := pathParamWithSuffix(path, "/v1/assets/products/", "/documents"); ok && method == http.MethodPost {
		id, err := parsePositiveID(rawID)
		if err != nil {
			return true, nil, "", err
		}
		err = a.linkDocument(ctx, "product_asset", id, body, actorFromRequest(query, body))
		return true, okWithMessage(map[string]any{"id": id}, "产品文档已关联"), "assets.products.documents.link", err
	}
	if rawID, ok := singlePathParam(path, "/v1/assets/products/"); ok {
		id, err := parsePositiveID(rawID)
		if err != nil {
			return true, nil, "", err
		}
		if method == http.MethodGet {
			data, err := a.getProduct(ctx, id)
			return true, okWithMessage(data, "ok"), "assets.products.get", err
		}
		if method == http.MethodPatch {
			err := a.updateProduct(ctx, id, body, actorFromRequest(query, body))
			return true, okWithMessage(map[string]any{"id": id}, "产品主档已更新"), "assets.products.update", err
		}
	}
	return false, nil, "", nil
}

func (a *Adapter) listProducts(ctx context.Context, query url.Values) (map[string]any, error) {
	status := statusFilter(query)
	search := likeSearch(query)
	items, err := a.queryMaps(ctx, `
		SELECT
		  p.id,
		  p.product_code,
		  p.product_name,
		  p.product_line,
		  CAST(p.customer_domain AS CHAR) AS customer_domain,
		  p.business_domain,
		  p.product_level,
		  p.asset_level,
		  p.status,
		  p.build_stage,
		  p.current_version,
		  p.target_version,
		  p.productization_value_level,
		  CAST(p.supported_terminals AS CHAR) AS supported_terminals,
		  CAST(p.covered_legacy_systems AS CHAR) AS covered_legacy_systems,
		  p.summary,
		  DATE_FORMAT(p.built_at, '%Y-%m-%d') AS built_at,
		  p.business_owner_uid,
		  p.technical_owner_uid,
		  p.project_code,
		  p.notes,
		  COUNT(DISTINCT pr.asset_id) AS asset_count,
		  COUNT(DISTINCT pb.technology_base_id) AS base_count
		FROM product_assets p
		LEFT JOIN product_asset_resources pr ON pr.product_asset_id = p.id
		LEFT JOIN product_asset_bases pb ON pb.product_asset_id = p.id
		WHERE (? IS NULL OR p.status = ?)
		  AND (
		    ? IS NULL
		    OR p.product_code LIKE ?
		    OR p.product_name LIKE ?
		    OR p.product_line LIKE ?
		    OR CAST(p.customer_domain AS CHAR) LIKE ?
		    OR p.business_domain LIKE ?
		    OR p.current_version LIKE ?
		    OR p.target_version LIKE ?
		    OR CAST(p.supported_terminals AS CHAR) LIKE ?
		    OR CAST(p.covered_legacy_systems AS CHAR) LIKE ?
		    OR p.project_code LIKE ?
		    OR p.business_owner_uid LIKE ?
		    OR p.technical_owner_uid LIKE ?
		  )
		GROUP BY p.id
		ORDER BY p.id DESC`,
		status, status, search, search, search, search, search, search, search, search, search, search, search, search, search,
	)
	if err != nil {
		return nil, err
	}
	active := int64(0)
	assetCount := float64(0)
	for _, item := range items {
		normalizeProductMap(item)
		switch cleanAnyString(item["status"]) {
		case "mvp", "mmp", "pmf", "iterating":
			active++
		}
		assetCount += rowNumber(item, "asset_count")
	}
	return map[string]any{
		"summary": []summaryMetric{
			metric("产品主档", len(items), "平台产品家底", "primary"),
			metric("活跃产品", active, "MVP/MMP/PMF 生命周期", "success"),
			metric("关联资源", assetCount, "运行与交付资源", "info"),
		},
		"total": len(items),
		"items": items,
	}, nil
}

func (a *Adapter) getProduct(ctx context.Context, id int64) (map[string]any, error) {
	row, err := a.queryRowMap(ctx, `
		SELECT
		  p.id,
		  p.product_code,
		  p.product_name,
		  p.product_line,
		  CAST(p.customer_domain AS CHAR) AS customer_domain,
		  p.business_domain,
		  p.product_level,
		  p.asset_level,
		  p.status,
		  p.build_stage,
		  p.current_version,
		  p.target_version,
		  p.productization_value_level,
		  CAST(p.supported_terminals AS CHAR) AS supported_terminals,
		  CAST(p.covered_legacy_systems AS CHAR) AS covered_legacy_systems,
		  p.summary,
		  DATE_FORMAT(p.built_at, '%Y-%m-%d') AS built_at,
		  p.business_owner_uid,
		  p.technical_owner_uid,
		  p.project_code,
		  p.notes,
		  COUNT(DISTINCT pr.asset_id) AS asset_count,
		  COUNT(DISTINCT pb.technology_base_id) AS base_count
		FROM product_assets p
		LEFT JOIN product_asset_resources pr ON pr.product_asset_id = p.id
		LEFT JOIN product_asset_bases pb ON pb.product_asset_id = p.id
		WHERE p.id = ?
		GROUP BY p.id`, id)
	if err != nil {
		return nil, err
	}
	if row == nil {
		return nil, notFound("产品主档不存在")
	}
	normalizeProductMap(row)
	linkedBases, err := a.queryMaps(ctx, `
		SELECT tb.id, tb.base_code, tb.base_name, tb.base_type, tb.status
		FROM product_asset_bases pb
		INNER JOIN technology_bases tb ON tb.id = pb.technology_base_id
		WHERE pb.product_asset_id = ?
		ORDER BY tb.id DESC`, id)
	if err != nil {
		return nil, err
	}
	linkedAssets, err := a.queryMaps(ctx, `
		SELECT ai.id, ai.asset_code, ai.asset_name, ai.asset_category, ai.asset_subtype, pr.relation_type, ai.status, pr.is_primary
		FROM product_asset_resources pr
		INNER JOIN asset_items ai ON ai.id = pr.asset_id
		WHERE pr.product_asset_id = ?
		ORDER BY pr.is_primary DESC, ai.id DESC`, id)
	if err != nil {
		return nil, err
	}
	for _, item := range linkedAssets {
		normalizeBoolField(item, "is_primary")
	}
	documents, err := a.documentsFor(ctx, "product_asset", id)
	if err != nil {
		return nil, err
	}
	deliveryInstances, err := a.queryMaps(ctx, `
		SELECT
		  dv.id,
		  dv.delivery_code,
		  dv.delivery_name,
		  dv.customer_code,
		  dv.contract_code,
		  dv.project_code,
		  dv.status,
		  dp.relation_type,
		  DATE_FORMAT(dv.go_live_at, '%Y-%m-%d') AS go_live_at,
		  DATE_FORMAT(dv.accepted_at, '%Y-%m-%d') AS accepted_at
		FROM asset_delivery_products dp
		INNER JOIN asset_delivery_views dv ON dv.id = dp.delivery_view_id
		WHERE dp.product_asset_id = ?
		ORDER BY dv.id DESC`, id)
	if err != nil {
		return nil, err
	}
	row["linked_bases"] = linkedBases
	row["linked_assets"] = linkedAssets
	row["documents"] = documents
	row["delivery_instances"] = deliveryInstances
	return row, nil
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
	status := statusFilter(query)
	search := likeSearch(query)
	items, err := a.queryMaps(ctx, `
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
		WHERE (? IS NULL OR da.status = ?)
		  AND (
		    ? IS NULL
		    OR da.digital_code LIKE ?
		    OR da.digital_name LIKE ?
		    OR da.digital_type LIKE ?
		    OR da.storage_location LIKE ?
		    OR da.project_code LIKE ?
		    OR da.owner_uid LIKE ?
		  )
		GROUP BY da.id
		ORDER BY da.id DESC`,
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
			metric("数字资产", len(items), "代码 / 文档 / 数据 / 模型 / 交付物", "primary"),
			metric("活跃资产", active, "当前仍在复用", "success"),
			metric("关联产品", productCount, "已挂接产品主档", "info"),
		},
		"total": len(items),
		"items": items,
	}, nil
}

func (a *Adapter) getDigitalAsset(ctx context.Context, id int64) (map[string]any, error) {
	row, err := a.queryRowMap(ctx, `
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
		GROUP BY da.id`, id)
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
