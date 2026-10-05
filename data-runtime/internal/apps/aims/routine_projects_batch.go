package aims

import (
	"context"
	"crypto/sha256"
	"database/sql"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"net/http"
	"net/url"
	"sort"
	"strconv"
	"strings"
	"unicode/utf8"

	"github.com/huizhi-yun/data-runtime/internal/httperror"
)

const routineProjectBatchPath = "/v1/aims/admin/projects/batch-create-routine"

type routineProjectDepartment struct {
	DeptCode   string
	Name       string
	ManagerUID string
	MemberUIDs []string
}

func (a *Adapter) handleRoutineProjectBatchRuntime(
	ctx context.Context,
	method string,
	path string,
	query url.Values,
	body map[string]any,
) (any, string, bool, error) {
	if path != routineProjectBatchPath {
		return nil, "", false, nil
	}
	if method != http.MethodPost {
		return nil, "", true, httperror.New(
			http.StatusMethodNotAllowed,
			"method_not_allowed",
			"批量创建部门事务项目仅支持 POST",
		)
	}

	data, err := a.batchCreateRoutineDepartmentProjects(ctx, query, body)
	return data, "aims.admin.projects.batch_create_routine", true, err
}

func (a *Adapter) batchCreateRoutineDepartmentProjects(
	ctx context.Context,
	query url.Values,
	body map[string]any,
) (map[string]any, error) {
	uid := strings.TrimSpace(query.Get("current_user"))
	if uid == "" {
		return nil, httperror.New(http.StatusUnauthorized, "missing_current_user", "current_user is required")
	}
	if !projectQueryBool(query, "current_user_is_project_admin", "currentUserIsProjectAdmin") {
		return nil, httperror.New(http.StatusForbidden, "project_admin_required", "仅系统管理员可以批量创建部门事务项目")
	}

	year, err := routineProjectBatchYear(body["year"])
	if err != nil {
		return nil, err
	}
	departments, err := routineProjectBatchDepartments(body["departments"])
	if err != nil {
		return nil, err
	}

	tx, err := a.DB().BeginTx(ctx, nil)
	if err != nil {
		return nil, err
	}
	defer tx.Rollback()

	portfolioID, portfolioCreated, portfolioReactivated, err := ensureRoutinePortfolioTx(ctx, tx, uid)
	if err != nil {
		return nil, err
	}

	items := make([]map[string]any, 0, len(departments))
	createdCount := 0
	existingCount := 0
	missingManagerCount := 0
	for _, department := range departments {
		projectName := fmt.Sprintf("%s%d", department.Name, year)
		item := map[string]any{
			"deptCode":       department.DeptCode,
			"departmentName": department.Name,
			"projectName":    projectName,
		}

		if department.ManagerUID == "" {
			item["status"] = "skipped"
			item["reason"] = "missing_manager"
			missingManagerCount++
			items = append(items, item)
			continue
		}

		existingID, existingCode, exists, err := existingRoutineDepartmentProjectTx(
			ctx,
			tx,
			department.DeptCode,
			projectName,
		)
		if err != nil {
			return nil, err
		}
		if exists {
			item["projectId"] = existingID
			item["projectCode"] = existingCode
			item["status"] = "skipped"
			item["reason"] = "exists"
			existingCount++
			items = append(items, item)
			continue
		}

		projectCode := routineDepartmentProjectCode(year, department.DeptCode)
		codeID, _, codeDept, codeCategory, codeExists, err := projectByCodeForUpdateTx(ctx, tx, projectCode)
		if err != nil {
			return nil, err
		}
		if codeExists {
			if codeCategory != "routine" || codeDept != department.DeptCode {
				return nil, httperror.New(
					http.StatusConflict,
					"routine_project_code_conflict",
					fmt.Sprintf("部门 %s 的事务项目编码与现有项目冲突", department.Name),
				)
			}
			item["projectId"] = codeID
			item["projectCode"] = projectCode
			item["status"] = "skipped"
			item["reason"] = "exists"
			existingCount++
			items = append(items, item)
			continue
		}

		projectID, memberCount, err := createRoutineDepartmentProjectTx(
			ctx,
			tx,
			uid,
			portfolioID,
			year,
			projectCode,
			projectName,
			department,
		)
		if err != nil {
			return nil, err
		}

		item["projectId"] = projectID
		item["projectCode"] = projectCode
		item["memberCount"] = memberCount
		item["status"] = "created"
		createdCount++
		items = append(items, item)
	}

	if err := tx.Commit(); err != nil {
		return nil, err
	}

	return map[string]any{
		"year": year,
		"portfolio": map[string]any{
			"id":          portfolioID,
			"created":     portfolioCreated,
			"reactivated": portfolioReactivated,
		},
		"summary": map[string]any{
			"departments":    len(departments),
			"created":        createdCount,
			"existing":       existingCount,
			"missingManager": missingManagerCount,
		},
		"items": items,
	}, nil
}

func routineProjectBatchYear(value any) (int, error) {
	year, err := strconv.Atoi(strings.TrimSpace(fmt.Sprint(value)))
	if err != nil || year < 2000 || year > 2100 {
		return 0, httperror.New(http.StatusBadRequest, "routine_year_invalid", "年度必须是 2000 至 2100 之间的整数")
	}
	return year, nil
}

func routineProjectBatchDepartments(value any) ([]routineProjectDepartment, error) {
	rawDepartments, ok := value.([]any)
	if !ok || len(rawDepartments) == 0 {
		return nil, httperror.New(http.StatusBadRequest, "routine_departments_required", "departments must be a non-empty array")
	}
	if len(rawDepartments) > 1000 {
		return nil, httperror.New(http.StatusBadRequest, "routine_departments_too_many", "一次最多处理 1000 个部门")
	}

	departments := make([]routineProjectDepartment, 0, len(rawDepartments))
	seenDepartments := make(map[string]bool, len(rawDepartments))
	for _, raw := range rawDepartments {
		item, ok := raw.(map[string]any)
		if !ok {
			return nil, httperror.New(http.StatusBadRequest, "routine_department_invalid", "部门数据格式不正确")
		}
		deptCode := firstBodyText(item, "deptCode", "dept_code")
		name := firstBodyText(item, "name", "departmentName", "department_name")
		managerUID := firstBodyText(item, "managerUid", "manager_uid")
		if deptCode == "" || name == "" || len(deptCode) > 50 || utf8.RuneCountInString(name) > 196 {
			return nil, httperror.New(http.StatusBadRequest, "routine_department_invalid", "部门编码或名称不正确")
		}
		if len(managerUID) > 64 {
			return nil, httperror.New(http.StatusBadRequest, "routine_manager_invalid", "部门负责人 UID 不正确")
		}
		if seenDepartments[deptCode] {
			return nil, httperror.New(http.StatusBadRequest, "routine_department_duplicate", "部门列表中存在重复部门")
		}
		seenDepartments[deptCode] = true

		memberUIDs, err := routineProjectMemberUIDs(item["memberUids"])
		if err != nil {
			return nil, err
		}
		departments = append(departments, routineProjectDepartment{
			DeptCode:   deptCode,
			Name:       name,
			ManagerUID: managerUID,
			MemberUIDs: memberUIDs,
		})
	}

	sort.Slice(departments, func(left, right int) bool {
		return departments[left].DeptCode < departments[right].DeptCode
	})
	return departments, nil
}

func routineProjectMemberUIDs(value any) ([]string, error) {
	if value == nil {
		return []string{}, nil
	}
	rawUIDs, ok := value.([]any)
	if !ok {
		return nil, httperror.New(http.StatusBadRequest, "routine_member_uids_invalid", "memberUids must be an array")
	}
	if len(rawUIDs) > 5000 {
		return nil, httperror.New(http.StatusBadRequest, "routine_members_too_many", "单个部门最多处理 5000 名成员")
	}

	seen := make(map[string]bool, len(rawUIDs))
	uids := make([]string, 0, len(rawUIDs))
	for _, rawUID := range rawUIDs {
		uid := strings.TrimSpace(fmt.Sprint(rawUID))
		if uid == "" || seen[uid] {
			continue
		}
		if len(uid) > 64 {
			return nil, httperror.New(http.StatusBadRequest, "routine_member_uid_invalid", "部门成员 UID 不正确")
		}
		seen[uid] = true
		uids = append(uids, uid)
	}
	sort.Strings(uids)
	return uids, nil
}

func ensureRoutinePortfolioTx(ctx context.Context, tx *sql.Tx, uid string) (int64, bool, bool, error) {
	var id int64
	var status string
	err := tx.QueryRowContext(ctx, `
		SELECT id, status
		FROM project_portfolios
		WHERE default_category = 'routine'
		ORDER BY is_system DESC, id ASC
		LIMIT 1
		FOR UPDATE
	`).Scan(&id, &status)
	if err == nil {
		if status != "active" {
			if _, updateErr := tx.ExecContext(ctx, "UPDATE project_portfolios SET status = 'active' WHERE id = ?", id); updateErr != nil {
				return 0, false, false, updateErr
			}
			return id, false, true, nil
		}
		return id, false, false, nil
	}
	if err != sql.ErrNoRows {
		return 0, false, false, err
	}

	result, err := tx.ExecContext(ctx, `
		INSERT INTO project_portfolios (
		  code, name, description, is_product_line, default_category,
		  is_system, display_order, status, created_by
		) VALUES ('ROUTINE', '日常事务', ?, 0, 'routine', 1, 999, 'active', ?)
	`, "不立项的日常工作容器集合，按部门 × 年建立。其下项目分类固定为 routine，不使用 PIVR 阶段与里程碑。", uid)
	if err != nil {
		return 0, false, false, portfolioWriteError(err)
	}
	id, err = result.LastInsertId()
	return id, true, false, err
}

func existingRoutineDepartmentProjectTx(
	ctx context.Context,
	tx *sql.Tx,
	deptCode string,
	projectName string,
) (int64, string, bool, error) {
	var id int64
	var projectCode string
	err := tx.QueryRowContext(ctx, `
		SELECT id, project_code
		FROM aims_projects
		WHERE category = 'routine' AND dept_code = ? AND name = ?
		ORDER BY id ASC
		LIMIT 1
		FOR UPDATE
	`, deptCode, projectName).Scan(&id, &projectCode)
	if err == sql.ErrNoRows {
		return 0, "", false, nil
	}
	return id, projectCode, err == nil, err
}

func projectByCodeForUpdateTx(
	ctx context.Context,
	tx *sql.Tx,
	projectCode string,
) (int64, string, string, string, bool, error) {
	var id int64
	var name string
	var deptCode sql.NullString
	var category string
	err := tx.QueryRowContext(ctx, `
		SELECT id, name, dept_code, category
		FROM aims_projects
		WHERE project_code = ?
		LIMIT 1
		FOR UPDATE
	`, projectCode).Scan(&id, &name, &deptCode, &category)
	if err == sql.ErrNoRows {
		return 0, "", "", "", false, nil
	}
	return id, name, strings.TrimSpace(deptCode.String), category, err == nil, err
}

func routineDepartmentProjectCode(year int, deptCode string) string {
	cleaned := strings.Builder{}
	for _, char := range strings.ToUpper(deptCode) {
		if (char >= 'A' && char <= 'Z') || (char >= '0' && char <= '9') {
			cleaned.WriteRune(char)
		}
		if cleaned.Len() >= 20 {
			break
		}
	}
	codePart := cleaned.String()
	if codePart == "" {
		codePart = "D"
	}
	hash := sha256.Sum256([]byte(deptCode))
	return fmt.Sprintf("RT%d%s%s", year, codePart, strings.ToUpper(hex.EncodeToString(hash[:4])))
}

func createRoutineDepartmentProjectTx(
	ctx context.Context,
	tx *sql.Tx,
	actorUID string,
	portfolioID int64,
	year int,
	projectCode string,
	projectName string,
	department routineProjectDepartment,
) (int64, int, error) {
	moduleConfig, err := json.Marshal(map[string]bool{
		"milestones":    false,
		"workflows":     false,
		"requirements":  false,
		"releases":      false,
		"environments":  false,
		"service_desk":  false,
		"decomposition": false,
	})
	if err != nil {
		return 0, 0, err
	}

	result, err := tx.ExecContext(ctx, `
		INSERT INTO aims_projects (
		  project_code, name, short_name, description, category, methodology,
		  lifecycle_status, portfolio_id, dept_code, leader_uid, security_level,
		  confidentiality_level, start_date, end_date, module_config, created_by
		) VALUES (?, ?, ?, ?, 'routine', 'PIVR', 'active', ?, ?, ?, 'department', 'L1', ?, ?, ?, ?)
	`,
		projectCode,
		projectName,
		truncateRunes(department.Name, 6),
		fmt.Sprintf("%d年度%s日常事务项目", year, department.Name),
		portfolioID,
		department.DeptCode,
		department.ManagerUID,
		fmt.Sprintf("%04d-01-01", year),
		fmt.Sprintf("%04d-12-31", year),
		string(moduleConfig),
		actorUID,
	)
	if err != nil {
		return 0, 0, err
	}
	projectID, err := result.LastInsertId()
	if err != nil {
		return 0, 0, err
	}

	if _, err := tx.ExecContext(ctx, "INSERT INTO project_counters (project_id, counter) VALUES (?, 0)", projectID); err != nil {
		return 0, 0, err
	}
	if _, err := tx.ExecContext(ctx, `
		INSERT INTO project_lifecycle_events (
		  project_id, from_status, to_status, effective_at, actor_uid, source
		) VALUES (?, NULL, 'active', UTC_TIMESTAMP(6), ?, 'aims.admin.routine-project.batch-create')
	`, projectID, actorUID); err != nil {
		return 0, 0, err
	}

	memberCount, err := insertRoutineProjectMembersTx(ctx, tx, projectID, department.ManagerUID, department.MemberUIDs)
	if err != nil {
		return 0, 0, err
	}
	return projectID, memberCount, nil
}

func insertRoutineProjectMembersTx(
	ctx context.Context,
	tx *sql.Tx,
	projectID int64,
	managerUID string,
	memberUIDs []string,
) (int, error) {
	roles := make(map[string]string, len(memberUIDs)+1)
	roles[managerUID] = "manager"
	for _, uid := range memberUIDs {
		if uid != "" && uid != managerUID {
			roles[uid] = "member"
		}
	}
	uids := make([]string, 0, len(roles))
	for uid := range roles {
		uids = append(uids, uid)
	}
	sort.Strings(uids)

	const chunkSize = 500
	for start := 0; start < len(uids); start += chunkSize {
		end := start + chunkSize
		if end > len(uids) {
			end = len(uids)
		}
		placeholders := make([]string, 0, end-start)
		args := make([]any, 0, (end-start)*3)
		for _, uid := range uids[start:end] {
			placeholders = append(placeholders, "(?, ?, ?, 'active')")
			args = append(args, projectID, uid, roles[uid])
		}
		if _, err := tx.ExecContext(ctx, `
			INSERT INTO aims_project_members (project_id, uid, role, status)
			VALUES `+strings.Join(placeholders, ", "), args...); err != nil {
			return 0, err
		}
	}
	return len(uids), nil
}

func truncateRunes(value string, limit int) string {
	runes := []rune(strings.TrimSpace(value))
	if len(runes) <= limit {
		return string(runes)
	}
	return string(runes[:limit])
}
