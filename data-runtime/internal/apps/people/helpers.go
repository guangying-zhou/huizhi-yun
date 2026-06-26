package people

import (
	"context"
	"crypto/rand"
	"database/sql"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"strconv"
	"strings"
	"time"
)

func ok(data any) map[string]any {
	return map[string]any{"code": 0, "message": "ok", "data": data}
}

func singleSegment(value string) bool {
	value = strings.TrimSpace(value)
	return value != "" && !strings.Contains(value, "/")
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

func cleanBodyString(body map[string]any, keys ...string) string {
	for _, key := range keys {
		if value := cleanAnyString(body[key]); value != "" {
			return value
		}
	}
	return ""
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

func itemsFromBody(body map[string]any) ([]map[string]any, bool) {
	raw, ok := body["items"].([]any)
	if !ok {
		return nil, false
	}
	items := make([]map[string]any, 0, len(raw))
	for _, item := range raw {
		object, ok := item.(map[string]any)
		if !ok {
			continue
		}
		items = append(items, object)
	}
	return items, true
}

func jsonColumnValue(value any) any {
	if value == nil {
		return nil
	}
	if text, ok := value.(string); ok {
		text = strings.TrimSpace(text)
		if text == "" {
			return nil
		}
		if json.Valid([]byte(text)) {
			return text
		}
		content, _ := json.Marshal(text)
		return string(content)
	}
	content, err := json.Marshal(value)
	if err != nil || string(content) == "null" {
		return nil
	}
	return string(content)
}

func generatedCode(prefix string) string {
	bytes := make([]byte, 4)
	if _, err := rand.Read(bytes); err != nil {
		return fmt.Sprintf("%s-%d", prefix, time.Now().UTC().UnixNano())
	}
	return prefix + "-" + strings.ToUpper(hex.EncodeToString(bytes))
}
