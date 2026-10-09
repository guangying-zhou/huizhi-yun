package people

import (
	"context"
	"database/sql"
	"fmt"
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"unicode"
	"unicode/utf8"

	"github.com/huizhi-yun/data-runtime/internal/apps/compat"
	"github.com/huizhi-yun/data-runtime/internal/config"
	"github.com/huizhi-yun/data-runtime/internal/httperror"
	"github.com/huizhi-yun/data-runtime/internal/integrationoperation"
)

type Adapter struct {
	*compat.Adapter
}

const peopleEmployeeSearchPath = "/v1/people/employees:search"

type rankSeriesSchemaMetadata struct {
	ColumnType   string
	Nullable     string
	DefaultValue sql.NullString
	NullRows     int
	IndexColumns string
}

var requiredTables = []string{
	"people_employees",
	"people_employee_number_sequences",
	"people_employee_private_facts",
	"people_positions",
	"people_ranks",
	"people_standard_cost_rates",
	"people_assignments",
	"people_cost_snapshots",
	"people_performance_cycles",
	"people_contribution_snapshots",
	"people_documents",
	"people_offboarding_cases",
	"people_offboarding_tasks",
	"people_offboarding_notification_checkpoint",
	"people_directory_lifecycle_versions",
	"people_connector_sync_receipts",
	"people_onboarding_cases",
	"integration_operation",
	"integration_operation_attempt",
	"integration_operation_dead_letter_actionable",
}

var requiredColumns = []string{
	"people_ranks.rank_series",
	"people_employees.mobile",
	"people_employees.onboard_date_source",
	"people_onboarding_cases.source_field_status",
	"people_onboarding_cases.reservation_id",
	"people_onboarding_cases.provision_operation_id",
}

func New(cfg config.PeopleConfig) (*Adapter, error) {
	adapter, err := compat.New(compat.Config{
		AppCode:         "people",
		DB:              cfg.DB,
		ResponseMode:    compat.ResponseCodeMessageData,
		RequiredTables:  requiredTables,
		RequiredColumns: requiredColumns,
		DashboardCounts: []compat.DashboardCount{
			{Key: "active_employees", Label: "在职员工", Table: "people_employees", Where: "archived_at IS NULL AND employment_status = 'active'"},
			{Key: "current_assignments", Label: "当前任职", Table: "people_assignments", Where: "is_primary = 1 AND approval_status IN ('none', 'approved') AND effective_from <= CURRENT_DATE() AND (effective_to IS NULL OR effective_to >= CURRENT_DATE())"},
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
				ListInFilters: map[string]string{
					"employee_uids": "employee_uid",
					"dept_codes":    "dept_code",
				},
			},
			{
				// 入职候选只读列表。候选不是 employee：它不参与员工统计、任职、
				// 成本、绩效或权限范围计算，因此不设 OwnerColumn 数据范围投影。
				Path:           "onboarding-cases",
				Table:          "people_onboarding_cases",
				CodeColumn:     "onboarding_code",
				CodePrefix:     "ONB",
				SearchColumns:  []string{"onboarding_code", "candidate_name", "employee_no", "canonical_uid", "corporate_email", "provider_subject"},
				DefaultOrderBy: "`updated_at` DESC, `id` DESC",
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
				SearchColumns:  []string{"rank_code", "rank_name", "rank_series"},
				DefaultOrderBy: "`rank_level` ASC, `sort_order` ASC, `id` ASC",
				PageSizeMax:    500,
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
				PageSizeMax:    500,
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
		},
	})
	if err != nil {
		return nil, err
	}
	return &Adapter{Adapter: adapter}, nil
}

func (a *Adapter) SchemaStatus(ctx context.Context) (compat.SchemaStatus, error) {
	status, err := a.Adapter.SchemaStatus(ctx)
	if err != nil || status.Status != "ok" {
		return status, err
	}

	metadata, err := a.rankSeriesSchemaMetadata(ctx)
	if err != nil {
		return compat.SchemaStatus{}, err
	}

	for _, check := range rankSeriesSchemaChecks(metadata) {
		status.CheckedColumns = append(status.CheckedColumns, check.name)
		if !check.ok {
			status.MissingColumns = append(status.MissingColumns, check.name)
			status.Status = "schema_mismatch"
		}
	}
	return status, nil
}

func (a *Adapter) rankSeriesSchemaMetadata(ctx context.Context) (rankSeriesSchemaMetadata, error) {
	var metadata rankSeriesSchemaMetadata
	err := a.DB().QueryRowContext(ctx, `
		SELECT c.COLUMN_TYPE,c.IS_NULLABLE,c.COLUMN_DEFAULT,
		       (SELECT COUNT(*) FROM people_ranks WHERE rank_series IS NULL),
		       COALESCE((SELECT GROUP_CONCAT(s.COLUMN_NAME ORDER BY s.SEQ_IN_INDEX SEPARATOR ',')
		                 FROM information_schema.STATISTICS s
		                 WHERE s.TABLE_SCHEMA=DATABASE() AND s.TABLE_NAME='people_ranks'
		                   AND s.INDEX_NAME='idx_people_rank_series_level'),'')
		FROM information_schema.COLUMNS c
		WHERE c.TABLE_SCHEMA=DATABASE() AND c.TABLE_NAME='people_ranks'
		  AND c.COLUMN_NAME='rank_series'
	`).Scan(&metadata.ColumnType, &metadata.Nullable, &metadata.DefaultValue, &metadata.NullRows, &metadata.IndexColumns)
	return metadata, err
}

func rankSeriesSchemaChecks(metadata rankSeriesSchemaMetadata) []struct {
	name string
	ok   bool
} {
	return []struct {
		name string
		ok   bool
	}{
		{name: "people_ranks.rank_series.enum_m_p", ok: strings.ReplaceAll(strings.ToLower(metadata.ColumnType), " ", "") == "enum('m','p')"},
		{name: "people_ranks.rank_series.not_null", ok: strings.EqualFold(metadata.Nullable, "NO") && metadata.NullRows == 0},
		{name: "people_ranks.rank_series.default_p", ok: metadata.DefaultValue.Valid && strings.EqualFold(strings.TrimSpace(metadata.DefaultValue.String), "P")},
		{name: "people_ranks.idx_people_rank_series_level", ok: metadata.IndexColumns == "rank_series,rank_level,enabled,sort_order"},
	}
}

func (a *Adapter) requireRankSeriesSchemaReady(ctx context.Context) error {
	baseStatus, err := a.Adapter.SchemaStatus(ctx)
	if err != nil {
		return err
	}
	if baseStatus.Status != "ok" {
		return httperror.New(http.StatusServiceUnavailable, "schema_mismatch", "People rank dictionary migration is incomplete")
	}
	metadata, err := a.rankSeriesSchemaMetadata(ctx)
	if err != nil {
		if err == sql.ErrNoRows {
			return httperror.New(http.StatusServiceUnavailable, "schema_mismatch", "People rank dictionary migration is incomplete")
		}
		return err
	}
	for _, check := range rankSeriesSchemaChecks(metadata) {
		if !check.ok {
			return httperror.New(http.StatusServiceUnavailable, "schema_mismatch", "People rank dictionary migration is incomplete")
		}
	}
	return nil
}

func (a *Adapter) HandleRuntime(ctx context.Context, method string, path string, query url.Values, body map[string]any) (any, string, error) {
	sanitizePeopleRuntimeAuthBody(body)
	if result, operation, handled, err := a.handleEmployeePrivateFactsRuntime(ctx, method, path, query, body); handled {
		return ok(result), operation, err
	}
	if method == http.MethodPost && strings.TrimRight(path, "/") == "/v1/people/service/hr-source-sync/dingtalk/departments:remap" {
		result, err := a.remapHRSourceDepartments(ctx, body)
		return ok(result), "people.hr_source_sync.dingtalk.departments.remap", err
	}
	if result, operation, handled, err := a.handlePeopleIntegrationOperationAdminRuntime(ctx, method, strings.TrimRight(path, "/"), query, body); handled {
		return ok(result), operation, err
	}
	if result, operation, handled, err := a.handleAssetsOffboardingProjectionRuntime(ctx, method, strings.TrimRight(path, "/"), body); handled {
		return ok(result), operation, err
	}
	if result, operation, handled, err := a.handleOffboardingRuntime(ctx, method, strings.TrimRight(path, "/"), query, body); handled {
		return ok(result), operation, err
	}
	if result, operation, handled, err := a.handleOffboardingDueNotificationRuntime(ctx, method, strings.TrimRight(path, "/"), body); handled {
		return ok(result), operation, err
	}
	if result, operation, handled, err := a.handleOffboardingNotificationDetailAuthorizationRuntime(ctx, method, strings.TrimRight(path, "/"), query, body); handled {
		return ok(result), operation, err
	}
	if err := validateRankMutation(method, path, body); err != nil {
		return nil, "people.ranks.write", err
	}
	if err := rejectGenericEmployeeRankMutation(method, path, body); err != nil {
		return nil, "people.employees.rank.write", err
	}
	if err := rejectGenericAssignmentRankMutation(method, path, body); err != nil {
		return nil, "people.assignments.rank.write", err
	}
	if isRankRuntimePath(path) {
		if err := a.requireRankSeriesSchemaReady(ctx); err != nil {
			return nil, "people.ranks.schema", err
		}
	}
	if err := rejectGenericCostSnapshotConfirmationMutation(method, path, body); err != nil {
		return nil, "people.cost_snapshots.confirmed_at.write", err
	}
	if err := rejectGenericAssignmentApprovalMutation(method, path, body); err != nil {
		return nil, "people.assignments.approval_status.write", err
	}
	if err := rejectGenericPerformanceCycleTerminalMutation(method, path, body); err != nil {
		return nil, "people.performance_cycles.terminal_status.write", err
	}
	if err := rejectGenericContributionSnapshotMutation(method, path); err != nil {
		return nil, "people.contribution_snapshots.service_managed.write", err
	}
	if method == http.MethodGet && path == "/v1/people/dashboard/overview" {
		if err := requireEmployeeQueryAccess(query); err != nil {
			return nil, "people.dashboard.access", err
		}
		result, err := a.dashboardOverview(ctx, query)
		return ok(result), "people.dashboard.overview", err
	}

	if method == http.MethodGet && strings.HasPrefix(path, "/v1/people/employees/") && strings.HasSuffix(path, "/profile") {
		if err := requireEmployeeQueryAccess(query); err != nil {
			return nil, "people.employees.access", err
		}
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
		if err := a.rejectDingTalkOnboardOverride(ctx, method, path, body); err != nil {
			return nil, "people.employees.onboard_date.write", err
		}
		if err := rejectClientOnboardDateSource(body); err != nil {
			return nil, "people.employees.onboard_date_source.write", err
		}
		markManualOnboardDateSource(method, path, body)
	}
	// 遗留 dt-* 主体归并。预览只读；执行要求全局访问权限，并在单事务内迁移
	// People 侧全部引用。
	if strings.TrimRight(path, "/") == "/v1/people/subject-merge:preview" && method == http.MethodGet {
		if err := requireEmployeeGlobalAccess(query); err != nil {
			return nil, "people.subject_merge.preview", err
		}
		result, err := a.PreviewSubjectMerge(ctx, query.Get("legacy_uid"), query.Get("canonical_uid"))
		if err != nil {
			return nil, "people.subject_merge.preview", err
		}
		return ok(result), "people.subject_merge.preview", nil
	}
	if strings.TrimRight(path, "/") == "/v1/people/subject-merge" && method == http.MethodPost {
		return nil, "people.subject_merge.apply", httperror.New(http.StatusGone,
			"people_subject_merge_manual_only",
			"Cross-application subject merge is disabled; use the audited runbook after all application reference checks pass")
	}
	// 入职开通与激活。激活只接受调用方已在 Console 验真的建号 operation，
	// 不接受浏览器声称「账号已创建」。
	if method == http.MethodPost && strings.HasPrefix(path, "/v1/people/onboarding-cases/") &&
		strings.HasSuffix(strings.TrimRight(path, "/"), ":begin-provisioning") {
		if err := requireEmployeeGlobalAccess(query); err != nil {
			return nil, "people.onboarding.begin_provision", err
		}
		code := strings.TrimSuffix(strings.TrimPrefix(strings.TrimRight(path, "/"), "/v1/people/onboarding-cases/"), ":begin-provisioning")
		result, err := a.BeginOnboardingProvisioning(ctx, code,
			int64(intValue(firstNonNil(body["object_version"], body["objectVersion"]))),
			cleanBodyString(body, "operator_uid", "operatorUid"))
		if err != nil {
			return nil, "people.onboarding.begin_provision", err
		}
		return ok(result), "people.onboarding.begin_provision", nil
	}
	if method == http.MethodPost && strings.HasPrefix(path, "/v1/people/onboarding-cases/") &&
		strings.HasSuffix(strings.TrimRight(path, "/"), ":reserved") {
		if err := requireEmployeeGlobalAccess(query); err != nil {
			return nil, "people.onboarding.reserve", err
		}
		code := strings.TrimSuffix(strings.TrimPrefix(strings.TrimRight(path, "/"), "/v1/people/onboarding-cases/"), ":reserved")
		result, err := a.RecordOnboardingReservation(ctx, code,
			cleanBodyString(body, "reservation_id", "reservationId"),
			int64(intValue(firstNonNil(body["object_version"], body["objectVersion"]))),
			cleanBodyString(body, "operator_uid", "operatorUid"))
		if err != nil {
			return nil, "people.onboarding.reserve", err
		}
		return ok(result), "people.onboarding.reserve", nil
	}
	if method == http.MethodPost && strings.HasPrefix(path, "/v1/people/onboarding-cases/") &&
		strings.HasSuffix(strings.TrimRight(path, "/"), ":provisioning") {
		if err := requireEmployeeGlobalAccess(query); err != nil {
			return nil, "people.onboarding.provision", err
		}
		code := strings.TrimSuffix(strings.TrimPrefix(strings.TrimRight(path, "/"), "/v1/people/onboarding-cases/"), ":provisioning")
		result, err := a.MarkOnboardingProvisioning(ctx, code,
			cleanBodyString(body, "reservation_id", "reservationId"),
			cleanBodyString(body, "provision_operation_id", "provisionOperationId"),
			int64(intValue(firstNonNil(body["object_version"], body["objectVersion"]))),
			cleanBodyString(body, "operator_uid", "operatorUid"))
		if err != nil {
			return nil, "people.onboarding.provision", err
		}
		return ok(result), "people.onboarding.provision", nil
	}
	if method == http.MethodPost && strings.HasPrefix(path, "/v1/people/onboarding-cases/") &&
		strings.HasSuffix(strings.TrimRight(path, "/"), ":failure") {
		if err := requireEmployeeGlobalAccess(query); err != nil {
			return nil, "people.onboarding.failure", err
		}
		code := strings.TrimSuffix(strings.TrimPrefix(strings.TrimRight(path, "/"), "/v1/people/onboarding-cases/"), ":failure")
		result, err := a.MarkOnboardingFailure(ctx, code,
			cleanBodyString(body, "status"), cleanBodyString(body, "error_code", "errorCode"),
			int64(intValue(firstNonNil(body["object_version"], body["objectVersion"]))),
			cleanBodyString(body, "operator_uid", "operatorUid"))
		if err != nil {
			return nil, "people.onboarding.failure", err
		}
		return ok(result), "people.onboarding.failure", nil
	}
	if method == http.MethodPost && strings.HasPrefix(path, "/v1/people/onboarding-cases/") &&
		strings.HasSuffix(strings.TrimRight(path, "/"), ":cancel") {
		if err := requireEmployeeGlobalAccess(query); err != nil {
			return nil, "people.onboarding.cancel", err
		}
		code := strings.TrimSuffix(strings.TrimPrefix(strings.TrimRight(path, "/"), "/v1/people/onboarding-cases/"), ":cancel")
		result, err := a.CancelOnboarding(ctx, code, cleanBodyString(body, "reason"),
			int64(intValue(firstNonNil(body["object_version"], body["objectVersion"]))),
			cleanBodyString(body, "operator_uid", "operatorUid"))
		if err != nil {
			return nil, "people.onboarding.cancel", err
		}
		return ok(result), "people.onboarding.cancel", nil
	}
	if method == http.MethodPost && strings.HasPrefix(path, "/v1/people/onboarding-cases/") &&
		strings.HasSuffix(strings.TrimRight(path, "/"), ":aggregate-status") {
		if err := requireEmployeeGlobalAccess(query); err != nil {
			return nil, "people.onboarding.aggregate", err
		}
		code := strings.TrimSuffix(strings.TrimPrefix(strings.TrimRight(path, "/"), "/v1/people/onboarding-cases/"), ":aggregate-status")
		result, err := a.AggregateOnboardingStatus(ctx, code,
			isExplicitTrue(firstNonNil(body["directory_applied"], body["directoryApplied"])),
			cleanBodyString(body, "platform_status", "platformStatus"),
			cleanBodyString(body, "operator_uid", "operatorUid"))
		if err != nil {
			return nil, "people.onboarding.aggregate", err
		}
		return ok(result), "people.onboarding.aggregate", nil
	}
	if method == http.MethodPost && strings.HasPrefix(path, "/v1/people/onboarding-cases/") &&
		strings.HasSuffix(strings.TrimRight(path, "/"), ":activate") {
		if err := requireEmployeeGlobalAccess(query); err != nil {
			return nil, "people.onboarding.activate", err
		}
		trusted, trustedErr := integrationoperation.TrustedContextFromMap(body, "people")
		if trustedErr != nil {
			return nil, "people.onboarding.activate", httperror.New(http.StatusForbidden,
				"integration_operation_context_invalid", "trusted People lifecycle context is required")
		}
		code := strings.TrimSuffix(strings.TrimPrefix(strings.TrimRight(path, "/"), "/v1/people/onboarding-cases/"), ":activate")
		result, err := a.ActivateOnboardingEmployee(ctx, code,
			cleanBodyString(body, "verified_operation_id", "verifiedOperationId"),
			cleanBodyString(body, "operator_uid", "operatorUid"), trusted)
		if err != nil {
			return nil, "people.onboarding.activate", err
		}
		return ok(result), "people.onboarding.activate", nil
	}
	// 入职单资料完善：HR 在这里确认 canonical 事实，走 CAS 而不是通用资源写入，
	// 以便强制状态守卫、必填校验和字段白名单。
	if method == http.MethodPatch && strings.HasPrefix(path, "/v1/people/onboarding-cases/") &&
		strings.HasSuffix(strings.TrimRight(path, "/"), "/profile") {
		if err := requireEmployeeGlobalAccess(query); err != nil {
			return nil, "people.onboarding.edit", err
		}
		trimmed := strings.TrimSuffix(strings.TrimRight(path, "/"), "/profile")
		code := strings.TrimPrefix(trimmed, "/v1/people/onboarding-cases/")
		result, err := a.UpdateOnboardingProfile(ctx, code, body, cleanBodyString(body, "operator_uid", "operatorUid"))
		if err != nil {
			return nil, "people.onboarding.edit", err
		}
		return ok(result), "people.onboarding.edit", nil
	}
	if method == http.MethodPost && strings.TrimRight(path, "/") == peopleEmployeeSearchPath {
		result, err := a.searchEmployees(ctx, query, body)
		if err == nil {
			redactEmployeeSensitiveCostFieldsInResponse(query, result)
		}
		return result, "people.employees.search", err
	}
	if result, operation, handled, err := a.handleAssignmentChangeRuntime(ctx, method, path, query, body); handled {
		if err == nil {
			redactEmployeeSensitiveCostFieldsInResponse(query, result)
		}
		return ok(result), operation, err
	}
	if err := a.ensureGenericAssignmentMutationConflictFree(ctx, method, path, body); err != nil {
		return nil, "people.assignments.primary_period.write", err
	}
	if result, operation, handled, err := a.handleDirectoryLifecycleMutation(ctx, method, path, query, body); handled {
		if err == nil {
			redactEmployeeSensitiveCostFieldsInResponse(query, result)
		}
		return result, operation, err
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
		result, err := a.syncContributionsCommand(ctx, body)
		return ok(result), "people.service.contributions.sync", err
	}

	if method == http.MethodPost {
		if cycleCode, matched := performanceCycleServiceAction(path, "confirm"); matched {
			result, err := a.confirmPerformanceCycle(ctx, cycleCode, query, body)
			return ok(result), "people.service.performance_cycles.confirm", err
		}
		if cycleCode, matched := performanceCycleServiceAction(path, "close"); matched {
			result, err := a.closePerformanceCycle(ctx, cycleCode, query, body)
			return ok(result), "people.service.performance_cycles.close", err
		}
	}

	if method == http.MethodPost && path == "/v1/people/service/directory-users:sync" {
		result, err := a.syncDirectoryUsers(ctx, body)
		return ok(result), "people.service.directory_users.sync", err
	}

	if method == http.MethodPost && path == "/v1/people/service/cost-snapshots:generate" {
		result, err := a.generateCostSnapshots(ctx, query, body)
		return ok(result), "people.service.cost_snapshots.generate", err
	}

	if method == http.MethodPost && path == "/v1/people/service/workflow/callback" {
		result, err := a.workflowCallback(ctx, body)
		return ok(result), "people.service.workflow.callback", err
	}

	result, operation, err := a.Adapter.HandleRuntime(ctx, method, path, query, body)
	if err == nil && (isEmployeeRuntimePath(path) || isAssignmentRuntimePath(path)) {
		redactEmployeeSensitiveCostFieldsInResponse(query, result)
	}
	return result, operation, err
}

func isEmployeeScopedRuntimePath(path string) bool {
	trimmed := strings.TrimRight(path, "/")
	return trimmed == "/v1/people/employees" || trimmed == peopleEmployeeSearchPath ||
		strings.HasPrefix(trimmed, "/v1/people/employees/") ||
		trimmed == "/v1/people/assignments" ||
		trimmed == peopleAssignmentChangePath ||
		strings.HasPrefix(trimmed, "/v1/people/assignments/")
}

func (a *Adapter) searchEmployees(ctx context.Context, trustedQuery url.Values, body map[string]any) (any, error) {
	query := make(url.Values, len(trustedQuery))
	for key, values := range trustedQuery {
		query[key] = append([]string(nil), values...)
	}
	for _, field := range []string{"page", "page_size", "keyword", "employment_status", "dept_codes", "employee_uids"} {
		value, exists := body[field]
		if !exists {
			continue
		}
		text, err := peopleSearchBodyValue(field, value)
		if err != nil {
			return nil, err
		}
		if text == "" {
			query.Del(field)
		} else {
			query.Set(field, text)
		}
	}
	result, _, err := a.Adapter.HandleRuntime(ctx, http.MethodGet, "/v1/people/employees", query, nil)
	return result, err
}

func peopleSearchBodyValue(field string, value any) (string, error) {
	var text string
	switch typed := value.(type) {
	case nil:
		return "", nil
	case string:
		text = strings.TrimSpace(typed)
	case []string:
		text = strings.Join(typed, ",")
	case []any:
		values := make([]string, 0, len(typed))
		for _, item := range typed {
			itemText := strings.TrimSpace(fmt.Sprint(item))
			if itemText != "" {
				values = append(values, itemText)
			}
		}
		text = strings.Join(values, ",")
	default:
		text = strings.TrimSpace(fmt.Sprint(value))
	}
	if utf8.RuneCountInString(text) > 64*1024 {
		return "", httperror.New(http.StatusRequestEntityTooLarge, "people_employee_search_filter_too_large", "employee search filter exceeds 65536 characters")
	}
	return text, nil
}

// markManualOnboardDateSource 标记 People 手工补录来源。若钉钉已经提供入职日期，
// rejectDingTalkOnboardOverride 会在此之前拒绝覆盖；钉钉没有值时才允许维护。
func markManualOnboardDateSource(method, path string, body map[string]any) {
	if body == nil || !isEmployeeRuntimePath(path) {
		return
	}
	if method != http.MethodPatch && method != http.MethodPut && method != http.MethodPost {
		return
	}
	for _, key := range []string{"onboard_date", "onboardDate"} {
		if _, ok := body[key]; ok {
			body["onboard_date_source"] = "manual"
			return
		}
	}
}

func rejectClientOnboardDateSource(body map[string]any) error {
	for _, key := range []string{"onboard_date_source", "onboardDateSource"} {
		if _, ok := body[key]; ok {
			return httperror.New(http.StatusBadRequest, "people_employee_onboard_date_source_managed", "onboard_date_source is managed by People")
		}
	}
	return nil
}

func isEmployeeRuntimePath(path string) bool {
	trimmed := strings.TrimRight(path, "/")
	return trimmed == "/v1/people/employees" ||
		strings.HasPrefix(trimmed, "/v1/people/employees/") && !strings.HasSuffix(trimmed, "/profile")
}

func isAssignmentRuntimePath(path string) bool {
	trimmed := strings.TrimRight(path, "/")
	return trimmed == "/v1/people/assignments" ||
		trimmed == peopleAssignmentChangePath ||
		strings.HasPrefix(trimmed, "/v1/people/assignments/")
}

func isPeopleGlobalSensitiveRuntimePath(path string) bool {
	trimmed := strings.TrimRight(path, "/")
	return trimmed == "/v1/people/standard-costs" ||
		strings.HasPrefix(trimmed, "/v1/people/standard-costs/")
}

func isRankRuntimePath(path string) bool {
	trimmed := strings.TrimRight(path, "/")
	return trimmed == "/v1/people/ranks" || strings.HasPrefix(trimmed, "/v1/people/ranks/")
}

func rejectGenericEmployeeRankMutation(method string, path string, body map[string]any) error {
	normalizedMethod := strings.ToUpper(strings.TrimSpace(method))
	trimmed := strings.TrimRight(path, "/")
	isCreate := normalizedMethod == http.MethodPost && trimmed == "/v1/people/employees"
	isUpdate := (normalizedMethod == http.MethodPatch || normalizedMethod == http.MethodPut) &&
		strings.HasPrefix(trimmed, "/v1/people/employees/") &&
		singleSegment(strings.TrimPrefix(trimmed, "/v1/people/employees/"))
	if !isCreate && !isUpdate {
		return nil
	}
	for key := range body {
		normalized := normalizeRankMutationKey(key)
		if normalized == "rank_code" || normalized == "rank_name" {
			return httperror.New(
				http.StatusBadRequest,
				"people_employee_rank_requires_assignment_change",
				"employee rank must be changed through assignments:change",
			)
		}
	}
	return nil
}

func rejectGenericAssignmentRankMutation(method string, path string, body map[string]any) error {
	normalizedMethod := strings.ToUpper(strings.TrimSpace(method))
	trimmed := strings.TrimRight(path, "/")
	isCreate := normalizedMethod == http.MethodPost && trimmed == "/v1/people/assignments"
	isUpdate := (normalizedMethod == http.MethodPatch || normalizedMethod == http.MethodPut) &&
		strings.HasPrefix(trimmed, "/v1/people/assignments/") &&
		singleSegment(strings.TrimPrefix(trimmed, "/v1/people/assignments/"))
	if !isCreate && !isUpdate {
		return nil
	}

	for key, value := range body {
		switch normalizeRankMutationKey(key) {
		case "rank_code", "rank_name":
			return httperror.New(
				http.StatusBadRequest,
				"people_assignment_rank_requires_assignment_change",
				"assignment rank must be changed through assignments:change",
			)
		case "change_type":
			if strings.EqualFold(strings.TrimSpace(fmt.Sprint(value)), "rank_change") {
				return httperror.New(
					http.StatusBadRequest,
					"people_assignment_rank_requires_assignment_change",
					"rank changes must use assignments:change",
				)
			}
		}
	}
	return nil
}

func validateRankMutation(method string, path string, body map[string]any) error {
	normalizedMethod := strings.ToUpper(strings.TrimSpace(method))
	trimmedPath := strings.TrimRight(path, "/")
	isCreate := normalizedMethod == http.MethodPost && trimmedPath == "/v1/people/ranks"
	isUpdate := (normalizedMethod == http.MethodPatch || normalizedMethod == http.MethodPut) &&
		strings.HasPrefix(trimmedPath, "/v1/people/ranks/") &&
		singleSegment(strings.TrimPrefix(trimmedPath, "/v1/people/ranks/"))
	if !isCreate && !isUpdate {
		return nil
	}

	if isUpdate {
		for key := range body {
			if normalizeRankMutationKey(key) == "rank_code" {
				return httperror.New(http.StatusBadRequest, "people_rank_code_immutable", "rank_code cannot be changed after creation")
			}
		}
	}

	canonical := make(map[string]any)
	canonicalKeys := make(map[string][]string)
	for key, value := range body {
		normalized := normalizeRankMutationKey(key)
		if !rankMutationField(normalized) {
			continue
		}
		if previous, exists := canonical[normalized]; exists && !rankMutationAliasValuesAgree(normalized, previous, value) {
			code := "people_rank_field_conflict"
			if normalized == "rank_series" {
				code = "people_rank_series_conflict"
			}
			return httperror.New(http.StatusBadRequest, code, normalized+" aliases must agree")
		}
		canonical[normalized] = value
		canonicalKeys[normalized] = append(canonicalKeys[normalized], key)
	}

	for _, field := range []string{"rank_code", "rank_name", "rank_series", "rank_level", "description", "enabled", "sort_order"} {
		value, exists := canonical[field]
		if !exists {
			continue
		}
		normalized, err := validateRankMutationField(field, value)
		if err != nil {
			return err
		}
		for _, key := range canonicalKeys[field] {
			delete(body, key)
		}
		body[field] = normalized
	}
	if isCreate {
		if _, exists := canonical["rank_name"]; !exists {
			return httperror.New(http.StatusBadRequest, "people_rank_name_invalid", "rank_name is required")
		}
	}
	return nil
}

func rankMutationAliasValuesAgree(field string, left any, right any) bool {
	if field == "rank_series" {
		return strings.EqualFold(strings.TrimSpace(fmt.Sprint(left)), strings.TrimSpace(fmt.Sprint(right)))
	}
	return fmt.Sprint(left) == fmt.Sprint(right)
}

func rankMutationField(field string) bool {
	switch field {
	case "rank_code", "rank_name", "rank_series", "rank_level", "description", "enabled", "sort_order":
		return true
	default:
		return false
	}
}

func validateRankMutationField(field string, value any) (any, error) {
	switch field {
	case "rank_code", "rank_name":
		text, ok := value.(string)
		limit := 32
		code := "people_rank_code_invalid"
		if field == "rank_name" {
			limit = 100
			code = "people_rank_name_invalid"
		}
		text = strings.TrimSpace(text)
		if !ok || text == "" || utf8.RuneCountInString(text) > limit {
			return nil, httperror.New(http.StatusBadRequest, code, fmt.Sprintf("%s must contain 1-%d characters", field, limit))
		}
		return text, nil
	case "rank_series":
		text, ok := value.(string)
		text = strings.ToUpper(strings.TrimSpace(text))
		if !ok || (text != "M" && text != "P") {
			return nil, httperror.New(http.StatusBadRequest, "people_rank_series_invalid", "rank_series must be M or P")
		}
		return text, nil
	case "rank_level", "sort_order":
		integer, ok := rankNonNegativeInteger(value)
		if !ok {
			code := "people_rank_level_invalid"
			if field == "sort_order" {
				code = "people_rank_sort_order_invalid"
			}
			return nil, httperror.New(http.StatusBadRequest, code, field+" must be a non-negative integer")
		}
		return integer, nil
	case "description":
		if value == nil {
			return nil, nil
		}
		text, ok := value.(string)
		text = strings.TrimSpace(text)
		if !ok || utf8.RuneCountInString(text) > 255 {
			return nil, httperror.New(http.StatusBadRequest, "people_rank_description_invalid", "description must contain at most 255 characters")
		}
		if text == "" {
			return nil, nil
		}
		return text, nil
	case "enabled":
		switch enabled := value.(type) {
		case bool:
			return enabled, nil
		default:
			integer, ok := rankNonNegativeInteger(enabled)
			if ok && (integer == 0 || integer == 1) {
				return integer, nil
			}
		}
		return nil, httperror.New(http.StatusBadRequest, "people_rank_enabled_invalid", "enabled must be true, false, 0 or 1")
	default:
		return value, nil
	}
}

func rankNonNegativeInteger(value any) (int64, bool) {
	text := strings.TrimSpace(fmt.Sprint(value))
	if text == "" {
		return 0, false
	}
	parsed, err := strconv.ParseInt(text, 10, 32)
	if err != nil || parsed < 0 {
		return 0, false
	}
	return parsed, true
}

// Keep this aligned with compat.toSnakeCase: rank validation runs before the
// generic adapter and must recognize every key spelling that CRUD recognizes.
func normalizeRankMutationKey(value string) string {
	value = strings.TrimSpace(value)
	if value == "" {
		return ""
	}
	var builder strings.Builder
	previousLower := false
	for _, character := range value {
		switch {
		case character == '-' || character == ' ' || character == '.':
			builder.WriteRune('_')
			previousLower = false
		case unicode.IsUpper(character):
			if previousLower {
				builder.WriteRune('_')
			}
			builder.WriteRune(unicode.ToLower(character))
			previousLower = false
		default:
			builder.WriteRune(character)
			previousLower = unicode.IsLetter(character) || unicode.IsDigit(character)
		}
	}
	return builder.String()
}

func rejectGenericCostSnapshotConfirmationMutation(method string, path string, body map[string]any) error {
	normalizedMethod := strings.ToUpper(strings.TrimSpace(method))
	trimmed := strings.TrimRight(path, "/")
	if normalizedMethod == http.MethodPost {
		if trimmed != "/v1/people/cost-snapshots" {
			return nil
		}
	} else if normalizedMethod == http.MethodPatch || normalizedMethod == http.MethodPut {
		if !strings.HasPrefix(trimmed, "/v1/people/cost-snapshots/") {
			return nil
		}
		snapshotCode := strings.TrimPrefix(trimmed, "/v1/people/cost-snapshots/")
		if !singleSegment(snapshotCode) {
			return nil
		}
	} else {
		return nil
	}

	for _, key := range []string{
		"confirmed_at",
		"confirmedAt",
	} {
		if _, ok := body[key]; ok {
			return httperror.New(http.StatusForbidden, "people_cost_snapshot_confirmation_requires_approval", "Cost snapshot confirmation must use an approval-protected service action")
		}
	}
	return nil
}

func rejectGenericAssignmentApprovalMutation(method string, path string, body map[string]any) error {
	normalizedMethod := strings.ToUpper(strings.TrimSpace(method))
	if normalizedMethod != http.MethodPost && normalizedMethod != http.MethodPatch && normalizedMethod != http.MethodPut {
		return nil
	}
	if !isAssignmentRuntimePath(path) {
		return nil
	}

	for _, key := range []string{
		"approval_status",
		"approvalStatus",
		"workflow_instance_id",
		"workflowInstanceId",
	} {
		if _, ok := body[key]; ok {
			return httperror.New(http.StatusForbidden, "people_assignment_approval_requires_workflow", "Assignment approval status must be updated through Workflow callback service")
		}
	}
	return nil
}

func rejectGenericPerformanceCycleTerminalMutation(method string, path string, body map[string]any) error {
	normalizedMethod := strings.ToUpper(strings.TrimSpace(method))
	trimmed := strings.TrimRight(path, "/")
	if normalizedMethod == http.MethodPost {
		if trimmed != "/v1/people/performance-cycles" {
			return nil
		}
	} else if normalizedMethod == http.MethodPatch || normalizedMethod == http.MethodPut {
		if matchPerformanceCycleCodePath(trimmed) == "" {
			return nil
		}
	} else {
		return nil
	}

	for _, key := range []string{
		"status",
		"confirmed_at",
		"confirmedAt",
		"closed_at",
		"closedAt",
	} {
		if _, ok := body[key]; ok {
			return httperror.New(http.StatusForbidden, "people_performance_cycle_status_requires_approval", "Performance cycle status transitions must use confirm/close service actions")
		}
	}
	return nil
}

func rejectGenericContributionSnapshotMutation(method string, path string) error {
	if strings.ToUpper(strings.TrimSpace(method)) == http.MethodGet {
		return nil
	}
	trimmed := strings.TrimRight(path, "/")
	if trimmed != "/v1/people/contribution-snapshots" && !strings.HasPrefix(trimmed, "/v1/people/contribution-snapshots/") {
		return nil
	}
	return httperror.New(
		http.StatusForbidden,
		"people_contribution_snapshot_requires_sync",
		"Contribution snapshots are service-managed and cannot be changed through generic CRUD",
	)
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
		"current_user_cost_snapshot_access",
		"currentUserCostSnapshotAccess",
		"current_user_cost_snapshot_dept_code",
		"currentUserCostSnapshotDeptCode",
		"current_user_cost_snapshot_dept_codes",
		"currentUserCostSnapshotDeptCodes",
		"current_user_assignment_access",
		"currentUserAssignmentAccess",
		"current_user_assignment_dept_code",
		"currentUserAssignmentDeptCode",
		"current_user_assignment_dept_codes",
		"currentUserAssignmentDeptCodes",
		"current_user_performance_cycle_access",
		"currentUserPerformanceCycleAccess",
		"current_user_performance_cycle_dept_code",
		"currentUserPerformanceCycleDeptCode",
		"current_user_performance_cycle_dept_codes",
		"currentUserPerformanceCycleDeptCodes",
		"current_user_document_access",
		"currentUserDocumentAccess",
		"current_user_document_dept_code",
		"currentUserDocumentDeptCode",
		"current_user_document_dept_codes",
		"currentUserDocumentDeptCodes",
	} {
		delete(body, key)
	}
}
