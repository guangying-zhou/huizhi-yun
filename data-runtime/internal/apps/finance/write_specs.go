package finance

import (
	"context"
	"database/sql"
	"fmt"
	"net/http"
	"strings"

	"github.com/huizhi-yun/data-runtime/internal/httperror"
)

type fieldKind string

const (
	fieldString          fieldKind = "string"
	fieldRequiredString  fieldKind = "required_string"
	fieldAllowed         fieldKind = "allowed"
	fieldRequiredAllowed fieldKind = "required_allowed"
	fieldMoney           fieldKind = "money"
	fieldRequiredMoney   fieldKind = "required_money"
	fieldNumber          fieldKind = "number"
	fieldDate            fieldKind = "date"
	fieldDateTime        fieldKind = "datetime"
	fieldJSON            fieldKind = "json"
	fieldBool            fieldKind = "bool"
)

type mutationField struct {
	Column   string
	Keys     []string
	Kind     fieldKind
	Default  any
	Allowed  []string
	Positive bool
}

type createSpec struct {
	Operation    string
	Scope        string
	Table        string
	CodePrefix   string
	CodeRequired bool
	CodeColumn   string
	Fields       []mutationField
	ReturnSQL    string
}

type updateSpec struct {
	Operation       string
	Scope           string
	Table           string
	Fields          []mutationField
	Editable        bool
	EditableMessage string
	NotFoundMessage string
	SoftDelete      bool
	After           func(context.Context, execQueryer, map[string]any, jsonBody) error
}

var subjectTypes = []string{"asset", "liability", "equity", "cost", "profit_loss"}
var accountingObjectTypes = []string{"customer_project", "internal_project", "department", "contract", "customer", "sales_region", "opportunity", "sales_campaign", "employee", "other"}
var receiptSourceTypes = []string{"contract", "no_contract", "pre_contract", "other"}
var salesScopeTypes = []string{"region", "customer", "opportunity", "contract", "sales_campaign", "general"}

func (a *Adapter) createBySpec(ctx context.Context, spec createSpec, body jsonBody) (DataResult[map[string]any], error) {
	codeColumn := firstNonEmpty(spec.CodeColumn, "code")
	code := cleanStringValue(bodyValue(body, "code"))
	if spec.CodeRequired {
		var err error
		code, err = requiredStringValue(code, "code")
		if err != nil {
			return DataResult[map[string]any]{}, err
		}
	} else if code == "" && spec.CodePrefix != "" {
		code = generateFinanceCode(spec.CodePrefix)
	}

	columns := []string{codeColumn}
	placeholders := []string{"?"}
	args := []any{code}

	for _, field := range spec.Fields {
		value, err := field.value(body, true)
		if err != nil {
			return DataResult[map[string]any]{}, err
		}
		columns = append(columns, field.Column)
		placeholders = append(placeholders, "?")
		args = append(args, value)
	}

	_, err := a.db.ExecContext(ctx, "INSERT INTO "+spec.Table+" ("+strings.Join(columns, ", ")+") VALUES ("+strings.Join(placeholders, ", ")+")", args...)
	if err != nil {
		return DataResult[map[string]any]{}, err
	}

	sqlText := spec.ReturnSQL
	if sqlText == "" {
		sqlText = "SELECT * FROM " + spec.Table + " WHERE " + codeColumn + " = ?"
	}
	row, err := queryOneMap(ctx, a.db, sqlText, code)
	if err != nil {
		return DataResult[map[string]any]{}, err
	}
	return resultData(row), nil
}

func (a *Adapter) updateBySpec(ctx context.Context, spec updateSpec, code string, body jsonBody) (DataResult[map[string]any], error) {
	if err := requireCodePath(code); err != nil {
		return DataResult[map[string]any]{}, err
	}

	tx, err := a.db.BeginTx(ctx, nil)
	if err != nil {
		return DataResult[map[string]any]{}, err
	}
	defer tx.Rollback()

	where := "code = ?"
	if spec.SoftDelete {
		where += " AND deleted_at IS NULL"
	}
	before, err := queryOneMap(ctx, tx, "SELECT * FROM "+spec.Table+" WHERE "+where+" LIMIT 1 FOR UPDATE", code)
	if err != nil {
		return DataResult[map[string]any]{}, err
	}
	if before == nil {
		return DataResult[map[string]any]{}, notFound(spec.NotFoundMessage)
	}
	if isApplicantRequestTable(spec.Table) {
		if err := requireApplicantRequestBodyAccess(body, before); err != nil {
			return DataResult[map[string]any]{}, err
		}
	}
	if isExpenseLedgerTable(spec.Table) {
		if err := requireExpenseLedgerBodyAccess(body, before); err != nil {
			return DataResult[map[string]any]{}, err
		}
	}
	if isPaymentConfirmationTable(spec.Table) {
		if err := requirePaymentConfirmationUpdateDutySeparation(spec.Table, before, body); err != nil {
			return DataResult[map[string]any]{}, err
		}
	}
	if isFinanceEmployeePerformanceTable(spec.Table) {
		if err := requireFinanceEmployeePerformanceBodyAccess(body, before); err != nil {
			return DataResult[map[string]any]{}, err
		}
	}
	if isPerformanceRuleTable(spec.Table) {
		if err := requireFinancePerformanceGlobalBodyAccess(body); err != nil {
			return DataResult[map[string]any]{}, err
		}
	}
	if spec.Editable {
		if err := ensureEditableStatus(before["status"], spec.EditableMessage); err != nil {
			return DataResult[map[string]any]{}, err
		}
	}

	assignments := make([]string, 0, len(spec.Fields)+1)
	args := make([]any, 0, len(spec.Fields)+1)
	for _, field := range spec.Fields {
		value, err := field.value(body, false)
		if err != nil {
			return DataResult[map[string]any]{}, err
		}
		assignments = append(assignments, field.Column+" = COALESCE(?, "+field.Column+")")
		args = append(args, value)
	}
	assignments = append(assignments, "updated_at = CURRENT_TIMESTAMP")
	args = append(args, code)

	if _, err := tx.ExecContext(ctx, "UPDATE "+spec.Table+" SET "+strings.Join(assignments, ", ")+" WHERE "+where, args...); err != nil {
		return DataResult[map[string]any]{}, err
	}
	if spec.After != nil {
		if err := spec.After(ctx, tx, before, body); err != nil {
			return DataResult[map[string]any]{}, err
		}
	}
	row, err := queryOneMap(ctx, tx, "SELECT * FROM "+spec.Table+" WHERE "+where+" LIMIT 1", code)
	if err != nil {
		return DataResult[map[string]any]{}, err
	}
	if err := tx.Commit(); err != nil {
		return DataResult[map[string]any]{}, err
	}
	return resultData(row), nil
}

func (a *Adapter) softDeleteByTable(ctx context.Context, table string, code string, notFoundMessage string, recalcContract bool, body jsonBody) (DataResult[map[string]any], error) {
	if err := requireCodePath(code); err != nil {
		return DataResult[map[string]any]{}, err
	}
	tx, err := a.db.BeginTx(ctx, nil)
	if err != nil {
		return DataResult[map[string]any]{}, err
	}
	defer tx.Rollback()

	row, err := queryOneMap(ctx, tx, "SELECT * FROM "+table+" WHERE code = ? AND deleted_at IS NULL LIMIT 1 FOR UPDATE", code)
	if err != nil {
		return DataResult[map[string]any]{}, err
	}
	if row == nil {
		return DataResult[map[string]any]{}, notFound(notFoundMessage)
	}
	if isExpenseLedgerTable(table) {
		if err := requireExpenseLedgerBodyRecordAccess(body, row); err != nil {
			return DataResult[map[string]any]{}, err
		}
	}
	if _, err := tx.ExecContext(ctx, "UPDATE "+table+" SET deleted_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP WHERE code = ? AND deleted_at IS NULL", code); err != nil {
		return DataResult[map[string]any]{}, err
	}
	if recalcContract {
		if err := a.recalculateContractSummary(ctx, tx, row["contract_code"]); err != nil {
			return DataResult[map[string]any]{}, err
		}
	}
	if err := writeFinanceAuditLog(ctx, tx, auditEntityTypeForTable(table), row["id"], code, "delete", row, map[string]any{
		"code":        code,
		"deleted":     true,
		"reason":      cleanStringValue(bodyValue(body, "reason", "deleteReason", "delete_reason")),
		"file_delete": bodyValue(body, "fileDelete", "file_delete"),
	}, auditOperatorID(body)); err != nil {
		return DataResult[map[string]any]{}, err
	}
	if err := tx.Commit(); err != nil {
		return DataResult[map[string]any]{}, err
	}
	return resultData(map[string]any{"code": code, "deleted": true}), nil
}

func (field mutationField) value(body jsonBody, create bool) (any, error) {
	value := bodyValue(body, field.Keys...)
	if create && (value == nil || cleanStringValue(value) == "") && field.Default != nil {
		value = field.Default
	}

	switch field.Kind {
	case fieldRequiredString:
		return requiredStringValue(value, field.Keys[0])
	case fieldAllowed:
		return allowedString(value, field.Keys[0], field.Allowed)
	case fieldRequiredAllowed:
		return requiredAllowedString(value, field.Keys[0], field.Allowed)
	case fieldMoney:
		return moneyStringValue(value, field.Keys[0], false, field.Positive)
	case fieldRequiredMoney:
		return moneyStringValue(value, field.Keys[0], true, field.Positive)
	case fieldNumber:
		return numberOrNil(value, field.Keys[0])
	case fieldDate:
		return optionalDateValue(value)
	case fieldDateTime:
		return optionalDateTimeValue(value), nil
	case fieldJSON:
		return jsonOrNil(value)
	case fieldBool:
		if !create && !bodyHas(body, field.Keys...) {
			return nil, nil
		}
		defaultValue := true
		if field.Default != nil {
			defaultValue = field.Default == true || field.Default == 1
		}
		return dbBool(value, defaultValue), nil
	case fieldString:
		fallthrough
	default:
		return nilString(value), nil
	}
}

func insertID(result sql.Result) (int64, error) {
	id, err := result.LastInsertId()
	if err != nil {
		return 0, httperror.New(http.StatusInternalServerError, "insert_id_unavailable", "Insert id is unavailable")
	}
	return id, nil
}

func placeholders(count int) string {
	if count <= 0 {
		return ""
	}
	items := make([]string, count)
	for i := range items {
		items[i] = "?"
	}
	return strings.Join(items, ", ")
}

func unsupportedCommand(name string) error {
	return httperror.New(http.StatusNotImplemented, "unsupported_command", fmt.Sprintf("%s is not supported by Data Runtime Agent yet", name))
}
