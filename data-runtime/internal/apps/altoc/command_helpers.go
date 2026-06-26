package altoc

import (
	"context"
	"database/sql"
	"encoding/json"
	"fmt"
	"net/http"
	"net/url"
	"sort"
	"strconv"
	"strings"
	"time"

	"github.com/huizhi-yun/data-runtime/internal/httperror"
)

func altocActor(body map[string]any) string {
	return firstNonEmptyText(
		firstBodyText(body, "operatorUid", "operator_uid", "currentUser", "current_user", "updatedBy", "updated_by", "createdBy", "created_by"),
		"system",
	)
}

func altocRequireOwnerWrite(body map[string]any, resource string, owner any) error {
	actor := altocActor(body)
	if actor == "" || actor == "system" {
		return httperror.New(http.StatusUnauthorized, "missing_current_user", "current_user is required")
	}
	if altocDataAccessMode(body) == "none" {
		return altocDataAccessForbidden()
	}
	if altocActorHasAllDataAccess(body, resource) {
		return nil
	}
	ownerText := strings.TrimSpace(fmt.Sprint(owner))
	if owner == nil || ownerText == "" || ownerText == "<nil>" {
		return nil
	}
	if ownerText != actor {
		return httperror.New(http.StatusForbidden, "owner_scope_required", "Only the owner can modify this record")
	}
	return nil
}

func altocRequireRecordWrite(body map[string]any, resource string, record map[string]any, ownerColumn string, departmentColumn string) error {
	actor := altocActor(body)
	if actor == "" || actor == "system" {
		return httperror.New(http.StatusUnauthorized, "missing_current_user", "current_user is required")
	}
	if altocDataAccessMode(body) == "none" {
		return altocDataAccessForbidden()
	}
	if altocActorHasAllDataAccess(body, resource) {
		return nil
	}
	ownerColumn = strings.TrimSpace(ownerColumn)
	departmentColumn = strings.TrimSpace(departmentColumn)
	if ownerColumn != "" && strings.TrimSpace(altocMapText(record, ownerColumn)) == actor {
		return nil
	}
	if departmentColumn != "" {
		recordDept := strings.TrimSpace(altocMapText(record, departmentColumn))
		for _, deptCode := range altocScopedDeptCodes(body) {
			if recordDept != "" && recordDept == deptCode {
				return nil
			}
		}
	}
	if ownerColumn == "" && departmentColumn == "" {
		return nil
	}
	if strings.TrimSpace(altocMapText(record, ownerColumn)) == "" && strings.TrimSpace(altocMapText(record, departmentColumn)) == "" {
		return nil
	}
	return httperror.New(http.StatusForbidden, "write_scope_required", "Only the owner, scoped department, or admin can modify this record")
}

func altocRequireActionScope(body map[string]any, resource string, action string) error {
	scopes := altocActorScopes(body)
	if len(scopes) == 0 {
		return nil
	}
	actor := altocActor(body)
	if actor == "" || actor == "system" {
		return httperror.New(http.StatusUnauthorized, "missing_current_user", "current_user is required")
	}
	resource = strings.TrimSpace(resource)
	action = strings.TrimSpace(action)
	if resource == "" || action == "" || altocActorHasAdminScope(body, resource) {
		return nil
	}
	for _, scope := range scopes {
		if altocActorScopeAllowsAction(scope, resource, action) {
			return nil
		}
	}
	return httperror.New(http.StatusForbidden, "permission_scope_required", "required permission scope is missing")
}

func altocActionCoveredByEdit(action string) bool {
	switch strings.TrimSpace(action) {
	case "create", "edit", "update", "delete":
		return true
	default:
		return false
	}
}

func altocReadScopeWhere(query url.Values, resource string, tableAlias string, ownerColumn string, departmentColumn string) ([]string, []any, error) {
	body := altocRuntimeBodyFromQuery(query)
	return altocReadScopeWhereFromBody(body, resource, tableAlias, ownerColumn, departmentColumn)
}

func altocReadScopeWhereFromBody(body map[string]any, resource string, tableAlias string, ownerColumn string, departmentColumn string) ([]string, []any, error) {
	if altocDataAccessMode(body) == "none" {
		return nil, nil, altocDataAccessForbidden()
	}
	if altocActorHasAllDataAccess(body, resource) {
		return nil, nil, nil
	}
	actor := firstBodyText(body, "current_user", "currentUser", "operator_uid", "operatorUid")
	if actor == "" {
		return nil, nil, httperror.New(http.StatusUnauthorized, "missing_current_user", "current_user is required")
	}

	clauses := make([]string, 0, 2)
	args := make([]any, 0, 4)
	if strings.TrimSpace(ownerColumn) != "" {
		clauses = append(clauses, altocQualifiedColumn(tableAlias, ownerColumn)+" = ?")
		args = append(args, actor)
	}
	deptCodes := altocScopedDeptCodes(body)
	if strings.TrimSpace(departmentColumn) != "" && len(deptCodes) > 0 {
		placeholders := strings.TrimRight(strings.Repeat("?,", len(deptCodes)), ",")
		clauses = append(clauses, altocQualifiedColumn(tableAlias, departmentColumn)+" IN ("+placeholders+")")
		for _, deptCode := range deptCodes {
			args = append(args, deptCode)
		}
	}
	if len(clauses) == 0 {
		return []string{"1 = 0"}, nil, nil
	}
	return []string{"(" + strings.Join(clauses, " OR ") + ")"}, args, nil
}

func altocRecordMatchesReadScope(body map[string]any, resource string, record map[string]any, ownerColumn string, departmentColumn string) (bool, error) {
	if altocDataAccessMode(body) == "none" {
		return false, altocDataAccessForbidden()
	}
	if altocActorHasAllDataAccess(body, resource) {
		return true, nil
	}
	actor := firstBodyText(body, "current_user", "currentUser", "operator_uid", "operatorUid")
	if actor == "" {
		return false, httperror.New(http.StatusUnauthorized, "missing_current_user", "current_user is required")
	}
	if strings.TrimSpace(ownerColumn) != "" && strings.TrimSpace(altocMapText(record, ownerColumn)) == actor {
		return true, nil
	}
	if strings.TrimSpace(departmentColumn) != "" {
		recordDept := strings.TrimSpace(altocMapText(record, departmentColumn))
		for _, deptCode := range altocScopedDeptCodes(body) {
			if recordDept != "" && recordDept == deptCode {
				return true, nil
			}
		}
	}
	return false, nil
}

func altocQualifiedColumn(tableAlias string, column string) string {
	tableAlias = strings.TrimSpace(tableAlias)
	column = strings.TrimSpace(column)
	if tableAlias == "" {
		return column
	}
	return tableAlias + "." + column
}

func altocActorHasAdminScope(body map[string]any, resource string) bool {
	resource = strings.TrimSpace(resource)
	for _, scope := range altocActorScopes(body) {
		scope = altocScopeSuffix(scope)
		if scope == "" {
			continue
		}
		if scope == "*" || scope == "altoc.*" || scope == "altoc:*" || scope == "altoc.admin" || scope == "altoc:admin" || scope == "altoc:admin:admin" {
			return true
		}
		if resource != "" && scope == "altoc:"+resource+":admin" {
			return true
		}
	}
	return false
}

func altocActorScopeAllowsAction(scope string, resource string, action string) bool {
	scope = altocScopeSuffix(scope)
	resource = strings.TrimSpace(resource)
	action = strings.TrimSpace(action)
	if scope == "" || resource == "" || action == "" {
		return false
	}
	if scope == "*" || scope == "altoc.*" || scope == "altoc:*" || scope == "altoc.admin" || scope == "altoc:admin" || scope == "altoc:admin:admin" {
		return true
	}
	if scope == "altoc:"+resource+":admin" {
		return true
	}
	if scope == "altoc:"+resource+":"+action {
		return true
	}
	if altocActionCoveredByEdit(action) && scope == "altoc:"+resource+":edit" {
		return true
	}
	return action == "view" && scope == "altoc:"+resource+":edit"
}

func altocScopeSuffix(scope string) string {
	scope = strings.TrimSpace(scope)
	if scope == "" {
		return ""
	}
	if scope == "*" || strings.HasPrefix(scope, "altoc.") {
		return scope
	}
	parts := strings.Split(scope, ":")
	for index, part := range parts {
		if strings.TrimSpace(part) == "altoc" {
			return strings.Join(parts[index:], ":")
		}
	}
	return scope
}

func altocActorHasAllDataAccess(body map[string]any, resource string) bool {
	if mode := altocDataAccessMode(body); mode != "" {
		return mode == "all"
	}
	return altocActorHasAdminScope(body, resource)
}

func altocDataAccessMode(body map[string]any) string {
	return strings.ToLower(strings.TrimSpace(firstBodyText(
		body,
		"current_user_altoc_access",
		"currentUserAltocAccess",
		"current_user_data_access",
		"currentUserDataAccess",
	)))
}

func altocScopedDeptCodes(body map[string]any) []string {
	switch altocDataAccessMode(body) {
	case "self":
		return nil
	case "dept":
		return altocDataDeptCodes(body)
	default:
		return altocActorDeptCodes(body)
	}
}

func altocDataDeptCodes(body map[string]any) []string {
	values := make([]string, 0)
	for _, key := range []string{
		"current_user_altoc_dept_codes",
		"currentUserAltocDeptCodes",
		"current_user_altoc_dept_code",
		"currentUserAltocDeptCode",
		"current_user_data_dept_codes",
		"currentUserDataDeptCodes",
		"current_user_data_dept_code",
		"currentUserDataDeptCode",
	} {
		values = append(values, altocDelimitedStrings(body[key])...)
	}
	return altocUniqueStrings(values)
}

func altocDataAccessForbidden() error {
	return httperror.New(http.StatusForbidden, "data_scope_denied", "current user data scope does not allow this record")
}

func altocActorDeptCodes(body map[string]any) []string {
	values := make([]string, 0)
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
		values = append(values, altocDelimitedStrings(body[key])...)
	}
	return altocUniqueStrings(values)
}

func altocActorDeptCode(body map[string]any) string {
	deptCodes := altocActorDeptCodes(body)
	if len(deptCodes) == 0 {
		return ""
	}
	return deptCodes[0]
}

func altocActorScopes(body map[string]any) []string {
	if body == nil {
		return nil
	}
	switch typed := body["current_user_scopes"].(type) {
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
		text := strings.TrimSpace(fmt.Sprint(typed))
		if text == "" || text == "<nil>" {
			return nil
		}
		return strings.Fields(text)
	}
}

func altocDelimitedStrings(value any) []string {
	switch typed := value.(type) {
	case nil:
		return nil
	case string:
		return altocDelimitedString(typed)
	case []string:
		result := make([]string, 0, len(typed))
		for _, item := range typed {
			result = append(result, altocDelimitedString(item)...)
		}
		return result
	case []any:
		result := make([]string, 0, len(typed))
		for _, item := range typed {
			result = append(result, altocDelimitedString(fmt.Sprint(item))...)
		}
		return result
	default:
		return altocDelimitedString(fmt.Sprint(value))
	}
}

func altocDelimitedString(value string) []string {
	value = strings.NewReplacer(",", " ", ";", " ").Replace(value)
	parts := strings.Fields(value)
	result := make([]string, 0, len(parts))
	for _, part := range parts {
		part = strings.TrimSpace(part)
		if part != "" && part != "<nil>" {
			result = append(result, part)
		}
	}
	return result
}

func altocUniqueStrings(values []string) []string {
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

func altocMapText(source map[string]any, keys ...string) string {
	if source == nil {
		return ""
	}
	for _, key := range keys {
		value, ok := source[key]
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

func altocBodyValue(body map[string]any, snakeKey string) (any, bool) {
	if body == nil {
		return nil, false
	}
	if value, ok := body[snakeKey]; ok {
		return value, true
	}
	parts := strings.Split(snakeKey, "_")
	if len(parts) <= 1 {
		return nil, false
	}
	camel := parts[0]
	for _, part := range parts[1:] {
		if part == "" {
			continue
		}
		camel += strings.ToUpper(part[:1]) + part[1:]
	}
	value, ok := body[camel]
	return value, ok
}

func altocBodyText(body map[string]any, snakeKey string) string {
	value, ok := altocBodyValue(body, snakeKey)
	if !ok || value == nil {
		return ""
	}
	text := strings.TrimSpace(fmt.Sprint(value))
	if text == "" || text == "<nil>" {
		return ""
	}
	return text
}

func altocPositiveID(value any) int64 {
	text := strings.TrimSpace(fmt.Sprint(value))
	if value == nil || text == "" || text == "<nil>" {
		return 0
	}
	parsed, err := strconv.ParseInt(text, 10, 64)
	if err != nil || parsed <= 0 {
		return 0
	}
	return parsed
}

func altocIdentifierID(raw string, name string) (int64, error) {
	id := altocPositiveID(raw)
	if id <= 0 {
		return 0, httperror.New(http.StatusBadRequest, "invalid_"+name, name+" is invalid")
	}
	return id, nil
}

func altocBool(value any) bool {
	switch typed := value.(type) {
	case bool:
		return typed
	case int:
		return typed != 0
	case int64:
		return typed != 0
	case float64:
		return typed != 0
	case string:
		text := strings.TrimSpace(strings.ToLower(typed))
		return text == "1" || text == "true" || text == "yes"
	default:
		text := strings.TrimSpace(strings.ToLower(fmt.Sprint(value)))
		return text == "1" || text == "true" || text == "yes"
	}
}

func altocDateTimeText(value string) any {
	value = strings.TrimSpace(value)
	if value == "" || value == "<nil>" {
		return nil
	}
	if parsed, err := time.Parse(time.RFC3339, value); err == nil {
		return parsed.UTC().Format("2006-01-02 15:04:05")
	}
	if parsed, err := time.Parse("2006-01-02", value); err == nil {
		return parsed.Format("2006-01-02") + " 00:00:00"
	}
	value = strings.ReplaceAll(value, "T", " ")
	if len(value) >= 19 {
		return value[:19]
	}
	return value
}

func altocDateText(value string) any {
	value = strings.TrimSpace(value)
	if value == "" || value == "<nil>" {
		return nil
	}
	if len(value) >= 10 {
		value = value[:10]
	}
	if _, err := time.Parse("2006-01-02", value); err == nil {
		return value
	}
	return value
}

func altocOptionalMoney(body map[string]any, keys ...string) any {
	for _, key := range keys {
		value, ok := altocBodyValue(body, key)
		if !ok || value == nil {
			continue
		}
		text := strings.TrimSpace(fmt.Sprint(value))
		if text == "" || text == "<nil>" {
			return nil
		}
		return value
	}
	return nil
}

func altocTableColumns(ctx context.Context, conn altocQueryer, table string) (map[string]bool, error) {
	rows, err := conn.QueryContext(ctx, `
		SELECT COLUMN_NAME
		FROM information_schema.COLUMNS
		WHERE TABLE_SCHEMA = DATABASE()
		  AND TABLE_NAME = ?
	`, table)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	columns := map[string]bool{}
	for rows.Next() {
		var name string
		if err := rows.Scan(&name); err != nil {
			return nil, err
		}
		columns[name] = true
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	return columns, nil
}

func altocTableExists(ctx context.Context, conn altocQueryer, table string) (bool, error) {
	row, err := altocQueryOneMap(ctx, conn, `
		SELECT COUNT(*) AS count
		FROM information_schema.TABLES
		WHERE TABLE_SCHEMA = DATABASE()
		  AND TABLE_NAME = ?
	`, table)
	if err != nil {
		return false, err
	}
	return moneyValue(row["count"]) > 0, nil
}

func altocInsertRecordTx(ctx context.Context, tx *sql.Tx, table string, fields map[string]any) (int64, error) {
	columns, err := altocTableColumns(ctx, tx, table)
	if err != nil {
		return 0, err
	}
	names := make([]string, 0, len(fields))
	for name := range fields {
		if columns[name] {
			names = append(names, name)
		}
	}
	if len(names) == 0 {
		return 0, httperror.New(http.StatusBadRequest, "empty_record", "No writable fields provided")
	}
	sort.Strings(names)

	args := make([]any, 0, len(names))
	placeholders := make([]string, 0, len(names))
	for _, name := range names {
		placeholders = append(placeholders, "?")
		args = append(args, altocNormalizeInsertValue(fields[name]))
	}
	result, err := tx.ExecContext(ctx, "INSERT INTO "+altocQuoteID(table)+" ("+altocQuoteIDList(names)+") VALUES ("+strings.Join(placeholders, ", ")+")", args...)
	if err != nil {
		return 0, err
	}
	id, _ := result.LastInsertId()
	return id, nil
}

func altocNormalizeInsertValue(value any) any {
	switch typed := value.(type) {
	case map[string]any:
		encoded, err := json.Marshal(typed)
		if err != nil {
			return nil
		}
		return string(encoded)
	case []any:
		encoded, err := json.Marshal(typed)
		if err != nil {
			return nil
		}
		return string(encoded)
	default:
		return value
	}
}

func altocNormalizeEntityName(value string) string {
	value = strings.ToLower(strings.TrimSpace(value))
	replacer := strings.NewReplacer(" ", "", "\t", "", "\n", "", "\r", "", "　", "", "（", "(", "）", ")")
	return replacer.Replace(value)
}

func altocNormalizeMobile(value string) string {
	var builder strings.Builder
	for _, char := range strings.TrimSpace(value) {
		if char >= '0' && char <= '9' {
			builder.WriteRune(char)
		}
	}
	return builder.String()
}

func altocNormalizeEmail(value string) string {
	return strings.ToLower(strings.TrimSpace(value))
}

func altocNormalizeDomain(value string) string {
	value = strings.ToLower(strings.TrimSpace(value))
	value = strings.TrimPrefix(value, "https://")
	value = strings.TrimPrefix(value, "http://")
	value = strings.TrimPrefix(value, "www.")
	if slash := strings.Index(value, "/"); slash >= 0 {
		value = value[:slash]
	}
	return value
}

func altocQuoteID(identifier string) string {
	return "`" + strings.ReplaceAll(identifier, "`", "``") + "`"
}

func altocQuoteIDList(names []string) string {
	quoted := make([]string, 0, len(names))
	for _, name := range names {
		quoted = append(quoted, altocQuoteID(name))
	}
	return strings.Join(quoted, ", ")
}

func insertAltocAuditTx(ctx context.Context, tx *sql.Tx, entityType string, entityID any, action string, oldValue any, newValue any, operator string) error {
	if operator = strings.TrimSpace(operator); operator == "" {
		operator = "system"
	}
	oldJSON, _ := json.Marshal(oldValue)
	newJSON, _ := json.Marshal(newValue)
	_, err := altocInsertRecordTx(ctx, tx, "audit_log", map[string]any{
		"entity_type": entityType,
		"entity_id":   entityID,
		"action":      action,
		"old_value":   string(oldJSON),
		"new_value":   string(newJSON),
		"operator_id": operator,
	})
	return err
}

func insertAltocSalesTaskIfNeededTx(ctx context.Context, tx *sql.Tx, relatedType string, relatedID any, name string, dueAt any, assignee string, operator string) error {
	name = strings.TrimSpace(name)
	if name == "" {
		return nil
	}
	exists, err := altocTableExists(ctx, tx, "sales_task")
	if err != nil || !exists {
		return err
	}
	assignee = firstNonEmptyText(assignee, operator)
	if assignee == "" {
		return nil
	}
	columns, err := altocTableColumns(ctx, tx, "sales_task")
	if err != nil {
		return err
	}
	if where, args, ok := salesTaskDuplicateWhere(columns, relatedType, relatedID, name, dueAt, assignee); ok {
		var existingID int64
		err := tx.QueryRowContext(ctx, "SELECT id FROM sales_task WHERE "+strings.Join(where, " AND ")+" LIMIT 1", args...).Scan(&existingID)
		if err == nil && existingID > 0 {
			return nil
		}
		if err != nil && err != sql.ErrNoRows {
			return err
		}
	}
	code, err := nextAltocCode(ctx, tx, "TK", "sales_task")
	if err != nil {
		return err
	}
	_, err = altocInsertRecordTx(ctx, tx, "sales_task", map[string]any{
		"code":             code,
		"name":             name,
		"related_type":     relatedType,
		"related_id":       relatedID,
		"assignee_user_id": assignee,
		"due_at":           dueAt,
		"status":           "todo",
		"priority":         "medium",
		"created_by":       nullableText(operator),
		"updated_by":       nullableText(operator),
	})
	return err
}

func salesTaskDuplicateWhere(columns map[string]bool, relatedType string, relatedID any, name string, dueAt any, assignee string) ([]string, []any, bool) {
	relatedType = strings.TrimSpace(relatedType)
	name = strings.TrimSpace(name)
	assignee = strings.TrimSpace(assignee)
	if relatedType == "" || name == "" || assignee == "" || altocPositiveID(relatedID) <= 0 {
		return nil, nil, false
	}
	for _, column := range []string{"related_type", "related_id", "name", "assignee_user_id"} {
		if !columns[column] {
			return nil, nil, false
		}
	}

	where := []string{
		"related_type = ?",
		"related_id = ?",
		"name = ?",
		"assignee_user_id = ?",
	}
	args := []any{relatedType, relatedID, name, assignee}
	if columns["due_at"] {
		where = append(where, "due_at <=> ?")
		args = append(args, dueAt)
	}
	if columns["status"] {
		where = append(where, "(status IS NULL OR status IN ('todo', 'doing', 'overdue'))")
	}
	if columns["deleted_at"] {
		where = append(where, "deleted_at IS NULL")
	}
	return where, args, true
}
