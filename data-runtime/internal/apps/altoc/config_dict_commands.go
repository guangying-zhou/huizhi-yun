package altoc

import (
	"context"
	"database/sql"
	"fmt"
	"net/http"
	"strings"

	"github.com/huizhi-yun/data-runtime/internal/httperror"
)

type configDictSpec struct {
	Entity string
	Table  string
	Fields []string
}

var configDictSpecs = map[string]configDictSpec{
	"customer_level": {
		Entity: "customer_level",
		Table:  "customer_level",
		Fields: []string{"code", "name", "sort_no", "is_enabled"},
	},
	"customer_type": {
		Entity: "customer_type",
		Table:  "customer_type",
		Fields: []string{"code", "name", "is_partner_type", "is_enabled"},
	},
	"opportunity_stage": {
		Entity: "opportunity_stage",
		Table:  "opportunity_stage",
		Fields: []string{"code", "name", "sort_no", "win_rate", "is_closed", "is_won", "is_lost", "is_enabled"},
	},
}

func (a *Adapter) createConfigDict(ctx context.Context, body map[string]any) (map[string]any, error) {
	if err := altocRequireActionScope(body, "settings", "edit"); err != nil {
		return nil, err
	}
	spec, err := configDictSpecFromBody(body)
	if err != nil {
		return nil, err
	}
	fields, err := configDictFields(spec, body)
	if err != nil {
		return nil, err
	}
	if err := requireConfigDictCreateFields(fields); err != nil {
		return nil, err
	}
	if _, ok := fields["is_enabled"]; !ok {
		fields["is_enabled"] = 1
	}
	if err := normalizeConfigDictDerivedFields(spec, fields, nil); err != nil {
		return nil, err
	}

	tx, err := a.DB().BeginTx(ctx, nil)
	if err != nil {
		return nil, err
	}
	defer tx.Rollback()

	if err := ensureConfigDictCodeUniqueTx(ctx, tx, spec, fields["code"], 0); err != nil {
		return nil, err
	}
	fields, err = configDictExistingColumns(ctx, tx, spec.Table, fields)
	if err != nil {
		return nil, err
	}
	id, err := altocInsertRecordTx(ctx, tx, spec.Table, fields)
	if err != nil {
		return nil, err
	}
	operator := altocActor(body)
	if err := insertAltocAuditTx(ctx, tx, spec.Table, id, "create", nil, fields, operator); err != nil {
		return nil, err
	}
	if err := tx.Commit(); err != nil {
		return nil, err
	}
	return map[string]any{"id": id}, nil
}

func (a *Adapter) updateConfigDict(ctx context.Context, body map[string]any) (map[string]any, error) {
	if err := altocRequireActionScope(body, "settings", "edit"); err != nil {
		return nil, err
	}
	spec, err := configDictSpecFromBody(body)
	if err != nil {
		return nil, err
	}
	id := altocPositiveID(firstNonEmptyBodyValue(body, "id", "dict_id", "dictId"))
	if id <= 0 {
		return nil, httperror.New(http.StatusBadRequest, "missing_dict_id", "id is required")
	}
	fields, err := configDictFields(spec, body)
	if err != nil {
		return nil, err
	}
	if len(fields) == 0 {
		return map[string]any{"id": id, "changed": false}, nil
	}

	tx, err := a.DB().BeginTx(ctx, nil)
	if err != nil {
		return nil, err
	}
	defer tx.Rollback()

	oldRow, err := lockConfigDictTx(ctx, tx, spec, id)
	if err != nil {
		return nil, err
	}
	if err := validateConfigDictUpdateFields(fields); err != nil {
		return nil, err
	}
	if err := normalizeConfigDictDerivedFields(spec, fields, oldRow); err != nil {
		return nil, err
	}
	if code, ok := fields["code"]; ok {
		if err := ensureConfigDictCodeUniqueTx(ctx, tx, spec, code, id); err != nil {
			return nil, err
		}
	}
	fields, err = configDictExistingColumns(ctx, tx, spec.Table, fields)
	if err != nil {
		return nil, err
	}
	if len(fields) == 0 {
		return map[string]any{"id": id, "changed": false}, nil
	}
	if err := updateConfigDictTx(ctx, tx, spec, id, fields); err != nil {
		return nil, err
	}
	operator := altocActor(body)
	if err := insertAltocAuditTx(ctx, tx, spec.Table, id, "update", oldRow, fields, operator); err != nil {
		return nil, err
	}
	if err := tx.Commit(); err != nil {
		return nil, err
	}
	return map[string]any{"id": id, "changed": true}, nil
}

func (a *Adapter) disableConfigDict(ctx context.Context, body map[string]any) (map[string]any, error) {
	if err := altocRequireActionScope(body, "settings", "edit"); err != nil {
		return nil, err
	}
	spec, err := configDictSpecFromBody(body)
	if err != nil {
		return nil, err
	}
	id := altocPositiveID(firstNonEmptyBodyValue(body, "id", "dict_id", "dictId"))
	if id <= 0 {
		return nil, httperror.New(http.StatusBadRequest, "missing_dict_id", "id is required")
	}

	tx, err := a.DB().BeginTx(ctx, nil)
	if err != nil {
		return nil, err
	}
	defer tx.Rollback()

	oldRow, err := lockConfigDictTx(ctx, tx, spec, id)
	if err != nil {
		return nil, err
	}
	columns, err := altocTableColumns(ctx, tx, spec.Table)
	if err != nil {
		return nil, err
	}
	if !columns["is_enabled"] {
		return nil, httperror.New(http.StatusBadRequest, "dict_disable_unsupported", spec.Table+" does not support disabling")
	}
	fields := map[string]any{"is_enabled": 0}
	if err := updateConfigDictTx(ctx, tx, spec, id, fields); err != nil {
		return nil, err
	}
	operator := altocActor(body)
	if err := insertAltocAuditTx(ctx, tx, spec.Table, id, "delete", oldRow, fields, operator); err != nil {
		return nil, err
	}
	if err := tx.Commit(); err != nil {
		return nil, err
	}
	return map[string]any{"id": id, "changed": true}, nil
}

func configDictSpecFromBody(body map[string]any) (configDictSpec, error) {
	entity := strings.TrimSpace(firstBodyText(body, "entity"))
	if entity == "" {
		return configDictSpec{}, httperror.New(http.StatusBadRequest, "missing_dict_entity", "entity is required")
	}
	spec, ok := configDictSpecs[entity]
	if !ok {
		return configDictSpec{}, httperror.New(http.StatusBadRequest, "invalid_dict_entity", "unsupported config dictionary entity")
	}
	return spec, nil
}

func configDictFields(spec configDictSpec, body map[string]any) (map[string]any, error) {
	fields := make(map[string]any, len(spec.Fields))
	for _, field := range spec.Fields {
		value, ok := altocBodyValue(body, field)
		if !ok {
			continue
		}
		normalized, err := normalizeConfigDictField(field, value)
		if err != nil {
			return nil, err
		}
		fields[field] = normalized
	}
	return fields, nil
}

func normalizeConfigDictField(field string, value any) (any, error) {
	text := strings.TrimSpace(fmt.Sprint(value))
	if value == nil || text == "" || text == "<nil>" {
		if field == "code" || field == "name" {
			return "", nil
		}
		return nil, nil
	}
	switch field {
	case "code", "name":
		return text, nil
	case "sort_no":
		return numberValue(value, 0), nil
	case "win_rate":
		rate := moneyValue(value)
		if rate < 0 || rate > 100 {
			return nil, httperror.New(http.StatusBadRequest, "invalid_stage_win_rate", "win_rate must be between 0 and 100")
		}
		return rate, nil
	case "is_enabled", "is_partner_type", "is_closed", "is_won", "is_lost":
		if altocBool(value) {
			return 1, nil
		}
		return 0, nil
	default:
		return value, nil
	}
}

func requireConfigDictCreateFields(fields map[string]any) error {
	if configDictFieldText(fields["code"]) == "" {
		return httperror.New(http.StatusBadRequest, "missing_dict_code", "code is required")
	}
	if configDictFieldText(fields["name"]) == "" {
		return httperror.New(http.StatusBadRequest, "missing_dict_name", "name is required")
	}
	return nil
}

func validateConfigDictUpdateFields(fields map[string]any) error {
	if value, ok := fields["code"]; ok && configDictFieldText(value) == "" {
		return httperror.New(http.StatusBadRequest, "missing_dict_code", "code must not be empty")
	}
	if value, ok := fields["name"]; ok && configDictFieldText(value) == "" {
		return httperror.New(http.StatusBadRequest, "missing_dict_name", "name must not be empty")
	}
	return nil
}

func configDictFieldText(value any) string {
	if value == nil {
		return ""
	}
	text := strings.TrimSpace(fmt.Sprint(value))
	if text == "<nil>" {
		return ""
	}
	return text
}

func normalizeConfigDictDerivedFields(spec configDictSpec, fields map[string]any, existing map[string]any) error {
	if spec.Entity != "opportunity_stage" {
		return nil
	}
	isWon := configDictMergedBool(fields, existing, "is_won")
	isLost := configDictMergedBool(fields, existing, "is_lost")
	if isWon && isLost {
		return httperror.New(http.StatusBadRequest, "invalid_stage_close_flags", "opportunity stage cannot be both won and lost")
	}
	if isWon {
		fields["is_closed"] = 1
		fields["stage_kind"] = "won"
		return nil
	}
	if isLost {
		fields["is_closed"] = 1
		fields["stage_kind"] = "lost"
		return nil
	}
	if _, wonChanged := fields["is_won"]; wonChanged {
		fields["stage_kind"] = "normal"
	}
	if _, lostChanged := fields["is_lost"]; lostChanged {
		fields["stage_kind"] = "normal"
	}
	if fields["stage_kind"] == "normal" {
		if _, closedProvided := fields["is_closed"]; !closedProvided {
			fields["is_closed"] = 0
		}
	}
	return nil
}

func configDictMergedBool(fields map[string]any, existing map[string]any, key string) bool {
	if value, ok := fields[key]; ok {
		return altocBool(value)
	}
	if existing == nil {
		return false
	}
	return altocBool(existing[key])
}

func ensureConfigDictCodeUniqueTx(ctx context.Context, tx *sql.Tx, spec configDictSpec, code any, excludeID int64) error {
	codeText := strings.TrimSpace(fmt.Sprint(code))
	if codeText == "" {
		return nil
	}
	query := "SELECT id FROM " + altocQuoteID(spec.Table) + " WHERE code = ?"
	args := []any{codeText}
	if excludeID > 0 {
		query += " AND id <> ?"
		args = append(args, excludeID)
	}
	query += " LIMIT 1"
	row, err := altocQueryOneMap(ctx, tx, query, args...)
	if err != nil {
		return err
	}
	if row != nil {
		return httperror.New(http.StatusConflict, "dict_code_exists", "code already exists")
	}
	return nil
}

func lockConfigDictTx(ctx context.Context, tx *sql.Tx, spec configDictSpec, id int64) (map[string]any, error) {
	row, err := altocQueryOneMap(ctx, tx, "SELECT * FROM "+altocQuoteID(spec.Table)+" WHERE id = ? LIMIT 1 FOR UPDATE", id)
	if err != nil {
		return nil, err
	}
	if row == nil {
		return nil, httperror.New(http.StatusNotFound, "record_not_found", "config dictionary record not found")
	}
	return row, nil
}

func configDictExistingColumns(ctx context.Context, tx *sql.Tx, table string, fields map[string]any) (map[string]any, error) {
	columns, err := altocTableColumns(ctx, tx, table)
	if err != nil {
		return nil, err
	}
	filtered := make(map[string]any, len(fields))
	for name, value := range fields {
		if columns[name] {
			filtered[name] = value
		}
	}
	return filtered, nil
}

func updateConfigDictTx(ctx context.Context, tx *sql.Tx, spec configDictSpec, id int64, fields map[string]any) error {
	if len(fields) == 0 {
		return httperror.New(http.StatusBadRequest, "empty_record", "No writable fields provided")
	}
	set, args := assignmentParts(fields)
	args = append(args, id)
	_, err := tx.ExecContext(ctx, "UPDATE "+altocQuoteID(spec.Table)+" SET "+strings.Join(set, ", ")+" WHERE id = ?", args...)
	return err
}

func firstNonEmptyBodyValue(body map[string]any, keys ...string) any {
	for _, key := range keys {
		value, ok := altocBodyValue(body, key)
		if !ok || value == nil {
			continue
		}
		text := strings.TrimSpace(fmt.Sprint(value))
		if text != "" && text != "<nil>" {
			return value
		}
	}
	return nil
}
