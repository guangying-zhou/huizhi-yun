package people

import (
	"context"
	"net/http"
	"net/url"
	"strings"

	"github.com/huizhi-yun/data-runtime/internal/apps/compat"
	"github.com/huizhi-yun/data-runtime/internal/config"
	"github.com/huizhi-yun/data-runtime/internal/httperror"
)

type Adapter struct {
	*compat.Adapter
}

var requiredTables = []string{
	"people_employees",
	"people_positions",
	"people_ranks",
	"people_standard_cost_rates",
	"people_assignments",
	"people_cost_snapshots",
	"people_performance_cycles",
	"people_contribution_snapshots",
	"people_documents",
}

func New(cfg config.PeopleConfig) (*Adapter, error) {
	adapter, err := compat.New(compat.Config{
		AppCode:        "people",
		DB:             cfg.DB,
		ResponseMode:   compat.ResponseCodeMessageData,
		RequiredTables: requiredTables,
		DashboardCounts: []compat.DashboardCount{
			{Key: "active_employees", Label: "在职员工", Table: "people_employees", Where: "archived_at IS NULL AND employment_status = 'active'"},
			{Key: "current_assignments", Label: "当前任职", Table: "people_assignments", Where: "effective_to IS NULL"},
			{Key: "active_cycles", Label: "进行中绩效周期", Table: "people_performance_cycles", Where: "status IN ('draft', 'collecting', 'calculating')"},
			{Key: "documents", Label: "关联文档", Table: "people_documents"},
		},
		Resources: []compat.ResourceSpec{
			{
				Path:             "employees",
				Table:            "people_employees",
				CodeColumn:       "employee_uid",
				CodePrefix:       "EMP",
				SearchColumns:    []string{"employee_uid", "employee_no", "display_name", "login_name", "dept_name", "position_name", "rank_code", "manager_uid"},
				DefaultOrderBy:   "`employment_status` ASC, `employee_no` ASC, `id` DESC",
				SoftDeleteColumn: "archived_at",
				OwnerColumn:      "employee_uid",
				DepartmentColumn: "dept_code",
				PageSizeMax:      500,
			},
			{
				Path:           "positions",
				Table:          "people_positions",
				CodeColumn:     "position_code",
				CodePrefix:     "POS",
				SearchColumns:  []string{"position_code", "position_name", "job_family"},
				DefaultOrderBy: "`sort_order` ASC, `id` ASC",
			},
			{
				Path:           "ranks",
				Table:          "people_ranks",
				CodeColumn:     "rank_code",
				CodePrefix:     "R",
				SearchColumns:  []string{"rank_code", "rank_name"},
				DefaultOrderBy: "`rank_level` ASC, `sort_order` ASC, `id` ASC",
			},
			{
				Path:             "assignments",
				Table:            "people_assignments",
				CodeColumn:       "assignment_code",
				CodePrefix:       "ASN",
				SearchColumns:    []string{"assignment_code", "employee_uid", "dept_name", "position_name", "rank_code", "manager_uid", "source_app", "source_biz_id"},
				DefaultOrderBy:   "`effective_from` DESC, `id` DESC",
				OwnerColumn:      "employee_uid",
				DepartmentColumn: "dept_code",
			},
			{
				Path:           "standard-costs",
				Table:          "people_standard_cost_rates",
				CodeColumn:     "rate_code",
				CodePrefix:     "SCR",
				SearchColumns:  []string{"rate_code", "rate_name", "position_code", "position_name", "rank_code", "rank_name", "employment_type", "cost_center_code"},
				DefaultOrderBy: "`effective_from` DESC, `sort_order` ASC, `id` DESC",
			},
			{
				Path:           "cost-snapshots",
				Table:          "people_cost_snapshots",
				CodeColumn:     "snapshot_code",
				CodePrefix:     "COST",
				SearchColumns:  []string{"snapshot_code", "employee_uid", "period_month", "cost_source", "cost_basis", "standard_rate_code", "source_app", "source_biz_id"},
				DefaultOrderBy: "`period_month` DESC, `id` DESC",
				ParentScope: &compat.ParentScopeSpec{
					Table:            "people_employees",
					IDColumn:         "employee_uid",
					LocalColumn:      "employee_uid",
					Resource:         "employees",
					OwnerColumn:      "employee_uid",
					DepartmentColumn: "dept_code",
					SoftDeleteColumn: "archived_at",
				},
			},
			{
				Path:           "performance-cycles",
				Table:          "people_performance_cycles",
				CodeColumn:     "cycle_code",
				CodePrefix:     "PC",
				SearchColumns:  []string{"cycle_code", "cycle_name", "project_code", "status"},
				DefaultOrderBy: "`period_end` DESC, `id` DESC",
			},
			{
				Path:           "contribution-snapshots",
				Table:          "people_contribution_snapshots",
				CodeColumn:     "contribution_code",
				CodePrefix:     "CONTR",
				SearchColumns:  []string{"contribution_code", "cycle_code", "employee_uid", "project_code", "role_code", "source_app", "source_biz_id"},
				DefaultOrderBy: "`cycle_code` DESC, `id` DESC",
				ParentScope: &compat.ParentScopeSpec{
					Table:            "people_employees",
					IDColumn:         "employee_uid",
					LocalColumn:      "employee_uid",
					Resource:         "employees",
					OwnerColumn:      "employee_uid",
					DepartmentColumn: "dept_code",
					SoftDeleteColumn: "archived_at",
				},
			},
			{
				Path:           "documents",
				Table:          "people_documents",
				CodeColumn:     "document_code",
				CodePrefix:     "PDOC",
				SearchColumns:  []string{"document_code", "employee_uid", "cycle_code", "project_code", "document_uuid", "document_title", "document_type"},
				DefaultOrderBy: "`id` DESC",
			},
		},
	})
	if err != nil {
		return nil, err
	}
	return &Adapter{Adapter: adapter}, nil
}

func (a *Adapter) HandleRuntime(ctx context.Context, method string, path string, query url.Values, body map[string]any) (any, string, error) {
	sanitizePeopleRuntimeAuthBody(body)

	if method == http.MethodGet && path == "/v1/people/dashboard/overview" {
		result, err := a.dashboardOverview(ctx)
		return ok(result), "people.dashboard.overview", err
	}

	if method == http.MethodGet && strings.HasPrefix(path, "/v1/people/employees/") && strings.HasSuffix(path, "/profile") {
		employeeUID := strings.TrimSuffix(strings.TrimPrefix(path, "/v1/people/employees/"), "/profile")
		if !singleSegment(employeeUID) {
			return nil, "", httperror.New(http.StatusNotFound, "not_found", "Route not found")
		}
		result, err := a.employeeProfile(ctx, employeeUID, query)
		return ok(result), "people.employees.profile", err
	}

	if isEmployeeScopedRuntimePath(path) {
		if err := requireEmployeeQueryAccess(query); err != nil {
			return nil, "people.employees.access", err
		}
		if method != http.MethodGet && isEmployeeRuntimePath(path) {
			if err := requireEmployeeSensitiveCostFieldAccess(query, body); err != nil {
				return nil, "people.employees.sensitive_cost.write", err
			}
		}
		if method != http.MethodGet && isAssignmentRuntimePath(path) {
			if err := requireEmployeeGlobalAccess(query); err != nil {
				return nil, "people.assignments.write", err
			}
		}
		if method == http.MethodPost && strings.TrimRight(path, "/") == "/v1/people/employees" {
			if err := requireEmployeeGlobalAccess(query); err != nil {
				return nil, "people.employees.create", err
			}
		}
		if method == http.MethodDelete {
			if err := requireEmployeeGlobalAccess(query); err != nil {
				return nil, "people.employees.delete", err
			}
		}
	}

	if isPeopleGlobalSensitiveRuntimePath(path) {
		if err := requireEmployeeGlobalAccess(query); err != nil {
			return nil, "people.global_sensitive.access", err
		}
	}

	if isPeopleScopedSensitiveRuntimePath(path) {
		if err := requireEmployeeQueryAccess(query); err != nil {
			return nil, "people.sensitive.access", err
		}
		if method != http.MethodGet {
			if err := requireEmployeeGlobalAccess(query); err != nil {
				return nil, "people.sensitive.write", err
			}
		}
	}

	if method == http.MethodGet && strings.TrimRight(path, "/") == "/v1/people/performance-cycles" {
		result, err := a.performanceCycleList(ctx, query)
		return ok(result), "people.performance_cycles.list", err
	}

	if method == http.MethodGet && strings.HasPrefix(path, "/v1/people/performance-cycles/") && strings.HasSuffix(path, "/detail") {
		cycleCode := strings.TrimSuffix(strings.TrimPrefix(path, "/v1/people/performance-cycles/"), "/detail")
		if !singleSegment(cycleCode) {
			return nil, "", httperror.New(http.StatusNotFound, "not_found", "Route not found")
		}
		result, err := a.performanceCycleDetail(ctx, cycleCode, query)
		return ok(result), "people.performance_cycles.detail", err
	}

	if method == http.MethodGet {
		if cycleCode := matchPerformanceCycleCodePath(strings.TrimRight(path, "/")); cycleCode != "" {
			result, err := a.performanceCycleRecord(ctx, cycleCode, query)
			return ok(result), "people.performance_cycles.get", err
		}
	}

	if method == http.MethodGet && path == "/v1/people/service/standard-costs:resolve" {
		result, err := a.resolveStandardCosts(ctx, query)
		return ok(result), "people.service.standard_costs.resolve", err
	}

	if method == http.MethodGet && strings.HasPrefix(path, "/v1/people/service/employees/") && strings.HasSuffix(path, "/cost-snapshot") {
		employeeUID := strings.TrimSuffix(strings.TrimPrefix(path, "/v1/people/service/employees/"), "/cost-snapshot")
		if !singleSegment(employeeUID) {
			return nil, "", httperror.New(http.StatusNotFound, "not_found", "Route not found")
		}
		result, err := a.employeeCostSnapshot(ctx, employeeUID, query)
		return ok(result), "people.service.employee_cost_snapshot", err
	}

	if method == http.MethodGet && strings.HasPrefix(path, "/v1/people/service/projects/") && strings.HasSuffix(path, "/people-costs") {
		projectCode := strings.TrimSuffix(strings.TrimPrefix(path, "/v1/people/service/projects/"), "/people-costs")
		if !singleSegment(projectCode) {
			return nil, "", httperror.New(http.StatusNotFound, "not_found", "Route not found")
		}
		result, err := a.projectPeopleCosts(ctx, projectCode, query)
		return ok(result), "people.service.project_people_costs", err
	}

	if method == http.MethodPost && path == "/v1/people/service/contributions:sync" {
		result, err := a.syncContributions(ctx, body)
		return ok(result), "people.service.contributions.sync", err
	}

	if method == http.MethodPost {
		if cycleCode, matched := performanceCycleServiceAction(path, "confirm"); matched {
			result, err := a.confirmPerformanceCycle(ctx, cycleCode, body)
			return ok(result), "people.service.performance_cycles.confirm", err
		}
		if cycleCode, matched := performanceCycleServiceAction(path, "close"); matched {
			result, err := a.closePerformanceCycle(ctx, cycleCode, body)
			return ok(result), "people.service.performance_cycles.close", err
		}
	}

	if method == http.MethodPost && path == "/v1/people/service/directory-users:sync" {
		result, err := a.syncDirectoryUsers(ctx, body)
		return ok(result), "people.service.directory_users.sync", err
	}

	if method == http.MethodPost && path == "/v1/people/service/cost-snapshots:generate" {
		result, err := a.generateCostSnapshots(ctx, body)
		return ok(result), "people.service.cost_snapshots.generate", err
	}

	if method == http.MethodPost && path == "/v1/people/service/workflow/callback" {
		result, err := a.workflowCallback(ctx, body)
		return ok(result), "people.service.workflow.callback", err
	}

	return a.Adapter.HandleRuntime(ctx, method, path, query, body)
}

func isEmployeeScopedRuntimePath(path string) bool {
	trimmed := strings.TrimRight(path, "/")
	return trimmed == "/v1/people/employees" ||
		strings.HasPrefix(trimmed, "/v1/people/employees/") ||
		trimmed == "/v1/people/assignments" ||
		strings.HasPrefix(trimmed, "/v1/people/assignments/")
}

func isEmployeeRuntimePath(path string) bool {
	trimmed := strings.TrimRight(path, "/")
	return trimmed == "/v1/people/employees" ||
		strings.HasPrefix(trimmed, "/v1/people/employees/") && !strings.HasSuffix(trimmed, "/profile")
}

func isAssignmentRuntimePath(path string) bool {
	trimmed := strings.TrimRight(path, "/")
	return trimmed == "/v1/people/assignments" || strings.HasPrefix(trimmed, "/v1/people/assignments/")
}

func isPeopleGlobalSensitiveRuntimePath(path string) bool {
	trimmed := strings.TrimRight(path, "/")
	return trimmed == "/v1/people/standard-costs" ||
		strings.HasPrefix(trimmed, "/v1/people/standard-costs/")
}

func sanitizePeopleRuntimeAuthBody(body map[string]any) {
	for _, key := range []string{
		"current_user_employee_access",
		"currentUserEmployeeAccess",
		"current_user_employee_dept_code",
		"currentUserEmployeeDeptCode",
		"current_user_employee_dept_codes",
		"currentUserEmployeeDeptCodes",
		"current_user_data_access",
		"currentUserDataAccess",
		"current_user_data_dept_code",
		"currentUserDataDeptCode",
		"current_user_data_dept_codes",
		"currentUserDataDeptCodes",
		"current_user_standard_cost_access",
		"currentUserStandardCostAccess",
	} {
		delete(body, key)
	}
}
