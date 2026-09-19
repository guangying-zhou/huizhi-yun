package assets

import (
	"context"
	"database/sql"
	"github.com/huizhi-yun/data-runtime/internal/httperror"
	"net/http"
)

// SaveAssetCategoryInTransaction reuses the owning Assets validation and tables.
// The caller supplies admin authorization. Success does not commit; any error rolls back.
func SaveAssetCategoryInTransaction(ctx context.Context, tx *sql.Tx, scope string, id int64, body map[string]any, operatorUID string) (out map[string]any, err error) {
	if tx == nil {
		return nil, httperror.New(http.StatusServiceUnavailable, "asset_transaction_required", "资产事务不可用")
	}
	defer func() {
		if err != nil {
			_ = tx.Rollback()
		}
	}()
	scope, err = normalizeAssetCategoryScope(scope)
	if err != nil {
		return nil, err
	}
	return saveAssetCategoryInTransaction(ctx, tx, scope, id, body, operatorUID)
}
func saveAssetCategoryInTransaction(ctx context.Context, tx *sql.Tx, scope string, id int64, body map[string]any, operatorUID string) (map[string]any, error) {

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

	groupID, err := saveAssetCategoryRows(ctx, tx, scope, id, operatorUID, meta, label, value, shortCode, description, enabled, sortOrder, normalizedItems)
	if err != nil {
		return nil, err
	}
	categories, err := (productMasterReader{tx: tx}).listAssetCategories(ctx, scope, true)
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

func saveAssetCategoryRows(ctx context.Context, tx *sql.Tx, scope string, id int64, operatorUID string, meta assetCategoryScopeDef, label, value, shortCode, description string, enabled bool, sortOrder int64, normalizedItems []map[string]any) (int64, error) {
	var duplicateID int64
	err := tx.QueryRowContext(ctx, `
			SELECT id
			FROM asset_category_groups
			WHERE category_scope = ?
			  AND category_value = ?
			  AND (? = 0 OR id <> ?)
			LIMIT 1`, scope, value, id, id).Scan(&duplicateID)
	if err != nil && err != sql.ErrNoRows {
		return 0, err
	}
	if duplicateID != 0 {
		return 0, httperror.New(http.StatusBadRequest, "duplicate_category_value", meta.GroupLabel+"值已存在")
	}

	groupID := id
	if groupID > 0 {
		var existingID int64
		err := tx.QueryRowContext(ctx,
			`SELECT id FROM asset_category_groups WHERE id = ? AND category_scope = ?`,
			groupID, scope,
		).Scan(&existingID)
		if err == sql.ErrNoRows {
			return 0, notFound("资产类别不存在或作用域不匹配")
		}
		if err != nil {
			return 0, err
		}
		_, err = tx.ExecContext(ctx, `
				UPDATE asset_category_groups
				SET category_label = ?, category_value = ?, short_code = ?, description = ?, enabled = ?, sort_order = ?, updated_by = ?
				WHERE id = ? AND category_scope = ?`,
			label, value, nullableString(shortCode), nullableString(description), boolToInt(enabled), sortOrder, nullableString(operatorUID), groupID, scope,
		)
		if err != nil {
			return 0, err
		}
		if _, err := tx.ExecContext(ctx, `DELETE FROM asset_category_items WHERE group_id = ?`, groupID); err != nil {
			return 0, err
		}
	} else {
		insert, err := tx.ExecContext(ctx, `
				INSERT INTO asset_category_groups (
					category_scope, category_value, category_label, short_code, description, enabled, sort_order, created_by, updated_by
				) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
			scope, value, label, nullableString(shortCode), nullableString(description), boolToInt(enabled), sortOrder, nullableString(operatorUID), nullableString(operatorUID),
		)
		if err != nil {
			return 0, err
		}
		groupID, err = insert.LastInsertId()
		if err != nil {
			return 0, err
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
			return 0, err
		}
	}
	return groupID, nil
}
