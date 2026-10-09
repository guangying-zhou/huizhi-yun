package workflow

import (
	"context"
	"net/http"
	"net/url"
	"strings"

	"github.com/huizhi-yun/data-runtime/internal/httperror"
)

// handleAdminRuntime owns the isolated /v1/workflow/admin/** configuration
// surface. Instance/task processing and its transaction boundaries remain in runtime.go.
func (a *Adapter) handleAdminRuntime(ctx context.Context, method string, path string, query url.Values, rawBody map[string]any) (InstanceAPIResponse, string, error) {
	switch {
	case method == http.MethodGet && path == "/v1/workflow/admin/action-defs":
		return a.adminListActionDefs(ctx, query)
	case method == http.MethodPost && path == "/v1/workflow/admin/action-defs":
		return a.adminCreateActionDef(ctx, rawBody)
	case method == http.MethodPatch && strings.HasPrefix(path, "/v1/workflow/admin/action-defs/"):
		return a.adminUpdateActionDef(ctx, pathID(path, "/v1/workflow/admin/action-defs/"), rawBody)
	case method == http.MethodDelete && strings.HasPrefix(path, "/v1/workflow/admin/action-defs/"):
		return a.adminDelete(ctx, "flow_action_defs", pathID(path, "/v1/workflow/admin/action-defs/"), "动作定义不存在或已禁用", "workflow.admin.action_defs.delete")
	case method == http.MethodGet && path == "/v1/workflow/admin/flow-schemas":
		return a.adminListFlowSchemas(ctx, query)
	case method == http.MethodPost && path == "/v1/workflow/admin/flow-schemas":
		return a.adminCreateFlowSchema(ctx, rawBody)
	case method == http.MethodGet && path == "/v1/workflow/admin/flow-schemas/templates":
		return a.adminFlowSchemaTemplates(ctx)
	case method == http.MethodGet && strings.HasPrefix(path, "/v1/workflow/admin/flow-schemas/"):
		return a.adminGetJSONSchema(ctx, "flow_schemas", pathID(path, "/v1/workflow/admin/flow-schemas/"), []string{"nodes", "config"}, "流程定义不存在", "workflow.admin.flow_schemas.detail")
	case method == http.MethodPatch && strings.HasPrefix(path, "/v1/workflow/admin/flow-schemas/"):
		return a.adminUpdateFlowSchema(ctx, pathID(path, "/v1/workflow/admin/flow-schemas/"), rawBody)
	case method == http.MethodDelete && strings.HasPrefix(path, "/v1/workflow/admin/flow-schemas/"):
		return a.adminDelete(ctx, "flow_schemas", pathID(path, "/v1/workflow/admin/flow-schemas/"), "流程定义不存在或已禁用", "workflow.admin.flow_schemas.delete")
	case method == http.MethodGet && path == "/v1/workflow/admin/form-schemas":
		return a.adminListFormSchemas(ctx, query)
	case method == http.MethodPost && path == "/v1/workflow/admin/form-schemas":
		return a.adminCreateFormSchema(ctx, rawBody)
	case method == http.MethodGet && strings.HasPrefix(path, "/v1/workflow/admin/form-schemas/"):
		return a.adminGetJSONSchema(ctx, "form_schemas", pathID(path, "/v1/workflow/admin/form-schemas/"), []string{"fields"}, "表单定义不存在", "workflow.admin.form_schemas.detail")
	case method == http.MethodPatch && strings.HasPrefix(path, "/v1/workflow/admin/form-schemas/"):
		return a.adminUpdateFormSchema(ctx, pathID(path, "/v1/workflow/admin/form-schemas/"), rawBody)
	case method == http.MethodDelete && strings.HasPrefix(path, "/v1/workflow/admin/form-schemas/"):
		return a.adminDelete(ctx, "form_schemas", pathID(path, "/v1/workflow/admin/form-schemas/"), "表单定义不存在或已禁用", "workflow.admin.form_schemas.delete")
	case method == http.MethodGet && path == "/v1/workflow/admin/routes":
		return a.adminListRoutes(ctx, query)
	case method == http.MethodPost && path == "/v1/workflow/admin/routes":
		return a.adminCreateRoute(ctx, rawBody)
	case method == http.MethodPatch && strings.HasPrefix(path, "/v1/workflow/admin/routes/"):
		return a.adminUpdateRoute(ctx, pathID(path, "/v1/workflow/admin/routes/"), rawBody)
	case method == http.MethodDelete && strings.HasPrefix(path, "/v1/workflow/admin/routes/"):
		return a.adminDelete(ctx, "flow_routes", pathID(path, "/v1/workflow/admin/routes/"), "路由规则不存在或已禁用", "workflow.admin.routes.delete")
	default:
		return InstanceAPIResponse{}, "", httperror.New(http.StatusNotFound, "not_found", "Route not found")
	}
}

func (a *Adapter) adminListActionDefs(ctx context.Context, query url.Values) (InstanceAPIResponse, string, error) {
	page := workflowPageParams(query, 20)
	where, args := filteredWhere(query, map[string]string{"resource_code": "a.resource_code"}, []string{"a.action_code", "a.name"})
	var total int64
	if err := a.db.QueryRowContext(ctx, "SELECT COUNT(*) AS total FROM flow_action_defs a "+where, args...).Scan(&total); err != nil {
		return InstanceAPIResponse{}, "", err
	}
	rows, err := queryMaps(ctx, a.db, `
		SELECT a.*, f.code AS form_code, f.name AS form_name,
		       fs.name AS flow_schema_name
		FROM flow_action_defs a
		LEFT JOIN form_schemas f ON a.form_schema_id = f.id
		LEFT JOIN flow_routes fr ON fr.action_def_id = a.id AND fr.is_default = 1 AND fr.status = 1
		LEFT JOIN flow_schemas fs ON fr.flow_schema_id = fs.id
		`+where+`
		ORDER BY a.app_code ASC, a.resource_code ASC, a.sort_order ASC, a.id ASC
		LIMIT ? OFFSET ?
	`, append(args, page.pageSize, page.offset)...)
	if err != nil {
		return InstanceAPIResponse{}, "", err
	}
	items := make([]map[string]any, 0, len(rows))
	for _, row := range rows {
		item := map[string]any{
			"id":                row["id"],
			"app_code":          row["app_code"],
			"resource_code":     row["resource_code"],
			"action_code":       row["action_code"],
			"name":              row["name"],
			"description":       row["description"],
			"form_schema_id":    row["form_schema_id"],
			"form_schema":       nil,
			"flow_schema_name":  row["flow_schema_name"],
			"embed_url_pattern": row["embed_url_pattern"],
			"icon":              row["icon"],
			"sort_order":        row["sort_order"],
			"source":            firstNonEmptyString(cleanAnyString(row["source"]), "manual"),
			"status":            row["status"],
			"created_by":        row["created_by"],
			"created_at":        row["created_at"],
			"updated_at":        row["updated_at"],
		}
		if row["form_schema_id"] != nil {
			item["form_schema"] = map[string]any{"id": row["form_schema_id"], "code": row["form_code"], "name": row["form_name"]}
		}
		items = append(items, item)
	}
	return pagedAdminResponse(items, total, page), "workflow.admin.action_defs.list", nil
}

func (a *Adapter) adminCreateActionDef(ctx context.Context, body map[string]any) (InstanceAPIResponse, string, error) {
	currentUser := cleanAnyString(body["current_user"])
	appCode := cleanAnyString(body["app_code"])
	resourceCode := cleanAnyString(body["resource_code"])
	actionCode := cleanAnyString(body["action_code"])
	name := cleanAnyString(body["name"])
	if currentUser == "" {
		return InstanceAPIResponse{}, "", httperror.New(http.StatusUnauthorized, "missing_current_user", "未登录")
	}
	if appCode == "" || resourceCode == "" || actionCode == "" || name == "" {
		return InstanceAPIResponse{}, "", httperror.New(http.StatusBadRequest, "field_required", "app_code, resource_code, action_code, name 必填")
	}
	if exists, err := existsByQuery(ctx, a.db, "SELECT id FROM flow_action_defs WHERE app_code = ? AND resource_code = ? AND action_code = ?", appCode, resourceCode, actionCode); err != nil {
		return InstanceAPIResponse{}, "", err
	} else if exists {
		return InstanceAPIResponse{}, "", httperror.New(http.StatusBadRequest, "duplicate_action_code", "该应用资源下的动作编码已存在")
	}
	result, err := a.db.ExecContext(ctx, `
		INSERT INTO flow_action_defs
		  (app_code, resource_code, action_code, name, description, form_schema_id, icon, sort_order, status, created_by, created_at, updated_at)
		VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, ?, NOW(), NOW())
	`, appCode, resourceCode, actionCode, name, nilIfEmpty(cleanAnyString(body["description"])), nullableNumber(body["form_schema_id"]), nilIfEmpty(cleanAnyString(body["icon"])), intValue(body["sort_order"]), currentUser)
	if err != nil {
		return InstanceAPIResponse{}, "", err
	}
	id, _ := result.LastInsertId()
	return InstanceAPIResponse{Code: 0, Data: map[string]any{"id": id, "resource_code": resourceCode, "action_code": actionCode, "name": name}}, "workflow.admin.action_defs.create", nil
}

func (a *Adapter) adminUpdateActionDef(ctx context.Context, id string, body map[string]any) (InstanceAPIResponse, string, error) {
	current, err := queryOneMap(ctx, a.db, "SELECT id, app_code, resource_code, action_code FROM flow_action_defs WHERE id = ?", id)
	if err != nil {
		return InstanceAPIResponse{}, "", err
	}
	if current == nil {
		return InstanceAPIResponse{}, "", httperror.New(http.StatusNotFound, "action_def_not_found", "动作定义不存在")
	}
	checkApp := bodyValue(body, "app_code", current["app_code"])
	checkResource := bodyValue(body, "resource_code", current["resource_code"])
	checkAction := bodyValue(body, "action_code", current["action_code"])
	if _, ok := body["app_code"]; ok || body["resource_code"] != nil || body["action_code"] != nil {
		if exists, err := existsByQuery(ctx, a.db, "SELECT id FROM flow_action_defs WHERE app_code = ? AND resource_code = ? AND action_code = ? AND id != ?", checkApp, checkResource, checkAction, id); err != nil {
			return InstanceAPIResponse{}, "", err
		} else if exists {
			return InstanceAPIResponse{}, "", httperror.New(http.StatusBadRequest, "duplicate_action_code", "该应用资源下的动作编码已存在")
		}
	}
	sets := []string{}
	args := []any{}
	addSet := func(key string, column string, transform func(any) any) {
		if value, ok := body[key]; ok {
			sets = append(sets, column+" = ?")
			args = append(args, transform(value))
		}
	}
	addSet("app_code", "app_code", identity)
	addSet("resource_code", "resource_code", identity)
	addSet("action_code", "action_code", identity)
	addSet("name", "name", identity)
	addSet("description", "description", identity)
	addSet("form_schema_id", "form_schema_id", identity)
	addSet("icon", "icon", identity)
	addSet("sort_order", "sort_order", identity)
	addSet("status", "status", identity)
	if len(sets) == 0 {
		return InstanceAPIResponse{}, "", httperror.New(http.StatusBadRequest, "empty_update", "没有需要更新的字段")
	}
	sets = append(sets, "updated_at = NOW()")
	args = append(args, id)
	if _, err := a.db.ExecContext(ctx, "UPDATE flow_action_defs SET "+strings.Join(sets, ", ")+" WHERE id = ?", args...); err != nil {
		return InstanceAPIResponse{}, "", err
	}
	return InstanceAPIResponse{Code: 0, Data: map[string]any{"id": parseInt64Fallback(id)}}, "workflow.admin.action_defs.update", nil
}

func (a *Adapter) adminListFlowSchemas(ctx context.Context, query url.Values) (InstanceAPIResponse, string, error) {
	page := workflowPageParams(query, 20)
	whereParts := []string{}
	args := []any{}
	if search := strings.TrimSpace(query.Get("search")); search != "" {
		whereParts = append(whereParts, "(code LIKE ? OR name LIKE ?)")
		args = append(args, like(search), like(search))
	}
	if status := strings.TrimSpace(query.Get("status")); status != "" {
		whereParts = append(whereParts, "status = ?")
		args = append(args, status)
	}
	if isTemplate := strings.TrimSpace(query.Get("is_template")); isTemplate != "" {
		whereParts = append(whereParts, "is_template = ?")
		args = append(args, isTemplate)
	}
	whereSQL := whereSQL(whereParts)
	var total int64
	if err := a.db.QueryRowContext(ctx, "SELECT COUNT(*) AS total FROM flow_schemas "+whereSQL, args...).Scan(&total); err != nil {
		return InstanceAPIResponse{}, "", err
	}
	rows, err := queryMaps(ctx, a.db, `
		SELECT id, code, name, description, version, status, is_template, created_by, created_at, updated_at
		FROM flow_schemas `+whereSQL+`
		ORDER BY is_template DESC, id DESC
		LIMIT ? OFFSET ?
	`, append(args, page.pageSize, page.offset)...)
	if err != nil {
		return InstanceAPIResponse{}, "", err
	}
	return pagedAdminResponse(rows, total, page), "workflow.admin.flow_schemas.list", nil
}

func (a *Adapter) adminCreateFlowSchema(ctx context.Context, body map[string]any) (InstanceAPIResponse, string, error) {
	currentUser := cleanAnyString(body["current_user"])
	code := cleanAnyString(body["code"])
	name := cleanAnyString(body["name"])
	if currentUser == "" {
		return InstanceAPIResponse{}, "", httperror.New(http.StatusUnauthorized, "missing_current_user", "未登录")
	}
	if code == "" || name == "" {
		return InstanceAPIResponse{}, "", httperror.New(http.StatusBadRequest, "field_required", "code, name 必填")
	}
	if exists, err := existsByQuery(ctx, a.db, "SELECT id FROM flow_schemas WHERE code = ?", code); err != nil {
		return InstanceAPIResponse{}, "", err
	} else if exists {
		return InstanceAPIResponse{}, "", httperror.New(http.StatusBadRequest, "duplicate_flow_code", "流程编码已存在")
	}
	nodes := body["nodes"]
	config := body["config"]
	fromTemplate := nullableNumber(body["template_id"])
	if fromTemplate != nil {
		template, err := queryOneMap(ctx, a.db, "SELECT id, nodes, config FROM flow_schemas WHERE id = ? AND is_template = 1 AND status = 1", fromTemplate)
		if err != nil {
			return InstanceAPIResponse{}, "", err
		}
		if template == nil {
			return InstanceAPIResponse{}, "", httperror.New(http.StatusNotFound, "template_not_found", "模板不存在或已禁用")
		}
		if nodes == nil {
			nodes, _ = parseAnyJSON(template["nodes"])
		}
		if config == nil {
			config, _ = parseAnyJSON(template["config"])
		}
	}
	if nodes == nil {
		return InstanceAPIResponse{}, "", httperror.New(http.StatusBadRequest, "nodes_required", "nodes 必填（或指定 template_id）")
	}
	if config == nil {
		config = map[string]any{}
	}
	result, err := a.db.ExecContext(ctx, `
		INSERT INTO flow_schemas (code, name, description, nodes, config, version, status, is_template, created_by, created_at, updated_at)
		VALUES (?, ?, ?, ?, ?, 1, 1, ?, ?, NOW(), NOW())
	`, code, name, nilIfEmpty(cleanAnyString(body["description"])), mustJSON(nodes), mustJSON(config), boolInt(body["is_template"]), currentUser)
	if err != nil {
		return InstanceAPIResponse{}, "", err
	}
	id, _ := result.LastInsertId()
	return InstanceAPIResponse{Code: 0, Data: map[string]any{"id": id, "code": code, "name": name, "is_template": boolInt(body["is_template"]), "from_template": fromTemplate}}, "workflow.admin.flow_schemas.create", nil
}

func (a *Adapter) adminUpdateFlowSchema(ctx context.Context, id string, body map[string]any) (InstanceAPIResponse, string, error) {
	existing, err := queryOneMap(ctx, a.db, "SELECT id, version FROM flow_schemas WHERE id = ?", id)
	if err != nil {
		return InstanceAPIResponse{}, "", err
	}
	if existing == nil {
		return InstanceAPIResponse{}, "", httperror.New(http.StatusNotFound, "flow_schema_not_found", "流程定义不存在")
	}
	if code, ok := body["code"]; ok {
		if exists, err := existsByQuery(ctx, a.db, "SELECT id FROM flow_schemas WHERE code = ? AND id != ?", code, id); err != nil {
			return InstanceAPIResponse{}, "", err
		} else if exists {
			return InstanceAPIResponse{}, "", httperror.New(http.StatusBadRequest, "duplicate_flow_code", "流程编码已存在")
		}
	}
	sets, args := jsonSchemaSets(body, []string{"code", "name", "description", "nodes", "config", "status"})
	if len(sets) == 0 {
		return InstanceAPIResponse{}, "", httperror.New(http.StatusBadRequest, "empty_update", "没有需要更新的字段")
	}
	sets = append(sets, "version = version + 1", "updated_at = NOW()")
	args = append(args, id)
	if _, err := a.db.ExecContext(ctx, "UPDATE flow_schemas SET "+strings.Join(sets, ", ")+" WHERE id = ?", args...); err != nil {
		return InstanceAPIResponse{}, "", err
	}
	return InstanceAPIResponse{Code: 0, Data: map[string]any{"id": parseInt64Fallback(id), "version": anyInt64(existing["version"]) + 1}}, "workflow.admin.flow_schemas.update", nil
}

func (a *Adapter) adminFlowSchemaTemplates(ctx context.Context) (InstanceAPIResponse, string, error) {
	rows, err := queryMaps(ctx, a.db, `
		SELECT id, code, name, description, nodes, config
		FROM flow_schemas
		WHERE is_template = 1 AND status = 1
		ORDER BY id ASC
	`)
	if err != nil {
		return InstanceAPIResponse{}, "", err
	}
	for _, row := range rows {
		nodes, _ := parseAnyJSON(row["nodes"])
		config, _ := parseAnyJSON(row["config"])
		row["nodes"] = nodes
		row["config"] = config
		row["node_count"] = len(asMapSlice(nodes))
	}
	return InstanceAPIResponse{Code: 0, Data: rows}, "workflow.admin.flow_schemas.templates", nil
}

func (a *Adapter) adminListFormSchemas(ctx context.Context, query url.Values) (InstanceAPIResponse, string, error) {
	page := workflowPageParams(query, 20)
	whereParts := []string{}
	args := []any{}
	if search := strings.TrimSpace(query.Get("search")); search != "" {
		whereParts = append(whereParts, "(code LIKE ? OR name LIKE ?)")
		args = append(args, like(search), like(search))
	}
	if status := strings.TrimSpace(query.Get("status")); status != "" {
		whereParts = append(whereParts, "status = ?")
		args = append(args, status)
	}
	whereSQL := whereSQL(whereParts)
	var total int64
	if err := a.db.QueryRowContext(ctx, "SELECT COUNT(*) AS total FROM form_schemas "+whereSQL, args...).Scan(&total); err != nil {
		return InstanceAPIResponse{}, "", err
	}
	rows, err := queryMaps(ctx, a.db, `
		SELECT id, code, name, description, version, status, created_by, created_at, updated_at
		FROM form_schemas `+whereSQL+`
		ORDER BY id DESC
		LIMIT ? OFFSET ?
	`, append(args, page.pageSize, page.offset)...)
	if err != nil {
		return InstanceAPIResponse{}, "", err
	}
	return pagedAdminResponse(rows, total, page), "workflow.admin.form_schemas.list", nil
}

func (a *Adapter) adminCreateFormSchema(ctx context.Context, body map[string]any) (InstanceAPIResponse, string, error) {
	currentUser := cleanAnyString(body["current_user"])
	code := cleanAnyString(body["code"])
	name := cleanAnyString(body["name"])
	if currentUser == "" {
		return InstanceAPIResponse{}, "", httperror.New(http.StatusUnauthorized, "missing_current_user", "未登录")
	}
	if code == "" || name == "" || body["fields"] == nil {
		return InstanceAPIResponse{}, "", httperror.New(http.StatusBadRequest, "field_required", "code, name, fields 必填")
	}
	if exists, err := existsByQuery(ctx, a.db, "SELECT id FROM form_schemas WHERE code = ?", code); err != nil {
		return InstanceAPIResponse{}, "", err
	} else if exists {
		return InstanceAPIResponse{}, "", httperror.New(http.StatusBadRequest, "duplicate_form_code", "表单编码已存在")
	}
	result, err := a.db.ExecContext(ctx, `
		INSERT INTO form_schemas (code, name, description, fields, version, status, created_by, created_at, updated_at)
		VALUES (?, ?, ?, ?, 1, 1, ?, NOW(), NOW())
	`, code, name, nilIfEmpty(cleanAnyString(body["description"])), mustJSON(body["fields"]), currentUser)
	if err != nil {
		return InstanceAPIResponse{}, "", err
	}
	id, _ := result.LastInsertId()
	return InstanceAPIResponse{Code: 0, Data: map[string]any{"id": id, "code": code, "name": name}}, "workflow.admin.form_schemas.create", nil
}

func (a *Adapter) adminUpdateFormSchema(ctx context.Context, id string, body map[string]any) (InstanceAPIResponse, string, error) {
	existing, err := queryOneMap(ctx, a.db, "SELECT id, version FROM form_schemas WHERE id = ?", id)
	if err != nil {
		return InstanceAPIResponse{}, "", err
	}
	if existing == nil {
		return InstanceAPIResponse{}, "", httperror.New(http.StatusNotFound, "form_schema_not_found", "表单定义不存在")
	}
	sets, args := jsonSchemaSets(body, []string{"name", "description", "fields", "status"})
	if len(sets) == 0 {
		return InstanceAPIResponse{}, "", httperror.New(http.StatusBadRequest, "empty_update", "没有需要更新的字段")
	}
	sets = append(sets, "version = version + 1", "updated_at = NOW()")
	args = append(args, id)
	if _, err := a.db.ExecContext(ctx, "UPDATE form_schemas SET "+strings.Join(sets, ", ")+" WHERE id = ?", args...); err != nil {
		return InstanceAPIResponse{}, "", err
	}
	return InstanceAPIResponse{Code: 0, Data: map[string]any{"id": parseInt64Fallback(id), "version": anyInt64(existing["version"]) + 1}}, "workflow.admin.form_schemas.update", nil
}

func (a *Adapter) adminListRoutes(ctx context.Context, query url.Values) (InstanceAPIResponse, string, error) {
	page := workflowPageParams(query, 50)
	whereParts := []string{}
	args := []any{}
	if actionDefID := strings.TrimSpace(query.Get("action_def_id")); actionDefID != "" {
		whereParts = append(whereParts, "r.action_def_id = ?")
		args = append(args, actionDefID)
	}
	whereSQL := whereSQL(whereParts)
	var total int64
	if err := a.db.QueryRowContext(ctx, "SELECT COUNT(*) AS total FROM flow_routes r "+whereSQL, args...).Scan(&total); err != nil {
		return InstanceAPIResponse{}, "", err
	}
	rows, err := queryMaps(ctx, a.db, `
		SELECT r.*, f.code AS flow_code, f.name AS flow_name
		FROM flow_routes r
		LEFT JOIN flow_schemas f ON r.flow_schema_id = f.id
		`+whereSQL+`
		ORDER BY r.priority DESC, r.id ASC
		LIMIT ? OFFSET ?
	`, append(args, page.pageSize, page.offset)...)
	if err != nil {
		return InstanceAPIResponse{}, "", err
	}
	for _, row := range rows {
		row["flow_schema"] = map[string]any{"id": row["flow_schema_id"], "code": row["flow_code"], "name": row["flow_name"]}
		row["conditions"], _ = parseAnyJSON(row["conditions"])
		delete(row, "flow_code")
		delete(row, "flow_name")
	}
	return pagedAdminResponse(rows, total, page), "workflow.admin.routes.list", nil
}

func (a *Adapter) adminCreateRoute(ctx context.Context, body map[string]any) (InstanceAPIResponse, string, error) {
	currentUser := cleanAnyString(body["current_user"])
	if currentUser == "" {
		return InstanceAPIResponse{}, "", httperror.New(http.StatusUnauthorized, "missing_current_user", "未登录")
	}
	name := cleanAnyString(body["name"])
	actionDefID := nullableNumber(body["action_def_id"])
	flowSchemaID := nullableNumber(body["flow_schema_id"])
	if actionDefID == nil || flowSchemaID == nil || name == "" {
		return InstanceAPIResponse{}, "", httperror.New(http.StatusBadRequest, "field_required", "action_def_id, flow_schema_id, name 必填")
	}
	if exists, err := existsByQuery(ctx, a.db, "SELECT id FROM flow_action_defs WHERE id = ?", actionDefID); err != nil {
		return InstanceAPIResponse{}, "", err
	} else if !exists {
		return InstanceAPIResponse{}, "", httperror.New(http.StatusBadRequest, "action_def_not_found", "动作定义不存在")
	}
	if exists, err := existsByQuery(ctx, a.db, "SELECT id FROM flow_schemas WHERE id = ?", flowSchemaID); err != nil {
		return InstanceAPIResponse{}, "", err
	} else if !exists {
		return InstanceAPIResponse{}, "", httperror.New(http.StatusBadRequest, "flow_schema_not_found", "流程定义不存在")
	}
	result, err := a.db.ExecContext(ctx, `
		INSERT INTO flow_routes
		  (action_def_id, flow_schema_id, name, description, level, conditions, priority, is_default, status, created_by, created_at, updated_at)
		VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, ?, NOW(), NOW())
	`, actionDefID, flowSchemaID, name, nilIfEmpty(cleanAnyString(body["description"])), nullableNumber(body["level"]), mustJSON(defaultMap(asStringMap(body["conditions"]))), intValue(body["priority"]), boolInt(body["is_default"]), currentUser)
	if err != nil {
		return InstanceAPIResponse{}, "", err
	}
	id, _ := result.LastInsertId()
	return InstanceAPIResponse{Code: 0, Data: map[string]any{"id": id, "name": name}}, "workflow.admin.routes.create", nil
}

func (a *Adapter) adminUpdateRoute(ctx context.Context, id string, body map[string]any) (InstanceAPIResponse, string, error) {
	if exists, err := existsByQuery(ctx, a.db, "SELECT id FROM flow_routes WHERE id = ?", id); err != nil {
		return InstanceAPIResponse{}, "", err
	} else if !exists {
		return InstanceAPIResponse{}, "", httperror.New(http.StatusNotFound, "route_not_found", "路由规则不存在")
	}
	sets := []string{}
	args := []any{}
	addSet := func(key string, column string, transform func(any) any) {
		if value, ok := body[key]; ok {
			sets = append(sets, column+" = ?")
			args = append(args, transform(value))
		}
	}
	addSet("flow_schema_id", "flow_schema_id", identity)
	addSet("name", "name", identity)
	addSet("description", "description", identity)
	addSet("level", "level", nullableNumber)
	addSet("conditions", "conditions", func(v any) any { return mustJSON(v) })
	addSet("priority", "priority", identity)
	addSet("is_default", "is_default", func(v any) any { return boolInt(v) })
	addSet("status", "status", identity)
	if len(sets) == 0 {
		return InstanceAPIResponse{}, "", httperror.New(http.StatusBadRequest, "empty_update", "没有需要更新的字段")
	}
	sets = append(sets, "updated_at = NOW()")
	args = append(args, id)
	if _, err := a.db.ExecContext(ctx, "UPDATE flow_routes SET "+strings.Join(sets, ", ")+" WHERE id = ?", args...); err != nil {
		return InstanceAPIResponse{}, "", err
	}
	return InstanceAPIResponse{Code: 0, Data: map[string]any{"id": parseInt64Fallback(id)}}, "workflow.admin.routes.update", nil
}

func (a *Adapter) adminGetJSONSchema(ctx context.Context, table string, id string, jsonColumns []string, notFound string, operation string) (InstanceAPIResponse, string, error) {
	row, err := queryOneMap(ctx, a.db, "SELECT * FROM "+table+" WHERE id = ?", id)
	if err != nil {
		return InstanceAPIResponse{}, "", err
	}
	if row == nil {
		return InstanceAPIResponse{}, "", httperror.New(http.StatusNotFound, "record_not_found", notFound)
	}
	for _, column := range jsonColumns {
		row[column], _ = parseAnyJSON(row[column])
	}
	return InstanceAPIResponse{Code: 0, Data: row}, operation, nil
}

func (a *Adapter) adminDelete(ctx context.Context, table string, id string, notFound string, operation string) (InstanceAPIResponse, string, error) {
	if exists, err := existsByQuery(ctx, a.db, "SELECT id FROM "+table+" WHERE id = ? AND status = 1", id); err != nil {
		return InstanceAPIResponse{}, "", err
	} else if !exists {
		return InstanceAPIResponse{}, "", httperror.New(http.StatusNotFound, "record_not_found", notFound)
	}
	if _, err := a.db.ExecContext(ctx, "UPDATE "+table+" SET status = 0, updated_at = NOW() WHERE id = ?", id); err != nil {
		return InstanceAPIResponse{}, "", err
	}
	return InstanceAPIResponse{Code: 0, Data: map[string]any{"id": parseInt64Fallback(id)}}, operation, nil
}

func identity(value any) any {
	return value
}

func bodyValue(body map[string]any, key string, fallback any) any {
	if value, ok := body[key]; ok {
		return value
	}
	return fallback
}

func filteredWhere(query url.Values, equals map[string]string, searchColumns []string) (string, []any) {
	parts := []string{}
	args := []any{}
	for key, column := range equals {
		if value := strings.TrimSpace(query.Get(key)); value != "" {
			parts = append(parts, column+" = ?")
			args = append(args, value)
		}
	}
	if search := strings.TrimSpace(query.Get("search")); search != "" && len(searchColumns) > 0 {
		searchParts := make([]string, 0, len(searchColumns))
		for _, column := range searchColumns {
			searchParts = append(searchParts, column+" LIKE ?")
			args = append(args, like(search))
		}
		parts = append(parts, "("+strings.Join(searchParts, " OR ")+")")
	}
	return whereSQL(parts), args
}

func whereSQL(parts []string) string {
	if len(parts) == 0 {
		return ""
	}
	return "WHERE " + strings.Join(parts, " AND ")
}

func pagedAdminResponse(items []map[string]any, total int64, page workflowPage) InstanceAPIResponse {
	return InstanceAPIResponse{Code: 0, Data: map[string]any{"items": items, "total": total, "page": page.page, "page_size": page.pageSize}}
}

func jsonSchemaSets(body map[string]any, keys []string) ([]string, []any) {
	sets := []string{}
	args := []any{}
	jsonColumns := map[string]bool{"nodes": true, "config": true, "fields": true}
	for _, key := range keys {
		value, ok := body[key]
		if !ok {
			continue
		}
		sets = append(sets, key+" = ?")
		if jsonColumns[key] {
			args = append(args, mustJSON(value))
		} else {
			args = append(args, value)
		}
	}
	return sets, args
}
