package assets

import (
	"context"
	"encoding/json"
	"net/http"
	"net/url"
	"strings"

	"github.com/huizhi-yun/data-runtime/internal/apps/compat"
	"github.com/huizhi-yun/data-runtime/internal/config"
	"github.com/huizhi-yun/data-runtime/internal/httperror"
)

type Adapter struct {
	*compat.Adapter
}

type dictionaryOption struct {
	Label       string `json:"label"`
	Value       string `json:"value"`
	Description string `json:"description,omitempty"`
	Enabled     *bool  `json:"enabled,omitempty"`
	SortOrder   int64  `json:"sortOrder"`
	ShortCode   string `json:"shortCode,omitempty"`
}

type dictionaryDefinition struct {
	Code        string             `json:"code"`
	Name        string             `json:"name"`
	Description string             `json:"description"`
	Options     []dictionaryOption `json:"options"`
}

type categoryScopeMeta struct {
	DictionaryCode string
	Name           string
	Description    string
}

var requiredTables = []string{
	"system_parameters",
	"asset_category_groups",
	"asset_category_items",
	"asset_items",
	"asset_environments",
	"product_assets",
	"technology_bases",
	"ip_assets",
	"digital_assets",
	"asset_delivery_views",
	"customer_delivery_assets",
	"customer_delivery_asset_environment_rel",
	"suppliers",
	"purchase_orders",
	"asset_receipts",
	"asset_assignments",
	"asset_alerts",
}

func New(cfg config.AssetsConfig) (*Adapter, error) {
	adapter, err := compat.New(compat.Config{
		AppCode:        "assets",
		DB:             cfg.DB,
		ResponseMode:   compat.ResponseCodeMessageData,
		RequiredTables: requiredTables,
		DashboardCounts: []compat.DashboardCount{
			{Key: "total_assets", Label: "资产总数", Table: "asset_items", Where: "archived_at IS NULL"},
			{Key: "active_environments", Label: "活跃环境", Table: "asset_environments", Where: "status = 'active'"},
			{Key: "pending_alerts", Label: "待处理预警", Table: "asset_alerts", Where: "status = 'pending'"},
			{Key: "purchase_orders", Label: "采购单", Table: "purchase_orders"},
		},
		Resources: []compat.ResourceSpec{
			{
				Path:             "assets",
				Table:            "asset_items",
				CodeColumn:       "asset_code",
				CodePrefix:       "AST",
				SearchColumns:    []string{"asset_code", "asset_name", "asset_subtype", "project_code", "customer_code", "contract_code", "owner_uid", "user_uid"},
				DefaultOrderBy:   "`id` DESC",
				SoftDeleteColumn: "archived_at",
			},
			{Path: "asset-categories", Table: "asset_category_items", SearchColumns: []string{"item_value", "item_label", "short_code"}, DefaultOrderBy: "`sort_order` ASC, `id` ASC", ReadOnly: true},
			{Path: "admin/asset-categories", Table: "asset_category_items", SearchColumns: []string{"item_value", "item_label", "short_code"}, DefaultOrderBy: "`sort_order` ASC, `id` ASC"},
			{Path: "environments", Table: "asset_environments", CodeColumn: "environment_code", CodePrefix: "ENV", SearchColumns: []string{"environment_code", "environment_name", "project_code", "customer_code", "contract_code", "owner_uid"}, DefaultOrderBy: "`id` DESC"},
			{Path: "products", Table: "product_assets", CodeColumn: "product_code", CodePrefix: "PROD", SearchColumns: []string{"product_code", "product_name", "product_line", "customer_domain", "business_domain", "project_code"}, DefaultOrderBy: "`id` DESC"},
			{Path: "technology-bases", Table: "technology_bases", SearchColumns: []string{"base_code", "base_name", "technology_domain"}, DefaultOrderBy: "`id` DESC"},
			{Path: "ip-assets", Table: "ip_assets", SearchColumns: []string{"ip_code", "ip_name", "ip_type", "owner_uid"}, DefaultOrderBy: "`id` DESC"},
			{Path: "digital-assets", Table: "digital_assets", SearchColumns: []string{"digital_code", "digital_name", "digital_type", "owner_uid"}, DefaultOrderBy: "`id` DESC"},
			{Path: "deliveries", Table: "asset_delivery_views", CodeColumn: "delivery_code", CodePrefix: "DEL", SearchColumns: []string{"delivery_code", "delivery_name", "customer_code", "contract_code", "project_code", "owner_uid"}, DefaultOrderBy: "`id` DESC"},
			{Path: "customer-delivery-assets", Table: "customer_delivery_assets", CodeColumn: "delivery_asset_code", CodePrefix: "CDA", SearchColumns: []string{"delivery_asset_code", "customer_code", "contract_code", "project_code", "product_code", "product_name", "status"}, DefaultOrderBy: "`updated_at` DESC, `id` DESC", SoftDeleteColumn: "deleted_at"},
			{Path: "suppliers", Table: "suppliers", CodeColumn: "supplier_code", CodePrefix: "SUP", SearchColumns: []string{"supplier_code", "supplier_name", "credit_code", "contact_name"}, DefaultOrderBy: "`id` DESC"},
			{Path: "purchase-orders", Table: "purchase_orders", CodeColumn: "order_no", CodePrefix: "PO", SearchColumns: []string{"order_no", "applicant_uid", "project_code", "customer_code", "contract_code"}, DefaultOrderBy: "`id` DESC"},
			{Path: "receipts", Table: "asset_receipts", CodeColumn: "receipt_no", CodePrefix: "RCPT", SearchColumns: []string{"receipt_no", "operator_uid"}, DefaultOrderBy: "`id` DESC"},
			{Path: "assignments", Table: "asset_assignments", CodeColumn: "assignment_no", CodePrefix: "ASN", SearchColumns: []string{"assignment_no", "target_ref", "requested_by"}, DefaultOrderBy: "`id` DESC"},
			{Path: "alerts", Table: "asset_alerts", CodeColumn: "alert_no", CodePrefix: "ALR", SearchColumns: []string{"alert_no", "title", "project_code", "handled_by"}, DefaultOrderBy: "`id` DESC"},
			{Path: "assets/{asset_id}/events", Table: "asset_events", PathParamColumns: map[string]string{"asset_id": "asset_id"}, SearchColumns: []string{"event_type", "operator_uid"}, DefaultOrderBy: "`id` DESC", ReadOnly: true},
		},
	})
	if err != nil {
		return nil, err
	}
	return &Adapter{Adapter: adapter}, nil
}

func (a *Adapter) HandleRuntime(ctx context.Context, method string, path string, query url.Values, body map[string]any) (any, string, error) {
	if result, operation, handled, err := a.handleCustomRuntime(ctx, method, path, query, body); handled {
		return result, operation, err
	}

	if method == http.MethodGet && path == "/v1/assets/dictionaries" {
		items, err := a.listDictionaries(ctx)
		return ok(map[string]any{"items": items}), "assets.dictionaries.list", err
	}
	if method == http.MethodPut && strings.HasPrefix(path, "/v1/assets/admin/dictionaries/") {
		code := strings.TrimSpace(strings.TrimPrefix(path, "/v1/assets/admin/dictionaries/"))
		if code == "" || strings.Contains(code, "/") {
			return nil, "", httperror.New(http.StatusNotFound, "not_found", "Route not found")
		}
		item, err := a.updateDictionary(ctx, code, body)
		return ok(item), "assets.dictionaries.update", err
	}
	return a.Adapter.HandleRuntime(ctx, method, path, query, body)
}

func (a *Adapter) listDictionaries(ctx context.Context) ([]dictionaryDefinition, error) {
	rows, err := a.DB().QueryContext(ctx, `
		SELECT param_key, param_value
		FROM system_parameters
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

func (a *Adapter) managedCategoryDictionaries(ctx context.Context) ([]dictionaryDefinition, error) {
	rows, err := a.DB().QueryContext(ctx, `
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

func (a *Adapter) updateDictionary(ctx context.Context, code string, body map[string]any) (dictionaryDefinition, error) {
	if isManagedDictionary(code) {
		return dictionaryDefinition{}, httperror.New(http.StatusBadRequest, "managed_dictionary", "Please maintain this dictionary in asset category management")
	}

	item := dictionaryDefinition{
		Code:        code,
		Name:        strings.TrimSpace(stringFromBody(body, "name")),
		Description: strings.TrimSpace(stringFromBody(body, "description")),
		Options:     optionsFromBody(body),
	}
	if item.Name == "" {
		item.Name = code
	}
	if len(item.Options) == 0 {
		return dictionaryDefinition{}, httperror.New(http.StatusBadRequest, "empty_dictionary_options", "Dictionary options cannot be empty")
	}

	content, err := json.Marshal(item)
	if err != nil {
		return dictionaryDefinition{}, err
	}
	_, err = a.DB().ExecContext(ctx, `
		INSERT INTO system_parameters (param_key, param_value)
		VALUES (?, ?)
		ON DUPLICATE KEY UPDATE param_value = VALUES(param_value)
	`, "dictionary."+code, string(content))
	return item, err
}

func ok(data any) map[string]any {
	return map[string]any{"code": 0, "message": "ok", "data": data}
}

func stringPtrValue(value *string) string {
	if value == nil {
		return ""
	}
	return *value
}

func stringFromBody(body map[string]any, key string) string {
	if body == nil {
		return ""
	}
	value, ok := body[key]
	if !ok || value == nil {
		return ""
	}
	return strings.TrimSpace(stringFromAny(value))
}

func optionsFromBody(body map[string]any) []dictionaryOption {
	raw, ok := body["options"].([]any)
	if !ok {
		return nil
	}
	options := make([]dictionaryOption, 0, len(raw))
	for index, item := range raw {
		object, ok := item.(map[string]any)
		if !ok {
			continue
		}
		label := strings.TrimSpace(stringFromAny(object["label"]))
		value := strings.TrimSpace(stringFromAny(object["value"]))
		if label == "" || value == "" {
			continue
		}
		options = append(options, dictionaryOption{
			Label:       label,
			Value:       value,
			Description: strings.TrimSpace(stringFromAny(object["description"])),
			Enabled:     boolPtrFromAny(object["enabled"], true),
			SortOrder:   int64FromAny(object["sortOrder"], int64(index+1)),
		})
	}
	return options
}

func boolPtr(value bool) *bool {
	return &value
}

func boolPtrFromAny(value any, fallback bool) *bool {
	if typed, ok := value.(bool); ok {
		return boolPtr(typed)
	}
	return boolPtr(fallback)
}

func stringFromAny(value any) string {
	if text, ok := value.(string); ok {
		return text
	}
	return ""
}

func int64FromAny(value any, fallback int64) int64 {
	switch typed := value.(type) {
	case int64:
		return typed
	case int:
		return int64(typed)
	case float64:
		return int64(typed)
	default:
		return fallback
	}
}

func isManagedDictionary(code string) bool {
	switch code {
	case "asset_physical_subtype", "asset_resource_subtype", "product_line", "ip_asset_type", "digital_asset_type":
		return true
	default:
		return false
	}
}
