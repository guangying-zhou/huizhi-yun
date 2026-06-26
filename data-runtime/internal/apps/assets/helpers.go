package assets

import (
	"context"
	"crypto/rand"
	"database/sql"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"time"

	"github.com/huizhi-yun/data-runtime/internal/httperror"
)

type summaryMetric map[string]any

func okWithMessage(data any, message string) map[string]any {
	if strings.TrimSpace(message) == "" {
		message = "ok"
	}
	return map[string]any{"code": 0, "message": message, "data": data}
}

func (a *Adapter) queryMaps(ctx context.Context, query string, args ...any) ([]map[string]any, error) {
	rows, err := a.DB().QueryContext(ctx, query, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	return rowsToMaps(rows)
}

func (a *Adapter) queryRowMap(ctx context.Context, query string, args ...any) (map[string]any, error) {
	items, err := a.queryMaps(ctx, query, args...)
	if err != nil {
		return nil, err
	}
	if len(items) == 0 {
		return nil, nil
	}
	return items[0], nil
}

func (a *Adapter) tableColumnExists(ctx context.Context, tableName string, columnName string) (bool, error) {
	var count int
	if err := a.DB().QueryRowContext(ctx, `
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

func (a *Adapter) physicalConfigDetailColumnExists(ctx context.Context) (bool, error) {
	return a.tableColumnExists(ctx, "asset_physical_details", "config_detail")
}

func (a *Adapter) physicalConfigDetailSelect(ctx context.Context) (string, error) {
	exists, err := a.physicalConfigDetailColumnExists(ctx)
	if err != nil {
		return "", err
	}
	if !exists {
		return "NULL AS config_detail", nil
	}
	return "apd.config_detail", nil
}

func rowsToMaps(rows *sql.Rows) ([]map[string]any, error) {
	columns, err := rows.Columns()
	if err != nil {
		return nil, err
	}
	values := make([]any, len(columns))
	targets := make([]any, len(columns))
	for i := range values {
		targets[i] = &values[i]
	}
	result := make([]map[string]any, 0)
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

func (a *Adapter) withTx(ctx context.Context, fn func(*sql.Tx) (any, error)) (any, error) {
	tx, err := a.DB().BeginTx(ctx, nil)
	if err != nil {
		return nil, err
	}
	result, err := fn(tx)
	if err != nil {
		_ = tx.Rollback()
		return nil, err
	}
	if err := tx.Commit(); err != nil {
		return nil, err
	}
	return result, nil
}

func actorFromRequest(query url.Values, body map[string]any) string {
	for _, key := range []string{"operator_uid", "current_user"} {
		if value := cleanAnyString(body[key]); value != "" {
			return value
		}
	}
	for _, key := range []string{"operator_uid", "current_user"} {
		if value := strings.TrimSpace(query.Get(key)); value != "" {
			return value
		}
	}
	return ""
}

func cleanAnyString(value any) string {
	if value == nil {
		return ""
	}
	text := strings.TrimSpace(fmt.Sprint(value))
	if text == "<nil>" {
		return ""
	}
	return text
}

func bodyText(body map[string]any, key string) string {
	return cleanAnyString(body[key])
}

func nullableBodyText(body map[string]any, key string) any {
	value := bodyText(body, key)
	if value == "" {
		return nil
	}
	return value
}

func bodyInt64(body map[string]any, key string) int64 {
	return int64FromAny(body[key], 0)
}

func nullableBodyInt64(body map[string]any, key string) any {
	value := int64FromAny(body[key], 0)
	if value == 0 {
		return nil
	}
	return value
}

func float64FromAny(value any) float64 {
	switch typed := value.(type) {
	case int:
		return float64(typed)
	case int64:
		return float64(typed)
	case float64:
		return typed
	case json.Number:
		parsed, _ := typed.Float64()
		return parsed
	case string:
		parsed, _ := strconv.ParseFloat(strings.TrimSpace(typed), 64)
		return parsed
	default:
		return 0
	}
}

func nullableBodyFloat(body map[string]any, key string) any {
	if _, ok := body[key]; !ok || body[key] == nil {
		return nil
	}
	return float64FromAny(body[key])
}

func boolIntFromAny(value any) any {
	switch typed := value.(type) {
	case bool:
		if typed {
			return int64(1)
		}
		return int64(0)
	case string:
		text := strings.TrimSpace(strings.ToLower(typed))
		if text == "" {
			return nil
		}
		if text == "true" || text == "1" || text == "yes" {
			return int64(1)
		}
		return int64(0)
	case nil:
		return nil
	default:
		if float64FromAny(value) != 0 {
			return int64(1)
		}
		return int64(0)
	}
}

func coalesceText(body map[string]any, key string, fallback string) string {
	if value := bodyText(body, key); value != "" {
		return value
	}
	return fallback
}

func firstText(values ...string) string {
	for _, value := range values {
		if text := strings.TrimSpace(value); text != "" {
			return text
		}
	}
	return ""
}

func likeSearch(query url.Values) any {
	search := firstText(query.Get("search"), query.Get("keyword"), query.Get("q"))
	if search == "" {
		return nil
	}
	return "%" + search + "%"
}

func statusFilter(query url.Values) any {
	status := strings.TrimSpace(query.Get("status"))
	if status == "" {
		return nil
	}
	return status
}

func metric(label string, value any, hint string, color string) summaryMetric {
	return summaryMetric{"label": label, "value": value, "hint": hint, "color": color}
}

func asFloat(value any) float64 {
	return float64FromAny(value)
}

func asInt(value any) int64 {
	return int64FromAny(value, 0)
}

func formatMoney(value any) string {
	return fmt.Sprintf("¥%.2f", asFloat(value))
}

func buildCode(prefix string) string {
	random := make([]byte, 2)
	if _, err := rand.Read(random); err != nil {
		return strings.ToUpper(prefix) + "-" + time.Now().UTC().Format("20060102150405")
	}
	return strings.ToUpper(prefix) + "-" + time.Now().UTC().Format("20060102150405") + "-" + strings.ToUpper(hex.EncodeToString(random))
}

func generateUUID() string {
	bytes := make([]byte, 16)
	if _, err := rand.Read(bytes); err != nil {
		return buildCode("UUID")
	}
	bytes[6] = (bytes[6] & 0x0f) | 0x40
	bytes[8] = (bytes[8] & 0x3f) | 0x80
	return fmt.Sprintf("%x-%x-%x-%x-%x", bytes[0:4], bytes[4:6], bytes[6:8], bytes[8:10], bytes[10:])
}

func normalizeCodeToken(input string, fallback string) string {
	builder := strings.Builder{}
	for _, r := range input {
		if (r >= 'a' && r <= 'z') || (r >= 'A' && r <= 'Z') || (r >= '0' && r <= '9') {
			builder.WriteRune(r)
		}
		if builder.Len() >= 4 {
			break
		}
	}
	value := strings.ToUpper(builder.String())
	if value == "" {
		return fallback
	}
	return value
}

func buildPhysicalAssetCode(subtype string, itemType string, subtypeToken string, itemTypeToken string) string {
	subtypeCode := firstText(subtypeToken, normalizeCodeToken(subtype, "PHYS"))
	itemCode := firstText(itemTypeToken, normalizeCodeToken(itemType, "ITEM"))
	random := make([]byte, 2)
	if _, err := rand.Read(random); err != nil {
		return "DV-" + subtypeCode + "-" + itemCode + "-" + time.Now().UTC().Format("20060102")
	}
	return "DV-" + subtypeCode + "-" + itemCode + "-" + time.Now().UTC().Format("20060102") + "-" + strings.ToUpper(hex.EncodeToString(random))
}

func singlePathParam(path string, prefix string) (string, bool) {
	if !strings.HasPrefix(path, prefix) {
		return "", false
	}
	value := strings.Trim(strings.TrimPrefix(path, prefix), "/")
	if value == "" || strings.Contains(value, "/") {
		return "", false
	}
	return value, true
}

func pathParamWithSuffix(path string, prefix string, suffix string) (string, bool) {
	if !strings.HasPrefix(path, prefix) || !strings.HasSuffix(path, suffix) {
		return "", false
	}
	value := strings.TrimSuffix(strings.TrimPrefix(path, prefix), suffix)
	value = strings.Trim(value, "/")
	if value == "" || strings.Contains(value, "/") {
		return "", false
	}
	return value, true
}

func parsePositiveID(value string) (int64, error) {
	id, err := strconv.ParseInt(strings.TrimSpace(value), 10, 64)
	if err != nil || id <= 0 {
		return 0, httperror.New(http.StatusBadRequest, "invalid_id", "Invalid id")
	}
	return id, nil
}

func requireIDBody(body map[string]any, key string, message string) (int64, error) {
	id := bodyInt64(body, key)
	if id <= 0 {
		return 0, httperror.New(http.StatusBadRequest, "missing_required_field", message)
	}
	return id, nil
}

func assertProjectPurpose(purpose string, projectCode string, subject string) error {
	if purpose == "project_procurement" && strings.TrimSpace(projectCode) == "" {
		return httperror.New(http.StatusBadRequest, "project_code_required", subject+"为项目采购时必须填写 project_code")
	}
	return nil
}

func jsonOrNil(value any) any {
	if value == nil {
		return nil
	}
	switch typed := value.(type) {
	case string:
		if strings.TrimSpace(typed) == "" {
			return nil
		}
		return typed
	default:
		content, err := json.Marshal(typed)
		if err != nil {
			return nil
		}
		return string(content)
	}
}

func mapField(body map[string]any, key string) map[string]any {
	value, ok := body[key].(map[string]any)
	if !ok || value == nil {
		return map[string]any{}
	}
	return value
}

func parseJSONStringList(value any) []string {
	switch typed := value.(type) {
	case nil:
		return []string{}
	case []string:
		return cleanStringList(typed)
	case []any:
		items := make([]string, 0, len(typed))
		for _, item := range typed {
			items = append(items, cleanAnyString(item))
		}
		return cleanStringList(items)
	}

	text := cleanAnyString(value)
	if text == "" {
		return []string{}
	}

	var values []string
	if err := json.Unmarshal([]byte(text), &values); err == nil {
		return values
	}

	var rawValues []any
	if err := json.Unmarshal([]byte(text), &rawValues); err == nil {
		result := make([]string, 0, len(rawValues))
		for _, item := range rawValues {
			if text := cleanAnyString(item); text != "" {
				result = append(result, text)
			}
		}
		return result
	}

	var scalar string
	if err := json.Unmarshal([]byte(text), &scalar); err == nil {
		if scalar = strings.TrimSpace(scalar); scalar != "" {
			return []string{scalar}
		}
		return []string{}
	}

	return splitDelimitedText(text)
}

func jsonStringListOrNil(value any) any {
	items := parseJSONStringList(value)
	if len(items) == 0 {
		return nil
	}
	content, err := json.Marshal(items)
	if err != nil {
		return nil
	}
	return string(content)
}

func jsonStringListOrFallback(value any, fallback []string) any {
	if content := jsonStringListOrNil(value); content != nil {
		return content
	}
	content, err := json.Marshal(cleanStringList(fallback))
	if err != nil {
		return nil
	}
	return string(content)
}

func cleanStringList(values []string) []string {
	result := make([]string, 0, len(values))
	seen := map[string]bool{}
	for _, value := range values {
		item := strings.TrimSpace(value)
		if item == "" || seen[item] {
			continue
		}
		seen[item] = true
		result = append(result, item)
	}
	return result
}

func splitDelimitedText(text string) []string {
	text = strings.TrimSpace(text)
	if text == "" {
		return []string{}
	}
	fields := strings.FieldsFunc(text, func(r rune) bool {
		switch r {
		case ',', '，', '、', ';', '；', '\n', '\r', '\t':
			return true
		default:
			return false
		}
	})
	result := make([]string, 0, len(fields))
	for _, field := range fields {
		result = append(result, field)
	}
	return cleanStringList(result)
}

func parseJSONList(value any) []any {
	text := cleanAnyString(value)
	if text == "" {
		return []any{}
	}
	var items []any
	if err := json.Unmarshal([]byte(text), &items); err != nil {
		return []any{}
	}
	return items
}

func normalizeAssetMap(item map[string]any) map[string]any {
	if tags, ok := item["tags"]; ok {
		item["tags"] = parseJSONList(tags)
	}
	return item
}

func normalizeProductMap(item map[string]any) map[string]any {
	for _, key := range []string{"customer_domain", "supported_terminals", "covered_legacy_systems"} {
		if value, ok := item[key]; ok {
			item[key] = parseJSONStringList(value)
		}
	}
	return item
}

func normalizeBoolField(item map[string]any, key string) map[string]any {
	if value, ok := item[key]; ok {
		item[key] = asInt(value) != 0
	}
	return item
}

func notFound(message string) error {
	return httperror.New(http.StatusNotFound, "record_not_found", message)
}

func insertEvent(ctx context.Context, tx *sql.Tx, objectType string, objectID int64, eventType string, operatorUID string, eventData map[string]any) error {
	var content any
	if eventData != nil {
		raw, err := json.Marshal(eventData)
		if err != nil {
			return err
		}
		content = string(raw)
	}
	_, err := tx.ExecContext(ctx,
		`INSERT INTO asset_events (object_type, object_id, event_type, event_data, operator_uid)
		 VALUES (?, ?, ?, ?, ?)`,
		objectType, objectID, eventType, content, nullableString(operatorUID),
	)
	return err
}

func nullableString(value string) any {
	if strings.TrimSpace(value) == "" {
		return nil
	}
	return strings.TrimSpace(value)
}

func rowNumber(item map[string]any, key string) float64 {
	return asFloat(item[key])
}
