package console

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"net/url"
	"regexp"
	"strconv"
	"strings"
	"time"

	"github.com/huizhi-yun/data-runtime/internal/httperror"
)

const tenantSettingScope = "__tenant__"

var settingKeyPattern = regexp.MustCompile(`^[A-Za-z][A-Za-z0-9]*(?:[._-][A-Za-z0-9]+)*$`)
var settingScopePattern = regexp.MustCompile(`^[A-Za-z0-9_.:-]{1,128}$`)

type MutationMeta struct {
	IdempotencyKey string
	RequestID      string
	ActorID        string
}

type settingCatalog struct {
	SettingKey   string         `json:"settingKey"`
	SettingName  string         `json:"settingName"`
	ValueType    string         `json:"valueType"`
	ScopeType    string         `json:"scopeType"`
	Category     string         `json:"category"`
	DefaultValue any            `json:"defaultValue"`
	Validator    map[string]any `json:"validator"`
	IsRequired   bool           `json:"isRequired"`
	EditableInUI bool           `json:"editableInUi"`
	Description  *string        `json:"description"`
	Status       string         `json:"status"`
	UpdatedAt    string         `json:"updatedAt"`
}

type settingValue struct {
	SettingKey     string  `json:"settingKey"`
	SettingName    string  `json:"settingName"`
	ValueType      string  `json:"valueType"`
	Category       string  `json:"category"`
	ScopeKey       string  `json:"scopeKey"`
	Value          any     `json:"value"`
	DefaultValue   any     `json:"defaultValue"`
	Source         string  `json:"source"`
	HasCustomValue bool    `json:"hasCustomValue"`
	EditableInUI   bool    `json:"editableInUi"`
	Description    *string `json:"description"`
	UpdatedBy      *string `json:"updatedBy"`
	UpdatedAt      *string `json:"updatedAt"`
	Revision       uint64  `json:"revision"`
}

func (a *Adapter) SettingCatalogs(ctx context.Context, query url.Values) (map[string]any, error) {
	conditions := []string{"1=1"}
	args := make([]any, 0, 6)
	if category := strings.TrimSpace(query.Get("category")); category != "" {
		conditions = append(conditions, "category=?")
		args = append(args, category)
	}
	status := strings.TrimSpace(query.Get("status"))
	if status == "" {
		status = "active"
	}
	if status != "all" {
		conditions = append(conditions, "status=?")
		args = append(args, status)
	}
	if search := strings.TrimSpace(query.Get("search")); search != "" {
		conditions = append(conditions, "(setting_key LIKE ? OR setting_name LIKE ? OR description LIKE ?)")
		pattern := "%" + search + "%"
		args = append(args, pattern, pattern, pattern)
	}
	rows, err := a.db.QueryContext(ctx, `
		SELECT setting_key,setting_name,value_type,scope_type,category,
			default_value_json,validator_json,is_required,editable_in_ui,
			description,status,updated_at
		FROM setting_catalogs
		WHERE `+strings.Join(conditions, " AND ")+`
		ORDER BY category,setting_key
	`, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	items := make([]settingCatalog, 0)
	for rows.Next() {
		item, err := scanSettingCatalog(rows)
		if err != nil {
			return nil, err
		}
		items = append(items, item)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	return map[string]any{"code": 0, "data": map[string]any{"items": items}}, nil
}

func (a *Adapter) SettingValues(ctx context.Context, query url.Values) (map[string]any, error) {
	scopeKey, err := validSettingScope(query.Get("scopeKey"))
	if err != nil {
		return nil, err
	}
	conditions := []string{"c.status=?"}
	status := strings.TrimSpace(query.Get("status"))
	if status == "" {
		status = "active"
	}
	args := []any{scopeKey, status}
	if category := strings.TrimSpace(query.Get("category")); category != "" {
		conditions = append(conditions, "c.category=?")
		args = append(args, category)
	}
	keys := make([]string, 0)
	for _, key := range strings.Split(query.Get("keys"), ",") {
		key = strings.TrimSpace(key)
		if key == "" {
			continue
		}
		if _, err := validSettingKey(key); err != nil {
			return nil, err
		}
		keys = append(keys, key)
	}
	if len(keys) > 100 {
		return nil, httperror.New(http.StatusBadRequest, "setting_key_limit_exceeded", "At most 100 setting keys may be requested")
	}
	if len(keys) > 0 {
		conditions = append(conditions, "c.setting_key IN ("+strings.TrimSuffix(strings.Repeat("?,", len(keys)), ",")+")")
		for _, key := range keys {
			args = append(args, key)
		}
	}
	rows, err := a.db.QueryContext(ctx, settingValuesSQL(strings.Join(conditions, " AND ")), args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	items := make([]settingValue, 0)
	for rows.Next() {
		item, err := scanSettingValue(rows, scopeKey)
		if err != nil {
			return nil, err
		}
		items = append(items, item)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	return map[string]any{"code": 0, "data": map[string]any{"items": items}}, nil
}

func (a *Adapter) UpdateSetting(ctx context.Context, settingKey string, body map[string]any, meta MutationMeta) (map[string]any, error) {
	return a.updateSetting(ctx, settingKey, body, meta, true, "custom")
}

func (a *Adapter) UpdateManagedSetting(ctx context.Context, settingKey string, body map[string]any, meta MutationMeta) (map[string]any, error) {
	return a.updateSetting(ctx, settingKey, body, meta, false, "managed")
}

func (a *Adapter) updateSetting(
	ctx context.Context,
	settingKey string,
	body map[string]any,
	meta MutationMeta,
	requireUIEditable bool,
	source string,
) (map[string]any, error) {
	settingKey, err := validSettingKey(settingKey)
	if err != nil {
		return nil, err
	}
	scopeKey, err := validSettingScope(textBody(body, "scopeKey"))
	if err != nil {
		return nil, err
	}
	expectedRevision, ok := nonNegativeRevision(body["expectedRevision"])
	if !ok {
		return nil, httperror.New(http.StatusBadRequest, "expected_revision_required", "expectedRevision must be a non-negative integer")
	}
	value, exists := body["value"]
	if !exists {
		return nil, httperror.New(http.StatusBadRequest, "setting_value_required", "value is required")
	}
	payload := struct {
		SettingKey       string `json:"settingKey"`
		ScopeKey         string `json:"scopeKey"`
		ExpectedRevision uint64 `json:"expectedRevision"`
		Value            any    `json:"value"`
	}{settingKey, scopeKey, expectedRevision, value}
	operation := "console.setting.update"
	if source == "managed" {
		operation = "console.setting.managed-update"
	}
	session, replay, err := a.beginMutation(ctx, operation, meta.IdempotencyKey, meta.RequestID, meta.ActorID, payload)
	if err != nil || replay != nil {
		return replay, err
	}
	defer session.tx.Rollback()

	catalog, err := loadSettingCatalogTx(ctx, session.tx, settingKey)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, httperror.New(http.StatusNotFound, "setting_not_found", "Setting not found")
	}
	if err != nil {
		return nil, err
	}
	if catalog.Status != "active" {
		return nil, httperror.New(http.StatusNotFound, "setting_not_found", "Setting not found")
	}
	if requireUIEditable && !catalog.EditableInUI {
		return nil, httperror.New(http.StatusForbidden, "setting_not_editable", "Setting is not editable")
	}
	normalized, err := normalizeSettingValue(catalog, value)
	if err != nil {
		return nil, err
	}
	valueJSON, err := json.Marshal(normalized)
	if err != nil {
		return nil, err
	}

	var currentRevision uint64
	err = session.tx.QueryRowContext(ctx, `
		SELECT revision FROM setting_values
		WHERE setting_key=? AND scope_key=?
		FOR UPDATE
	`, settingKey, scopeKey).Scan(&currentRevision)
	if errors.Is(err, sql.ErrNoRows) {
		currentRevision = 0
	} else if err != nil {
		return nil, err
	}
	if currentRevision != expectedRevision {
		return nil, httperror.New(http.StatusConflict, "setting_revision_conflict", "Setting has changed; reload it before saving")
	}
	if currentRevision == 0 {
		if _, err := session.tx.ExecContext(ctx, `
			INSERT INTO setting_values (
				setting_key,scope_key,value_json,source,updated_by,revision,created_at,updated_at
			) VALUES (?, ?, ?, ?, ?, 1, UTC_TIMESTAMP(), UTC_TIMESTAMP())
		`, settingKey, scopeKey, valueJSON, source, meta.ActorID); err != nil {
			return nil, err
		}
	} else {
		result, err := session.tx.ExecContext(ctx, `
			UPDATE setting_values
			SET value_json=?,source=?,updated_by=?,revision=revision+1,updated_at=UTC_TIMESTAMP()
			WHERE setting_key=? AND scope_key=? AND revision=?
		`, valueJSON, source, meta.ActorID, settingKey, scopeKey, expectedRevision)
		if err != nil {
			return nil, err
		}
		affected, _ := result.RowsAffected()
		if affected != 1 {
			return nil, httperror.New(http.StatusConflict, "setting_revision_conflict", "Setting has changed; reload it before saving")
		}
	}
	item, err := loadSettingValueTx(ctx, session.tx, settingKey, scopeKey)
	if err != nil {
		return nil, err
	}
	response := map[string]any{"code": 0, "data": item}
	action := "update"
	if source == "managed" {
		action = "managed_update"
	}
	if err := a.finishMutation(ctx, session, "system_settings", action, "setting", settingKey, map[string]any{
		"scopeKey":         scopeKey,
		"source":           source,
		"previousRevision": expectedRevision,
		"revision":         item.Revision,
	}, response); err != nil {
		return nil, err
	}
	return response, nil
}

func settingValuesSQL(condition string) string {
	return `
		SELECT c.setting_key,c.setting_name,c.value_type,c.category,
			c.default_value_json,c.editable_in_ui,c.description,
			v.value_json,v.source,v.updated_by,v.updated_at,COALESCE(v.revision,0)
		FROM setting_catalogs c
		LEFT JOIN setting_values v ON v.setting_key=c.setting_key AND v.scope_key=?
		WHERE ` + condition + `
		ORDER BY c.category,c.setting_key
	`
}

type rowScanner interface {
	Scan(dest ...any) error
}

func scanSettingCatalog(scanner rowScanner) (settingCatalog, error) {
	var item settingCatalog
	var defaultJSON, validatorJSON []byte
	var description sql.NullString
	var required, editable bool
	var updatedAt time.Time
	if err := scanner.Scan(
		&item.SettingKey, &item.SettingName, &item.ValueType, &item.ScopeType, &item.Category,
		&defaultJSON, &validatorJSON, &required, &editable, &description, &item.Status, &updatedAt,
	); err != nil {
		return settingCatalog{}, err
	}
	item.DefaultValue = decodeJSON(defaultJSON)
	if validator := decodeJSON(validatorJSON); validator != nil {
		item.Validator, _ = validator.(map[string]any)
	}
	item.IsRequired = required
	item.EditableInUI = editable
	item.Description = nullableString(description)
	item.UpdatedAt = updatedAt.UTC().Format(time.RFC3339Nano)
	return item, nil
}

func scanSettingValue(scanner rowScanner, scopeKey string) (settingValue, error) {
	var item settingValue
	var defaultJSON, valueJSON []byte
	var source, updatedBy sql.NullString
	var updatedAt sql.NullTime
	var editable bool
	var description sql.NullString
	if err := scanner.Scan(
		&item.SettingKey, &item.SettingName, &item.ValueType, &item.Category,
		&defaultJSON, &editable, &description, &valueJSON, &source, &updatedBy, &updatedAt, &item.Revision,
	); err != nil {
		return settingValue{}, err
	}
	item.ScopeKey = scopeKey
	item.DefaultValue = decodeJSON(defaultJSON)
	item.HasCustomValue = valueJSON != nil
	if item.HasCustomValue {
		item.Value = decodeJSON(valueJSON)
	} else {
		item.Value = item.DefaultValue
	}
	item.Source = "default"
	if source.Valid {
		item.Source = source.String
	}
	item.EditableInUI = editable
	item.Description = nullableString(description)
	item.UpdatedBy = nullableString(updatedBy)
	if updatedAt.Valid {
		formatted := updatedAt.Time.UTC().Format(time.RFC3339Nano)
		item.UpdatedAt = &formatted
	}
	return item, nil
}

func loadSettingCatalogTx(ctx context.Context, tx *sql.Tx, settingKey string) (settingCatalog, error) {
	return scanSettingCatalog(tx.QueryRowContext(ctx, `
		SELECT setting_key,setting_name,value_type,scope_type,category,
			default_value_json,validator_json,is_required,editable_in_ui,
			description,status,updated_at
		FROM setting_catalogs
		WHERE setting_key=?
		LIMIT 1
		FOR UPDATE
	`, settingKey))
}

func loadSettingValueTx(ctx context.Context, tx *sql.Tx, settingKey string, scopeKey string) (settingValue, error) {
	return scanSettingValue(tx.QueryRowContext(ctx, settingValuesSQL("c.setting_key=?"), scopeKey, settingKey), scopeKey)
}

func normalizeSettingValue(catalog settingCatalog, value any) (any, error) {
	var normalized any
	switch catalog.ValueType {
	case "boolean":
		switch candidate := value.(type) {
		case bool:
			normalized = candidate
		case string:
			parsed, err := strconv.ParseBool(candidate)
			if err != nil {
				return nil, httperror.New(http.StatusBadRequest, "invalid_setting_value", "Setting value must be a boolean")
			}
			normalized = parsed
		default:
			return nil, httperror.New(http.StatusBadRequest, "invalid_setting_value", "Setting value must be a boolean")
		}
	case "number":
		var number float64
		switch candidate := value.(type) {
		case float64:
			number = candidate
		case string:
			parsed, err := strconv.ParseFloat(candidate, 64)
			if err != nil {
				return nil, httperror.New(http.StatusBadRequest, "invalid_setting_value", "Setting value must be a number")
			}
			number = parsed
		default:
			return nil, httperror.New(http.StatusBadRequest, "invalid_setting_value", "Setting value must be a number")
		}
		normalized = number
	case "url":
		text, ok := value.(string)
		if !ok {
			return nil, httperror.New(http.StatusBadRequest, "invalid_setting_value", "Setting value must be an http(s) URL")
		}
		text = strings.TrimSpace(text)
		if text != "" {
			parsed, err := url.ParseRequestURI(text)
			if err != nil || (parsed.Scheme != "http" && parsed.Scheme != "https") {
				return nil, httperror.New(http.StatusBadRequest, "invalid_setting_value", "Setting value must be an http(s) URL")
			}
		}
		normalized = text
	case "json":
		normalized = value
	default:
		if text, ok := value.(string); ok {
			normalized = text
		} else {
			normalized = fmt.Sprint(value)
		}
	}
	if catalog.IsRequired && (normalized == nil || normalized == "") {
		return nil, httperror.New(http.StatusBadRequest, "setting_value_required", catalog.SettingKey+" is required")
	}
	if err := validateSettingRules(catalog, normalized); err != nil {
		return nil, err
	}
	return normalized, nil
}

func validateSettingRules(catalog settingCatalog, value any) error {
	rules := catalog.Validator
	if rules == nil {
		return nil
	}
	if allowed, ok := rules["allowedValues"].([]any); ok {
		matched := false
		for _, item := range allowed {
			if fmt.Sprint(item) == fmt.Sprint(value) {
				matched = true
			}
		}
		if !matched {
			return httperror.New(http.StatusBadRequest, "invalid_setting_value", catalog.SettingKey+" is not an allowed value")
		}
	}
	if text, ok := value.(string); ok {
		if min := numberRule(rules["minLength"]); min > 0 && float64(len(text)) < min {
			return httperror.New(http.StatusBadRequest, "invalid_setting_value", catalog.SettingKey+" is too short")
		}
		if max := numberRule(rules["maxLength"]); max > 0 && float64(len(text)) > max {
			return httperror.New(http.StatusBadRequest, "invalid_setting_value", catalog.SettingKey+" is too long")
		}
		if pattern := strings.TrimSpace(fmt.Sprint(rules["pattern"])); pattern != "" && pattern != "<nil>" {
			expression, err := regexp.Compile(pattern)
			if err != nil || !expression.MatchString(text) {
				return httperror.New(http.StatusBadRequest, "invalid_setting_value", catalog.SettingKey+" does not match its validator")
			}
		}
	}
	if number, ok := value.(float64); ok {
		if min := numberRule(rules["min"]); min != 0 && number < min {
			return httperror.New(http.StatusBadRequest, "invalid_setting_value", catalog.SettingKey+" is below minimum")
		}
		if max := numberRule(rules["max"]); max != 0 && number > max {
			return httperror.New(http.StatusBadRequest, "invalid_setting_value", catalog.SettingKey+" is above maximum")
		}
	}
	return nil
}

func numberRule(value any) float64 {
	number, _ := strconv.ParseFloat(fmt.Sprint(value), 64)
	return number
}

func validSettingKey(value string) (string, error) {
	value = strings.TrimSpace(value)
	if len(value) == 0 || len(value) > 128 || !settingKeyPattern.MatchString(value) {
		return "", httperror.New(http.StatusBadRequest, "invalid_setting_key", "Invalid settingKey")
	}
	return value, nil
}

func validSettingScope(value string) (string, error) {
	value = strings.TrimSpace(value)
	if value == "" {
		value = tenantSettingScope
	}
	if !settingScopePattern.MatchString(value) {
		return "", httperror.New(http.StatusBadRequest, "invalid_setting_scope", "Invalid scopeKey")
	}
	return value, nil
}

func textBody(body map[string]any, key string) string {
	text, _ := body[key].(string)
	return text
}

func nonNegativeRevision(value any) (uint64, bool) {
	if value == nil {
		return 0, false
	}
	switch candidate := value.(type) {
	case float64:
		if candidate < 0 || candidate != float64(uint64(candidate)) {
			return 0, false
		}
		return uint64(candidate), true
	case int:
		if candidate < 0 {
			return 0, false
		}
		return uint64(candidate), true
	case uint64:
		return candidate, true
	default:
		return 0, false
	}
}

func decodeJSON(value []byte) any {
	if len(value) == 0 {
		return nil
	}
	var decoded any
	if json.Unmarshal(value, &decoded) != nil {
		return string(value)
	}
	return decoded
}
