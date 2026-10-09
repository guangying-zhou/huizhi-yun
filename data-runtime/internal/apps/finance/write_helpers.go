package finance

import (
	"context"
	"crypto/rand"
	"database/sql"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"math"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/huizhi-yun/data-runtime/internal/httperror"
)

type jsonBody map[string]any

func bodyValue(body jsonBody, keys ...string) any {
	for _, key := range keys {
		if value, ok := body[key]; ok {
			return value
		}
	}
	return nil
}

func bodyHas(body jsonBody, keys ...string) bool {
	for _, key := range keys {
		if _, ok := body[key]; ok {
			return true
		}
	}
	return false
}

func cleanStringValue(value any) string {
	text := strings.TrimSpace(fmt.Sprint(value))
	if value == nil || text == "<nil>" {
		return ""
	}
	return text
}

func nilString(value any) any {
	text := cleanStringValue(value)
	if text == "" {
		return nil
	}
	return text
}

func requiredStringValue(value any, field string) (string, error) {
	text := cleanStringValue(value)
	if text == "" {
		return "", httperror.New(http.StatusBadRequest, "field_required", field+" is required")
	}
	return text, nil
}

func allowedString(value any, field string, allowed []string) (any, error) {
	text := cleanStringValue(value)
	if text == "" {
		return nil, nil
	}
	for _, item := range allowed {
		if text == item {
			return text, nil
		}
	}
	return nil, httperror.New(http.StatusBadRequest, "invalid_field", field+" must be one of "+strings.Join(allowed, ", "))
}

func requiredAllowedString(value any, field string, allowed []string) (string, error) {
	text, err := requiredStringValue(value, field)
	if err != nil {
		return "", err
	}
	allowedValue, err := allowedString(text, field, allowed)
	if err != nil {
		return "", err
	}
	return allowedValue.(string), nil
}

func moneyStringValue(value any, field string, required bool, positive bool) (any, error) {
	if value == nil || cleanStringValue(value) == "" {
		if required {
			return nil, httperror.New(http.StatusBadRequest, "field_required", field+" is required")
		}
		return nil, nil
	}

	number, err := strconv.ParseFloat(strings.ReplaceAll(cleanStringValue(value), ",", ""), 64)
	if err != nil || math.IsNaN(number) || math.IsInf(number, 0) {
		return nil, httperror.New(http.StatusBadRequest, "invalid_amount", field+" must be a valid amount")
	}
	if positive && number <= 0 {
		return nil, httperror.New(http.StatusBadRequest, "invalid_amount", field+" must be greater than 0")
	}
	return fmt.Sprintf("%.2f", number), nil
}

func numberOrNil(value any, field string) (any, error) {
	if value == nil || cleanStringValue(value) == "" {
		return nil, nil
	}
	number, err := strconv.ParseFloat(cleanStringValue(value), 64)
	if err != nil || math.IsNaN(number) || math.IsInf(number, 0) {
		return nil, httperror.New(http.StatusBadRequest, "invalid_number", field+" must be a number")
	}
	if math.Trunc(number) == number {
		return int64(number), nil
	}
	return number, nil
}

func optionalDateValue(value any) (any, error) {
	text := cleanStringValue(value)
	if text == "" {
		return nil, nil
	}
	if _, err := time.Parse("2006-01-02", text); err != nil {
		return nil, httperror.New(http.StatusBadRequest, "invalid_date", "date must be YYYY-MM-DD")
	}
	return text, nil
}

func optionalDateTimeValue(value any) any {
	text := cleanStringValue(value)
	if text == "" {
		return nil
	}
	if _, err := time.Parse("2006-01-02", text); err == nil {
		return text + " 00:00:00"
	}
	return text
}

func jsonOrNil(value any) (any, error) {
	if value == nil || cleanStringValue(value) == "" {
		return nil, nil
	}
	if text, ok := value.(string); ok {
		return text, nil
	}
	encoded, err := json.Marshal(value)
	if err != nil {
		return nil, err
	}
	return string(encoded), nil
}

func writeFinanceAuditLog(ctx context.Context, conn execQueryer, entityType string, entityID any, entityCode string, action string, oldValue any, newValue any, operatorID string) error {
	oldJSON, err := jsonOrNil(oldValue)
	if err != nil {
		return err
	}
	newJSON, err := jsonOrNil(newValue)
	if err != nil {
		return err
	}
	_, err = conn.ExecContext(ctx, `
		INSERT INTO finance_audit_log (
		  entity_type, entity_id, entity_code, action, old_value, new_value, operator_id, source_app
		) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
	`, entityType, numberAnyOrNil(entityID), nilString(entityCode), action, oldJSON, newJSON, nilString(operatorID), "finance")
	return err
}

func auditOperatorID(body jsonBody) string {
	return firstNonEmpty(
		cleanStringValue(bodyValue(body, "operatorId", "operator_id")),
		cleanStringValue(bodyValue(body, "deletedBy", "deleted_by")),
		cleanStringValue(bodyValue(body, "redReversedBy", "red_reversed_by")),
		cleanStringValue(bodyValue(body, "updatedBy", "updated_by")),
		cleanStringValue(bodyValue(body, "createdBy", "created_by")),
		"finance-ui",
	)
}

func auditEntityTypeForTable(table string) string {
	switch table {
	case "finance_invoice":
		return "invoice"
	case "finance_receipt":
		return "receipt"
	case "finance_bank_account":
		return "bank_account"
	case "finance_expense":
		return "expense"
	default:
		return strings.TrimPrefix(table, "finance_")
	}
}

func numberAnyOrNil(value any) any {
	switch typed := value.(type) {
	case int64, int, int32, uint, uint64, float64, float32:
		return typed
	default:
		text := cleanStringValue(value)
		if text == "" {
			return nil
		}
		number, err := strconv.ParseInt(text, 10, 64)
		if err == nil {
			return number
		}
		return nil
	}
}

func dbBool(value any, fallback bool) int {
	if value == nil || cleanStringValue(value) == "" {
		if fallback {
			return 1
		}
		return 0
	}
	text := strings.ToLower(cleanStringValue(value))
	if value == true || text == "1" || text == "true" || text == "yes" || text == "on" {
		return 1
	}
	return 0
}

func todayDate() string {
	return time.Now().UTC().Format("2006-01-02")
}

func currentMonth() string {
	return time.Now().UTC().Format("2006-01")
}

func periodMonthValue(value any) (string, error) {
	text := cleanStringValue(value)
	if text == "" {
		text = currentMonth()
	}
	if len(text) != 7 {
		return "", httperror.New(http.StatusBadRequest, "invalid_period_month", "periodMonth must be YYYY-MM")
	}
	if _, err := time.Parse("2006-01", text); err != nil {
		return "", httperror.New(http.StatusBadRequest, "invalid_period_month", "periodMonth must be YYYY-MM")
	}
	return text, nil
}

func generateFinanceCode(prefix string) string {
	random := make([]byte, 2)
	if _, err := rand.Read(random); err != nil {
		return prefix + time.Now().UTC().Format("20060102150405")
	}
	return prefix + time.Now().UTC().Format("20060102150405") + strings.ToUpper(hex.EncodeToString(random))
}

func queryOneMap(ctx context.Context, conn queryer, sqlText string, args ...any) (map[string]any, error) {
	rows, err := conn.QueryContext(ctx, sqlText, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	items, err := rowsToMaps(rows)
	if err != nil {
		return nil, err
	}
	if len(items) == 0 {
		return nil, nil
	}
	return items[0], nil
}

type queryer interface {
	QueryContext(ctx context.Context, query string, args ...any) (*sql.Rows, error)
}

func requireCodePath(code string) error {
	if strings.TrimSpace(code) == "" {
		return httperror.New(http.StatusBadRequest, "code_required", "code is required")
	}
	return nil
}

func notFound(message string) error {
	return httperror.New(http.StatusNotFound, "record_not_found", message)
}

func ensureEditableStatus(status any, message string) error {
	text := cleanStringValue(status)
	if text == "draft" || text == "rejected" {
		return nil
	}
	return httperror.New(http.StatusConflict, "invalid_status", message)
}

func resultData(data map[string]any) DataResult[map[string]any] {
	if data == nil {
		data = map[string]any{}
	}
	return DataResult[map[string]any]{Data: data}
}
