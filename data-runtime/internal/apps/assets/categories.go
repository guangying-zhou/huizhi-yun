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
	tx, err := a.DB().BeginTx(ctx, &sql.TxOptions{Isolation: sql.LevelRepeatableRead, ReadOnly: true})
	if err != nil {
		return nil, err
	}
	defer tx.Rollback()
	result, err := (productMasterReader{tx: tx}).listAssetCategories(ctx, scope, includeDisabled)
	if err != nil {
		return nil, err
	}
	if err := tx.Commit(); err != nil {
		return nil, err
	}
	return result, nil
}

func (a *Adapter) saveAssetCategory(ctx context.Context, scope string, id int64, body map[string]any, operatorUID string) (map[string]any, error) {
	tx, err := a.DB().BeginTx(ctx, nil)
	if err != nil {
		return nil, err
	}
	defer tx.Rollback()
	result, err := SaveAssetCategoryInTransaction(ctx, tx, scope, id, body, operatorUID)
	if err != nil {
		return nil, err
	}
	if err = tx.Commit(); err != nil {
		return nil, err
	}
	return result, nil
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
