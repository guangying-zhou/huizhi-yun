package assets

import (
	"context"
	"database/sql"
	"encoding/json"
	"github.com/huizhi-yun/data-runtime/internal/httperror"
	"net/url"
	"regexp"
	"strconv"
	"strings"
)

// productMasterReader binds every dependency read to its caller's snapshot.
type productMasterReader struct {
	tx              *sql.Tx
	dictionaryTable string
}

func (a productMasterReader) queryMaps(ctx context.Context, query string, args ...any) ([]map[string]any, error) {
	rows, err := a.tx.QueryContext(ctx, query, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	return rowsToMaps(rows)
}
func (a productMasterReader) queryRowMap(ctx context.Context, query string, args ...any) (map[string]any, error) {
	rows, err := a.queryMaps(ctx, query, args...)
	if err != nil {
		return nil, err
	}
	if len(rows) == 0 {
		return nil, nil
	}
	return rows[0], nil
}
func ListProductsInTransaction(ctx context.Context, tx *sql.Tx, query url.Values) (map[string]any, error) {
	return (productMasterReader{tx: tx}).listProducts(ctx, query)
}
func ReadProductInTransaction(ctx context.Context, tx *sql.Tx, id int64, query url.Values) (map[string]any, error) {
	return (productMasterReader{tx: tx}).getProduct(ctx, id, query)
}
func ListAssetCategoriesInTransaction(ctx context.Context, tx *sql.Tx, scope string, includeDisabled bool) ([]map[string]any, error) {
	if _, err := normalizeAssetCategoryScope(scope); err != nil {
		return nil, err
	}
	return (productMasterReader{tx: tx}).listAssetCategories(ctx, scope, includeDisabled)
}
func (a productMasterReader) listProducts(ctx context.Context, query url.Values) (map[string]any, error) {
	access, actor, err := assetsObjectAccess(query)
	if err != nil {
		return nil, err
	}
	where, args := "1=1", []any{}
	if access != "all" {
		units, err := assetsScopeUnits(query)
		if err != nil {
			return nil, err
		}
		where, args = productObjectScopeWhere("p", actor, units)
	}
	return a.listProductsWithScope(ctx, query, where, args)
}

// Only the exact-capability service router may call this unscoped directory read.

func (a productMasterReader) listProductsWithScope(ctx context.Context, query url.Values, scopeWhere string, scopeArgs []any) (map[string]any, error) {
	status := statusFilter(query)
	search := likeSearch(query)
	productCodes := uniqueCSVValues(firstText(query.Get("product_codes"), query.Get("productCodes"), query.Get("product_code"), query.Get("productCode")))
	productCodeFilter := ""
	args := []any{status, status, search, search, search, search, search, search, search, search, search, search, search, search, search}
	if len(productCodes) > 0 {
		productCodeFilter = "\n\t\t  AND p.product_code IN (" + strings.TrimRight(strings.Repeat("?,", len(productCodes)), ",") + ")"
		for _, code := range productCodes {
			args = append(args, code)
		}
	}
	productCodeFilter += " AND " + scopeWhere
	args = append(args, scopeArgs...)
	if category := strings.TrimSpace(query.Get("product_line")); category != "" && category != "all" {
		productCodeFilter += " AND p.product_line = ?"
		args = append(args, category)
	}
	baseWhere, baseArgs, err := productRelatedReadPredicate(query, "base", "scope_tb")
	if err != nil {
		return nil, err
	}
	assetWhere, assetArgs, err := productRelatedReadPredicate(query, "asset", "scope_ai")
	if err != nil {
		return nil, err
	}
	args = append(append(assetArgs, baseArgs...), args...)
	order := productListOrder(query)
	statement := `
		SELECT
		  p.id,
		  p.product_code,
		  p.product_name,
		  p.product_line,
		  COALESCE(product_line_group.category_label, p.product_line) AS product_line_label,
		  product_line_group.sort_order AS product_line_sort_order,
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
		  (SELECT COUNT(DISTINCT scope_pr.asset_id) FROM product_asset_resources scope_pr JOIN asset_items scope_ai ON scope_ai.id=scope_pr.asset_id WHERE scope_pr.product_asset_id=p.id AND scope_ai.archived_at IS NULL AND ` + assetWhere + `) AS asset_count,
          (SELECT COUNT(DISTINCT scope_pb.technology_base_id) FROM product_asset_bases scope_pb JOIN technology_bases scope_tb ON scope_tb.id=scope_pb.technology_base_id WHERE scope_pb.product_asset_id=p.id AND ` + baseWhere + `) AS base_count
		FROM product_assets p
		LEFT JOIN asset_category_groups product_line_group
		  ON product_line_group.category_scope = 'product'
		 AND product_line_group.category_value = p.product_line
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
		` + productCodeFilter + `
		GROUP BY p.id
		ORDER BY ` + order
	if query.Has("page") || query.Has("pageSize") {
		return a.productListPage(ctx, query, statement, args)
	}
	items, err := a.queryMaps(ctx, statement, args...)
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

func (a productMasterReader) getProduct(ctx context.Context, id int64, query url.Values) (map[string]any, error) {
	access, actor, err := assetsObjectAccess(query)
	if err != nil {
		return nil, err
	}
	where, args := "1=1", []any{id}
	if access != "all" {
		units, err := assetsScopeUnits(query)
		if err != nil {
			return nil, err
		}
		var scopeArgs []any
		where, scopeArgs = productObjectScopeWhere("p", actor, units)
		args = append(args, scopeArgs...)
	}

	baseWhere, baseArgs, err := productRelatedReadPredicate(query, "base", "scope_tb")
	if err != nil {
		return nil, err
	}
	assetWhere, assetArgs, err := productRelatedReadPredicate(query, "asset", "scope_ai")
	if err != nil {
		return nil, err
	}
	args = append(append(assetArgs, baseArgs...), args...)
	row, err := a.queryRowMap(ctx, `
		SELECT
		  p.id,
		  p.product_code,
		  p.product_name,
		  p.product_line,
		  COALESCE(product_line_group.category_label, p.product_line) AS product_line_label,
		  product_line_group.sort_order AS product_line_sort_order,
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
		  (SELECT COUNT(DISTINCT scope_pr.asset_id) FROM product_asset_resources scope_pr JOIN asset_items scope_ai ON scope_ai.id=scope_pr.asset_id WHERE scope_pr.product_asset_id=p.id AND scope_ai.archived_at IS NULL AND `+assetWhere+`) AS asset_count,
          (SELECT COUNT(DISTINCT scope_pb.technology_base_id) FROM product_asset_bases scope_pb JOIN technology_bases scope_tb ON scope_tb.id=scope_pb.technology_base_id WHERE scope_pb.product_asset_id=p.id AND `+baseWhere+`) AS base_count
		FROM product_assets p
		LEFT JOIN asset_category_groups product_line_group
		  ON product_line_group.category_scope = 'product'
		 AND product_line_group.category_value = p.product_line
		LEFT JOIN product_asset_resources pr ON pr.product_asset_id = p.id
		LEFT JOIN product_asset_bases pb ON pb.product_asset_id = p.id
		WHERE p.id = ? AND `+where+`
		GROUP BY p.id`, args...)
	if err != nil {
		return nil, err
	}
	if row == nil {
		return nil, notFound("产品主档不存在")
	}
	normalizeProductMap(row)
	baseWhere, baseArgs, err = productRelatedReadPredicate(query, "base", "tb")
	if err != nil {
		return nil, err
	}
	assetWhere, assetArgs, err = productRelatedReadPredicate(query, "asset", "ai")
	if err != nil {
		return nil, err
	}
	linkedBases, err := a.queryMaps(ctx, `
		SELECT tb.id, tb.base_code, tb.base_name, tb.base_type, tb.status
		FROM product_asset_bases pb
		INNER JOIN technology_bases tb ON tb.id = pb.technology_base_id
		WHERE pb.product_asset_id = ? AND `+baseWhere+`
		ORDER BY tb.id DESC`, append([]any{id}, baseArgs...)...)
	if err != nil {
		return nil, err
	}
	linkedAssets, err := a.queryMaps(ctx, `
		SELECT ai.id, ai.asset_code, ai.asset_name, ai.asset_category, ai.asset_subtype, pr.relation_type, ai.status, pr.is_primary
		FROM product_asset_resources pr
		INNER JOIN asset_items ai ON ai.id = pr.asset_id
		WHERE pr.product_asset_id = ? AND ai.archived_at IS NULL AND `+assetWhere+`
		ORDER BY pr.is_primary DESC, ai.id DESC`, append([]any{id}, assetArgs...)...)
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

func (a productMasterReader) listAssetCategories(ctx context.Context, scope string, includeDisabled bool) ([]map[string]any, error) {
	groups, err := a.queryMaps(ctx, `
		SELECT id, category_scope, category_value, category_label, short_code, description, enabled, sort_order
		FROM asset_category_groups
		WHERE category_scope = ?
		ORDER BY sort_order ASC, id ASC`, scope)
	if err != nil {
		return nil, err
	}
	items, err := a.queryMaps(ctx, `
		SELECT aci.id, aci.group_id, aci.item_value, aci.item_label, aci.short_code, aci.description, aci.enabled, aci.sort_order
		FROM asset_category_items aci
		INNER JOIN asset_category_groups acg ON acg.id = aci.group_id
		WHERE acg.category_scope = ?
		ORDER BY aci.sort_order ASC, aci.id ASC`, scope)
	if err != nil {
		return nil, err
	}

	byGroup := map[int64][]map[string]any{}
	for _, item := range items {
		if !includeDisabled && asInt(item["enabled"]) != 1 {
			continue
		}
		groupID := asInt(item["group_id"])
		byGroup[groupID] = append(byGroup[groupID], map[string]any{
			"id":          item["id"],
			"value":       item["item_value"],
			"label":       item["item_label"],
			"shortCode":   firstText(cleanAnyString(item["short_code"])),
			"description": firstText(cleanAnyString(item["description"])),
			"enabled":     asInt(item["enabled"]) == 1,
			"sortOrder":   item["sort_order"],
		})
	}

	result := make([]map[string]any, 0, len(groups))
	for _, group := range groups {
		if !includeDisabled && asInt(group["enabled"]) != 1 {
			continue
		}
		id := asInt(group["id"])
		result = append(result, map[string]any{
			"id":          group["id"],
			"scope":       group["category_scope"],
			"value":       group["category_value"],
			"label":       group["category_label"],
			"shortCode":   firstText(cleanAnyString(group["short_code"])),
			"description": firstText(cleanAnyString(group["description"])),
			"enabled":     asInt(group["enabled"]) == 1,
			"sortOrder":   group["sort_order"],
			"items":       byGroup[id],
		})
	}
	return result, nil
}

func (a productMasterReader) productListPage(ctx context.Context, query url.Values, statement string, args []any) (map[string]any, error) {
	page, size, err := productMasterPageBounds(query)
	if err != nil {
		return nil, err
	}

	tx := a.tx

	var total, active, assets int64
	err = tx.QueryRowContext(ctx, `SELECT COUNT(*), COALESCE(SUM(status IN ('mvp','mmp','pmf','iterating')),0), COALESCE(SUM(asset_count),0) FROM (`+statement+`) product_summary`, args...).Scan(&total, &active, &assets)
	if err != nil {
		return nil, err
	}
	pageArgs := append(append([]any{}, args...), size, (page-1)*size)
	rows, err := tx.QueryContext(ctx, statement+` LIMIT ? OFFSET ?`, pageArgs...)
	if err != nil {
		return nil, err
	}
	items, err := rowsToMaps(rows)
	closeErr := rows.Close()
	if err != nil {
		return nil, err
	}
	if closeErr != nil {
		return nil, closeErr
	}
	for _, item := range items {
		normalizeProductMap(item)
	}
	return map[string]any{
		"items": items, "total": total, "page": page, "pageSize": size,
		"summary": []summaryMetric{
			metric("产品主档", total, "平台产品家底", "primary"),
			metric("活跃产品", active, "MVP/MMP/PMF 生命周期", "success"),
			metric("关联资源", assets, "运行与交付资源", "info"),
		},
	}, nil
}

func (a productMasterReader) documentsFor(ctx context.Context, objectType string, objectID int64) ([]map[string]any, error) {
	hasArtifactType, err := a.tableColumnExists(ctx, "asset_documents", "artifact_type")
	if err != nil {
		return nil, err
	}
	artifactSelect := "NULL AS artifact_type"
	if hasArtifactType {
		artifactSelect = "artifact_type"
	}
	hasSourceContext, err := a.tableColumnExists(ctx, "asset_documents", "source_context")
	if err != nil {
		return nil, err
	}
	sourceContextSelect := "NULL AS source_context"
	if hasSourceContext {
		sourceContextSelect = "source_context"
	}
	items, err := a.queryMaps(ctx, `
		SELECT id, document_id, document_type, `+artifactSelect+`, `+sourceContextSelect+`, remark
		FROM asset_documents
		WHERE object_type = ? AND object_id = ?
		ORDER BY id DESC`, objectType, objectID)
	if err != nil {
		return nil, err
	}
	for _, item := range items {
		if cleanAnyString(item["artifact_type"]) == "" && objectType == "delivery_view" {
			item["artifact_type"] = artifactTypeFromDocumentType(cleanAnyString(item["document_type"]))
		}
	}
	return items, nil
}

func (a productMasterReader) tableColumnExists(ctx context.Context, tableName string, columnName string) (bool, error) {
	var count int
	if err := a.tx.QueryRowContext(ctx, `
		SELECT COUNT(*)
		FROM information_schema.COLUMNS
		WHERE TABLE_SCHEMA = DATABASE()
		  AND TABLE_NAME = ?
		  AND COLUMN_NAME = ?
	`, tableName, columnName).Scan(&count); err != nil {
		return false, err
	}
	return count > 0, nil
}

func (a productMasterReader) listDictionaries(ctx context.Context) ([]dictionaryDefinition, error) {
	rows, err := a.tx.QueryContext(ctx, `
		SELECT param_key, param_value
		FROM `+a.dictionaryTableName()+`
		WHERE param_key LIKE 'dictionary.%'
		ORDER BY param_key ASC
	`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	items := make([]dictionaryDefinition, 0)
	for rows.Next() {
		var key string
		var value string
		if err := rows.Scan(&key, &value); err != nil {
			return nil, err
		}
		var item dictionaryDefinition
		if err := json.Unmarshal([]byte(value), &item); err != nil {
			continue
		}
		if item.Code == "" {
			item.Code = strings.TrimPrefix(key, "dictionary.")
		}
		if isManagedDictionary(item.Code) {
			continue
		}
		items = append(items, item)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}

	managed, err := a.managedCategoryDictionaries(ctx)
	if err != nil {
		return nil, err
	}
	items = append(items, managed...)
	return items, nil
}

func (a productMasterReader) managedCategoryDictionaries(ctx context.Context) ([]dictionaryDefinition, error) {
	rows, err := a.tx.QueryContext(ctx, `
		SELECT category_scope, category_value, category_label, short_code, description, enabled, sort_order
		FROM asset_category_groups
		ORDER BY category_scope ASC, sort_order ASC, id ASC
	`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	type categoryRow struct {
		Scope       string
		Value       string
		Label       string
		ShortCode   string
		Description string
		Enabled     bool
		SortOrder   int64
	}
	byScope := map[string][]categoryRow{}
	for rows.Next() {
		var scope string
		var value string
		var label string
		var shortCode *string
		var description *string
		var enabled int64
		var sortOrder int64
		if err := rows.Scan(&scope, &value, &label, &shortCode, &description, &enabled, &sortOrder); err != nil {
			return nil, err
		}
		byScope[scope] = append(byScope[scope], categoryRow{
			Scope:       scope,
			Value:       value,
			Label:       label,
			ShortCode:   stringPtrValue(shortCode),
			Description: stringPtrValue(description),
			Enabled:     enabled != 0,
			SortOrder:   sortOrder,
		})
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}

	metas := []struct {
		Scope string
		Meta  categoryScopeMeta
	}{
		{Scope: "physical", Meta: categoryScopeMeta{DictionaryCode: "asset_physical_subtype", Name: "资产子类", Description: "维护实物资产子类和适用的实物细类。"}},
		{Scope: "resource", Meta: categoryScopeMeta{DictionaryCode: "asset_resource_subtype", Name: "资源子类", Description: "维护资源资产子类。"}},
		{Scope: "product", Meta: categoryScopeMeta{DictionaryCode: "product_line", Name: "产品线", Description: "维护产品资产的产品线分类。"}},
		{Scope: "ip", Meta: categoryScopeMeta{DictionaryCode: "ip_asset_type", Name: "资产类型", Description: "维护知识产权资产类型。"}},
		{Scope: "digital", Meta: categoryScopeMeta{DictionaryCode: "digital_asset_type", Name: "资产类型", Description: "维护数字资产类型。"}},
	}

	result := make([]dictionaryDefinition, 0, len(metas))
	for _, item := range metas {
		rows := byScope[item.Scope]
		if len(rows) == 0 {
			continue
		}
		options := make([]dictionaryOption, 0, len(rows))
		for _, row := range rows {
			options = append(options, dictionaryOption{
				Label:       row.Label,
				Value:       row.Value,
				ShortCode:   row.ShortCode,
				Description: row.Description,
				Enabled:     boolPtr(row.Enabled),
				SortOrder:   row.SortOrder,
			})
		}
		result = append(result, dictionaryDefinition{
			Code:        item.Meta.DictionaryCode,
			Name:        item.Meta.Name,
			Description: item.Meta.Description,
			Options:     options,
		})
	}
	return result, nil
}

func ListProductDictionariesInTransaction(ctx context.Context, tx *sql.Tx, registeredTable string) (any, error) {
	if !regexp.MustCompile("^`[A-Za-z_][A-Za-z0-9_]{0,63}`$").MatchString(registeredTable) {
		return nil, httperror.New(503, "assets_dictionary_mapping_invalid", "Dictionary mapping unavailable")
	}
	return (productMasterReader{tx: tx, dictionaryTable: registeredTable}).listDictionaries(ctx)
}
func (a productMasterReader) dictionaryTableName() string {
	if a.dictionaryTable != "" {
		return a.dictionaryTable
	}
	return "`system_parameters`"
}

func productMasterPageBounds(query url.Values) (int, int, error) {
	page, size := 1, 20
	for key, target := range map[string]*int{"page": &page, "pageSize": &size} {
		if raw := query.Get(key); raw != "" {
			value, err := strconv.Atoi(raw)
			if err != nil || value < 1 || (key == "pageSize" && value > 100) || (key == "page" && value > 1000000) {
				return 0, 0, httperror.New(400, "invalid_product_pagination", "产品分页参数无效")
			}
			*target = value
		}
	}
	return page, size, nil
}

func validateProductMasterReadScope(query url.Values) error {
	access, _, err := assetsObjectAccess(query)
	if err != nil {
		return err
	}
	if access != "all" {
		_, err = assetsScopeUnits(query)
		if err != nil {
			return err
		}
	}
	return nil
}
