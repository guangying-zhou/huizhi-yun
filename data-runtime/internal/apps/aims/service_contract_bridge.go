package aims

import (
	"context"
	"database/sql"
	"fmt"
	"net/http"
	"net/url"
	"strconv"
	"strings"

	"github.com/huizhi-yun/data-runtime/internal/httperror"
)

type aimsQueryer interface {
	QueryContext(context.Context, string, ...any) (*sql.Rows, error)
}

func (a *Adapter) handleServiceContractRuntime(ctx context.Context, method string, path string, query url.Values, body map[string]any) (any, string, bool, error) {
	switch {
	case method == http.MethodPost && path == "/v1/aims/service/projects/from-contract":
		data, err := a.createProjectFromContract(ctx, body)
		return data, "aims.service.projects.from_contract", true, err
	case method == http.MethodGet && path == "/v1/aims/service/projects/eligible-for-contract":
		data, err := a.eligibleProjectsForContract(ctx, query)
		return data, "aims.service.projects.eligible_for_contract", true, err
	case method == http.MethodGet && strings.HasPrefix(path, "/v1/aims/service/projects/by-contract/"):
		contractCode := strings.TrimPrefix(path, "/v1/aims/service/projects/by-contract/")
		contractCode, _ = url.PathUnescape(contractCode)
		data, err := a.projectByContractCode(ctx, contractCode)
		return data, "aims.service.projects.by_contract", true, err
	case method == http.MethodPost:
		if projectCode, ok := pathParam(path, "/v1/aims/service/projects/", "/payment-milestones:sync"); ok {
			projectCode, _ = url.PathUnescape(projectCode)
			data, err := a.syncPaymentMilestones(ctx, projectCode, body)
			return data, "aims.service.projects.payment_milestones.sync", true, err
		}
		if ticketCode, ok := pathParam(path, "/v1/aims/service/service-tickets/", "/work-item"); ok {
			ticketCode, _ = url.PathUnescape(ticketCode)
			data, err := a.createWorkItemFromServiceTicket(ctx, ticketCode, body)
			return data, "aims.service.service_tickets.work_item.create", true, err
		}
	}
	return nil, "", false, nil
}

func (a *Adapter) eligibleProjectsForContract(ctx context.Context, query url.Values) (map[string]any, error) {
	contractCode := strings.TrimSpace(firstNonEmptyText(query.Get("contract_code"), query.Get("contractCode")))
	customerCode := strings.TrimSpace(firstNonEmptyText(query.Get("customer_code"), query.Get("customerCode")))
	projectCode := strings.TrimSpace(firstNonEmptyText(query.Get("project_code"), query.Get("projectCode")))
	search := strings.TrimSpace(query.Get("search"))
	includeLinked := strings.EqualFold(strings.TrimSpace(query.Get("include_linked")), "true") ||
		strings.EqualFold(strings.TrimSpace(query.Get("includeLinked")), "true") ||
		strings.TrimSpace(query.Get("include_linked")) == "1" ||
		strings.TrimSpace(query.Get("includeLinked")) == "1"

	where := []string{"lifecycle_status <> 'archived'"}
	args := []any{}
	if customerCode != "" {
		where = append(where, "customer_code = ?")
		args = append(args, customerCode)
	}
	if projectCode != "" {
		where = append(where, "project_code = ?")
		args = append(args, projectCode)
	}
	if search != "" {
		like := "%" + search + "%"
		where = append(where, "(project_code LIKE ? OR name LIKE ? OR short_name LIKE ? OR internal_code LIKE ?)")
		args = append(args, like, like, like, like)
	}
	if !includeLinked {
		if contractCode != "" {
			where = append(where, "((contract_code IS NULL OR contract_code = '') OR contract_code = ?)")
			args = append(args, contractCode)
		} else {
			where = append(where, "(contract_code IS NULL OR contract_code = '')")
		}
	}

	limit := serviceBodyInt(map[string]any{
		"limit": query.Get("limit"),
	}, "limit")
	if limit <= 0 || limit > 100 {
		limit = 50
	}
	args = append(args, limit)

	items, err := aimsQueryMaps(ctx, a.DB(), `
		SELECT
		  id,
		  project_code,
		  name,
		  short_name,
		  internal_code,
		  category,
		  methodology,
		  lifecycle_status,
		  dept_code,
		  leader_uid,
		  start_date,
		  end_date,
		  customer_code,
		  customer_name,
		  contract_id,
		  contract_code
		FROM aims_projects
		WHERE `+strings.Join(where, " AND ")+`
		ORDER BY
		  CASE
		    WHEN contract_code = ? THEN 0
		    WHEN contract_code IS NULL OR contract_code = '' THEN 1
		    ELSE 2
		  END,
		  updated_at DESC,
		  id DESC
		LIMIT ?
	`, append(args[:len(args)-1], contractCode, args[len(args)-1])...)
	if err != nil {
		return nil, err
	}

	for _, item := range items {
		item["eligible_reason"] = projectEligibilityReason(item, contractCode)
		item["link_mode"] = "linked_existing"
	}
	return map[string]any{
		"items": items,
		"total": len(items),
		"filters": map[string]any{
			"contract_code":  contractCode,
			"customer_code":  customerCode,
			"project_code":   projectCode,
			"search":         search,
			"include_linked": includeLinked,
		},
	}, nil
}

func projectEligibilityReason(project map[string]any, contractCode string) string {
	currentContract := strings.TrimSpace(fmt.Sprint(project["contract_code"]))
	switch {
	case currentContract == "":
		return "unlinked"
	case contractCode != "" && currentContract == contractCode:
		return "already_linked_to_contract"
	default:
		return "linked_to_other_contract"
	}
}

func (a *Adapter) createProjectFromContract(ctx context.Context, body map[string]any) (map[string]any, error) {
	contractCode := firstBodyText(body, "contractCode", "contract_code")
	if contractCode == "" {
		return nil, httperror.New(http.StatusBadRequest, "missing_contract_code", "contractCode is required")
	}

	tx, err := a.DB().BeginTx(ctx, nil)
	if err != nil {
		return nil, err
	}
	defer tx.Rollback()

	projectCode := firstBodyText(body, "projectCode", "project_code")
	autoCode := projectCode == ""
	if autoCode {
		projectCode = projectCodeFromContractPlan(contractCode, firstBodyText(body, "planKey", "plan_key"), firstBodyText(body, "projectRole", "project_role"))
	}
	desiredProjectCode := normalizeProjectCode(projectCode)
	if desiredProjectCode == "" {
		return nil, httperror.New(http.StatusBadRequest, "missing_project_code", "projectCode is required")
	}

	existing, err := aimsQueryOneMap(ctx, tx, `
		SELECT *
		FROM aims_projects
		WHERE project_code = ?
		  AND lifecycle_status <> 'archived'
		LIMIT 1
		FOR UPDATE
	`, desiredProjectCode)
	if err != nil {
		return nil, err
	}
	if existing != nil {
		existingContractCode := strings.TrimSpace(fmt.Sprint(existing["contract_code"]))
		if existingContractCode != "" && existingContractCode != contractCode {
			return nil, httperror.New(http.StatusConflict, "project_linked_to_other_contract", "projectCode is already linked to another contract")
		}
		if existingContractCode == "" {
			if _, err := tx.ExecContext(ctx, `
				UPDATE aims_projects
				SET contract_code = ?,
				    contract_id = COALESCE(contract_id, ?),
				    customer_code = COALESCE(customer_code, ?),
				    customer_name = COALESCE(customer_name, ?),
				    updated_at = CURRENT_TIMESTAMP
				WHERE id = ?
			`, contractCode,
				nullableOptionalID(body, "contractId", "contract_id"),
				nullableText(firstBodyText(body, "customerCode", "customer_code")),
				nullableText(firstBodyText(body, "customerName", "customer_name")),
				existing["id"]); err != nil {
				return nil, err
			}
			existing, err = aimsQueryOneMap(ctx, tx, "SELECT * FROM aims_projects WHERE id = ? LIMIT 1", existing["id"])
			if err != nil {
				return nil, err
			}
		}
		if err := tx.Commit(); err != nil {
			return nil, err
		}
		return map[string]any{
			"project":         existing,
			"created":         false,
			"idempotent":      true,
			"planKey":         firstBodyText(body, "planKey", "plan_key"),
			"projectRole":     firstBodyText(body, "projectRole", "project_role"),
			"lineCodes":       serviceStringSlice(body["lineCodes"], body["line_codes"]),
			"obligationCodes": serviceStringSlice(body["obligationCodes"], body["obligation_codes"]),
		}, nil
	}

	projectCode, err = a.reserveProjectCode(ctx, tx, projectCode, autoCode)
	if err != nil {
		return nil, err
	}

	name := firstNonEmptyText(
		firstBodyText(body, "projectName", "project_name"),
		firstBodyText(body, "contractName", "contract_name"),
		firstBodyText(body, "name"),
		contractCode,
	)
	shortName := firstNonEmptyText(firstBodyText(body, "shortName", "short_name"), truncateAimsText(name, 50))
	createdBy := firstNonEmptyText(firstBodyText(body, "createdBy", "created_by"), firstBodyText(body, "current_user", "operator_uid"), "system")
	leaderUID := firstNonEmptyText(firstBodyText(body, "leaderUid", "leader_uid"), firstBodyText(body, "ownerUserId", "owner_user_id"))
	managerUID := firstNonEmptyText(leaderUID, createdBy)
	lifecycleStatus := allowedProjectLifecycle(firstBodyText(body, "lifecycleStatus", "lifecycle_status"), "active")

	result, err := tx.ExecContext(ctx, `
		INSERT INTO aims_projects (
		  project_code, name, short_name, internal_code, description, category, methodology,
		  lifecycle_status, portfolio_id, domain_code, dept_code, leader_uid, security_level,
		  access_whitelist, start_date, end_date, opp_id, contract_id, customer_code, customer_name,
		  contract_code, module_config, board_config, workflow_config, notification_config,
		  template_set_id, template_version_id, created_by
		) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
	`, projectCode,
		name,
		shortName,
		nullableText(firstBodyText(body, "internalCode", "internal_code")),
		nullableText(firstBodyText(body, "description", "remark")),
		firstNonEmptyText(firstBodyText(body, "category"), categoryForProjectRole(firstBodyText(body, "projectRole", "project_role")), "delivery"),
		firstNonEmptyText(firstBodyText(body, "methodology"), "PIVR"),
		lifecycleStatus,
		nullableOptionalID(body, "portfolioId", "portfolio_id"),
		nullableText(firstBodyText(body, "domainCode", "domain_code")),
		nullableText(firstBodyText(body, "deptCode", "dept_code", "ownerDeptCode", "owner_dept_code")),
		nullableText(leaderUID),
		firstNonEmptyText(firstBodyText(body, "securityLevel", "security_level"), "company"),
		nullableText(bodyJSONText(body, "accessWhitelist", "access_whitelist")),
		nullableText(firstBodyText(body, "startDate", "start_date", "effectiveDate", "effective_date")),
		nullableText(firstBodyText(body, "endDate", "end_date")),
		nullableOptionalID(body, "oppId", "opp_id", "opportunityId", "opportunity_id"),
		nullableOptionalID(body, "contractId", "contract_id"),
		nullableText(firstBodyText(body, "customerCode", "customer_code")),
		nullableText(firstBodyText(body, "customerName", "customer_name")),
		contractCode,
		nullableText(bodyJSONText(body, "moduleConfig", "module_config")),
		nullableText(bodyJSONText(body, "boardConfig", "board_config")),
		nullableText(bodyJSONText(body, "workflowConfig", "workflow_config")),
		nullableText(bodyJSONText(body, "notificationConfig", "notification_config")),
		nullableOptionalID(body, "templateSetId", "template_set_id"),
		nullableOptionalID(body, "templateVersionId", "template_version_id"),
		createdBy)
	if err != nil {
		return nil, err
	}

	projectID, err := result.LastInsertId()
	if err != nil {
		return nil, err
	}
	if _, err := tx.ExecContext(ctx, "INSERT INTO project_counters (project_id, counter) VALUES (?, 0)", projectID); err != nil {
		return nil, err
	}
	if managerUID != "" {
		if _, err := tx.ExecContext(ctx, `
			INSERT INTO aims_project_members (project_id, uid, role, status)
			VALUES (?, ?, 'manager', 'active')
			ON DUPLICATE KEY UPDATE role = 'manager', status = 'active'
		`, projectID, managerUID); err != nil {
			return nil, err
		}
	}

	project, err := aimsQueryOneMap(ctx, tx, "SELECT * FROM aims_projects WHERE id = ? LIMIT 1", projectID)
	if err != nil {
		return nil, err
	}
	if err := tx.Commit(); err != nil {
		return nil, err
	}
	return map[string]any{
		"project":         project,
		"created":         true,
		"idempotent":      false,
		"planKey":         firstBodyText(body, "planKey", "plan_key"),
		"projectRole":     firstBodyText(body, "projectRole", "project_role"),
		"lineCodes":       serviceStringSlice(body["lineCodes"], body["line_codes"]),
		"obligationCodes": serviceStringSlice(body["obligationCodes"], body["obligation_codes"]),
	}, nil
}

func (a *Adapter) projectByContractCode(ctx context.Context, contractCode string) (map[string]any, error) {
	contractCode = strings.TrimSpace(contractCode)
	if contractCode == "" {
		return nil, httperror.New(http.StatusBadRequest, "missing_contract_code", "contractCode is required")
	}
	project, err := aimsQueryOneMap(ctx, a.DB(), `
		SELECT *
		FROM aims_projects
		WHERE contract_code = ?
		  AND lifecycle_status <> 'archived'
		ORDER BY id ASC
		LIMIT 1
	`, contractCode)
	if err != nil {
		return nil, err
	}
	if project == nil {
		return nil, httperror.New(http.StatusNotFound, "record_not_found", "project not found")
	}
	return map[string]any{"project": project}, nil
}

func (a *Adapter) syncPaymentMilestones(ctx context.Context, projectCode string, body map[string]any) (map[string]any, error) {
	projectCode = strings.TrimSpace(projectCode)
	if projectCode == "" {
		return nil, httperror.New(http.StatusBadRequest, "missing_project_code", "projectCode is required")
	}
	terms, err := paymentTermItems(body)
	if err != nil {
		return nil, err
	}
	schedules, err := billingScheduleItems(body)
	if err != nil {
		return nil, err
	}
	if len(terms) == 0 && len(schedules) == 0 {
		return nil, httperror.New(http.StatusBadRequest, "missing_milestone_items", "paymentTerms or billingSchedules is required")
	}

	tx, err := a.DB().BeginTx(ctx, nil)
	if err != nil {
		return nil, err
	}
	defer tx.Rollback()

	project, err := aimsQueryOneMap(ctx, tx, `
		SELECT id, project_code, contract_code
		FROM aims_projects
		WHERE project_code = ?
		  AND lifecycle_status <> 'archived'
		LIMIT 1
		FOR UPDATE
	`, projectCode)
	if err != nil {
		return nil, err
	}
	if project == nil {
		return nil, httperror.New(http.StatusNotFound, "record_not_found", "project not found")
	}
	projectID, err := int64MapValue(project, "id")
	if err != nil {
		return nil, err
	}

	createdBy := firstNonEmptyText(firstBodyText(body, "createdBy", "created_by"), firstBodyText(body, "current_user", "operator_uid"), "system")
	items := make([]map[string]any, 0, len(terms))
	created := 0
	updated := 0

	for index, term := range terms {
		paymentTermID, ok, err := optionalBodyID(term, "paymentTermId", "payment_term_id", "id")
		if err != nil || !ok || paymentTermID <= 0 {
			return nil, httperror.New(http.StatusBadRequest, "invalid_payment_term_id", "paymentTerms[].paymentTermId is required")
		}
		name := firstNonEmptyText(firstBodyText(term, "termName", "term_name", "name", "planName", "plan_name"), fmt.Sprintf("付款条款 %d", paymentTermID))
		description := firstBodyText(term, "conditionDesc", "condition_desc", "description", "remark")
		termType := strings.ToLower(firstBodyText(term, "termType", "term_type", "planType", "plan_type"))
		expectedDate := firstBodyText(term, "expectedDate", "expected_date", "plannedPaymentDate", "planned_payment_date", "plannedInvoiceDate", "planned_invoice_date")
		sortOrder := serviceBodyInt(term, "sortNo", "sort_no", "sortOrder", "sort_order")
		if sortOrder == 0 {
			sortOrder = (index + 1) * 10
		}
		templateKey := firstNonEmptyText(firstBodyText(term, "templateKey", "template_key"), fmt.Sprintf("payment_term:%d", paymentTermID))

		existingID, err := a.paymentMilestoneID(ctx, tx, projectID, paymentTermID)
		if err != nil {
			return nil, err
		}
		if existingID > 0 {
			if _, err := tx.ExecContext(ctx, `
				UPDATE milestones
				SET name = ?,
				    description = ?,
				    mode = 'strong_constraint',
				    end_date = ?,
				    pivr_stage = ?,
				    template_key = ?,
				    sort_order = ?,
				    updated_at = CURRENT_TIMESTAMP
				WHERE id = ?
			`, name, nullableText(description), nullableText(expectedDate), nullableText(pivrStageForTermType(termType)), templateKey, sortOrder, existingID); err != nil {
				return nil, err
			}
			updated++
		} else {
			result, err := tx.ExecContext(ctx, `
				INSERT INTO milestones (
				  project_id, name, description, mode, end_date, status, pivr_stage,
				  template_key, payment_term_id, sort_order, created_by
				) VALUES (?, ?, ?, 'strong_constraint', ?, 'planning', ?, ?, ?, ?, ?)
			`, projectID, name, nullableText(description), nullableText(expectedDate), nullableText(pivrStageForTermType(termType)), templateKey, paymentTermID, sortOrder, createdBy)
			if err != nil {
				return nil, err
			}
			existingID, err = result.LastInsertId()
			if err != nil {
				return nil, err
			}
			created++
		}

		row, err := aimsQueryOneMap(ctx, tx, "SELECT * FROM milestones WHERE id = ? LIMIT 1", existingID)
		if err != nil {
			return nil, err
		}
		items = append(items, row)
	}

	for index, schedule := range schedules {
		scheduleID, _, err := optionalBodyID(schedule, "billingScheduleId", "billing_schedule_id", "id")
		if err != nil {
			return nil, httperror.New(http.StatusBadRequest, "invalid_billing_schedule_id", "billingSchedules[].id must be a positive integer when provided")
		}
		scheduleCode := firstBodyText(schedule, "billingScheduleCode", "billing_schedule_code", "code")
		templateKey := firstNonEmptyText(
			firstBodyText(schedule, "templateKey", "template_key"),
			"billing_schedule:"+firstNonEmptyText(scheduleCode, fmt.Sprint(scheduleID), fmt.Sprintf("%d", index+1)),
		)
		name := firstNonEmptyText(
			firstBodyText(schedule, "scheduleName", "schedule_name", "name"),
			firstBodyText(schedule, "obligationName", "obligation_name"),
			fmt.Sprintf("结算节点 %s", firstNonEmptyText(scheduleCode, fmt.Sprint(index+1))),
		)
		triggerType := strings.ToLower(firstBodyText(schedule, "triggerType", "trigger_type"))
		description := firstNonEmptyText(
			firstBodyText(schedule, "conditionDesc", "condition_desc", "description", "remark"),
			firstBodyText(schedule, "obligationCode", "obligation_code"),
		)
		expectedDate := firstBodyText(schedule, "expectedDate", "expected_date", "plannedPaymentDate", "planned_payment_date", "plannedInvoiceDate", "planned_invoice_date")
		sortOrder := serviceBodyInt(schedule, "sortNo", "sort_no", "sortOrder", "sort_order")
		if sortOrder == 0 {
			sortOrder = (len(terms) + index + 1) * 10
		}

		existingID, err := a.milestoneIDByTemplateKey(ctx, tx, projectID, templateKey)
		if err != nil {
			return nil, err
		}
		if existingID > 0 {
			if _, err := tx.ExecContext(ctx, `
				UPDATE milestones
				SET name = ?,
				    description = ?,
				    mode = 'strong_constraint',
				    end_date = ?,
				    pivr_stage = ?,
				    template_key = ?,
				    sort_order = ?,
				    updated_at = CURRENT_TIMESTAMP
				WHERE id = ?
			`, name, nullableText(description), nullableText(expectedDate), nullableText(pivrStageForTermType(triggerType)), templateKey, sortOrder, existingID); err != nil {
				return nil, err
			}
			updated++
		} else {
			result, err := tx.ExecContext(ctx, `
				INSERT INTO milestones (
				  project_id, name, description, mode, end_date, status, pivr_stage,
				  template_key, payment_term_id, sort_order, created_by
				) VALUES (?, ?, ?, 'strong_constraint', ?, 'planning', ?, ?, NULL, ?, ?)
			`, projectID, name, nullableText(description), nullableText(expectedDate), nullableText(pivrStageForTermType(triggerType)), templateKey, sortOrder, createdBy)
			if err != nil {
				return nil, err
			}
			existingID, err = result.LastInsertId()
			if err != nil {
				return nil, err
			}
			created++
		}

		row, err := aimsQueryOneMap(ctx, tx, "SELECT * FROM milestones WHERE id = ? LIMIT 1", existingID)
		if err != nil {
			return nil, err
		}
		items = append(items, row)
	}

	if err := tx.Commit(); err != nil {
		return nil, err
	}
	return map[string]any{
		"projectCode": projectCode,
		"created":     created,
		"updated":     updated,
		"items":       items,
	}, nil
}

func (a *Adapter) reserveProjectCode(ctx context.Context, tx *sql.Tx, rawCode string, auto bool) (string, error) {
	code := normalizeProjectCode(rawCode)
	if code == "" {
		return "", httperror.New(http.StatusBadRequest, "missing_project_code", "projectCode is required")
	}
	if len(code) > 50 {
		code = strings.TrimRight(code[:50], "-")
	}

	if !auto {
		exists, err := a.projectCodeExists(ctx, tx, code)
		if err != nil {
			return "", err
		}
		if exists {
			return "", httperror.New(http.StatusConflict, "project_code_exists", "projectCode is already used")
		}
		return code, nil
	}

	base := code
	for index := 0; index < 100; index++ {
		candidate := base
		if index > 0 {
			suffix := fmt.Sprintf("-%d", index+1)
			candidate = truncateAimsText(base, 50-len(suffix)) + suffix
		}
		exists, err := a.projectCodeExists(ctx, tx, candidate)
		if err != nil {
			return "", err
		}
		if !exists {
			return candidate, nil
		}
	}
	return "", httperror.New(http.StatusConflict, "project_code_exists", "unable to allocate projectCode")
}

func (a *Adapter) projectCodeExists(ctx context.Context, tx *sql.Tx, projectCode string) (bool, error) {
	var count int64
	if err := tx.QueryRowContext(ctx, `
		SELECT COUNT(*)
		FROM aims_projects
		WHERE project_code = ?
		  AND lifecycle_status <> 'archived'
	`, projectCode).Scan(&count); err != nil {
		return false, err
	}
	return count > 0, nil
}

func (a *Adapter) paymentMilestoneID(ctx context.Context, tx *sql.Tx, projectID int64, paymentTermID int64) (int64, error) {
	var id int64
	err := tx.QueryRowContext(ctx, `
		SELECT id
		FROM milestones
		WHERE project_id = ?
		  AND payment_term_id = ?
		ORDER BY id ASC
		LIMIT 1
		FOR UPDATE
	`, projectID, paymentTermID).Scan(&id)
	if err == sql.ErrNoRows {
		return 0, nil
	}
	return id, err
}

func (a *Adapter) milestoneIDByTemplateKey(ctx context.Context, tx *sql.Tx, projectID int64, templateKey string) (int64, error) {
	templateKey = strings.TrimSpace(templateKey)
	if templateKey == "" {
		return 0, nil
	}
	var id int64
	err := tx.QueryRowContext(ctx, `
		SELECT id
		FROM milestones
		WHERE project_id = ?
		  AND template_key = ?
		ORDER BY id ASC
		LIMIT 1
		FOR UPDATE
	`, projectID, templateKey).Scan(&id)
	if err == sql.ErrNoRows {
		return 0, nil
	}
	return id, err
}

func paymentTermItems(body map[string]any) ([]map[string]any, error) {
	value, ok := body["paymentTerms"]
	if !ok {
		value = body["payment_terms"]
	}
	if value == nil {
		return nil, nil
	}
	rawItems, ok := value.([]any)
	if !ok {
		return nil, httperror.New(http.StatusBadRequest, "invalid_payment_terms", "paymentTerms must be an array")
	}
	items := make([]map[string]any, 0, len(rawItems))
	for _, raw := range rawItems {
		item, ok := raw.(map[string]any)
		if !ok {
			return nil, httperror.New(http.StatusBadRequest, "invalid_payment_terms", "paymentTerms must contain objects")
		}
		items = append(items, item)
	}
	return items, nil
}

func billingScheduleItems(body map[string]any) ([]map[string]any, error) {
	value, ok := body["billingSchedules"]
	if !ok {
		value = body["billing_schedules"]
	}
	if value == nil {
		return nil, nil
	}
	rawItems, ok := value.([]any)
	if !ok {
		return nil, httperror.New(http.StatusBadRequest, "invalid_billing_schedules", "billingSchedules must be an array")
	}
	items := make([]map[string]any, 0, len(rawItems))
	for _, raw := range rawItems {
		item, ok := raw.(map[string]any)
		if !ok {
			return nil, httperror.New(http.StatusBadRequest, "invalid_billing_schedules", "billingSchedules must contain objects")
		}
		items = append(items, item)
	}
	return items, nil
}

func aimsQueryOneMap(ctx context.Context, conn aimsQueryer, query string, args ...any) (map[string]any, error) {
	rows, err := conn.QueryContext(ctx, query, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	items, err := aimsRowsToMaps(rows)
	if err != nil {
		return nil, err
	}
	if len(items) == 0 {
		return nil, nil
	}
	return items[0], nil
}

func aimsQueryMaps(ctx context.Context, conn aimsQueryer, query string, args ...any) ([]map[string]any, error) {
	rows, err := conn.QueryContext(ctx, query, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	return aimsRowsToMaps(rows)
}

func projectCodeFromContractCode(contractCode string) string {
	code := normalizeProjectCode(contractCode)
	if code == "" {
		code = "CONTRACT"
	}
	if !strings.HasPrefix(code, "PRJ-") {
		code = "PRJ-" + code
	}
	return truncateAimsText(code, 50)
}

func projectCodeFromContractPlan(contractCode string, planKey string, projectRole string) string {
	base := projectCodeFromContractCode(contractCode)
	suffix := normalizeProjectCode(firstNonEmptyText(planKey, projectRole))
	if suffix == "" || strings.EqualFold(suffix, "DELIVERY-MAIN") {
		return base
	}
	suffix = strings.TrimPrefix(suffix, "PROJECT-")
	return truncateAimsText(base+"-"+suffix, 50)
}

func categoryForProjectRole(role string) string {
	switch strings.ToLower(strings.TrimSpace(role)) {
	case "maintenance", "operation":
		return "maintenance"
	case "development":
		return "product_dev"
	default:
		return "delivery"
	}
}

func serviceStringSlice(values ...any) []string {
	result := make([]string, 0)
	for _, value := range values {
		switch typed := value.(type) {
		case nil:
			continue
		case []string:
			for _, item := range typed {
				if text := strings.TrimSpace(item); text != "" {
					result = append(result, text)
				}
			}
		case []any:
			for _, item := range typed {
				if text := strings.TrimSpace(fmt.Sprint(item)); text != "" && text != "<nil>" {
					result = append(result, text)
				}
			}
		default:
			if text := strings.TrimSpace(fmt.Sprint(value)); text != "" && text != "<nil>" {
				result = append(result, text)
			}
		}
		if len(result) > 0 {
			return result
		}
	}
	return result
}

func normalizeProjectCode(value string) string {
	value = strings.ToUpper(strings.TrimSpace(value))
	var builder strings.Builder
	lastDash := false
	for _, r := range value {
		valid := (r >= 'A' && r <= 'Z') || (r >= '0' && r <= '9')
		if valid {
			builder.WriteRune(r)
			lastDash = false
			continue
		}
		if !lastDash {
			builder.WriteByte('-')
			lastDash = true
		}
	}
	return strings.Trim(builder.String(), "-")
}

func truncateAimsText(value string, max int) string {
	value = strings.TrimSpace(value)
	if max <= 0 || len(value) <= max {
		return value
	}
	runes := []rune(value)
	if len(runes) <= max {
		return value
	}
	return string(runes[:max])
}

func allowedProjectLifecycle(value string, fallback string) string {
	value = strings.TrimSpace(value)
	switch value {
	case "draft", "approval_pending", "active", "paused", "completed", "archived":
		return value
	default:
		return fallback
	}
}

func pivrStageForTermType(termType string) string {
	switch strings.ToLower(strings.TrimSpace(termType)) {
	case "advance", "one_time", "contract_signed":
		return "P"
	case "milestone", "delivery":
		return "I"
	case "acceptance", "accepted":
		return "V"
	case "retention", "annual_service", "service_end":
		return "R"
	default:
		return ""
	}
}

func serviceBodyInt(body map[string]any, keys ...string) int {
	for _, key := range keys {
		value, ok := body[key]
		if !ok || value == nil {
			continue
		}
		switch typed := value.(type) {
		case int:
			return typed
		case int64:
			return int(typed)
		case float64:
			return int(typed)
		default:
			parsed, err := strconv.Atoi(strings.TrimSpace(fmt.Sprint(value)))
			if err == nil {
				return parsed
			}
		}
	}
	return 0
}

func int64MapValue(row map[string]any, key string) (int64, error) {
	value := row[key]
	switch typed := value.(type) {
	case int64:
		return typed, nil
	case int:
		return int64(typed), nil
	case []byte:
		return strconv.ParseInt(string(typed), 10, 64)
	case string:
		return strconv.ParseInt(strings.TrimSpace(typed), 10, 64)
	default:
		return strconv.ParseInt(strings.TrimSpace(fmt.Sprint(value)), 10, 64)
	}
}
