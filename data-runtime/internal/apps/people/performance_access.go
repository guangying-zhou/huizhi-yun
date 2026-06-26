package people

import (
	"net/url"
	"strconv"
	"strings"

	"github.com/huizhi-yun/data-runtime/internal/httperror"
)

type peoplePage struct {
	page     int
	pageSize int
	offset   int
}

func isPeopleScopedSensitiveRuntimePath(path string) bool {
	trimmed := strings.TrimRight(path, "/")
	return trimmed == "/v1/people/cost-snapshots" ||
		strings.HasPrefix(trimmed, "/v1/people/cost-snapshots/") ||
		trimmed == "/v1/people/performance-cycles" ||
		matchPerformanceCycleCodePath(trimmed) != "" ||
		strings.HasPrefix(trimmed, "/v1/people/performance-cycles/") && strings.HasSuffix(trimmed, "/detail") ||
		trimmed == "/v1/people/contribution-snapshots" ||
		strings.HasPrefix(trimmed, "/v1/people/contribution-snapshots/")
}

func matchPerformanceCycleCodePath(path string) string {
	prefix := "/v1/people/performance-cycles/"
	if !strings.HasPrefix(path, prefix) {
		return ""
	}
	cycleCode := strings.TrimPrefix(path, prefix)
	if strings.Contains(cycleCode, "/") || !singleSegment(cycleCode) {
		return ""
	}
	return cycleCode
}

func peopleListPage(query url.Values) peoplePage {
	page := parsePositiveInt(firstCleanEmployeeAccessValue(query.Get("page")), 1)
	pageSize := parsePositiveInt(firstCleanEmployeeAccessValue(query.Get("page_size"), query.Get("pageSize")), 50)
	if pageSize > 500 {
		pageSize = 500
	}
	return peoplePage{page: page, pageSize: pageSize, offset: (page - 1) * pageSize}
}

func parsePositiveInt(value string, fallback int) int {
	parsed, err := strconv.Atoi(strings.TrimSpace(value))
	if err != nil || parsed <= 0 {
		return fallback
	}
	return parsed
}

func employeeScopedRowClause(query url.Values, employeeColumn string) (string, []any, error) {
	switch employeeAccessFromQuery(query) {
	case "", "all":
		return "", nil, nil
	case "self":
		uid := employeeCurrentUserFromQuery(query)
		if uid == "" {
			return "1 = 0", nil, nil
		}
		return employeeColumn + " = ?", []any{uid}, nil
	case "dept":
		uid := employeeCurrentUserFromQuery(query)
		deptCodes := employeeDeptCodesFromQuery(query)
		clauses := make([]string, 0, 2)
		args := make([]any, 0, len(deptCodes)+1)
		if uid != "" {
			clauses = append(clauses, employeeColumn+" = ?")
			args = append(args, uid)
		}
		if len(deptCodes) > 0 {
			clauses = append(clauses, "EXISTS (SELECT 1 FROM people_employees scoped_employee WHERE scoped_employee.employee_uid = "+employeeColumn+" AND scoped_employee.archived_at IS NULL AND scoped_employee.dept_code IN ("+placeholders(len(deptCodes))+"))")
			for _, code := range deptCodes {
				args = append(args, code)
			}
		}
		if len(clauses) == 0 {
			return "1 = 0", nil, nil
		}
		return "(" + strings.Join(clauses, " OR ") + ")", args, nil
	default:
		return "", nil, employeeAccessForbidden()
	}
}

func performanceCycleScopeWhere(query url.Values) (string, []any, error) {
	rowClause, args, err := employeeScopedRowClause(query, "scoped_contribution.employee_uid")
	if err != nil || rowClause == "" {
		return rowClause, args, err
	}
	return "EXISTS (SELECT 1 FROM people_contribution_snapshots scoped_contribution WHERE scoped_contribution.cycle_code = people_performance_cycles.cycle_code AND " + rowClause + ")", args, nil
}

func performanceCycleForbiddenIfScoped(query url.Values) error {
	switch employeeAccessFromQuery(query) {
	case "", "all":
		return nil
	default:
		return httperror.New(403, "people_performance_cycle_access_denied", "only authorized users can access this performance cycle")
	}
}
