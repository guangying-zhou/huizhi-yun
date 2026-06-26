package compat

import (
	"context"
	"crypto/rand"
	"database/sql"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"net/http"
	"net/url"
	"sort"
	"strconv"
	"strings"
	"sync"
	"time"
	"unicode"

	"github.com/huizhi-yun/data-runtime/internal/config"
	"github.com/huizhi-yun/data-runtime/internal/db"
	"github.com/huizhi-yun/data-runtime/internal/httperror"
)

type ResponseMode string

const (
	ResponseData            ResponseMode = "data"
	ResponseCodeData        ResponseMode = "code_data"
	ResponseCodeMessageData ResponseMode = "code_message_data"
	ResponseSuccessData     ResponseMode = "success_data"
)

type Config struct {
	AppCode         string
	DB              config.DBConfig
	ResponseMode    ResponseMode
	RequiredTables  []string
	Resources       []ResourceSpec
	DashboardCounts []DashboardCount
}

type ResourceSpec struct {
	Path             string
	Table            string
	IDColumn         string
	CodeColumn       string
	CodePrefix       string
	SearchColumns    []string
	DefaultOrderBy   string
	SoftDeleteColumn string
	PageSizeMax      int
	ReadOnly         bool
	ActorColumn      string
	OwnerColumn      string
	DepartmentColumn string
	ParentScope      *ParentScopeSpec
	PathParamColumns map[string]string
	WriteDenyColumns []string
}

type ParentScopeSpec struct {
	Table            string
	IDColumn         string
	LocalColumn      string
	Resource         string
	OwnerColumn      string
	DepartmentColumn string
	SoftDeleteColumn string
}

type DashboardCount struct {
	Key   string
	Label string
	Table string
	Where string
}

type Adapter struct {
	appCode         string
	db              *sql.DB
	dbName          string
	responseMode    ResponseMode
	requiredTables  []string
	resources       []ResourceSpec
	dashboardCounts []DashboardCount
	columnMu        sync.RWMutex
	columnCache     map[string]map[string]columnInfo
}

type SchemaStatus struct {
	App           string   `json:"app"`
	Database      string   `json:"database"`
	Status        string   `json:"status"`
	CheckedTables []string `json:"checkedTables"`
	MissingTables []string `json:"missingTables"`
}

type columnInfo struct {
	Name     string
	DataType string
	Nullable bool
}

type pageParams struct {
	page     int
	pageSize int
	offset   int
}

type resourceMatch struct {
	spec     ResourceSpec
	captures map[string]string
	rest     []string
}

var reservedQueryKeys = map[string]bool{
	"_":                             true,
	"current_user":                  true,
	"current_user_data_access":      true,
	"current_user_data_dept_code":   true,
	"current_user_data_dept_codes":  true,
	"current_user_dept_code":        true,
	"current_user_dept_codes":       true,
	"current_user_department_code":  true,
	"current_user_department_codes": true,
	"currentUserDataAccess":         true,
	"currentUserDataDeptCode":       true,
	"currentUserDataDeptCodes":      true,
	"currentUserDeptCode":           true,
	"currentUserDeptCodes":          true,
	"currentUserDepartmentCode":     true,
	"currentUserDepartmentCodes":    true,
	"current_user_scopes":           true,
	"fields":                        true,
	"keyword":                       true,
	"limit":                         true,
	"offset":                        true,
	"operator_uid":                  true,
	"order":                         true,
	"page":                          true,
	"page_size":                     true,
	"pageSize":                      true,
	"q":                             true,
	"search":                        true,
	"showAll":                       true,
	"sort":                          true,
	"t":                             true,
}

var reservedBodyKeys = map[string]bool{
	"current_user":                  true,
	"current_user_data_access":      true,
	"current_user_data_dept_code":   true,
	"current_user_data_dept_codes":  true,
	"current_user_dept_code":        true,
	"current_user_dept_codes":       true,
	"current_user_department_code":  true,
	"current_user_department_codes": true,
	"currentUserDataAccess":         true,
	"currentUserDataDeptCode":       true,
	"currentUserDataDeptCodes":      true,
	"currentUserDeptCode":           true,
	"currentUserDeptCodes":          true,
	"currentUserDepartmentCode":     true,
	"currentUserDepartmentCodes":    true,
	"current_user_scopes":           true,
	"operator_uid":                  true,
}

func New(cfg Config) (*Adapter, error) {
	conn, err := db.Open(cfg.DB)
	if err != nil {
		return nil, err
	}
	resources := append([]ResourceSpec(nil), cfg.Resources...)
	sort.SliceStable(resources, func(i int, j int) bool {
		return len(pathSegments(resources[i].Path)) > len(pathSegments(resources[j].Path))
	})
	for i := range resources {
		if resources[i].IDColumn == "" {
			resources[i].IDColumn = "id"
		}
	}
	mode := cfg.ResponseMode
	if mode == "" {
		mode = ResponseData
	}
	return &Adapter{
		appCode:         strings.TrimSpace(cfg.AppCode),
		db:              conn,
		dbName:          cfg.DB.Database,
		responseMode:    mode,
		requiredTables:  append([]string(nil), cfg.RequiredTables...),
		resources:       resources,
		dashboardCounts: append([]DashboardCount(nil), cfg.DashboardCounts...),
		columnCache:     map[string]map[string]columnInfo{},
	}, nil
}

func (a *Adapter) Ping(ctx context.Context) error {
	return a.db.PingContext(ctx)
}

func (a *Adapter) DB() *sql.DB {
	return a.db
}

func (a *Adapter) SchemaStatus(ctx context.Context) (SchemaStatus, error) {
	if len(a.requiredTables) == 0 {
		return SchemaStatus{
			App:      a.appCode,
			Database: a.dbName,
			Status:   "ok",
		}, nil
	}

	placeholders := strings.TrimRight(strings.Repeat("?,", len(a.requiredTables)), ",")
	args := make([]any, 0, len(a.requiredTables))
	for _, table := range a.requiredTables {
		args = append(args, table)
	}

	rows, err := a.db.QueryContext(ctx, `
		SELECT TABLE_NAME
		FROM information_schema.TABLES
		WHERE TABLE_SCHEMA = DATABASE()
		  AND TABLE_NAME IN (`+placeholders+`)
	`, args...)
	if err != nil {
		return SchemaStatus{}, err
	}
	defer rows.Close()

	existing := map[string]bool{}
	for rows.Next() {
		var table string
		if err := rows.Scan(&table); err != nil {
			return SchemaStatus{}, err
		}
		existing[table] = true
	}
	if err := rows.Err(); err != nil {
		return SchemaStatus{}, err
	}

	missing := make([]string, 0)
	for _, table := range a.requiredTables {
		if !existing[table] {
			missing = append(missing, table)
		}
	}

	status := "ok"
	if len(missing) > 0 {
		status = "schema_mismatch"
	}
	return SchemaStatus{
		App:           a.appCode,
		Database:      a.dbName,
		Status:        status,
		CheckedTables: a.requiredTables,
		MissingTables: missing,
	}, nil
}

func (a *Adapter) HandleRuntime(ctx context.Context, method string, path string, query url.Values, body map[string]any) (any, string, error) {
	suffix, ok := a.runtimeSuffix(path)
	if !ok {
		return nil, "", httperror.New(http.StatusNotFound, "not_found", "Route not found")
	}

	if method == http.MethodGet && (suffix == "dashboard" || strings.HasPrefix(suffix, "dashboard/") || strings.HasPrefix(suffix, "reports/") || suffix == "workspace") {
		result, err := a.dashboard(ctx)
		return a.wrap(result), a.appCode + ".dashboard.read", err
	}

	match, ok := a.matchResource(suffix)
	if !ok {
		return nil, "", httperror.New(http.StatusNotFound, "not_found", "Route not found")
	}

	switch method {
	case http.MethodGet:
		if len(match.rest) == 0 {
			result, err := a.list(ctx, match, query)
			return a.wrap(result), a.operation(match.spec, "list"), err
		}
		if len(match.rest) == 1 {
			result, err := a.get(ctx, match, match.rest[0], query)
			return a.wrap(result), a.operation(match.spec, "get"), err
		}
	case http.MethodPost:
		if len(match.rest) == 0 {
			result, err := a.create(ctx, match, query, body)
			return a.wrap(result), a.operation(match.spec, "create"), err
		}
	case http.MethodPut, http.MethodPatch:
		if len(match.rest) == 1 {
			result, err := a.update(ctx, match, query, match.rest[0], body)
			return a.wrap(result), a.operation(match.spec, "update"), err
		}
	case http.MethodDelete:
		if len(match.rest) == 1 {
			result, err := a.delete(ctx, match, query, match.rest[0])
			return a.wrap(result), a.operation(match.spec, "delete"), err
		}
	}

	return nil, "", httperror.New(http.StatusNotImplemented, "runtime_action_not_supported", "This tenant-runtime adapter does not support the requested action yet")
}

func (a *Adapter) runtimeSuffix(path string) (string, bool) {
	prefix := "/v1/" + a.appCode
	if path == prefix {
		return "", true
	}
	prefix += "/"
	if !strings.HasPrefix(path, prefix) {
		return "", false
	}
	return strings.Trim(strings.TrimPrefix(path, prefix), "/"), true
}

func (a *Adapter) matchResource(suffix string) (resourceMatch, bool) {
	for _, spec := range a.resources {
		captures, rest, ok := matchPattern(spec.Path, suffix)
		if !ok {
			continue
		}
		return resourceMatch{spec: spec, captures: captures, rest: rest}, true
	}
	return resourceMatch{}, false
}

func (a *Adapter) list(ctx context.Context, match resourceMatch, query url.Values) (map[string]any, error) {
	columns, err := a.tableColumns(ctx, match.spec.Table)
	if err != nil {
		return nil, err
	}
	page := getPageParams(query, match.spec.PageSizeMax)
	where, args := a.whereParts(match, columns, query)
	scopeWhere, scopeArgs, err := a.readScopeWhere(match, columns, query, nil)
	if err != nil {
		return nil, err
	}
	where = append(where, scopeWhere...)
	args = append(args, scopeArgs...)
	whereSQL := ""
	if len(where) > 0 {
		whereSQL = " WHERE " + strings.Join(where, " AND ")
	}

	var total int64
	if err := a.db.QueryRowContext(ctx, "SELECT COUNT(*) FROM "+quoteID(match.spec.Table)+whereSQL, args...).Scan(&total); err != nil {
		return nil, err
	}

	orderBy := a.orderBy(match.spec, columns, query)
	rows, err := a.db.QueryContext(
		ctx,
		"SELECT * FROM "+quoteID(match.spec.Table)+whereSQL+" ORDER BY "+orderBy+" LIMIT ? OFFSET ?",
		append(args, page.pageSize, page.offset)...,
	)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	items, err := rowsToMaps(rows)
	if err != nil {
		return nil, err
	}
	return map[string]any{
		"items":    items,
		"total":    total,
		"page":     page.page,
		"pageSize": page.pageSize,
	}, nil
}

func (a *Adapter) get(ctx context.Context, match resourceMatch, identifier string, query url.Values) (map[string]any, error) {
	columns, err := a.tableColumns(ctx, match.spec.Table)
	if err != nil {
		return nil, err
	}
	where, args := a.identityWhere(match.spec, columns, identifier)
	for key, column := range match.spec.PathParamColumns {
		value := strings.TrimSpace(match.captures[key])
		if value == "" {
			continue
		}
		if hasColumn(columns, column) {
			where = append(where, quoteID(column)+" = ?")
			args = append(args, value)
		} else {
			where = append(where, "1 = 0")
		}
	}
	where = append(where, a.lifecycleWhere(match.spec, columns)...)
	scopeWhere, scopeArgs, err := a.readScopeWhere(match, columns, query, nil)
	if err != nil {
		return nil, err
	}
	where = append(where, scopeWhere...)
	args = append(args, scopeArgs...)

	rows, err := a.db.QueryContext(ctx, "SELECT * FROM "+quoteID(match.spec.Table)+" WHERE "+strings.Join(where, " AND ")+" LIMIT 1", args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	items, err := rowsToMaps(rows)
	if err != nil {
		return nil, err
	}
	if len(items) == 0 {
		return nil, httperror.New(http.StatusNotFound, "record_not_found", "Record not found")
	}
	return items[0], nil
}

func (a *Adapter) create(ctx context.Context, match resourceMatch, query url.Values, body map[string]any) (map[string]any, error) {
	if match.spec.ReadOnly {
		return nil, httperror.New(http.StatusMethodNotAllowed, "resource_read_only", "Resource is read-only")
	}
	columns, err := a.tableColumns(ctx, match.spec.Table)
	if err != nil {
		return nil, err
	}
	fields := map[string]any{}
	for key, value := range body {
		if reservedBodyKeys[key] {
			continue
		}
		column := toSnakeCase(key)
		if shouldSkipCreateColumn(columns, column, match.spec.IDColumn) || writeDeniedColumn(match.spec, column) {
			continue
		}
		fields[column] = normalizeBodyValue(value, columns[column])
	}
	for key, column := range match.spec.PathParamColumns {
		if hasColumn(columns, column) {
			fields[column] = match.captures[key]
			continue
		}
		if strings.TrimSpace(match.captures[key]) != "" {
			return nil, httperror.New(http.StatusInternalServerError, "schema_mismatch", "Runtime adapter path parameter column is missing")
		}
	}
	actor := actorFrom(query, body)
	if actor != "" {
		if hasColumn(columns, "created_by") && fields["created_by"] == nil {
			fields["created_by"] = actor
		}
		if hasColumn(columns, "updated_by") && fields["updated_by"] == nil {
			fields["updated_by"] = actor
		}
		if hasColumn(columns, "uid") && match.spec.ActorColumn == "uid" && fields["uid"] == nil {
			fields["uid"] = actor
		}
	}
	applyRuntimeScopeCreateDefaults(fields, match.spec, columns, actor, runtimeActorDeptCodes(query, body))
	if err := a.requireParentCreateScope(ctx, match, columns, fields, query, body); err != nil {
		return nil, err
	}
	if match.spec.CodeColumn != "" && hasColumn(columns, match.spec.CodeColumn) && fields[match.spec.CodeColumn] == nil && match.spec.CodePrefix != "" {
		fields[match.spec.CodeColumn] = generateCode(match.spec.CodePrefix)
	}
	if len(fields) == 0 {
		return nil, httperror.New(http.StatusBadRequest, "empty_request", "No writable fields provided")
	}

	names := make([]string, 0, len(fields))
	args := make([]any, 0, len(fields))
	for name := range fields {
		names = append(names, name)
	}
	sort.Strings(names)
	placeholders := make([]string, 0, len(names))
	for _, name := range names {
		placeholders = append(placeholders, "?")
		args = append(args, fields[name])
	}

	result, err := a.db.ExecContext(ctx, "INSERT INTO "+quoteID(match.spec.Table)+" ("+quoteIDList(names)+") VALUES ("+strings.Join(placeholders, ", ")+")", args...)
	if err != nil {
		return nil, err
	}
	id, err := result.LastInsertId()
	if err != nil {
		return map[string]any{"created": true}, nil
	}
	if match.spec.IDColumn != "" && match.spec.IDColumn != "id" {
		if identifier, ok := fields[match.spec.IDColumn]; ok {
			identifierText := strings.TrimSpace(fmt.Sprint(identifier))
			if identifierText != "" {
				return a.get(ctx, match, identifierText, query)
			}
		}
	}
	return a.get(ctx, match, strconv.FormatInt(id, 10), query)
}

func (a *Adapter) update(ctx context.Context, match resourceMatch, query url.Values, identifier string, body map[string]any) (map[string]any, error) {
	if match.spec.ReadOnly {
		return nil, httperror.New(http.StatusMethodNotAllowed, "resource_read_only", "Resource is read-only")
	}
	columns, err := a.tableColumns(ctx, match.spec.Table)
	if err != nil {
		return nil, err
	}
	fields := map[string]any{}
	for key, value := range body {
		if reservedBodyKeys[key] {
			continue
		}
		column := toSnakeCase(key)
		if !hasColumn(columns, column) || writeDeniedColumn(match.spec, column) || column == match.spec.IDColumn || column == "created_at" || column == "updated_at" || column == "created_by" {
			continue
		}
		fields[column] = normalizeBodyValue(value, columns[column])
	}
	if actor := actorFrom(query, body); actor != "" && hasColumn(columns, "updated_by") && fields["updated_by"] == nil {
		fields["updated_by"] = actor
	}
	if len(fields) == 0 {
		return a.get(ctx, match, identifier, query)
	}

	names := make([]string, 0, len(fields))
	args := make([]any, 0, len(fields)+1)
	for name := range fields {
		names = append(names, name)
	}
	sort.Strings(names)
	set := make([]string, 0, len(names))
	for _, name := range names {
		set = append(set, quoteID(name)+" = ?")
		args = append(args, fields[name])
	}
	where, whereArgs := a.identityWhere(match.spec, columns, identifier)
	for key, column := range match.spec.PathParamColumns {
		value := strings.TrimSpace(match.captures[key])
		if value == "" {
			continue
		}
		if hasColumn(columns, column) {
			where = append(where, quoteID(column)+" = ?")
			whereArgs = append(whereArgs, value)
		} else {
			where = append(where, "1 = 0")
		}
	}
	if err := a.requireOwnerWrite(ctx, match, columns, where, whereArgs, query, body); err != nil {
		return nil, err
	}
	args = append(args, whereArgs...)

	if _, err := a.db.ExecContext(ctx, "UPDATE "+quoteID(match.spec.Table)+" SET "+strings.Join(set, ", ")+" WHERE "+strings.Join(where, " AND "), args...); err != nil {
		return nil, err
	}
	return a.get(ctx, match, identifier, query)
}

func (a *Adapter) delete(ctx context.Context, match resourceMatch, query url.Values, identifier string) (map[string]any, error) {
	if match.spec.ReadOnly {
		return nil, httperror.New(http.StatusMethodNotAllowed, "resource_read_only", "Resource is read-only")
	}
	columns, err := a.tableColumns(ctx, match.spec.Table)
	if err != nil {
		return nil, err
	}
	where, args := a.identityWhere(match.spec, columns, identifier)
	for key, column := range match.spec.PathParamColumns {
		value := strings.TrimSpace(match.captures[key])
		if value == "" {
			continue
		}
		if hasColumn(columns, column) {
			where = append(where, quoteID(column)+" = ?")
			args = append(args, value)
		} else {
			where = append(where, "1 = 0")
		}
	}
	if err := a.requireOwnerWrite(ctx, match, columns, where, args, query, nil); err != nil {
		return nil, err
	}

	lifecycleColumn := firstExistingColumn(columns, match.spec.SoftDeleteColumn, "deleted_at", "archived_at")
	if lifecycleColumn != "" {
		set := []string{quoteID(lifecycleColumn) + " = NOW()"}
		if actor := actorFrom(query, nil); actor != "" && hasColumn(columns, "updated_by") {
			set = append(set, quoteID("updated_by")+" = ?")
			args = append([]any{actor}, args...)
		}
		if _, err := a.db.ExecContext(ctx, "UPDATE "+quoteID(match.spec.Table)+" SET "+strings.Join(set, ", ")+" WHERE "+strings.Join(where, " AND "), args...); err != nil {
			return nil, err
		}
	} else if _, err := a.db.ExecContext(ctx, "DELETE FROM "+quoteID(match.spec.Table)+" WHERE "+strings.Join(where, " AND "), args...); err != nil {
		return nil, err
	}

	return map[string]any{"deleted": true, "id": identifier}, nil
}

func applyRuntimeScopeCreateDefaults(fields map[string]any, spec ResourceSpec, columns map[string]columnInfo, actor string, deptCodes []string) {
	ownerColumn := strings.TrimSpace(spec.OwnerColumn)
	if ownerColumn != "" && hasColumn(columns, ownerColumn) && actor != "" && !runtimeFieldPresent(fields[ownerColumn]) {
		fields[ownerColumn] = actor
	}
	departmentColumn := strings.TrimSpace(spec.DepartmentColumn)
	if departmentColumn != "" && hasColumn(columns, departmentColumn) && len(deptCodes) > 0 && !runtimeFieldPresent(fields[departmentColumn]) {
		fields[departmentColumn] = deptCodes[0]
	}
}

func runtimeFieldPresent(value any) bool {
	if value == nil {
		return false
	}
	text := strings.TrimSpace(fmt.Sprint(value))
	return text != "" && text != "<nil>"
}

func (a *Adapter) dashboard(ctx context.Context) (map[string]any, error) {
	metrics := make([]map[string]any, 0, len(a.dashboardCounts))
	summary := map[string]any{}
	for _, spec := range a.dashboardCounts {
		if !safeIdentifier(spec.Table) {
			continue
		}
		sqlText := "SELECT COUNT(*) FROM " + quoteID(spec.Table)
		if strings.TrimSpace(spec.Where) != "" {
			sqlText += " WHERE " + spec.Where
		}
		var count int64
		if err := a.db.QueryRowContext(ctx, sqlText).Scan(&count); err != nil {
			return nil, err
		}
		key := firstNonEmpty(spec.Key, spec.Table)
		label := firstNonEmpty(spec.Label, key)
		summary[key] = count
		metrics = append(metrics, map[string]any{
			"key":   key,
			"label": label,
			"value": count,
		})
	}
	return map[string]any{
		"metrics":         metrics,
		"summary":         summary,
		"items":           []any{},
		"quick_links":     []any{},
		"urgent_alerts":   []any{},
		"expiring_assets": []any{},
	}, nil
}

func (a *Adapter) whereParts(match resourceMatch, columns map[string]columnInfo, query url.Values) ([]string, []any) {
	where := make([]string, 0)
	args := make([]any, 0)
	where = append(where, a.lifecycleWhere(match.spec, columns)...)

	for key, column := range match.spec.PathParamColumns {
		value := strings.TrimSpace(match.captures[key])
		if value == "" {
			continue
		}
		if hasColumn(columns, column) {
			where = append(where, quoteID(column)+" = ?")
			args = append(args, value)
		} else {
			where = append(where, "1 = 0")
		}
	}

	if match.spec.ActorColumn != "" && hasColumn(columns, match.spec.ActorColumn) {
		if actor := actorFrom(query, nil); actor != "" {
			where = append(where, quoteID(match.spec.ActorColumn)+" = ?")
			args = append(args, actor)
		}
	}

	if keyword := firstNonEmpty(query.Get("keyword"), query.Get("search"), query.Get("q")); keyword != "" && len(match.spec.SearchColumns) > 0 {
		searchParts := make([]string, 0, len(match.spec.SearchColumns))
		for _, column := range match.spec.SearchColumns {
			if !hasColumn(columns, column) {
				continue
			}
			searchParts = append(searchParts, quoteID(column)+" LIKE ? ESCAPE '\\\\'")
			args = append(args, likeKeyword(keyword))
		}
		if len(searchParts) > 0 {
			where = append(where, "("+strings.Join(searchParts, " OR ")+")")
		}
	}

	for key, values := range query {
		if reservedQueryKeys[key] || len(values) == 0 {
			continue
		}
		value := strings.TrimSpace(values[0])
		if value == "" {
			continue
		}
		column := toSnakeCase(key)
		if !hasColumn(columns, column) {
			continue
		}
		if value == "__null__" {
			where = append(where, quoteID(column)+" IS NULL")
			continue
		}
		where = append(where, quoteID(column)+" = ?")
		args = append(args, value)
	}

	return where, args
}

func (a *Adapter) lifecycleWhere(spec ResourceSpec, columns map[string]columnInfo) []string {
	column := firstExistingColumn(columns, spec.SoftDeleteColumn, "deleted_at", "archived_at")
	if column == "" {
		return nil
	}
	return []string{quoteID(column) + " IS NULL"}
}

func (a *Adapter) identityWhere(spec ResourceSpec, columns map[string]columnInfo, identifier string) ([]string, []any) {
	identifier = strings.TrimSpace(identifier)
	if identifier == "" {
		return []string{"1 = 0"}, nil
	}
	if _, err := strconv.ParseInt(identifier, 10, 64); err == nil && hasColumn(columns, spec.IDColumn) {
		return []string{quoteID(spec.IDColumn) + " = ?"}, []any{identifier}
	}
	if spec.CodeColumn != "" && hasColumn(columns, spec.CodeColumn) {
		return []string{quoteID(spec.CodeColumn) + " = ?"}, []any{identifier}
	}
	if hasColumn(columns, spec.IDColumn) {
		return []string{quoteID(spec.IDColumn) + " = ?"}, []any{identifier}
	}
	return []string{"1 = 0"}, nil
}

func (a *Adapter) requireOwnerWrite(ctx context.Context, match resourceMatch, columns map[string]columnInfo, where []string, args []any, query url.Values, body map[string]any) error {
	ownerColumn := strings.TrimSpace(match.spec.OwnerColumn)
	departmentColumn := strings.TrimSpace(match.spec.DepartmentColumn)
	hasOwnerScope := ownerColumn != "" && hasColumn(columns, ownerColumn)
	hasDepartmentScope := departmentColumn != "" && hasColumn(columns, departmentColumn)
	parentScope, hasParentScope, err := normalizedParentScope(match.spec, columns)
	if err != nil {
		return err
	}
	if !hasOwnerScope && !hasDepartmentScope && !hasParentScope {
		return nil
	}
	if runtimeDataAccess(query, body) == "none" {
		return runtimeDataAccessForbidden()
	}
	actor := actorFrom(query, body)
	if actor == "" {
		return httperror.New(http.StatusUnauthorized, "missing_current_user", "current_user is required")
	}
	if a.hasRuntimeDataAccessAll(match, parentScope, hasParentScope, query, body) {
		return nil
	}
	if !hasOwnerScope && !hasDepartmentScope && hasParentScope {
		return a.requireParentWriteScope(ctx, match, parentScope, where, args, query, body)
	}

	selectColumns := make([]string, 0, 2)
	if hasOwnerScope {
		selectColumns = append(selectColumns, quoteID(ownerColumn))
	}
	if hasDepartmentScope {
		selectColumns = append(selectColumns, quoteID(departmentColumn))
	}
	rows, err := a.db.QueryContext(ctx, "SELECT "+strings.Join(selectColumns, ", ")+" FROM "+quoteID(match.spec.Table)+" WHERE "+strings.Join(where, " AND ")+" LIMIT 1", args...)
	if err != nil {
		return err
	}
	defer rows.Close()
	if !rows.Next() {
		return httperror.New(http.StatusNotFound, "record_not_found", "Record not found")
	}
	var owner sql.NullString
	var department sql.NullString
	scanTargets := make([]any, 0, 2)
	if hasOwnerScope {
		scanTargets = append(scanTargets, &owner)
	}
	if hasDepartmentScope {
		scanTargets = append(scanTargets, &department)
	}
	if err := rows.Scan(scanTargets...); err != nil {
		return err
	}
	if err := rows.Err(); err != nil {
		return err
	}
	if !runtimeActorCanWriteScopedRecord(actor, runtimeActorDeptCodes(query, body), owner, hasOwnerScope, department, hasDepartmentScope) {
		return httperror.New(http.StatusForbidden, "owner_scope_required", "Only the owner or scoped department can modify this record")
	}
	return nil
}

func runtimeActorCanWriteScopedRecord(actor string, deptCodes []string, owner sql.NullString, hasOwnerScope bool, department sql.NullString, hasDepartmentScope bool) bool {
	actor = strings.TrimSpace(actor)
	ownerText := ""
	if hasOwnerScope && owner.Valid {
		ownerText = strings.TrimSpace(owner.String)
		if ownerText != "" && ownerText == actor {
			return true
		}
	}
	departmentText := ""
	if hasDepartmentScope && department.Valid {
		departmentText = strings.TrimSpace(department.String)
		for _, deptCode := range deptCodes {
			if departmentText != "" && departmentText == strings.TrimSpace(deptCode) {
				return true
			}
		}
	}
	return ownerText == "" && departmentText == ""
}

func (a *Adapter) readScopeWhere(match resourceMatch, columns map[string]columnInfo, query url.Values, body map[string]any) ([]string, []any, error) {
	ownerColumn := strings.TrimSpace(match.spec.OwnerColumn)
	departmentColumn := strings.TrimSpace(match.spec.DepartmentColumn)
	hasOwnerScope := ownerColumn != "" && hasColumn(columns, ownerColumn)
	hasDepartmentScope := departmentColumn != "" && hasColumn(columns, departmentColumn)
	parentScope, hasParentScope, err := normalizedParentScope(match.spec, columns)
	if err != nil {
		return nil, nil, err
	}
	if !hasOwnerScope && !hasDepartmentScope && !hasParentScope {
		return nil, nil, nil
	}
	if runtimeDataAccess(query, body) == "none" {
		return nil, nil, runtimeDataAccessForbidden()
	}
	if a.hasRuntimeDataAccessAll(match, parentScope, hasParentScope, query, body) {
		return nil, nil, nil
	}
	actor := actorFrom(query, body)
	if actor == "" {
		return nil, nil, httperror.New(http.StatusUnauthorized, "missing_current_user", "current_user is required")
	}

	clauses := make([]string, 0, 2)
	args := make([]any, 0, 4)
	if hasOwnerScope {
		clauses = append(clauses, quoteID(ownerColumn)+" = ?")
		args = append(args, actor)
	}
	deptCodes := runtimeActorDeptCodes(query, body)
	if hasDepartmentScope && len(deptCodes) > 0 {
		placeholders := strings.TrimRight(strings.Repeat("?,", len(deptCodes)), ",")
		clauses = append(clauses, quoteID(departmentColumn)+" IN ("+placeholders+")")
		for _, deptCode := range deptCodes {
			args = append(args, deptCode)
		}
	}
	if hasParentScope {
		parentWhere, parentArgs := parentScopeExistsWhere(parentScope, actor, deptCodes)
		if parentWhere != "" {
			clauses = append(clauses, parentWhere)
			args = append(args, parentArgs...)
		}
	}
	if len(clauses) == 0 {
		return []string{"1 = 0"}, nil, nil
	}
	return []string{"(" + strings.Join(clauses, " OR ") + ")"}, args, nil
}

func normalizedParentScope(spec ResourceSpec, columns map[string]columnInfo) (ParentScopeSpec, bool, error) {
	if spec.ParentScope == nil {
		return ParentScopeSpec{}, false, nil
	}
	scope := *spec.ParentScope
	scope.Table = strings.TrimSpace(scope.Table)
	scope.IDColumn = firstNonEmpty(scope.IDColumn, "id")
	scope.LocalColumn = strings.TrimSpace(scope.LocalColumn)
	scope.Resource = firstNonEmpty(scope.Resource, resourceScopeName(scope.Table))
	scope.OwnerColumn = strings.TrimSpace(scope.OwnerColumn)
	scope.DepartmentColumn = strings.TrimSpace(scope.DepartmentColumn)
	scope.SoftDeleteColumn = strings.TrimSpace(scope.SoftDeleteColumn)
	if scope.Table == "" || scope.LocalColumn == "" || (scope.OwnerColumn == "" && scope.DepartmentColumn == "") {
		return ParentScopeSpec{}, false, httperror.New(http.StatusInternalServerError, "invalid_parent_scope", "Runtime adapter parent scope config is invalid")
	}
	if !safeIdentifier(scope.Table) || !safeIdentifier(scope.IDColumn) || !safeIdentifier(scope.LocalColumn) ||
		(scope.OwnerColumn != "" && !safeIdentifier(scope.OwnerColumn)) ||
		(scope.DepartmentColumn != "" && !safeIdentifier(scope.DepartmentColumn)) ||
		(scope.SoftDeleteColumn != "" && !safeIdentifier(scope.SoftDeleteColumn)) {
		return ParentScopeSpec{}, false, httperror.New(http.StatusInternalServerError, "invalid_parent_scope", "Runtime adapter parent scope config is invalid")
	}
	if !hasColumn(columns, scope.LocalColumn) {
		return ParentScopeSpec{}, false, httperror.New(http.StatusInternalServerError, "schema_mismatch", "Runtime adapter parent scope column is missing")
	}
	return scope, true, nil
}

func (a *Adapter) hasRuntimeScopeAdmin(match resourceMatch, parentScope ParentScopeSpec, hasParentScope bool, scopes []string) bool {
	if runtimeActorHasAdminScope(a.appCode, resourceScopeName(match.spec.Path), scopes) {
		return true
	}
	return hasParentScope && runtimeActorHasAdminScope(a.appCode, parentScope.Resource, scopes)
}

func (a *Adapter) hasRuntimeDataAccessAll(match resourceMatch, parentScope ParentScopeSpec, hasParentScope bool, query url.Values, body map[string]any) bool {
	if runtimeDataAccess(query, body) == "all" {
		return true
	}
	return a.hasRuntimeScopeAdmin(match, parentScope, hasParentScope, runtimeActorScopes(query, body))
}

func parentScopeExistsWhere(scope ParentScopeSpec, actor string, deptCodes []string) (string, []any) {
	parentAlias := "scope_parent"
	scopeClauses, scopeArgs := parentScopeRecordClauses(scope, parentAlias, actor, deptCodes)
	if len(scopeClauses) == 0 {
		return "", nil
	}
	where := []string{
		parentAlias + "." + quoteID(scope.IDColumn) + " = " + quoteID(scope.LocalColumn),
	}
	if scope.SoftDeleteColumn != "" {
		where = append(where, parentAlias+"."+quoteID(scope.SoftDeleteColumn)+" IS NULL")
	}
	where = append(where, "("+strings.Join(scopeClauses, " OR ")+")")
	return "EXISTS (SELECT 1 FROM " + quoteID(scope.Table) + " " + parentAlias + " WHERE " + strings.Join(where, " AND ") + ")", scopeArgs
}

func parentScopeRecordClauses(scope ParentScopeSpec, tableAlias string, actor string, deptCodes []string) ([]string, []any) {
	columnPrefix := ""
	if strings.TrimSpace(tableAlias) != "" {
		columnPrefix = strings.TrimSpace(tableAlias) + "."
	}
	clauses := make([]string, 0, 2)
	args := make([]any, 0, 4)
	if scope.OwnerColumn != "" {
		clauses = append(clauses, columnPrefix+quoteID(scope.OwnerColumn)+" = ?")
		args = append(args, actor)
	}
	if scope.DepartmentColumn != "" && len(deptCodes) > 0 {
		placeholders := strings.TrimRight(strings.Repeat("?,", len(deptCodes)), ",")
		clauses = append(clauses, columnPrefix+quoteID(scope.DepartmentColumn)+" IN ("+placeholders+")")
		for _, deptCode := range deptCodes {
			args = append(args, deptCode)
		}
	}
	return clauses, args
}

func (a *Adapter) requireParentCreateScope(ctx context.Context, match resourceMatch, columns map[string]columnInfo, fields map[string]any, query url.Values, body map[string]any) error {
	parentScope, hasParentScope, err := normalizedParentScope(match.spec, columns)
	if err != nil || !hasParentScope {
		return err
	}
	actor := actorFrom(query, body)
	if actor == "" {
		return httperror.New(http.StatusUnauthorized, "missing_current_user", "current_user is required")
	}
	if a.hasRuntimeScopeAdmin(match, parentScope, true, runtimeActorScopes(query, body)) {
		return nil
	}
	parentID, ok := fields[parentScope.LocalColumn]
	if !ok || !runtimeFieldPresent(parentID) {
		return httperror.New(http.StatusBadRequest, "missing_parent_scope", "Parent scoped resource id is required")
	}
	return a.requireParentRecordScope(ctx, parentScope, fmt.Sprint(parentID), query, body)
}

func (a *Adapter) requireParentWriteScope(ctx context.Context, match resourceMatch, parentScope ParentScopeSpec, where []string, args []any, query url.Values, body map[string]any) error {
	exists, err := a.recordExists(ctx, match.spec.Table, where, args)
	if err != nil {
		return err
	}
	if !exists {
		return httperror.New(http.StatusNotFound, "record_not_found", "Record not found")
	}
	actor := actorFrom(query, body)
	deptCodes := runtimeActorDeptCodes(query, body)
	parentWhere, parentArgs := parentScopeExistsWhere(parentScope, actor, deptCodes)
	if parentWhere == "" {
		return httperror.New(http.StatusForbidden, "owner_scope_required", "Only the owner or scoped department can modify this record")
	}
	scopedWhere := append([]string(nil), where...)
	scopedWhere = append(scopedWhere, parentWhere)
	scopedArgs := append([]any(nil), args...)
	scopedArgs = append(scopedArgs, parentArgs...)
	allowed, err := a.recordExists(ctx, match.spec.Table, scopedWhere, scopedArgs)
	if err != nil {
		return err
	}
	if !allowed {
		return httperror.New(http.StatusForbidden, "owner_scope_required", "Only the owner or scoped department can modify this record")
	}
	return nil
}

func (a *Adapter) requireParentRecordScope(ctx context.Context, parentScope ParentScopeSpec, parentID string, query url.Values, body map[string]any) error {
	parentID = strings.TrimSpace(parentID)
	if parentID == "" {
		return httperror.New(http.StatusBadRequest, "missing_parent_scope", "Parent scoped resource id is required")
	}
	parentWhere := []string{quoteID(parentScope.IDColumn) + " = ?"}
	parentArgs := []any{parentID}
	if parentScope.SoftDeleteColumn != "" {
		parentWhere = append(parentWhere, quoteID(parentScope.SoftDeleteColumn)+" IS NULL")
	}
	exists, err := a.recordExists(ctx, parentScope.Table, parentWhere, parentArgs)
	if err != nil {
		return err
	}
	if !exists {
		return httperror.New(http.StatusNotFound, "parent_record_not_found", "Parent scoped record not found")
	}
	actor := actorFrom(query, body)
	deptCodes := runtimeActorDeptCodes(query, body)
	scopeClauses, scopeArgs := parentScopeRecordClauses(parentScope, "", actor, deptCodes)
	if len(scopeClauses) == 0 {
		return httperror.New(http.StatusForbidden, "owner_scope_required", "Only the owner or scoped department can modify this record")
	}
	scopedWhere := append([]string(nil), parentWhere...)
	scopedWhere = append(scopedWhere, "("+strings.Join(scopeClauses, " OR ")+")")
	scopedArgs := append([]any(nil), parentArgs...)
	scopedArgs = append(scopedArgs, scopeArgs...)
	allowed, err := a.recordExists(ctx, parentScope.Table, scopedWhere, scopedArgs)
	if err != nil {
		return err
	}
	if !allowed {
		return httperror.New(http.StatusForbidden, "owner_scope_required", "Only the owner or scoped department can modify this record")
	}
	return nil
}

func (a *Adapter) recordExists(ctx context.Context, table string, where []string, args []any) (bool, error) {
	if !safeIdentifier(table) {
		return false, httperror.New(http.StatusInternalServerError, "invalid_table", "Runtime adapter table config is invalid")
	}
	query := "SELECT 1 FROM " + quoteID(table)
	if len(where) > 0 {
		query += " WHERE " + strings.Join(where, " AND ")
	}
	query += " LIMIT 1"
	var marker int
	if err := a.db.QueryRowContext(ctx, query, args...).Scan(&marker); err != nil {
		if err == sql.ErrNoRows {
			return false, nil
		}
		return false, err
	}
	return true, nil
}

func runtimeActorScopes(query url.Values, body map[string]any) []string {
	scopes := make([]string, 0)
	if body != nil {
		scopes = append(scopes, scopeStrings(body["current_user_scopes"])...)
	}
	if query != nil {
		scopes = append(scopes, strings.Fields(query.Get("current_user_scopes"))...)
	}
	return scopes
}

func runtimeActorDeptCodes(query url.Values, body map[string]any) []string {
	if access := runtimeDataAccess(query, body); access == "self" {
		return nil
	} else if access == "dept" {
		return runtimeDataDeptCodes(query, body)
	}

	values := make([]string, 0)
	if body != nil {
		for _, key := range []string{
			"current_user_dept_codes",
			"currentUserDeptCodes",
			"current_user_dept_code",
			"currentUserDeptCode",
			"current_user_department_codes",
			"currentUserDepartmentCodes",
			"current_user_department_code",
			"currentUserDepartmentCode",
		} {
			values = append(values, delimitedStrings(body[key])...)
		}
	}
	if query != nil {
		for _, key := range []string{
			"current_user_dept_codes",
			"currentUserDeptCodes",
			"current_user_dept_code",
			"currentUserDeptCode",
			"current_user_department_codes",
			"currentUserDepartmentCodes",
			"current_user_department_code",
			"currentUserDepartmentCode",
		} {
			for _, value := range query[key] {
				values = append(values, delimitedString(value)...)
			}
		}
	}
	return uniqueStrings(values)
}

func runtimeDataAccess(query url.Values, body map[string]any) string {
	return strings.ToLower(firstNonEmpty(
		bodyString(body, "current_user_data_access", "currentUserDataAccess"),
		queryValue(query, "current_user_data_access", "currentUserDataAccess"),
	))
}

func runtimeDataDeptCodes(query url.Values, body map[string]any) []string {
	values := make([]string, 0)
	if body != nil {
		for _, key := range []string{
			"current_user_data_dept_codes",
			"currentUserDataDeptCodes",
			"current_user_data_dept_code",
			"currentUserDataDeptCode",
		} {
			values = append(values, delimitedStrings(body[key])...)
		}
	}
	if query != nil {
		for _, key := range []string{
			"current_user_data_dept_codes",
			"currentUserDataDeptCodes",
			"current_user_data_dept_code",
			"currentUserDataDeptCode",
		} {
			for _, value := range query[key] {
				values = append(values, delimitedString(value)...)
			}
		}
	}
	return uniqueStrings(values)
}

func bodyString(body map[string]any, keys ...string) string {
	if body == nil {
		return ""
	}
	for _, key := range keys {
		value, ok := body[key]
		if !ok || value == nil {
			continue
		}
		text := strings.TrimSpace(fmt.Sprint(value))
		if text != "" && text != "<nil>" {
			return text
		}
	}
	return ""
}

func queryValue(query url.Values, keys ...string) string {
	if query == nil {
		return ""
	}
	for _, key := range keys {
		if text := strings.TrimSpace(query.Get(key)); text != "" {
			return text
		}
	}
	return ""
}

func runtimeDataAccessForbidden() error {
	return httperror.New(http.StatusForbidden, "data_scope_denied", "current user data scope does not allow this record")
}

func scopeStrings(value any) []string {
	switch typed := value.(type) {
	case nil:
		return nil
	case string:
		return strings.Fields(typed)
	case []string:
		return append([]string(nil), typed...)
	case []any:
		result := make([]string, 0, len(typed))
		for _, item := range typed {
			if text := strings.TrimSpace(fmt.Sprint(item)); text != "" && text != "<nil>" {
				result = append(result, text)
			}
		}
		return result
	default:
		text := strings.TrimSpace(fmt.Sprint(value))
		if text == "" || text == "<nil>" {
			return nil
		}
		return strings.Fields(text)
	}
}

func delimitedStrings(value any) []string {
	switch typed := value.(type) {
	case nil:
		return nil
	case string:
		return delimitedString(typed)
	case []string:
		result := make([]string, 0, len(typed))
		for _, item := range typed {
			result = append(result, delimitedString(item)...)
		}
		return result
	case []any:
		result := make([]string, 0, len(typed))
		for _, item := range typed {
			result = append(result, delimitedString(fmt.Sprint(item))...)
		}
		return result
	default:
		return delimitedString(fmt.Sprint(value))
	}
}

func delimitedString(value string) []string {
	parts := strings.FieldsFunc(value, func(r rune) bool {
		return r == ',' || r == ';' || unicode.IsSpace(r)
	})
	result := make([]string, 0, len(parts))
	for _, part := range parts {
		part = strings.TrimSpace(part)
		if part != "" && part != "<nil>" {
			result = append(result, part)
		}
	}
	return result
}

func uniqueStrings(values []string) []string {
	seen := map[string]bool{}
	result := make([]string, 0, len(values))
	for _, value := range values {
		value = strings.TrimSpace(value)
		if value == "" || value == "<nil>" || seen[value] {
			continue
		}
		seen[value] = true
		result = append(result, value)
	}
	return result
}

func runtimeActorHasAdminScope(appCode string, resource string, scopes []string) bool {
	appCode = strings.TrimSpace(appCode)
	resource = strings.TrimSpace(resource)
	for _, scope := range scopes {
		scope = strings.TrimSpace(scope)
		if scope == "" {
			continue
		}
		if scope == "*" || scope == appCode+".*" || scope == appCode+".admin" {
			return true
		}
		if resource != "" && (scope == appCode+":"+resource+":admin" || scope == appCode+":admin:admin") {
			return true
		}
	}
	return false
}

func resourceScopeName(path string) string {
	first, _, _ := strings.Cut(strings.Trim(path, "/"), "/")
	first = strings.ReplaceAll(first, "-", "_")
	if first == "quotes" {
		return "quotation"
	}
	switch {
	case strings.HasSuffix(first, "ies"):
		return strings.TrimSuffix(first, "ies") + "y"
	case strings.HasSuffix(first, "s"):
		return strings.TrimSuffix(first, "s")
	default:
		return first
	}
}

func (a *Adapter) orderBy(spec ResourceSpec, columns map[string]columnInfo, query url.Values) string {
	sortColumn := toSnakeCase(query.Get("sort"))
	if sortColumn != "" && hasColumn(columns, sortColumn) {
		order := strings.ToUpper(strings.TrimSpace(query.Get("order")))
		if order != "ASC" {
			order = "DESC"
		}
		return quoteID(sortColumn) + " " + order
	}
	if strings.TrimSpace(spec.DefaultOrderBy) != "" {
		return spec.DefaultOrderBy
	}
	if hasColumn(columns, "updated_at") {
		return quoteID("updated_at") + " DESC"
	}
	if hasColumn(columns, "created_at") {
		return quoteID("created_at") + " DESC"
	}
	if hasColumn(columns, spec.IDColumn) {
		return quoteID(spec.IDColumn) + " DESC"
	}
	return "1"
}

func (a *Adapter) tableColumns(ctx context.Context, table string) (map[string]columnInfo, error) {
	a.columnMu.RLock()
	if cached, ok := a.columnCache[table]; ok {
		a.columnMu.RUnlock()
		return cached, nil
	}
	a.columnMu.RUnlock()

	if !safeIdentifier(table) {
		return nil, httperror.New(http.StatusInternalServerError, "invalid_table", "Runtime adapter table config is invalid")
	}

	rows, err := a.db.QueryContext(ctx, `
		SELECT COLUMN_NAME, DATA_TYPE, IS_NULLABLE
		FROM information_schema.COLUMNS
		WHERE TABLE_SCHEMA = DATABASE()
		  AND TABLE_NAME = ?
	`, table)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	columns := map[string]columnInfo{}
	for rows.Next() {
		var name, dataType, isNullable string
		if err := rows.Scan(&name, &dataType, &isNullable); err != nil {
			return nil, err
		}
		columns[name] = columnInfo{
			Name:     name,
			DataType: strings.ToLower(strings.TrimSpace(dataType)),
			Nullable: strings.EqualFold(isNullable, "YES"),
		}
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	if len(columns) == 0 {
		return nil, httperror.New(http.StatusNotFound, "table_not_found", "Runtime adapter table not found")
	}

	a.columnMu.Lock()
	a.columnCache[table] = columns
	a.columnMu.Unlock()
	return columns, nil
}

func (a *Adapter) wrap(data any) any {
	switch a.responseMode {
	case ResponseSuccessData:
		return map[string]any{"success": true, "data": data}
	case ResponseCodeMessageData:
		return map[string]any{"code": 0, "message": "ok", "data": data}
	case ResponseCodeData:
		return map[string]any{"code": 0, "data": data}
	default:
		return map[string]any{"data": data}
	}
}

func (a *Adapter) operation(spec ResourceSpec, action string) string {
	name := strings.ReplaceAll(spec.Path, "/", ".")
	name = strings.ReplaceAll(name, "{", "")
	name = strings.ReplaceAll(name, "}", "")
	name = strings.ReplaceAll(name, "-", "_")
	return a.appCode + "." + name + "." + action
}

func matchPattern(pattern string, suffix string) (map[string]string, []string, bool) {
	patternParts := pathSegments(pattern)
	suffixParts := pathSegments(suffix)
	if len(suffixParts) < len(patternParts) {
		return nil, nil, false
	}
	captures := map[string]string{}
	for i, part := range patternParts {
		actual := suffixParts[i]
		if strings.HasPrefix(part, "{") && strings.HasSuffix(part, "}") {
			key := strings.TrimSuffix(strings.TrimPrefix(part, "{"), "}")
			if key == "" || actual == "" {
				return nil, nil, false
			}
			captures[key] = actual
			continue
		}
		if part != actual {
			return nil, nil, false
		}
	}
	return captures, suffixParts[len(patternParts):], true
}

func pathSegments(path string) []string {
	path = strings.Trim(path, "/")
	if path == "" {
		return nil
	}
	return strings.Split(path, "/")
}

func rowsToMaps(rows *sql.Rows) ([]map[string]any, error) {
	columns, err := rows.Columns()
	if err != nil {
		return nil, err
	}
	result := make([]map[string]any, 0)
	values := make([]any, len(columns))
	targets := make([]any, len(columns))
	for i := range values {
		targets[i] = &values[i]
	}
	for rows.Next() {
		if err := rows.Scan(targets...); err != nil {
			return nil, err
		}
		item := make(map[string]any, len(columns))
		for i, column := range columns {
			item[column] = normalizeSQLValue(values[i])
		}
		result = append(result, item)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	return result, nil
}

func normalizeSQLValue(value any) any {
	switch typed := value.(type) {
	case nil:
		return nil
	case []byte:
		return string(typed)
	case time.Time:
		return typed.UTC().Format("2006-01-02 15:04:05")
	default:
		return typed
	}
}

func normalizeBodyValue(value any, column columnInfo) any {
	switch typed := value.(type) {
	case map[string]any:
		content, err := json.Marshal(typed)
		if err != nil {
			return nil
		}
		return string(content)
	case []any:
		content, err := json.Marshal(typed)
		if err != nil {
			return nil
		}
		return string(content)
	case string:
		if column.Nullable && strings.TrimSpace(typed) == "" {
			return nil
		}
		return typed
	default:
		return typed
	}
}

func getPageParams(query url.Values, maxValues ...int) pageParams {
	maxPageSize := 100
	if len(maxValues) > 0 && maxValues[0] > 0 {
		maxPageSize = maxValues[0]
	}
	page := clampInt(parsePositiveInt(query.Get("page"), 1), 1, 100000)
	pageSize := clampInt(parsePositiveInt(firstNonEmpty(query.Get("pageSize"), query.Get("page_size"), query.Get("limit")), 20), 1, maxPageSize)
	return pageParams{
		page:     page,
		pageSize: pageSize,
		offset:   (page - 1) * pageSize,
	}
}

func parsePositiveInt(value string, fallback int) int {
	parsed, err := strconv.Atoi(strings.TrimSpace(value))
	if err != nil || parsed <= 0 {
		return fallback
	}
	return parsed
}

func clampInt(value int, min int, max int) int {
	if value < min {
		return min
	}
	if value > max {
		return max
	}
	return value
}

func likeKeyword(keyword string) string {
	replacer := strings.NewReplacer("\\", "\\\\", "%", "\\%", "_", "\\_")
	return "%" + replacer.Replace(strings.TrimSpace(keyword)) + "%"
}

func actorFrom(query url.Values, body map[string]any) string {
	if body != nil {
		for _, key := range []string{"operator_uid", "current_user"} {
			if value := strings.TrimSpace(fmt.Sprint(body[key])); value != "" && value != "<nil>" {
				return value
			}
		}
	}
	if query != nil {
		return firstNonEmpty(query.Get("operator_uid"), query.Get("current_user"))
	}
	return ""
}

func firstNonEmpty(values ...string) string {
	for _, value := range values {
		if strings.TrimSpace(value) != "" {
			return strings.TrimSpace(value)
		}
	}
	return ""
}

func firstExistingColumn(columns map[string]columnInfo, candidates ...string) string {
	for _, candidate := range candidates {
		if candidate != "" && hasColumn(columns, candidate) {
			return candidate
		}
	}
	return ""
}

func hasColumn(columns map[string]columnInfo, column string) bool {
	if column == "" {
		return false
	}
	_, ok := columns[column]
	return ok
}

func shouldSkipCreateColumn(columns map[string]columnInfo, column string, idColumn string) bool {
	if !hasColumn(columns, column) || column == "created_at" || column == "updated_at" {
		return true
	}
	return column == idColumn && idColumn == "id"
}

func writeDeniedColumn(spec ResourceSpec, column string) bool {
	for _, denied := range spec.WriteDenyColumns {
		if strings.EqualFold(strings.TrimSpace(denied), column) {
			return true
		}
	}
	return false
}

func quoteID(identifier string) string {
	if !safeIdentifier(identifier) {
		return "``"
	}
	return "`" + strings.ReplaceAll(identifier, "`", "``") + "`"
}

func quoteIDList(identifiers []string) string {
	parts := make([]string, 0, len(identifiers))
	for _, identifier := range identifiers {
		parts = append(parts, quoteID(identifier))
	}
	return strings.Join(parts, ", ")
}

func safeIdentifier(identifier string) bool {
	if identifier == "" {
		return false
	}
	for _, r := range identifier {
		if !(r == '_' || r == '-' || unicode.IsLetter(r) || unicode.IsDigit(r)) {
			return false
		}
	}
	return true
}

func toSnakeCase(value string) string {
	value = strings.TrimSpace(value)
	if value == "" {
		return ""
	}
	var builder strings.Builder
	var previousLower bool
	for _, r := range value {
		switch {
		case r == '-' || r == ' ' || r == '.':
			builder.WriteRune('_')
			previousLower = false
		case unicode.IsUpper(r):
			if previousLower {
				builder.WriteRune('_')
			}
			builder.WriteRune(unicode.ToLower(r))
			previousLower = false
		default:
			builder.WriteRune(r)
			previousLower = unicode.IsLetter(r) || unicode.IsDigit(r)
		}
	}
	return builder.String()
}

func generateCode(prefix string) string {
	bytes := make([]byte, 4)
	if _, err := rand.Read(bytes); err != nil {
		return strings.ToUpper(prefix) + time.Now().UTC().Format("20060102150405")
	}
	return strings.ToUpper(prefix) + "-" + time.Now().UTC().Format("20060102150405") + "-" + strings.ToUpper(hex.EncodeToString(bytes))
}
