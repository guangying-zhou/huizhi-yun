package people

import (
	"context"
	"database/sql"
	"net/http"
	"strings"

	"github.com/huizhi-yun/data-runtime/internal/httperror"
)

type departmentAliasRemap struct {
	aliasCode     string
	canonicalCode string
}

func (a *Adapter) remapHRSourceDepartments(ctx context.Context, body map[string]any) (map[string]any, error) {
	rawAliases, ok := body["aliases"].([]any)
	if !ok || len(rawAliases) == 0 {
		return nil, httperror.New(http.StatusBadRequest, "people_department_aliases_required", "At least one department alias is required")
	}
	if len(rawAliases) > 500 {
		return nil, httperror.New(http.StatusRequestEntityTooLarge, "people_department_aliases_too_large", "At most 500 department aliases may be remapped at once")
	}

	aliases := make([]departmentAliasRemap, 0, len(rawAliases))
	seen := map[string]bool{}
	for _, raw := range rawAliases {
		item := peopleObject(raw)
		aliasCode := strings.TrimSpace(peopleText(item["aliasDeptCode"]))
		canonicalCode := strings.TrimSpace(peopleText(item["canonicalDeptCode"]))
		if aliasCode == "" || canonicalCode == "" || aliasCode == canonicalCode || len(aliasCode) > 64 || len(canonicalCode) > 64 {
			return nil, httperror.New(http.StatusBadRequest, "people_department_alias_invalid", "Department alias mapping is invalid")
		}
		if seen[aliasCode] {
			return nil, httperror.New(http.StatusBadRequest, "people_department_alias_duplicate", "Department alias mapping contains a duplicate alias")
		}
		seen[aliasCode] = true
		aliases = append(aliases, departmentAliasRemap{aliasCode: aliasCode, canonicalCode: canonicalCode})
	}

	tx, err := a.DB().BeginTx(ctx, &sql.TxOptions{})
	if err != nil {
		return nil, err
	}
	defer func() { _ = tx.Rollback() }()

	employeeRows := int64(0)
	assignmentRows := int64(0)
	for _, alias := range aliases {
		result, execErr := tx.ExecContext(ctx, `UPDATE people_employees
			SET dept_code=?,updated_at=UTC_TIMESTAMP() WHERE dept_code=?`, alias.canonicalCode, alias.aliasCode)
		if execErr != nil {
			return nil, execErr
		}
		if affected, affectedErr := result.RowsAffected(); affectedErr == nil {
			employeeRows += affected
		}

		result, execErr = tx.ExecContext(ctx, `UPDATE people_assignments
			SET dept_code=?,updated_at=UTC_TIMESTAMP() WHERE dept_code=?`, alias.canonicalCode, alias.aliasCode)
		if execErr != nil {
			return nil, execErr
		}
		if affected, affectedErr := result.RowsAffected(); affectedErr == nil {
			assignmentRows += affected
		}
	}
	if err = tx.Commit(); err != nil {
		return nil, err
	}
	return map[string]any{
		"aliasesApplied":     len(aliases),
		"employeesUpdated":   employeeRows,
		"assignmentsUpdated": assignmentRows,
	}, nil
}

func peopleObject(value any) map[string]any {
	if result, ok := value.(map[string]any); ok {
		return result
	}
	return map[string]any{}
}

func peopleText(value any) string {
	if result, ok := value.(string); ok {
		return result
	}
	return ""
}
