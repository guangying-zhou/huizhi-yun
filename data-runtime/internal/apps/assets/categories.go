package assets

import (
	"context"
	"database/sql"
	"net/http"
	"strings"

	"github.com/huizhi-yun/data-runtime/internal/httperror"
)

type assetCategoryScopeDef struct {
	DictionaryCode string
	Name           string
	Description    string
	GroupLabel     string
	ItemLabel      string
	ItemsSupported bool
}

var assetCategoryScopes = map[string]assetCategoryScopeDef{
	"physical": {DictionaryCode: "asset_physical_subtype", Name: "资产子类", Description: "维护实物资产子类和适用的实物细类。", GroupLabel: "资产子类", ItemLabel: "资产细类", ItemsSupported: true},
	"resource": {DictionaryCode: "asset_resource_subtype", Name: "资源子类", Description: "维护资源资产子类。", GroupLabel: "资源子类", ItemLabel: "细类", ItemsSupported: false},
	"product":  {DictionaryCode: "product_line", Name: "产品线", Description: "维护产品资产的产品线分类。", GroupLabel: "产品线", ItemLabel: "细类", ItemsSupported: false},
	"ip":       {DictionaryCode: "ip_asset_type", Name: "资产类型", Description: "维护知识产权资产类型。", GroupLabel: "资产类型", ItemLabel: "细类", ItemsSupported: false},
	"digital":  {DictionaryCode: "digital_asset_type", Name: "资产类型", Description: "维护数字资产类型。", GroupLabel: "资产类型", ItemLabel: "细类", ItemsSupported: false},
}

func normalizeAssetCategoryScope(input string) (string, error) {
	scope := strings.TrimSpace(input)
	if scope == "" {
		scope = "physical"
	}
	if _, ok := assetCategoryScopes[scope]; !ok {
		return "", httperror.New(http.StatusBadRequest, "invalid_scope", "不支持的资产类别作用域")
	}
	return scope, nil
}

func normalizeShortCode(input string) string {
	builder := strings.Builder{}
	for _, r := range input {
		if (r >= 'a' && r <= 'z') || (r >= 'A' && r <= 'Z') || (r >= '0' && r <= '9') {
			builder.WriteRune(r)
		}
		if builder.Len() >= 8 {
			break
		}
	}
	return strings.ToUpper(builder.String())
}

func (a *Adapter) listAssetCategories(ctx context.Context, scope string, includeDisabled bool) ([]map[string]any, error) {
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

func (a *Adapter) saveAssetCategory(ctx context.Context, scope string, id int64, body map[string]any, operatorUID string) (map[string]any, error) {
	meta := assetCategoryScopes[scope]
	label := bodyText(body, "label")
	value := bodyText(body, "value")
	shortCode := normalizeShortCode(bodyText(body, "shortCode"))
	description := bodyText(body, "description")
	enabled := true
	if raw, ok := body["enabled"]; ok {
		enabled = asInt(boolIntFromAny(raw)) != 0
	}
	sortOrder := int64FromAny(body["sortOrder"], 0)

	if label == "" || value == "" {
		return nil, httperror.New(http.StatusBadRequest, "invalid_category", meta.GroupLabel+"的名称和值不能为空")
	}

	rawItems, _ := body["items"].([]any)
	normalizedItems := make([]map[string]any, 0, len(rawItems))
	for index, raw := range rawItems {
		item, ok := raw.(map[string]any)
		if !ok {
			continue
		}
		itemLabel := bodyText(item, "label")
		itemValue := bodyText(item, "value")
		if itemLabel == "" || itemValue == "" {
			continue
		}
		itemEnabled := true
		if rawEnabled, ok := item["enabled"]; ok {
			itemEnabled = asInt(boolIntFromAny(rawEnabled)) != 0
		}
		itemSortOrder := int64FromAny(item["sortOrder"], 0)
		if itemSortOrder == 0 {
			itemSortOrder = int64(index + 1)
		}
		normalizedItems = append(normalizedItems, map[string]any{
			"label":       itemLabel,
			"value":       itemValue,
			"shortCode":   normalizeShortCode(bodyText(item, "shortCode")),
			"description": bodyText(item, "description"),
			"enabled":     itemEnabled,
			"sortOrder":   itemSortOrder,
		})
	}
	if meta.ItemsSupported && len(normalizedItems) == 0 {
		return nil, httperror.New(http.StatusBadRequest, "invalid_category_items", "至少保留一个"+meta.ItemLabel)
	}

	result, err := a.withTx(ctx, func(tx *sql.Tx) (any, error) {
		var duplicateID int64
		err := tx.QueryRowContext(ctx, `
			SELECT id
			FROM asset_category_groups
			WHERE category_scope = ?
			  AND category_value = ?
			  AND (? = 0 OR id <> ?)
			LIMIT 1`, scope, value, id, id).Scan(&duplicateID)
		if err != nil && err != sql.ErrNoRows {
			return nil, err
		}
		if duplicateID != 0 {
			return nil, httperror.New(http.StatusBadRequest, "duplicate_category_value", meta.GroupLabel+"值已存在")
		}

		groupID := id
		if groupID > 0 {
			var existingID int64
			err := tx.QueryRowContext(ctx,
				`SELECT id FROM asset_category_groups WHERE id = ? AND category_scope = ?`,
				groupID, scope,
			).Scan(&existingID)
			if err == sql.ErrNoRows {
				return nil, notFound("资产类别不存在或作用域不匹配")
			}
			if err != nil {
				return nil, err
			}
			_, err = tx.ExecContext(ctx, `
				UPDATE asset_category_groups
				SET category_label = ?, category_value = ?, short_code = ?, description = ?, enabled = ?, sort_order = ?, updated_by = ?
				WHERE id = ? AND category_scope = ?`,
				label, value, nullableString(shortCode), nullableString(description), boolToInt(enabled), sortOrder, nullableString(operatorUID), groupID, scope,
			)
			if err != nil {
				return nil, err
			}
			if _, err := tx.ExecContext(ctx, `DELETE FROM asset_category_items WHERE group_id = ?`, groupID); err != nil {
				return nil, err
			}
		} else {
			insert, err := tx.ExecContext(ctx, `
				INSERT INTO asset_category_groups (
					category_scope, category_value, category_label, short_code, description, enabled, sort_order, created_by, updated_by
				) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
				scope, value, label, nullableString(shortCode), nullableString(description), boolToInt(enabled), sortOrder, nullableString(operatorUID), nullableString(operatorUID),
			)
			if err != nil {
				return nil, err
			}
			groupID, err = insert.LastInsertId()
			if err != nil {
				return nil, err
			}
		}

		for _, item := range normalizedItems {
			_, err := tx.ExecContext(ctx, `
				INSERT INTO asset_category_items (
					group_id, item_value, item_label, short_code, description, enabled, sort_order, created_by, updated_by
				) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
				groupID,
				item["value"],
				item["label"],
				nullableString(cleanAnyString(item["shortCode"])),
				nullableString(cleanAnyString(item["description"])),
				boolToInt(item["enabled"] == true),
				item["sortOrder"],
				nullableString(operatorUID),
				nullableString(operatorUID),
			)
			if err != nil {
				return nil, err
			}
		}
		return groupID, nil
	})
	if err != nil {
		return nil, err
	}

	groupID := result.(int64)
	categories, err := a.listAssetCategories(ctx, scope, true)
	if err != nil {
		return nil, err
	}
	for _, category := range categories {
		if asInt(category["id"]) == groupID {
			return category, nil
		}
	}
	return nil, nil
}

func boolToInt(value bool) int64 {
	if value {
		return 1
	}
	return 0
}

func (a *Adapter) assetCategoryScopeByID(ctx context.Context, id int64) (string, error) {
	row, err := a.queryRowMap(ctx, `SELECT category_scope FROM asset_category_groups WHERE id = ?`, id)
	if err != nil {
		return "", err
	}
	if row == nil {
		return "", notFound("资产类别不存在")
	}
	return normalizeAssetCategoryScope(cleanAnyString(row["category_scope"]))
}

func (a *Adapter) getPhysicalAssetCodeTokens(ctx context.Context, subtype string, itemType string) (string, string, error) {
	row, err := a.queryRowMap(ctx, `
		SELECT id, short_code
		FROM asset_category_groups
		WHERE category_scope = 'physical' AND category_value = ?
		LIMIT 1`, subtype)
	if err != nil || row == nil {
		return "", "", err
	}
	subtypeToken := normalizeShortCode(cleanAnyString(row["short_code"]))
	item, err := a.queryRowMap(ctx, `
		SELECT short_code
		FROM asset_category_items
		WHERE group_id = ? AND item_value = ?
		LIMIT 1`, row["id"], itemType)
	if err != nil || item == nil {
		return subtypeToken, "", err
	}
	return subtypeToken, normalizeShortCode(cleanAnyString(item["short_code"])), nil
}
