package people

import (
	"context"
	"net/http"
	"strings"
	"time"

	"github.com/huizhi-yun/data-runtime/internal/httperror"
)

func (a *Adapter) syncDirectoryUsers(ctx context.Context, body map[string]any) (map[string]any, error) {
	items, ok := itemsFromBody(body)
	if !ok || len(items) == 0 {
		return nil, httperror.New(http.StatusBadRequest, "empty_directory_user_items", "Directory user items cannot be empty")
	}

	sourceApp := cleanBodyString(body, "source_app", "sourceApp")
	if sourceApp == "" {
		sourceApp = "console"
	}
	sourceBizType := cleanBodyString(body, "source_biz_type", "sourceBizType")
	if sourceBizType == "" {
		sourceBizType = "directory_user"
	}

	defaultEffectiveFrom := cleanBodyString(body, "effective_from", "effectiveFrom")
	if defaultEffectiveFrom == "" {
		defaultEffectiveFrom = time.Now().UTC().Format("2006-01-02")
	}
	createAssignments := !isExplicitFalse(firstNonNil(body["create_assignments"], body["createAssignments"]))

	tx, err := a.DB().BeginTx(ctx, nil)
	if err != nil {
		return nil, err
	}

	synced := 0
	assignmentsSynced := 0
	for _, item := range items {
		employeeUID := cleanBodyString(item, "employee_uid", "employeeUid", "uid")
		if employeeUID == "" {
			_ = tx.Rollback()
			return nil, httperror.New(http.StatusBadRequest, "invalid_directory_user_item", "Each directory user item requires uid")
		}

		employeeNo := cleanBodyString(item, "employee_no", "employeeNo", "jobNumber", "employeeNumber")
		if employeeNo == "" {
			employeeNo = employeeUID
		}
		displayName := cleanBodyString(item, "display_name", "displayName", "real_name", "realName", "nickname", "username")
		if displayName == "" {
			displayName = employeeUID
		}
		initials := cleanBodyString(item, "initials")
		if initials == "" {
			initials = initialsFromName(displayName)
		}

		loginName := cleanBodyString(item, "login_name", "loginName", "username")
		deptCode := cleanBodyString(item, "dept_code", "deptCode")
		deptName := cleanBodyString(item, "dept_name", "deptName")
		positionCode := cleanBodyString(item, "position_code", "positionCode")
		positionName := cleanBodyString(item, "position_name", "positionName", "position_title", "positionTitle")
		rankCode := cleanBodyString(item, "rank_code", "rankCode")
		rankName := cleanBodyString(item, "rank_name", "rankName")
		managerUID := cleanBodyString(item, "manager_uid", "managerUid", "managerUID")
		onboardDate := cleanBodyString(item, "onboard_date", "onboardDate", "hire_date", "hireDate")
		effectiveFrom := cleanBodyString(item, "effective_from", "effectiveFrom")
		if effectiveFrom == "" {
			effectiveFrom = onboardDate
		}
		if effectiveFrom == "" {
			effectiveFrom = defaultEffectiveFrom
		}

		employmentStatus := normalizeDirectoryEmploymentStatus(firstNonNil(item["employment_status"], item["employmentStatus"], item["status"]))
		employmentType := normalizeDirectoryEmploymentType(firstNonNil(item["employment_type"], item["employmentType"], item["user_type"], item["userType"]))
		sourceBizID := cleanBodyString(item, "source_biz_id", "sourceBizId", "uid")
		if sourceBizID == "" {
			sourceBizID = employeeUID
		}

		metadata := map[string]any{
			"source_app":      sourceApp,
			"source_biz_type": sourceBizType,
			"directory_user":  item,
		}

		if _, err := tx.ExecContext(ctx, `
			INSERT INTO people_employees (
				employee_uid,
				employee_no,
				display_name,
				initials,
				login_name,
				employment_status,
				employment_type,
				dept_code,
				dept_name,
				position_code,
				position_name,
				rank_code,
				rank_name,
				manager_uid,
				onboard_date,
				monthly_standard_cost,
				metadata,
				created_by,
				updated_by,
				archived_at
			)
			VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULLIF(?, ''), 0, ?, ?, ?, CASE WHEN ? = 'active' THEN NULL ELSE NOW() END)
			ON DUPLICATE KEY UPDATE
				employee_no = CASE
					WHEN people_employees.employee_no = people_employees.employee_uid THEN VALUES(employee_no)
					ELSE people_employees.employee_no
				END,
				display_name = VALUES(display_name),
				initials = COALESCE(VALUES(initials), people_employees.initials),
				login_name = COALESCE(VALUES(login_name), people_employees.login_name),
				employment_status = VALUES(employment_status),
				employment_type = VALUES(employment_type),
				dept_code = COALESCE(VALUES(dept_code), people_employees.dept_code),
				dept_name = COALESCE(VALUES(dept_name), people_employees.dept_name),
				position_code = COALESCE(VALUES(position_code), people_employees.position_code),
				position_name = COALESCE(VALUES(position_name), people_employees.position_name),
				rank_code = COALESCE(VALUES(rank_code), people_employees.rank_code),
				rank_name = COALESCE(VALUES(rank_name), people_employees.rank_name),
				manager_uid = COALESCE(VALUES(manager_uid), people_employees.manager_uid),
				onboard_date = COALESCE(people_employees.onboard_date, VALUES(onboard_date)),
				metadata = VALUES(metadata),
				updated_by = VALUES(updated_by),
				archived_at = CASE WHEN VALUES(employment_status) = 'active' THEN NULL ELSE COALESCE(people_employees.archived_at, NOW()) END,
				updated_at = NOW()
		`,
			employeeUID,
			employeeNo,
			displayName,
			nullableString(initials),
			nullableString(loginName),
			employmentStatus,
			employmentType,
			nullableString(deptCode),
			nullableString(deptName),
			nullableString(positionCode),
			nullableString(positionName),
			nullableString(rankCode),
			nullableString(rankName),
			nullableString(managerUID),
			onboardDate,
			jsonColumnValue(metadata),
			sourceApp,
			sourceApp,
			employmentStatus,
		); err != nil {
			_ = tx.Rollback()
			return nil, err
		}
		synced++

		assignmentCode := cleanBodyString(item, "assignment_code", "assignmentCode")
		if assignmentCode == "" {
			assignmentCode = stableDirectoryCode("ASN-DIR", employeeUID)
		}

		if createAssignments && employmentStatus == "active" {
			if _, err := tx.ExecContext(ctx, `
				INSERT INTO people_assignments (
					assignment_code,
					employee_uid,
					change_type,
					effective_from,
					effective_to,
					dept_code,
					dept_name,
					position_code,
					position_name,
					rank_code,
					rank_name,
					manager_uid,
					approval_status,
					source_app,
					source_biz_type,
					source_biz_id,
					remarks,
					created_by,
					updated_by
				)
				VALUES (?, ?, 'onboard', ?, NULL, ?, ?, ?, ?, ?, ?, ?, 'approved', ?, ?, ?, 'Console Directory bootstrap import', ?, ?)
				ON DUPLICATE KEY UPDATE
					effective_to = NULL,
					dept_code = VALUES(dept_code),
					dept_name = VALUES(dept_name),
					position_code = VALUES(position_code),
					position_name = VALUES(position_name),
					rank_code = VALUES(rank_code),
					rank_name = VALUES(rank_name),
					manager_uid = VALUES(manager_uid),
					approval_status = VALUES(approval_status),
					source_app = VALUES(source_app),
					source_biz_type = VALUES(source_biz_type),
					source_biz_id = VALUES(source_biz_id),
					updated_by = VALUES(updated_by),
					updated_at = NOW()
			`,
				assignmentCode,
				employeeUID,
				effectiveFrom,
				nullableString(deptCode),
				nullableString(deptName),
				nullableString(positionCode),
				nullableString(positionName),
				nullableString(rankCode),
				nullableString(rankName),
				nullableString(managerUID),
				sourceApp,
				sourceBizType,
				sourceBizID,
				sourceApp,
				sourceApp,
			); err != nil {
				_ = tx.Rollback()
				return nil, err
			}
			assignmentsSynced++
		} else if createAssignments {
			if _, err := tx.ExecContext(ctx, `
				UPDATE people_assignments
				SET effective_to = COALESCE(effective_to, ?),
				    updated_by = ?,
				    updated_at = NOW()
				WHERE assignment_code = ?
			`, effectiveFrom, sourceApp, assignmentCode); err != nil {
				_ = tx.Rollback()
				return nil, err
			}
		}
	}

	if err := tx.Commit(); err != nil {
		return nil, err
	}
	return map[string]any{
		"synced":                 synced,
		"assignments_synced":     assignmentsSynced,
		"source_app":             sourceApp,
		"source_biz_type":        sourceBizType,
		"create_assignments":     createAssignments,
		"default_effective_from": defaultEffectiveFrom,
	}, nil
}

func (a *Adapter) syncContributions(ctx context.Context, body map[string]any) (map[string]any, error) {
	items, ok := itemsFromBody(body)
	if !ok || len(items) == 0 {
		return nil, httperror.New(http.StatusBadRequest, "empty_contribution_items", "Contribution items cannot be empty")
	}

	defaultCycleCode := cleanBodyString(body, "cycle_code", "cycleCode")
	tx, err := a.DB().BeginTx(ctx, nil)
	if err != nil {
		return nil, err
	}

	synced := 0
	for _, item := range items {
		cycleCode := cleanBodyString(item, "cycle_code", "cycleCode")
		if cycleCode == "" {
			cycleCode = defaultCycleCode
		}
		employeeUID := cleanBodyString(item, "employee_uid", "employeeUid", "uid")
		if cycleCode == "" || employeeUID == "" {
			_ = tx.Rollback()
			return nil, httperror.New(http.StatusBadRequest, "invalid_contribution_item", "Each contribution item requires cycle_code and employee_uid")
		}

		contributionCode := cleanBodyString(item, "contribution_code", "contributionCode")
		if contributionCode == "" {
			contributionCode = generatedCode("CONTR")
		}
		projectCode := cleanBodyString(item, "project_code", "projectCode")
		roleCode := cleanBodyString(item, "role_code", "roleCode")
		sourceApp := cleanBodyString(item, "source_app", "sourceApp")
		if sourceApp == "" {
			sourceApp = cleanBodyString(body, "source_app", "sourceApp")
		}
		if sourceApp == "" {
			sourceApp = "aims"
		}
		sourceBizType := cleanBodyString(item, "source_biz_type", "sourceBizType")
		sourceBizID := cleanBodyString(item, "source_biz_id", "sourceBizId", "source_biz_id")
		capturedAt := cleanBodyString(item, "captured_at", "capturedAt")
		if capturedAt == "" {
			capturedAt = cleanBodyString(body, "captured_at", "capturedAt")
		}

		if _, err := tx.ExecContext(ctx, `
			INSERT INTO people_contribution_snapshots (
				contribution_code,
				cycle_code,
				employee_uid,
				project_code,
				role_code,
				work_hours,
				contribution_score,
				source_app,
				source_biz_type,
				source_biz_id,
				source_refs,
				captured_at
			)
			VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, COALESCE(NULLIF(?, ''), NOW()))
			ON DUPLICATE KEY UPDATE
				project_code = VALUES(project_code),
				role_code = VALUES(role_code),
				work_hours = VALUES(work_hours),
				contribution_score = VALUES(contribution_score),
				source_refs = VALUES(source_refs),
				captured_at = VALUES(captured_at),
				updated_at = NOW()
		`,
			contributionCode,
			cycleCode,
			employeeUID,
			nullableString(projectCode),
			nullableString(roleCode),
			float64FromAny(item["work_hours"]),
			float64FromAny(item["contribution_score"]),
			sourceApp,
			sourceBizType,
			sourceBizID,
			jsonColumnValue(firstNonNil(item["source_refs"], item["sourceRefs"], body["source_refs"], body["sourceRefs"])),
			capturedAt,
		); err != nil {
			_ = tx.Rollback()
			return nil, err
		}
		synced++
	}

	if err := tx.Commit(); err != nil {
		return nil, err
	}
	return map[string]any{
		"synced": synced,
	}, nil
}

func (a *Adapter) workflowCallback(ctx context.Context, body map[string]any) (map[string]any, error) {
	bizType := cleanBodyString(body, "biz_type", "bizType", "resourceCode")
	bizID := cleanBodyString(body, "biz_id", "bizId", "businessKey")
	status := normalizeWorkflowStatus(cleanBodyString(body, "status", "approval_status", "approvalStatus", "result"))
	workflowInstanceID := cleanBodyString(body, "workflow_instance_id", "workflowInstanceId", "instanceId")

	if bizType == "" || bizID == "" || status == "" {
		return nil, httperror.New(http.StatusBadRequest, "invalid_workflow_callback", "Workflow callback requires biz_type, biz_id and status")
	}

	affected := int64(0)
	switch strings.ToLower(bizType) {
	case "assignment", "assignments", "people_assignment":
		result, err := a.DB().ExecContext(ctx, `
			UPDATE people_assignments
			SET approval_status = ?,
			    workflow_instance_id = COALESCE(NULLIF(?, ''), workflow_instance_id),
			    updated_at = NOW()
			WHERE assignment_code = ? OR source_biz_id = ?
		`, status, workflowInstanceID, bizID, bizID)
		if err != nil {
			return nil, err
		}
		affected, _ = result.RowsAffected()
	case "performance_cycle", "performance_cycles", "cycle":
		cycleStatus := status
		if status == "approved" {
			cycleStatus = "confirmed"
		}
		result, err := a.DB().ExecContext(ctx, `
			UPDATE people_performance_cycles
			SET status = ?,
			    workflow_instance_id = COALESCE(NULLIF(?, ''), workflow_instance_id),
			    confirmed_at = CASE WHEN ? = 'confirmed' THEN NOW() ELSE confirmed_at END,
			    updated_at = NOW()
			WHERE cycle_code = ?
		`, cycleStatus, workflowInstanceID, cycleStatus, bizID)
		if err != nil {
			return nil, err
		}
		affected, _ = result.RowsAffected()
	default:
		return nil, httperror.New(http.StatusBadRequest, "unsupported_workflow_biz_type", "Unsupported workflow callback biz_type")
	}

	return map[string]any{
		"updated":               affected,
		"biz_type":              bizType,
		"biz_id":                bizID,
		"status":                status,
		"workflow_instance_id":  workflowInstanceID,
		"callback_acknowledged": true,
	}, nil
}

func normalizeWorkflowStatus(value string) string {
	switch strings.ToLower(strings.TrimSpace(value)) {
	case "pass", "passed", "approve", "approved", "success":
		return "approved"
	case "reject", "rejected", "failed":
		return "rejected"
	case "cancel", "cancelled", "canceled":
		return "cancelled"
	default:
		return strings.ToLower(strings.TrimSpace(value))
	}
}

func nullableString(value string) any {
	if strings.TrimSpace(value) == "" {
		return nil
	}
	return value
}

func firstNonNil(values ...any) any {
	for _, value := range values {
		if value != nil {
			return value
		}
	}
	return nil
}

func normalizeDirectoryEmploymentStatus(value any) string {
	status := strings.ToLower(strings.TrimSpace(cleanAnyString(value)))
	if status == "" {
		return "active"
	}
	switch status {
	case "1", "active", "enabled", "normal":
		return "active"
	case "leaving":
		return "leaving"
	case "left", "resigned":
		return "left"
	default:
		return "inactive"
	}
}

func normalizeDirectoryEmploymentType(value any) string {
	switch strings.ToLower(strings.TrimSpace(cleanAnyString(value))) {
	case "part_time", "part-time", "parttime":
		return "part_time"
	case "outsourced", "contractor", "external":
		return "outsourced"
	case "intern":
		return "intern"
	case "agent", "bot", "ai_agent":
		return "agent"
	default:
		return "full_time"
	}
}

func isExplicitFalse(value any) bool {
	switch strings.ToLower(strings.TrimSpace(cleanAnyString(value))) {
	case "false", "0", "no", "n", "off":
		return true
	default:
		return false
	}
}

func initialsFromName(value string) string {
	runes := []rune(strings.TrimSpace(value))
	if len(runes) <= 2 {
		return string(runes)
	}
	return string(runes[:2])
}

func stableDirectoryCode(prefix string, value string) string {
	var builder strings.Builder
	for _, r := range strings.TrimSpace(value) {
		switch {
		case r >= 'a' && r <= 'z':
			builder.WriteRune(r - 'a' + 'A')
		case r >= 'A' && r <= 'Z':
			builder.WriteRune(r)
		case r >= '0' && r <= '9':
			builder.WriteRune(r)
		default:
			builder.WriteRune('-')
		}
	}
	code := strings.Trim(builder.String(), "-")
	if code == "" {
		return generatedCode(prefix)
	}
	limit := 64 - len(prefix) - 1
	if limit > 0 && len(code) > limit {
		code = code[:limit]
	}
	return prefix + "-" + code
}
