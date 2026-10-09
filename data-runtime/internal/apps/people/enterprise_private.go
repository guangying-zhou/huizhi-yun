package people

import (
	"context"
	"database/sql"
	"github.com/huizhi-yun/data-runtime/internal/httperror"
	"strconv"
)

func IsEnterprisePrivateOperation(op string) bool {
	return op == "employees-private-view" || op == "employees-private-update"
}
func ValidateEnterprisePrivateInput(op string, i EnterpriseMasterInput) error {
	if !IsEnterprisePrivateOperation(op) || !masterText(i.ID, 64, false) || i.Page != 0 || i.PageSize != 0 || i.Search != "" || i.CostAllowed || i.CostScope.Access != "none" || !MasterScopeValid(i.CostScope) {
		return masterInvalid()
	}
	if op == "employees-private-view" {
		if len(i.Payload) != 0 {
			return masterInvalid()
		}
		return nil
	}
	version, ok := i.Payload["expectedVersion"].(float64)
	if !ok || version < 1 || version != float64(int64(version)) || version > 2147483647 {
		return masterInvalid()
	}
	supported := 0
	for key, value := range i.Payload {
		if key == "expectedVersion" {
			continue
		}
		known := false
		for _, spec := range employeePrivateFieldSpecs {
			if spec.Code != key {
				continue
			}
			known = true
			text, ok := value.(string)
			if !ok || !masterText(text, 255, true) {
				return masterInvalid()
			}
			if _, e := normalizeEmployeePrivateValue(spec, text); e != nil {
				return e
			}
			supported++
		}
		if !known {
			return masterInvalid()
		}
	}
	if supported == 0 {
		return masterInvalid()
	}
	return nil
}
func EnterprisePrivateViewTx(ctx context.Context, tx *sql.Tx, table func(string) (string, error), uid string, version int64) (map[string]any, error) {
	t, e := table("people_employee_private_facts")
	if e != nil {
		return nil, e
	}
	rows, e := tx.QueryContext(ctx, "SELECT field_code,source_code,value_text FROM "+t+" WHERE BINARY employee_uid=BINARY ? ORDER BY field_code,CASE source_code WHEN 'dingtalk' THEN 1 WHEN 'manual' THEN 2 ELSE 3 END,updated_at DESC", uid)
	if e != nil {
		return nil, e
	}
	defer rows.Close()
	fields := map[string]any{}
	for rows.Next() {
		var field, source, value string
		if e = rows.Scan(&field, &source, &value); e != nil {
			return nil, e
		}
		known := false
		for _, spec := range employeePrivateFieldSpecs {
			known = known || field == spec.Code
		}
		if !known || privateSourcePriority(source) == 0 {
			continue
		}
		if _, exists := fields[field]; exists {
			continue
		}
		readOnly := source == "dingtalk" && value != ""
		if field == "id_number" {
			value = maskEmployeeIDNumber(value)
		}
		fields[field] = map[string]any{"value": value, "source": source, "readOnly": readOnly}
	}
	if e = rows.Err(); e != nil {
		return nil, e
	}
	return map[string]any{"employee_uid": uid, "row_version": version, "fields": fields}, nil
}

// Caller owns employee lock and scope check, transaction/receipt and commit.
func EnterprisePrivateWriteTx(ctx context.Context, tx *sql.Tx, table func(string) (string, error), i EnterpriseMasterInput, actor string) (map[string]any, error) {
	if e := ValidateEnterprisePrivateInput("employees-private-update", i); e != nil {
		return nil, e
	}
	employees, e := table("people_employees")
	if e != nil {
		return nil, e
	}
	facts, e := table("people_employee_private_facts")
	if e != nil {
		return nil, e
	}
	var version int64
	if e = tx.QueryRowContext(ctx, "SELECT row_version FROM "+employees+" WHERE BINARY employee_uid=BINARY ? AND archived_at IS NULL FOR UPDATE", i.ID).Scan(&version); e != nil {
		return nil, e
	}
	if float64(version) != i.Payload["expectedVersion"] {
		return nil, httperror.New(409, "people_version_conflict", "Object version changed")
	}
	for _, spec := range employeePrivateFieldSpecs {
		raw, present := i.Payload[spec.Code]
		if !present {
			continue
		}
		value, e := normalizeEmployeePrivateValue(spec, raw.(string))
		if e != nil {
			return nil, e
		}
		var count int
		if e = tx.QueryRowContext(ctx, "SELECT COUNT(*) FROM "+facts+" WHERE BINARY employee_uid=BINARY ? AND field_code=? AND source_code='dingtalk' AND value_text<>''", i.ID, spec.Code).Scan(&count); e != nil {
			return nil, e
		}
		if count > 0 {
			return nil, httperror.New(409, "people_employee_private_field_owned_by_dingtalk", "Field owned by DingTalk")
		}
		if _, e = tx.ExecContext(ctx, "INSERT INTO "+facts+"(employee_uid,field_code,source_code,value_text,created_by,updated_by) VALUES(?,?,'manual',?,?,?) ON DUPLICATE KEY UPDATE value_text=VALUES(value_text),updated_by=VALUES(updated_by),updated_at=CURRENT_TIMESTAMP", i.ID, spec.Code, value, actor, actor); e != nil {
			return nil, e
		}
	}
	result, e := tx.ExecContext(ctx, "UPDATE "+employees+" SET row_version=row_version+1,updated_by=? WHERE BINARY employee_uid=BINARY ? AND row_version=?", actor, i.ID, version)
	if e != nil {
		return nil, e
	}
	n, _ := result.RowsAffected()
	if n != 1 {
		return nil, httperror.New(409, "people_version_conflict", "Object version changed")
	}
	return map[string]any{"id": i.ID, "row_version": version + 1, "updated": true, "version": strconv.FormatInt(version+1, 10)}, nil
}
