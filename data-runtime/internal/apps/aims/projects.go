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

type projectListPage struct {
	page     int
	pageSize int
	offset   int
}

func (a *Adapter) memberProjects(ctx context.Context, query url.Values) (map[string]any, error) {
	currentUser := strings.TrimSpace(query.Get("current_user"))
	if currentUser == "" {
		return nil, httperror.New(http.StatusUnauthorized, "missing_current_user", "current_user is required")
	}

	page := memberProjectsPage(query)
	where, args := memberProjectsWhere(query)
	visibilityWhere, visibilityArgs := projectVisibilityWhere(query, "p", currentUser)
	where = append(where, visibilityWhere)
	args = append(args, visibilityArgs...)
	countArgs := append([]any{currentUser}, args...)
	listArgs := append([]any{currentUser, currentUser}, args...)
	whereSQL := "WHERE " + strings.Join(where, " AND ")

	var total int64
	if err := a.DB().QueryRowContext(ctx, `
		SELECT COUNT(DISTINCT p.id)
		FROM aims_projects p
		LEFT JOIN aims_project_members cm
		  ON cm.project_id = p.id
		 AND cm.uid = ?
		 AND cm.status = 'active'
		`+whereSQL, countArgs...).Scan(&total); err != nil {
		return nil, err
	}

	rows, err := a.DB().QueryContext(ctx, `
		SELECT
			p.id,
			p.project_code,
			p.name,
			p.short_name,
			p.internal_code,
			p.description,
			p.category,
			p.methodology,
			p.lifecycle_status,
			p.portfolio_id,
			p.domain_code,
			p.dept_code,
			p.leader_uid,
			p.security_level,
			p.access_whitelist,
			DATE_FORMAT(p.start_date, '%Y-%m-%d') AS start_date,
			DATE_FORMAT(p.end_date, '%Y-%m-%d') AS end_date,
			p.opp_id,
			p.contract_id,
			p.customer_code,
			p.customer_name,
			p.contract_code,
			p.template_set_id,
			ts.name AS template_set_name,
			p.template_version_id,
			tv.version_label AS template_version_label,
			p.approval_status,
			p.workflow_instance_id,
			p.module_config,
				p.board_config,
				p.workflow_config,
				p.notification_config,
				p.created_by,
				DATE_FORMAT(p.created_at, '%Y-%m-%d %H:%i:%s') AS created_at,
				DATE_FORMAT(p.updated_at, '%Y-%m-%d %H:%i:%s') AS updated_at,
				IFNULL(mc.member_count, 0) AS member_count,
				IFNULL(dc.document_count, 0) AS document_count,
				CASE
					WHEN p.leader_uid = ? THEN 'manager'
					ELSE cm.role
				END AS current_user_role,
			1 AS can_access
		FROM aims_projects p
		LEFT JOIN aims_project_members cm
		  ON cm.project_id = p.id
		 AND cm.uid = ?
		 AND cm.status = 'active'
		LEFT JOIN project_template_sets ts ON ts.id = p.template_set_id
		LEFT JOIN project_template_versions tv ON tv.id = p.template_version_id
			LEFT JOIN (
				SELECT project_id, COUNT(*) AS member_count
				FROM aims_project_members
				WHERE status = 'active'
				GROUP BY project_id
			) mc ON mc.project_id = p.id
		LEFT JOIN (
			SELECT document_sources.project_id, COUNT(DISTINCT document_sources.document_key) AS document_count
			FROM (
				SELECT resolved.project_id,
					CASE
						WHEN COALESCE(resolved.document_source, 'codocs') = 'repo'
							THEN CONCAT('repo:', COALESCE(resolved.repo_project_code, ''), ':', COALESCE(resolved.repo_file_path, ''))
						ELSE CONCAT('codocs:', COALESCE(resolved.codocs_uuid, resolved.uuid, ''))
					END AS document_key
				FROM (
					SELECT
						pd.uuid,
						pd.codocs_uuid,
						pd.document_source,
						pd.repo_project_code,
						pd.repo_file_path,
						pd.project_id
					FROM project_documents pd
					WHERE pd.project_id IS NOT NULL
					  AND COALESCE(pd.is_folder, 0) = 0
					UNION ALL
					SELECT
						pd.uuid,
						pd.codocs_uuid,
						pd.document_source,
						pd.repo_project_code,
						pd.repo_file_path,
						m.project_id
					FROM project_documents pd
					JOIN milestones m ON m.id = pd.milestone_id
					WHERE pd.milestone_id IS NOT NULL
					  AND COALESCE(pd.is_folder, 0) = 0
					UNION ALL
					SELECT
						pd.uuid,
						pd.codocs_uuid,
						pd.document_source,
						pd.repo_project_code,
						pd.repo_file_path,
						wi.project_id
					FROM project_documents pd
					JOIN work_items wi ON wi.id = pd.work_item_id
					WHERE pd.work_item_id IS NOT NULL
					  AND COALESCE(pd.is_folder, 0) = 0
				) resolved
				WHERE (
					COALESCE(resolved.document_source, 'codocs') = 'repo'
					AND COALESCE(resolved.repo_project_code, '') != ''
					AND COALESCE(resolved.repo_file_path, '') != ''
				) OR (
					COALESCE(resolved.document_source, 'codocs') != 'repo'
					AND COALESCE(resolved.codocs_uuid, resolved.uuid, '') != ''
				)
				UNION ALL
				SELECT d.project_id,
					CASE
						WHEN COALESCE(d.document_source, 'codocs') = 'repo'
							THEN CONCAT('repo:', COALESCE(d.repo_project_code, ''), ':', COALESCE(d.repo_file_path, ''))
						ELSE CONCAT('codocs:', COALESCE(d.document_uuid, ''))
					END AS document_key
				FROM deliverables d
				WHERE d.project_id IS NOT NULL
				  AND d.deliverable_type = 'document'
				  AND (
					(
						COALESCE(d.document_source, 'codocs') = 'repo'
						AND COALESCE(d.repo_project_code, '') != ''
						AND COALESCE(d.repo_file_path, '') != ''
					) OR (
						COALESCE(d.document_source, 'codocs') != 'repo'
						AND COALESCE(d.document_uuid, '') != ''
					)
				  )
			) document_sources
			GROUP BY document_sources.project_id
		) dc ON dc.project_id = p.id
			`+whereSQL+`
			ORDER BY p.updated_at DESC, p.id DESC
			LIMIT ? OFFSET ?
		`, append(listArgs, page.pageSize, page.offset)...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	items := make([]map[string]any, 0)
	for rows.Next() {
		item, err := scanMemberProject(rows)
		if err != nil {
			return nil, err
		}
		items = append(items, item)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}

	return map[string]any{
		"items":    items,
		"total":    total,
		"page":     page.page,
		"pageSize": page.pageSize,
	}, nil
}

func (a *Adapter) projectDetail(ctx context.Context, projectID string, query url.Values) (map[string]any, error) {
	currentUser := strings.TrimSpace(query.Get("current_user"))
	if currentUser == "" {
		return nil, httperror.New(http.StatusUnauthorized, "missing_current_user", "current_user is required")
	}

	visibilityWhere, visibilityArgs := projectVisibilityWhere(query, "p", currentUser)
	args := append([]any{currentUser, currentUser, projectID}, visibilityArgs...)
	rows, err := a.DB().QueryContext(ctx, `
		SELECT
			p.id,
			p.project_code,
			p.name,
			p.short_name,
			p.internal_code,
			p.description,
			p.category,
			p.methodology,
			p.lifecycle_status,
			p.portfolio_id,
			p.domain_code,
			p.dept_code,
			p.leader_uid,
			p.security_level,
			p.access_whitelist,
			DATE_FORMAT(p.start_date, '%Y-%m-%d') AS start_date,
			DATE_FORMAT(p.end_date, '%Y-%m-%d') AS end_date,
			p.opp_id,
			p.contract_id,
			p.customer_code,
			p.customer_name,
			p.contract_code,
			p.template_set_id,
			ts.name AS template_set_name,
			p.template_version_id,
			tv.version_label AS template_version_label,
			p.approval_status,
			p.workflow_instance_id,
			p.module_config,
				p.board_config,
				p.workflow_config,
				p.notification_config,
				p.created_by,
				DATE_FORMAT(p.created_at, '%Y-%m-%d %H:%i:%s') AS created_at,
				DATE_FORMAT(p.updated_at, '%Y-%m-%d %H:%i:%s') AS updated_at,
				IFNULL(mc.member_count, 0) AS member_count,
				IFNULL(dc.document_count, 0) AS document_count,
				CASE
					WHEN p.leader_uid = ? THEN 'manager'
					ELSE cm.role
				END AS current_user_role,
			1 AS can_access
		FROM aims_projects p
		LEFT JOIN aims_project_members cm
		  ON cm.project_id = p.id
		 AND cm.uid = ?
		 AND cm.status = 'active'
		LEFT JOIN project_template_sets ts ON ts.id = p.template_set_id
		LEFT JOIN project_template_versions tv ON tv.id = p.template_version_id
			LEFT JOIN (
				SELECT project_id, COUNT(*) AS member_count
				FROM aims_project_members
				WHERE status = 'active'
				GROUP BY project_id
			) mc ON mc.project_id = p.id
		LEFT JOIN (
			SELECT document_sources.project_id, COUNT(DISTINCT document_sources.document_key) AS document_count
			FROM (
				SELECT resolved.project_id,
					CASE
						WHEN COALESCE(resolved.document_source, 'codocs') = 'repo'
							THEN CONCAT('repo:', COALESCE(resolved.repo_project_code, ''), ':', COALESCE(resolved.repo_file_path, ''))
						ELSE CONCAT('codocs:', COALESCE(resolved.codocs_uuid, resolved.uuid, ''))
					END AS document_key
				FROM (
					SELECT
						pd.uuid,
						pd.codocs_uuid,
						pd.document_source,
						pd.repo_project_code,
						pd.repo_file_path,
						pd.project_id
					FROM project_documents pd
					WHERE pd.project_id IS NOT NULL
					  AND COALESCE(pd.is_folder, 0) = 0
					UNION ALL
					SELECT
						pd.uuid,
						pd.codocs_uuid,
						pd.document_source,
						pd.repo_project_code,
						pd.repo_file_path,
						m.project_id
					FROM project_documents pd
					JOIN milestones m ON m.id = pd.milestone_id
					WHERE pd.milestone_id IS NOT NULL
					  AND COALESCE(pd.is_folder, 0) = 0
					UNION ALL
					SELECT
						pd.uuid,
						pd.codocs_uuid,
						pd.document_source,
						pd.repo_project_code,
						pd.repo_file_path,
						wi.project_id
					FROM project_documents pd
					JOIN work_items wi ON wi.id = pd.work_item_id
					WHERE pd.work_item_id IS NOT NULL
					  AND COALESCE(pd.is_folder, 0) = 0
				) resolved
				WHERE (
					COALESCE(resolved.document_source, 'codocs') = 'repo'
					AND COALESCE(resolved.repo_project_code, '') != ''
					AND COALESCE(resolved.repo_file_path, '') != ''
				) OR (
					COALESCE(resolved.document_source, 'codocs') != 'repo'
					AND COALESCE(resolved.codocs_uuid, resolved.uuid, '') != ''
				)
				UNION ALL
				SELECT d.project_id,
					CASE
						WHEN COALESCE(d.document_source, 'codocs') = 'repo'
							THEN CONCAT('repo:', COALESCE(d.repo_project_code, ''), ':', COALESCE(d.repo_file_path, ''))
						ELSE CONCAT('codocs:', COALESCE(d.document_uuid, ''))
					END AS document_key
				FROM deliverables d
				WHERE d.project_id IS NOT NULL
				  AND d.deliverable_type = 'document'
				  AND (
					(
						COALESCE(d.document_source, 'codocs') = 'repo'
						AND COALESCE(d.repo_project_code, '') != ''
						AND COALESCE(d.repo_file_path, '') != ''
					) OR (
						COALESCE(d.document_source, 'codocs') != 'repo'
						AND COALESCE(d.document_uuid, '') != ''
					)
				  )
			) document_sources
			GROUP BY document_sources.project_id
		) dc ON dc.project_id = p.id
			WHERE p.id = ?
			  AND `+visibilityWhere+`
			LIMIT 1
		`, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	if !rows.Next() {
		return nil, httperror.New(http.StatusNotFound, "project_not_found", "project not found")
	}
	item, err := scanMemberProject(rows)
	if err != nil {
		return nil, err
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	return item, nil
}

func memberProjectsWhere(query url.Values) ([]string, []any) {
	where := []string{}
	args := []any{}

	if category := strings.TrimSpace(query.Get("category")); category != "" {
		where = append(where, "p.category = ?")
		args = append(args, category)
	}

	if status := strings.TrimSpace(query.Get("lifecycle_status")); status != "" {
		where = append(where, "p.lifecycle_status = ?")
		args = append(args, status)
	} else {
		where = append(where, "p.lifecycle_status != 'archived'")
	}

	if search := strings.TrimSpace(query.Get("search")); search != "" {
		where = append(where, "(p.name LIKE ? OR p.project_code LIKE ? OR p.short_name LIKE ?)")
		keyword := "%" + strings.ReplaceAll(strings.ReplaceAll(strings.ReplaceAll(search, "\\", "\\\\"), "%", "\\%"), "_", "\\_") + "%"
		args = append(args, keyword, keyword, keyword)
	}

	if portfolioID := strings.TrimSpace(firstNonEmptyProjectParam(query, "portfolio_id", "portfolioId")); portfolioID != "" {
		if portfolioID == "0" {
			where = append(where, "p.portfolio_id IS NULL")
		} else {
			where = append(where, "p.portfolio_id = ?")
			args = append(args, portfolioID)
		}
	}

	if domainCode := strings.TrimSpace(firstNonEmptyProjectParam(query, "domain_code", "domainCode")); domainCode != "" {
		where = append(where, "p.domain_code = ?")
		args = append(args, domainCode)
	}

	if deptCode := strings.TrimSpace(firstNonEmptyProjectParam(query, "dept_code", "deptCode")); deptCode != "" {
		where = append(where, "p.dept_code = ?")
		args = append(args, deptCode)
	}

	if leaderUID := strings.TrimSpace(firstNonEmptyProjectParam(query, "leader_uid", "leaderUid")); leaderUID != "" {
		where = append(where, "p.leader_uid = ?")
		args = append(args, leaderUID)
	}

	return where, args
}

func projectVisibilityWhere(query url.Values, alias string, currentUser string) (string, []any) {
	prefix := strings.TrimSpace(alias)
	if prefix != "" {
		prefix += "."
	}

	memberExists := fmt.Sprintf("EXISTS (SELECT 1 FROM aims_project_members pam WHERE pam.project_id = %sid AND pam.uid = ? AND pam.status = 'active')", prefix)
	// project_team uses only the leader/creator/member branches below.
	parts := []string{
		fmt.Sprintf("COALESCE(%ssecurity_level, 'company') = 'company'", prefix),
		fmt.Sprintf("%sleader_uid = ?", prefix),
		fmt.Sprintf("%screated_by = ?", prefix),
		memberExists,
		fmt.Sprintf("(COALESCE(%ssecurity_level, 'company') = 'whitelist' AND JSON_CONTAINS(COALESCE(%saccess_whitelist, JSON_ARRAY()), JSON_QUOTE(?), '$'))", prefix, prefix),
	}
	args := []any{currentUser, currentUser, currentUser, currentUser}

	if hasProjectAdminFlag(query) {
		parts = append(parts, "1 = 1")
	}

	managementDeptCodes := projectManagementDeptCodes(query)
	if len(managementDeptCodes) > 0 {
		placeholders := strings.TrimRight(strings.Repeat("?,", len(managementDeptCodes)), ",")
		parts = append(parts, fmt.Sprintf("%sdept_code IN (%s)", prefix, placeholders))
		for _, deptCode := range managementDeptCodes {
			args = append(args, deptCode)
		}
	}

	adminDeptCodes := projectAdminDeptCodes(query)
	if len(adminDeptCodes) > 0 {
		placeholders := strings.TrimRight(strings.Repeat("?,", len(adminDeptCodes)), ",")
		parts = append(parts, fmt.Sprintf("%sdept_code IN (%s)", prefix, placeholders))
		for _, deptCode := range adminDeptCodes {
			args = append(args, deptCode)
		}
	}

	adminProjectCodes := projectAdminProjectCodes(query)
	if len(adminProjectCodes) > 0 {
		placeholders := strings.TrimRight(strings.Repeat("?,", len(adminProjectCodes)), ",")
		parts = append(parts, fmt.Sprintf("%sproject_code IN (%s)", prefix, placeholders))
		for _, projectCode := range adminProjectCodes {
			args = append(args, projectCode)
		}
	}

	deptCodes := projectAccessDeptCodes(query)
	if len(deptCodes) > 0 {
		placeholders := strings.TrimRight(strings.Repeat("?,", len(deptCodes)), ",")
		parts = append(parts, fmt.Sprintf("(COALESCE(%ssecurity_level, 'company') = 'department' AND %sdept_code IN (%s))", prefix, prefix, placeholders))
		for _, deptCode := range deptCodes {
			args = append(args, deptCode)
		}
	}

	return "(" + strings.Join(parts, " OR ") + ")", args
}

func projectAccessDeptCodes(query url.Values) []string {
	return uniqueDeptCodes([]string{
		query.Get("current_user_dept_codes"),
		query.Get("currentUserDeptCodes"),
		query.Get("current_user_dept_code"),
		query.Get("currentUserDeptCode"),
		query.Get("user_dept_codes"),
		query.Get("userDeptCodes"),
	})
}

func projectManagementDeptCodes(query url.Values) []string {
	return uniqueDeptCodes([]string{
		query.Get("current_user_management_dept_codes"),
		query.Get("currentUserManagementDeptCodes"),
		query.Get("management_dept_codes"),
		query.Get("managementDeptCodes"),
	})
}

func projectAdminDeptCodes(query url.Values) []string {
	return uniqueDeptCodes([]string{
		query.Get("current_user_project_admin_dept_codes"),
		query.Get("currentUserProjectAdminDeptCodes"),
		query.Get("project_admin_dept_codes"),
		query.Get("projectAdminDeptCodes"),
	})
}

func projectAdminProjectCodes(query url.Values) []string {
	return uniqueDeptCodes([]string{
		query.Get("current_user_project_admin_project_codes"),
		query.Get("currentUserProjectAdminProjectCodes"),
		query.Get("project_admin_project_codes"),
		query.Get("projectAdminProjectCodes"),
	})
}

func uniqueDeptCodes(values []string) []string {
	seen := map[string]bool{}
	codes := make([]string, 0)
	for _, value := range values {
		for _, part := range strings.Split(value, ",") {
			code := strings.TrimSpace(part)
			if code == "" || seen[code] {
				continue
			}
			seen[code] = true
			codes = append(codes, code)
		}
	}
	return codes
}

func scanMemberProject(rows *sql.Rows) (map[string]any, error) {
	var (
		id                   int64
		projectCode          string
		name                 string
		shortName            sql.NullString
		internalCode         sql.NullString
		description          sql.NullString
		category             string
		methodology          string
		lifecycleStatus      string
		portfolioID          sql.NullInt64
		domainCode           sql.NullString
		deptCode             sql.NullString
		leaderUID            sql.NullString
		securityLevel        string
		accessWhitelist      sql.NullString
		startDate            sql.NullString
		endDate              sql.NullString
		oppID                sql.NullInt64
		contractID           sql.NullInt64
		customerCode         sql.NullString
		customerName         sql.NullString
		contractCode         sql.NullString
		templateSetID        sql.NullInt64
		templateSetName      sql.NullString
		templateVersionID    sql.NullInt64
		templateVersionLabel sql.NullString
		approvalStatus       string
		workflowInstanceID   sql.NullString
		moduleConfig         sql.NullString
		boardConfig          sql.NullString
		workflowConfig       sql.NullString
		notificationConfig   sql.NullString
		createdBy            string
		createdAt            sql.NullString
		updatedAt            sql.NullString
		memberCount          int64
		documentCount        int64
		currentUserRole      sql.NullString
		canAccess            int64
	)

	if err := rows.Scan(
		&id,
		&projectCode,
		&name,
		&shortName,
		&internalCode,
		&description,
		&category,
		&methodology,
		&lifecycleStatus,
		&portfolioID,
		&domainCode,
		&deptCode,
		&leaderUID,
		&securityLevel,
		&accessWhitelist,
		&startDate,
		&endDate,
		&oppID,
		&contractID,
		&customerCode,
		&customerName,
		&contractCode,
		&templateSetID,
		&templateSetName,
		&templateVersionID,
		&templateVersionLabel,
		&approvalStatus,
		&workflowInstanceID,
		&moduleConfig,
		&boardConfig,
		&workflowConfig,
		&notificationConfig,
		&createdBy,
		&createdAt,
		&updatedAt,
		&memberCount,
		&documentCount,
		&currentUserRole,
		&canAccess,
	); err != nil {
		return nil, err
	}

	return map[string]any{
		"id":                     id,
		"project_code":           projectCode,
		"name":                   name,
		"short_name":             nullableString(shortName),
		"internal_code":          nullableString(internalCode),
		"description":            nullableString(description),
		"category":               category,
		"methodology":            methodology,
		"lifecycle_status":       lifecycleStatus,
		"portfolio_id":           nullableInt64(portfolioID),
		"domain_code":            nullableString(domainCode),
		"dept_code":              nullableString(deptCode),
		"leader_uid":             nullableString(leaderUID),
		"security_level":         securityLevel,
		"access_whitelist":       nullableString(accessWhitelist),
		"start_date":             nullableString(startDate),
		"end_date":               nullableString(endDate),
		"opp_id":                 nullableInt64(oppID),
		"contract_id":            nullableInt64(contractID),
		"customer_code":          nullableString(customerCode),
		"customer_name":          nullableString(customerName),
		"contract_code":          nullableString(contractCode),
		"template_set_id":        nullableInt64(templateSetID),
		"template_set_name":      nullableString(templateSetName),
		"template_version_id":    nullableInt64(templateVersionID),
		"template_version_label": nullableString(templateVersionLabel),
		"approval_status":        approvalStatus,
		"workflow_instance_id":   nullableString(workflowInstanceID),
		"module_config":          nullableString(moduleConfig),
		"board_config":           nullableString(boardConfig),
		"workflow_config":        nullableString(workflowConfig),
		"notification_config":    nullableString(notificationConfig),
		"created_by":             createdBy,
		"created_at":             nullableString(createdAt),
		"updated_at":             nullableString(updatedAt),
		"member_count":           memberCount,
		"document_count":         documentCount,
		"can_access":             canAccess != 0,
		"current_user_role":      nullableString(currentUserRole),
	}, nil
}

func memberProjectsPage(query url.Values) projectListPage {
	page := parseProjectPositiveInt(query.Get("page"), 1)
	pageSize := parseProjectPositiveInt(firstNonEmptyProjectParam(query, "pageSize", "page_size", "limit"), 20)
	page = clampProjectInt(page, 1, 100000)
	pageSize = clampProjectInt(pageSize, 1, 500)
	return projectListPage{
		page:     page,
		pageSize: pageSize,
		offset:   (page - 1) * pageSize,
	}
}

func firstNonEmptyProjectParam(query url.Values, keys ...string) string {
	for _, key := range keys {
		if value := strings.TrimSpace(query.Get(key)); value != "" {
			return value
		}
	}
	return ""
}

func parseProjectPositiveInt(value string, fallback int) int {
	parsed, err := strconv.Atoi(strings.TrimSpace(value))
	if err != nil || parsed <= 0 {
		return fallback
	}
	return parsed
}

func clampProjectInt(value int, min int, max int) int {
	if value < min {
		return min
	}
	if value > max {
		return max
	}
	return value
}
