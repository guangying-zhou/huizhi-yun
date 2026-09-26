package directory

import (
	"context"
	"database/sql"
	"errors"
	"net/http"
	"net/url"
	"strconv"
	"strings"

	"github.com/huizhi-yun/data-runtime/internal/httperror"
)

const consoleDirectoryUserColumns = `u.id,u.uid,u.username,u.display_name,u.real_name,u.nickname,
	u.avatar_url,u.email,u.mobile,u.mobile_tail4,u.position_title,u.gender,
	pd.dept_code,pd.dept_name,u.user_type,di.provider_subject,u.status`

const consoleDirectoryUserJoins = `LEFT JOIN (
	SELECT ranked.uid,ranked.dept_code,ranked.dept_name
	FROM (
		SELECT ud.uid,ud.dept_code,d.dept_name,
			ROW_NUMBER() OVER (PARTITION BY ud.uid ORDER BY ud.is_primary DESC,d.sort_order ASC,d.id ASC,ud.id ASC) row_no
		FROM directory_user_departments ud
		INNER JOIN directory_departments d ON d.dept_code=ud.dept_code
		WHERE ud.status='active' AND ud.relation_type='member' AND d.status='active' AND d.org_type='department'
	) ranked WHERE ranked.row_no=1
) pd ON pd.uid=u.uid
LEFT JOIN directory_identities di ON di.uid=u.uid AND di.provider_code='dingtalk' AND di.status='active'`

const consoleCommitteeMemberCount = `(SELECT COUNT(DISTINCT member_relations.uid)
	FROM directory_user_departments member_relations
	WHERE member_relations.dept_code=d.dept_code AND member_relations.status='active')
	+ CASE WHEN d.leader_uid IS NOT NULL AND NOT EXISTS (
		SELECT 1 FROM directory_user_departments leader_relation
		WHERE leader_relation.dept_code=d.dept_code
			AND leader_relation.uid=d.leader_uid AND leader_relation.status='active'
	) THEN 1 ELSE 0 END
	+ CASE WHEN d.manager_uid IS NOT NULL
		AND d.manager_uid<>COALESCE(d.leader_uid,'') AND NOT EXISTS (
			SELECT 1 FROM directory_user_departments manager_relation
			WHERE manager_relation.dept_code=d.dept_code
				AND manager_relation.uid=d.manager_uid AND manager_relation.status='active'
		) THEN 1 ELSE 0 END`

const consoleCommitteeMemberRole = `CASE
	WHEN d.leader_uid=candidates.uid THEN 'leader'
	WHEN d.manager_uid=candidates.uid THEN 'manager'
	WHEN candidates.has_observer=1 THEN 'observer'
	ELSE 'member' END`

const consoleCommitteeMemberCandidates = ` FROM (
	SELECT relations.uid,MIN(relations.id) id,MIN(relations.joined_at) joined_at,
		MAX(relations.source_provider) source_provider,
		MAX(CASE WHEN relations.relation_type='observer' THEN 1 ELSE 0 END) has_observer
	FROM directory_user_departments relations
	WHERE relations.dept_code=? AND relations.status='active'
	GROUP BY relations.uid
	UNION ALL
	SELECT leader_only.uid,0,NULL,'manual',0
	FROM directory_users leader_only
	INNER JOIN directory_departments leader_committee ON leader_committee.leader_uid=leader_only.uid
	WHERE leader_committee.dept_code=? AND leader_committee.org_type='committee'
		AND NOT EXISTS (
			SELECT 1 FROM directory_user_departments leader_relation
			WHERE leader_relation.dept_code=leader_committee.dept_code
				AND leader_relation.uid=leader_only.uid AND leader_relation.status='active')
	UNION ALL
	SELECT manager_only.uid,0,NULL,'manual',0
	FROM directory_users manager_only
	INNER JOIN directory_departments manager_committee ON manager_committee.manager_uid=manager_only.uid
	WHERE manager_committee.dept_code=? AND manager_committee.org_type='committee'
		AND manager_committee.manager_uid<>COALESCE(manager_committee.leader_uid,'')
		AND NOT EXISTS (
			SELECT 1 FROM directory_user_departments manager_relation
			WHERE manager_relation.dept_code=manager_committee.dept_code
				AND manager_relation.uid=manager_only.uid AND manager_relation.status='active')
	) candidates
	INNER JOIN directory_departments d ON d.dept_code=? AND d.org_type='committee'
	INNER JOIN directory_users u ON u.uid=candidates.uid
	` + consoleDirectoryUserJoins

type consoleDirectoryUserRow struct {
	ID            int64
	UID           string
	Username      sql.NullString
	DisplayName   sql.NullString
	RealName      sql.NullString
	Nickname      sql.NullString
	Avatar        sql.NullString
	Email         sql.NullString
	Mobile        sql.NullString
	MobileTail4   sql.NullString
	PositionTitle sql.NullString
	Gender        string
	DeptCode      sql.NullString
	DeptName      sql.NullString
	UserType      string
	DingTalkID    sql.NullString
	Status        string
}

type consoleDirectoryDepartmentRow struct {
	ID          int64
	Code        string
	Name        string
	ParentCode  sql.NullString
	Level       int
	SortOrder   int
	ManagerUID  sql.NullString
	ManagerName sql.NullString
	LeaderUID   sql.NullString
	LeaderName  sql.NullString
	OrgType     string
	Category    sql.NullString
	Description sql.NullString
	Status      string
}

func (a *Adapter) ConsoleMeta(ctx context.Context) (map[string]any, error) {
	var users, departments, projects int64
	var lastSynced sql.NullTime
	if err := a.db.QueryRowContext(ctx, `SELECT COUNT(*) FROM directory_users WHERE status='active'`).Scan(&users); err != nil {
		return nil, err
	}
	if err := a.db.QueryRowContext(ctx, `SELECT COUNT(*) FROM directory_departments WHERE status='active'`).Scan(&departments); err != nil {
		return nil, err
	}
	if err := a.db.QueryRowContext(ctx, `SELECT COUNT(*) FROM directory_projects WHERE status='active'`).Scan(&projects); err != nil {
		return nil, err
	}
	if err := a.db.QueryRowContext(ctx, `SELECT MAX(synced_at) FROM directory_users`).Scan(&lastSynced); err != nil {
		return nil, err
	}
	var synced any
	if lastSynced.Valid {
		synced = lastSynced.Time
	}
	return map[string]any{
		"contractVersion": "directory.v1", "provider": "console", "status": "active",
		"userCount": users, "departmentCount": departments, "projectCount": projects, "lastSyncedAt": synced,
	}, nil
}

func (a *Adapter) ConsoleUsers(ctx context.Context, query url.Values) (map[string]any, error) {
	conditions := []string{"u.user_type <> 'system'"}
	args := []any{}
	status := strings.TrimSpace(query.Get("status"))
	if status == "" {
		status = "active"
	}
	if status != "all" {
		conditions = append(conditions, "u.status=?")
		args = append(args, status)
	}
	search := strings.TrimSpace(firstQuery(query, "search", "keyword"))
	if search != "" {
		if len(search) > 100 {
			return nil, httperror.New(http.StatusBadRequest, "directory_search_invalid", "Directory search is too long")
		}
		conditions = append(conditions, "(u.uid LIKE ? OR u.username LIKE ? OR u.display_name LIKE ? OR u.real_name LIKE ? OR u.email LIKE ?)")
		like := "%" + search + "%"
		args = append(args, like, like, like, like, like)
	}
	deptCode := strings.TrimSpace(firstQuery(query, "deptCode", "dept_code"))
	if deptCode != "" {
		conditions = append(conditions, `EXISTS (
			SELECT 1 FROM directory_user_departments ud
			WHERE ud.uid=u.uid AND ud.dept_code=? AND ud.status='active')`)
		args = append(args, deptCode)
	}
	where := " WHERE " + strings.Join(conditions, " AND ")
	page, pageSize, err := boundedPage(query)
	if err != nil {
		return nil, err
	}
	var total int64
	if err := a.db.QueryRowContext(ctx, "SELECT COUNT(*) FROM directory_users u"+where, args...).Scan(&total); err != nil {
		return nil, err
	}
	rows, err := a.db.QueryContext(ctx, `SELECT `+consoleDirectoryUserColumns+`
		FROM directory_users u `+consoleDirectoryUserJoins+where+`
		ORDER BY u.uid ASC LIMIT ? OFFSET ?`, append(args, pageSize, (page-1)*pageSize)...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	items := make([]map[string]any, 0)
	for rows.Next() {
		item, err := scanConsoleDirectoryUser(rows)
		if err != nil {
			return nil, err
		}
		items = append(items, item)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	departments, err := a.consoleDepartments(ctx, "active")
	if err != nil {
		return nil, err
	}
	tree := buildConsoleDepartmentTree(departments, items)
	return map[string]any{"items": items, "total": total, "page": page, "pageSize": pageSize, "tree": tree}, nil
}

func (a *Adapter) ConsoleUser(ctx context.Context, uid string, includeInactive bool) (map[string]any, error) {
	uid = strings.TrimSpace(uid)
	if uid == "" || len(uid) > 128 {
		return nil, httperror.New(http.StatusBadRequest, "directory_uid_invalid", "Directory uid is invalid")
	}
	where := " WHERE u.uid=?"
	if !includeInactive {
		where += " AND u.status='active'"
	}
	row := a.db.QueryRowContext(ctx, `SELECT `+consoleDirectoryUserColumns+`
		FROM directory_users u `+consoleDirectoryUserJoins+where+` LIMIT 1`, uid)
	item, err := scanConsoleDirectoryUser(row)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, httperror.New(http.StatusNotFound, "directory_user_not_found", "Directory user was not found")
	}
	return item, err
}

func (a *Adapter) ConsoleDepartments(ctx context.Context, query url.Values) (map[string]any, error) {
	status := strings.TrimSpace(query.Get("status"))
	if status == "" {
		status = "active"
	}
	rows, err := a.consoleDepartments(ctx, status)
	if err != nil {
		return nil, err
	}
	return map[string]any{"tree": buildConsoleDepartmentTree(rows, nil), "flat": normalizeConsoleDepartments(rows)}, nil
}

func (a *Adapter) consoleDepartments(ctx context.Context, status string) ([]consoleDirectoryDepartmentRow, error) {
	where := ""
	args := []any{}
	if status != "all" {
		where = " WHERE d.status=?"
		args = append(args, status)
	}
	rows, err := a.db.QueryContext(ctx, `SELECT d.id,d.dept_code,d.dept_name,d.parent_dept_code,
		d.level_no,d.sort_order,d.manager_uid,mu.display_name,d.leader_uid,lu.display_name,
		d.org_type,d.dept_category,d.description,d.status
		FROM directory_departments d
		LEFT JOIN directory_users mu ON mu.uid=d.manager_uid
		LEFT JOIN directory_users lu ON lu.uid=d.leader_uid`+where+`
		ORDER BY d.sort_order ASC,d.id ASC`, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	result := make([]consoleDirectoryDepartmentRow, 0)
	for rows.Next() {
		var row consoleDirectoryDepartmentRow
		if err := rows.Scan(&row.ID, &row.Code, &row.Name, &row.ParentCode, &row.Level, &row.SortOrder,
			&row.ManagerUID, &row.ManagerName, &row.LeaderUID, &row.LeaderName, &row.OrgType,
			&row.Category, &row.Description, &row.Status); err != nil {
			return nil, err
		}
		result = append(result, row)
	}
	return result, rows.Err()
}

func (a *Adapter) ConsoleProjects(ctx context.Context, query url.Values) (map[string]any, error) {
	conditions := []string{}
	args := []any{}
	status := strings.TrimSpace(query.Get("status"))
	if status == "" {
		status = "active"
	}
	if status != "all" {
		conditions = append(conditions, "status=?")
		args = append(args, status)
	}
	search := strings.TrimSpace(firstQuery(query, "search", "keyword"))
	if search != "" {
		conditions = append(conditions, "(project_code LIKE ? OR project_name LIKE ?)")
		like := "%" + search + "%"
		args = append(args, like, like)
	}
	if dept := strings.TrimSpace(firstQuery(query, "deptCode", "dept_code")); dept != "" {
		conditions = append(conditions, "dept_code=?")
		args = append(args, dept)
	}
	if leader := strings.TrimSpace(firstQuery(query, "leaderUid", "leader_uid")); leader != "" {
		conditions = append(conditions, "leader_uid=?")
		args = append(args, leader)
	}
	where := ""
	if len(conditions) > 0 {
		where = " WHERE " + strings.Join(conditions, " AND ")
	}
	page, pageSize, err := boundedPage(query)
	if err != nil {
		return nil, err
	}
	var total int64
	if err := a.db.QueryRowContext(ctx, "SELECT COUNT(*) FROM directory_projects"+where, args...).Scan(&total); err != nil {
		return nil, err
	}
	rows, err := a.db.QueryContext(ctx, `SELECT id,project_code,parent_project_code,project_name,project_type,
		dept_code,owner_uid,leader_uid,repo_url,description,status
		FROM directory_projects`+where+` ORDER BY created_at ASC,id ASC LIMIT ? OFFSET ?`,
		append(args, pageSize, (page-1)*pageSize)...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	items := make([]map[string]any, 0)
	for rows.Next() {
		var id int64
		var code, name, projectType, status string
		var parent, dept, owner, leader, repo, description sql.NullString
		if err := rows.Scan(&id, &code, &parent, &name, &projectType, &dept, &owner, &leader, &repo, &description, &status); err != nil {
			return nil, err
		}
		items = append(items, map[string]any{
			"id": id, "projectCode": code, "parentId": nullableValue(parent), "name": name,
			"deptCode": nullableValue(dept), "ownerUid": nullableValue(owner), "leaderUid": nullableValue(leader),
			"description": nullableValue(description), "status": accountStatus(status), "statusKey": status,
			"repoUrl": nullableValue(repo), "isGroup": boolInt(projectType == "group"),
			"isTemplate": boolInt(projectType == "template"), "docsSyncedAt": nil,
			"docsCommittedAt": nil, "subProjects": []any{},
		})
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	return map[string]any{
		"items": buildConsoleProjectTree(items), "flat": items, "total": total, "page": page, "pageSize": pageSize,
	}, nil
}

func (a *Adapter) ConsoleBatchUsers(ctx context.Context, uids []string) ([]map[string]any, error) {
	unique := make([]string, 0, len(uids))
	seen := map[string]bool{}
	for _, raw := range uids {
		uid := strings.TrimSpace(raw)
		if uid == "" || seen[uid] {
			continue
		}
		if len(uid) > 128 {
			return nil, httperror.New(http.StatusBadRequest, "directory_uid_invalid", "Directory uid is invalid")
		}
		seen[uid] = true
		unique = append(unique, uid)
	}
	if len(unique) > 100 {
		return nil, httperror.New(http.StatusRequestEntityTooLarge, "directory_batch_too_large", "Directory batch accepts at most 100 users")
	}
	if len(unique) == 0 {
		return []map[string]any{}, nil
	}
	placeholders := strings.TrimSuffix(strings.Repeat("?,", len(unique)), ",")
	args := make([]any, len(unique))
	for index, uid := range unique {
		args[index] = uid
	}
	rows, err := a.db.QueryContext(ctx, `SELECT `+consoleDirectoryUserColumns+`
		FROM directory_users u `+consoleDirectoryUserJoins+`
		WHERE u.uid IN (`+placeholders+`) ORDER BY u.uid ASC`, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	items := make([]map[string]any, 0, len(unique))
	for rows.Next() {
		item, err := scanConsoleDirectoryUser(rows)
		if err != nil {
			return nil, err
		}
		items = append(items, item)
	}
	return items, rows.Err()
}

func (a *Adapter) ConsoleDepartment(ctx context.Context, code string) (map[string]any, error) {
	code = strings.TrimSpace(code)
	if code == "" || len(code) > 128 {
		return nil, httperror.New(http.StatusBadRequest, "directory_department_code_invalid", "Department code is invalid")
	}
	rows, err := a.consoleDepartments(ctx, "all")
	if err != nil {
		return nil, err
	}
	for index, item := range normalizeConsoleDepartments(rows) {
		if rows[index].Code == code {
			return item, nil
		}
	}
	return nil, httperror.New(http.StatusNotFound, "directory_department_not_found", "Department was not found")
}

func (a *Adapter) ConsoleAccessibleDepartments(ctx context.Context, uid string) ([]map[string]any, error) {
	uid = strings.TrimSpace(uid)
	if uid == "" || len(uid) > 128 {
		return nil, httperror.New(http.StatusBadRequest, "directory_uid_invalid", "Directory uid is invalid")
	}
	departments, err := a.consoleDepartments(ctx, "active")
	if err != nil {
		return nil, err
	}
	rows, err := a.db.QueryContext(ctx, `SELECT dept_code FROM directory_user_departments
		WHERE uid=? AND status='active'`, uid)
	if err != nil {
		return nil, err
	}
	direct := map[string]bool{}
	for rows.Next() {
		var code string
		if err := rows.Scan(&code); err != nil {
			rows.Close()
			return nil, err
		}
		direct[code] = true
	}
	if err := rows.Close(); err != nil {
		return nil, err
	}
	children := map[string][]string{}
	for _, department := range departments {
		if department.ManagerUID.String == uid || department.LeaderUID.String == uid {
			direct[department.Code] = true
		}
		if department.ParentCode.Valid {
			children[department.ParentCode.String] = append(children[department.ParentCode.String], department.Code)
		}
	}
	accessible := map[string]bool{}
	var visit func(string)
	visit = func(code string) {
		if accessible[code] {
			return
		}
		accessible[code] = true
		for _, child := range children[code] {
			visit(child)
		}
	}
	for code := range direct {
		visit(code)
	}
	result := make([]map[string]any, 0)
	normalized := normalizeConsoleDepartments(departments)
	for index, department := range departments {
		if accessible[department.Code] && department.OrgType == "department" && department.ParentCode.Valid {
			result = append(result, normalized[index])
		}
	}
	return result, nil
}

func (a *Adapter) ConsoleDepartmentMembers(ctx context.Context, code string, query url.Values) (map[string]any, error) {
	if _, err := a.ConsoleDepartment(ctx, code); err != nil {
		return nil, err
	}
	conditions := []string{"ud.dept_code=?", "ud.status='active'", "u.status='active'"}
	args := []any{code}
	search := strings.TrimSpace(firstQuery(query, "search", "keyword"))
	if search != "" {
		conditions = append(conditions, "(u.uid LIKE ? OR u.display_name LIKE ? OR u.real_name LIKE ? OR u.email LIKE ?)")
		like := "%" + search + "%"
		args = append(args, like, like, like, like)
	}
	where := " WHERE " + strings.Join(conditions, " AND ")
	page, pageSize, err := boundedPage(query)
	if err != nil {
		return nil, err
	}
	var total int64
	if err := a.db.QueryRowContext(ctx, `SELECT COUNT(DISTINCT u.uid)
		FROM directory_user_departments ud INNER JOIN directory_users u ON u.uid=ud.uid`+where, args...).Scan(&total); err != nil {
		return nil, err
	}
	rows, err := a.db.QueryContext(ctx, `SELECT `+consoleDirectoryUserColumns+`
		FROM directory_user_departments ud
		INNER JOIN directory_users u ON u.uid=ud.uid
		`+consoleDirectoryUserJoins+where+`
		ORDER BY ud.is_primary DESC,u.uid ASC LIMIT ? OFFSET ?`,
		append(args, pageSize, (page-1)*pageSize)...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	items := make([]map[string]any, 0)
	for rows.Next() {
		item, err := scanConsoleDirectoryUser(rows)
		if err != nil {
			return nil, err
		}
		items = append(items, item)
	}
	return map[string]any{"items": items, "total": total, "page": page, "pageSize": pageSize}, rows.Err()
}

func (a *Adapter) ConsoleCommittees(ctx context.Context, query url.Values) (map[string]any, error) {
	conditions := []string{"d.org_type='committee'"}
	args := []any{}
	status := strings.TrimSpace(query.Get("status"))
	if status == "" {
		status = "active"
	}
	if status != "all" {
		conditions = append(conditions, "d.status=?")
		args = append(args, status)
	}
	search := strings.TrimSpace(firstQuery(query, "search", "keyword"))
	if search != "" {
		conditions = append(conditions, "(d.dept_code LIKE ? OR d.dept_name LIKE ? OR d.description LIKE ?)")
		like := "%" + search + "%"
		args = append(args, like, like, like)
	}
	if parent := strings.TrimSpace(query.Get("parentDeptCode")); parent != "" {
		conditions = append(conditions, "d.parent_dept_code=?")
		args = append(args, parent)
	}
	where := " WHERE " + strings.Join(conditions, " AND ")
	page, pageSize, err := boundedPage(query)
	if err != nil {
		return nil, err
	}
	var total int64
	if err := a.db.QueryRowContext(ctx, "SELECT COUNT(*) FROM directory_departments d"+where, args...).Scan(&total); err != nil {
		return nil, err
	}
	rows, err := a.db.QueryContext(ctx, `SELECT d.id,d.dept_code,d.dept_name,d.parent_dept_code,
		parent.dept_name,d.manager_uid,manager_user.display_name,d.leader_uid,leader_user.display_name,
		d.description,d.sort_order,d.status,`+consoleCommitteeMemberCount+` AS member_count,
		d.created_at,d.updated_at
		FROM directory_departments d
		LEFT JOIN directory_departments parent ON parent.dept_code=d.parent_dept_code AND parent.status<>'deleted'
		LEFT JOIN directory_users manager_user ON manager_user.uid=d.manager_uid
		LEFT JOIN directory_users leader_user ON leader_user.uid=d.leader_uid`+where+`
		ORDER BY d.sort_order ASC,d.id ASC LIMIT ? OFFSET ?`,
		append(args, pageSize, (page-1)*pageSize)...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	items := make([]map[string]any, 0)
	for rows.Next() {
		item, err := scanConsoleCommittee(rows)
		if err != nil {
			return nil, err
		}
		items = append(items, item)
	}
	return map[string]any{"items": items, "total": total, "page": page, "pageSize": pageSize}, rows.Err()
}

func (a *Adapter) ConsoleCommittee(ctx context.Context, code string) (map[string]any, error) {
	code = strings.TrimSpace(code)
	if code == "" || len(code) > 128 {
		return nil, httperror.New(http.StatusBadRequest, "directory_committee_code_invalid", "Committee code is invalid")
	}
	row := a.db.QueryRowContext(ctx, `SELECT d.id,d.dept_code,d.dept_name,d.parent_dept_code,
		parent.dept_name,d.manager_uid,manager_user.display_name,d.leader_uid,leader_user.display_name,
		d.description,d.sort_order,d.status,`+consoleCommitteeMemberCount+` AS member_count,
		d.created_at,d.updated_at
		FROM directory_departments d
		LEFT JOIN directory_departments parent ON parent.dept_code=d.parent_dept_code AND parent.status<>'deleted'
		LEFT JOIN directory_users manager_user ON manager_user.uid=d.manager_uid
		LEFT JOIN directory_users leader_user ON leader_user.uid=d.leader_uid
		WHERE d.dept_code=? AND d.org_type='committee' LIMIT 1`, code)
	item, err := scanConsoleCommittee(row)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, httperror.New(http.StatusNotFound, "directory_committee_not_found", "Committee was not found")
	}
	return item, err
}

func (a *Adapter) ConsoleCommitteeMembers(ctx context.Context, code string, query url.Values) (map[string]any, error) {
	if _, err := a.ConsoleCommittee(ctx, code); err != nil {
		return nil, err
	}
	conditions := []string{}
	filterArgs := []any{}
	search := strings.TrimSpace(firstQuery(query, "search", "keyword"))
	if search != "" {
		conditions = append(conditions, "(u.uid LIKE ? OR u.display_name LIKE ? OR u.real_name LIKE ? OR u.email LIKE ?)")
		like := "%" + search + "%"
		filterArgs = append(filterArgs, like, like, like, like)
	}
	role := strings.TrimSpace(query.Get("role"))
	if role != "" {
		if role != "leader" && role != "manager" && role != "observer" && role != "member" {
			return nil, httperror.New(http.StatusBadRequest, "directory_committee_role_invalid", "Committee role is invalid")
		}
		conditions = append(conditions, consoleCommitteeMemberRole+"=?")
		filterArgs = append(filterArgs, role)
	}
	where := ""
	if len(conditions) > 0 {
		where = " WHERE " + strings.Join(conditions, " AND ")
	}
	page, pageSize, err := boundedPage(query)
	if err != nil {
		return nil, err
	}
	baseArgs := []any{code, code, code, code}
	var total int64
	if err := a.db.QueryRowContext(ctx, "SELECT COUNT(*)"+consoleCommitteeMemberCandidates+where,
		append(baseArgs, filterArgs...)...).Scan(&total); err != nil {
		return nil, err
	}
	rowArgs := append(append(baseArgs, filterArgs...), pageSize, (page-1)*pageSize)
	rows, err := a.db.QueryContext(ctx, `SELECT candidates.id,candidates.uid,`+
		consoleCommitteeMemberRole+` AS role,candidates.source_provider,candidates.joined_at,
		u.display_name,u.real_name,u.avatar_url,u.email,u.position_title,u.status,pd.dept_code,pd.dept_name`+
		consoleCommitteeMemberCandidates+where+`
		ORDER BY FIELD(role,'leader','manager','member','observer'),candidates.uid ASC
		LIMIT ? OFFSET ?`, rowArgs...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	items := make([]map[string]any, 0)
	for rows.Next() {
		var id int64
		var uid, roleValue, provider, userStatus string
		var joinedAt sql.NullTime
		var displayName, realName, avatar, email, positionTitle, deptCode, deptName sql.NullString
		if err := rows.Scan(&id, &uid, &roleValue, &provider, &joinedAt, &displayName, &realName,
			&avatar, &email, &positionTitle, &userStatus, &deptCode, &deptName); err != nil {
			return nil, err
		}
		name := displayName.String
		if name == "" {
			name = realName.String
		}
		if name == "" {
			name = uid
		}
		items = append(items, map[string]any{
			"id": id, "uid": uid, "role": roleValue, "sourceProvider": provider,
			"joinedAt": nullableTime(joinedAt), "status": "active", "displayName": name,
			"realName": nullableValue(realName), "avatar": nullableValue(avatar),
			"email": nullableValue(email), "positionTitle": nullableValue(positionTitle),
			"userStatus": userStatus, "primaryDeptCode": nullableValue(deptCode),
			"deptName": nullableValue(deptName),
		})
	}
	return map[string]any{"items": items, "total": total, "page": page, "pageSize": pageSize}, rows.Err()
}

func (a *Adapter) ConsoleSubjectExports(ctx context.Context, query url.Values) (map[string]any, error) {
	conditions := []string{"1=1"}
	args := []any{}
	if subjectType := strings.TrimSpace(query.Get("subject_type")); subjectType != "" {
		conditions = append(conditions, "subject_type=?")
		args = append(args, subjectType)
	}
	if changedAfter := strings.TrimSpace(query.Get("changed_after")); changedAfter != "" {
		conditions = append(conditions, "updated_at>?")
		args = append(args, changedAfter)
	}
	if cursor := strings.TrimSpace(query.Get("cursor")); cursor != "" {
		cursorID, err := strconv.ParseInt(cursor, 10, 64)
		if err != nil || cursorID < 0 {
			return nil, httperror.New(http.StatusBadRequest, "directory_cursor_invalid", "Directory cursor is invalid")
		}
		conditions = append(conditions, "id>?")
		args = append(args, cursorID)
	}
	limit := parsePositiveInt(query.Get("limit"), 50)
	if limit > 100 {
		return nil, httperror.New(http.StatusBadRequest, "directory_page_size_too_large", "Directory page size must not exceed 100")
	}
	rows, err := a.db.QueryContext(ctx, `SELECT id,subject_type,subject_code,external_ref,
		parent_subject_type,parent_subject_code,source_object_type,source_object_code,snapshot_hash,
		status,exported_at,updated_at FROM directory_subject_exports
		WHERE `+strings.Join(conditions, " AND ")+` ORDER BY id ASC LIMIT ?`, append(args, limit+1)...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	items := make([]map[string]any, 0, limit)
	var lastID int64
	hasMore := false
	for rows.Next() {
		var id int64
		var subjectType, subjectCode, sourceType, sourceCode, snapshotHash, status string
		var externalRef, parentType, parentCode sql.NullString
		var exportedAt, updatedAt any
		if err := rows.Scan(&id, &subjectType, &subjectCode, &externalRef, &parentType, &parentCode,
			&sourceType, &sourceCode, &snapshotHash, &status, &exportedAt, &updatedAt); err != nil {
			return nil, err
		}
		if len(items) == limit {
			hasMore = true
			break
		}
		lastID = id
		items = append(items, map[string]any{
			"subjectType": subjectType, "subjectCode": subjectCode, "externalRef": nullableValue(externalRef),
			"parentSubjectType": nullableValue(parentType), "parentSubjectCode": nullableValue(parentCode),
			"sourceObjectType": sourceType, "sourceObjectCode": sourceCode, "snapshotHash": snapshotHash,
			"status": status, "exportedAt": exportedAt, "updatedAt": updatedAt,
		})
	}
	var nextCursor any
	if hasMore {
		nextCursor = strconv.FormatInt(lastID, 10)
	}
	return map[string]any{"items": items, "nextCursor": nextCursor, "hasMore": hasMore}, rows.Err()
}

func (a *Adapter) ConsoleSubjectMemberships(ctx context.Context, query url.Values) (map[string]any, error) {
	conditions := []string{"ud.relation_type='member'"}
	args := []any{}
	if cursor := strings.TrimSpace(query.Get("cursor")); cursor != "" {
		cursorID, err := strconv.ParseInt(cursor, 10, 64)
		if err != nil || cursorID < 0 {
			return nil, httperror.New(http.StatusBadRequest, "directory_cursor_invalid", "Directory cursor is invalid")
		}
		conditions = append(conditions, "ud.id>?")
		args = append(args, cursorID)
	}
	limit := parsePositiveInt(query.Get("limit"), 50)
	if limit > 100 {
		return nil, httperror.New(http.StatusBadRequest, "directory_page_size_too_large", "Directory page size must not exceed 100")
	}
	rows, err := a.db.QueryContext(ctx, `SELECT ud.id,ud.uid,ud.dept_code,d.org_type,
		ud.relation_type,ud.is_primary,
		CASE WHEN ud.status='active' AND u.status='active' AND d.status='active'
			THEN 'active' ELSE 'inactive' END,
		GREATEST(ud.updated_at,u.updated_at,d.updated_at)
		FROM directory_user_departments ud
		INNER JOIN directory_users u ON u.uid=ud.uid
		INNER JOIN directory_departments d ON d.dept_code=ud.dept_code
		WHERE `+strings.Join(conditions, " AND ")+`
		ORDER BY ud.id ASC LIMIT ?`, append(args, limit+1)...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	items := make([]map[string]any, 0, limit)
	var lastID int64
	hasMore := false
	for rows.Next() {
		var id int64
		var subjectCode, containerCode, orgType, relationType, status string
		var primary bool
		var updatedAt any
		if err := rows.Scan(&id, &subjectCode, &containerCode, &orgType, &relationType, &primary, &status, &updatedAt); err != nil {
			return nil, err
		}
		if len(items) == limit {
			hasMore = true
			break
		}
		lastID = id
		items = append(items, map[string]any{
			"subjectType": "user", "subjectCode": subjectCode,
			"containerSubjectType": map[bool]string{true: "committee", false: "department"}[orgType == "committee"],
			"containerSubjectCode": containerCode, "relationType": relationType,
			"isPrimary": primary, "status": status, "updatedAt": updatedAt,
		})
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	var nextCursor any
	if hasMore {
		nextCursor = strconv.FormatInt(lastID, 10)
	}
	return map[string]any{"items": items, "nextCursor": nextCursor, "hasMore": hasMore}, nil
}

func (a *Adapter) ConsoleUserDepartments(ctx context.Context, uid string) (any, error) {
	uid = strings.TrimSpace(uid)
	args := []any{}
	where := ` WHERE ud.status='active' AND u.status='active' AND d.status='active'`
	if uid != "" {
		if len(uid) > 128 {
			return nil, httperror.New(http.StatusBadRequest, "directory_uid_invalid", "Directory uid is invalid")
		}
		where += " AND ud.uid=?"
		args = append(args, uid)
	}
	limitSQL := ""
	if uid == "" {
		limitSQL = " LIMIT 101"
	}
	rows, err := a.db.QueryContext(ctx, `SELECT ud.uid,ud.dept_code,ud.relation_type,ud.is_primary,
		d.dept_name,d.parent_dept_code,d.org_type
		FROM directory_user_departments ud
		INNER JOIN directory_users u ON u.uid=ud.uid
		INNER JOIN directory_departments d ON d.dept_code=ud.dept_code`+where+`
		ORDER BY ud.uid ASC,
		CASE WHEN d.org_type='department' AND ud.relation_type='member' THEN 0 ELSE 1 END,
		ud.is_primary DESC,d.sort_order ASC`+limitSQL, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	items := make([]map[string]any, 0)
	primaryCode := any(nil)
	for rows.Next() {
		var rowUID, code, relationType, name, orgType string
		var primary bool
		var parent sql.NullString
		if err := rows.Scan(&rowUID, &code, &relationType, &primary, &name, &parent, &orgType); err != nil {
			return nil, err
		}
		if uid == "" {
			items = append(items, map[string]any{
				"uid": rowUID, "deptCode": code, "relationType": relationType, "isPrimary": primary,
			})
			continue
		}
		items = append(items, map[string]any{
			"deptCode": code, "name": name, "parentId": nullableValue(parent), "orgType": orgType,
			"relationType": relationType, "isPrimary": primary, "children": []any{},
		})
		if primaryCode == nil && orgType == "department" && relationType == "member" {
			primaryCode = code
		}
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	if uid == "" {
		if len(items) > 100 {
			return nil, httperror.New(http.StatusBadRequest, "directory_pagination_required", "Directory membership query must be paginated")
		}
		return items, nil
	}
	return map[string]any{"departments": items, "primaryDeptCode": primaryCode}, nil
}

// EnterpriseSelfDepartments is only called with a verified signed actor. It
// exposes the transfer selector fields and the recipients needed after submit.
func (a *Adapter) EnterpriseSelfDepartments(ctx context.Context, uid string) (map[string]any, error) {
	uid = strings.TrimSpace(uid)
	if uid == "" || len(uid) > 128 {
		return nil, httperror.New(http.StatusBadRequest, "directory_uid_invalid", "Directory uid is invalid")
	}
	rows, err := a.db.QueryContext(ctx, `SELECT d.dept_code,d.dept_name,d.org_type,ud.relation_type,ud.is_primary,d.manager_uid,d.leader_uid
		FROM directory_user_departments ud
		INNER JOIN directory_users u ON u.uid=ud.uid
		INNER JOIN directory_departments d ON d.dept_code=ud.dept_code
		WHERE ud.uid=? AND ud.status='active' AND u.status='active' AND d.status='active'
		ORDER BY CASE WHEN d.org_type='department' AND ud.relation_type='member' THEN 0 ELSE 1 END,
		ud.is_primary DESC,d.sort_order ASC LIMIT 101`, uid)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	departments := make([]map[string]any, 0)
	var primary any
	for rows.Next() {
		var code, name, orgType, relation string
		var isPrimary bool
		var manager, leader sql.NullString
		if err := rows.Scan(&code, &name, &orgType, &relation, &isPrimary, &manager, &leader); err != nil {
			return nil, err
		}
		departments = append(departments, map[string]any{"deptCode": code, "name": name, "managerId": nullableValue(manager), "leaderId": nullableValue(leader), "children": []any{}})
		if primary == nil && orgType == "department" && relation == "member" {
			primary = code
		}
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	if len(departments) > 100 {
		return nil, httperror.New(http.StatusBadRequest, "directory_pagination_required", "Directory memberships exceed the transfer selector limit")
	}
	return map[string]any{"departments": departments, "primaryDeptCode": primary}, nil
}

func (a *Adapter) ConsoleProject(ctx context.Context, code string) (map[string]any, error) {
	code = strings.TrimSpace(code)
	if code == "" || len(code) > 128 {
		return nil, httperror.New(http.StatusBadRequest, "directory_project_code_invalid", "Project code is invalid")
	}
	row := a.db.QueryRowContext(ctx, `SELECT id,project_code,parent_project_code,project_name,project_type,
		dept_code,owner_uid,leader_uid,repo_url,description,status
		FROM directory_projects WHERE project_code=? LIMIT 1`, code)
	item, err := scanConsoleProject(row)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, httperror.New(http.StatusNotFound, "directory_project_not_found", "Project was not found")
	}
	return item, err
}

func (a *Adapter) ConsoleProjectMembers(ctx context.Context, code string, query url.Values) (map[string]any, error) {
	if _, err := a.ConsoleProject(ctx, code); err != nil {
		return nil, err
	}
	conditions := []string{"pm.project_code=?"}
	args := []any{code}
	status := strings.TrimSpace(query.Get("status"))
	if status == "" {
		status = "active"
	}
	if status != "all" {
		conditions = append(conditions, "pm.status=?")
		args = append(args, status)
	}
	if role := strings.TrimSpace(query.Get("role")); role != "" {
		conditions = append(conditions, "pm.member_role=?")
		args = append(args, role)
	}
	search := strings.TrimSpace(firstQuery(query, "search", "keyword"))
	if search != "" {
		conditions = append(conditions, "(pm.uid LIKE ? OR u.display_name LIKE ? OR u.real_name LIKE ? OR u.email LIKE ?)")
		like := "%" + search + "%"
		args = append(args, like, like, like, like)
	}
	where := " WHERE " + strings.Join(conditions, " AND ")
	page, pageSize, err := boundedPage(query)
	if err != nil {
		return nil, err
	}
	var total int64
	if err := a.db.QueryRowContext(ctx, `SELECT COUNT(*)
		FROM directory_project_members pm LEFT JOIN directory_users u ON u.uid=pm.uid`+where, args...).Scan(&total); err != nil {
		return nil, err
	}
	rows, err := a.db.QueryContext(ctx, `SELECT pm.id,pm.project_code,pm.uid,pm.member_role,
		pm.source_provider,pm.external_ref,pm.joined_at,pm.left_at,pm.status,
		u.display_name,u.real_name,u.email,u.mobile_tail4,pd.dept_code,pd.dept_name
		FROM directory_project_members pm
		LEFT JOIN directory_users u ON u.uid=pm.uid
		`+consoleDirectoryUserJoins+where+`
		ORDER BY FIELD(pm.member_role,'owner','admin','member','viewer'),pm.uid ASC
		LIMIT ? OFFSET ?`, append(args, pageSize, (page-1)*pageSize)...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	items := make([]map[string]any, 0)
	for rows.Next() {
		var id int64
		var projectCode, uid, role, provider, joinedAt, status string
		var externalRef, leftAt, displayName, realName, email, mobileTail4, deptCode, deptName sql.NullString
		if err := rows.Scan(&id, &projectCode, &uid, &role, &provider, &externalRef, &joinedAt,
			&leftAt, &status, &displayName, &realName, &email, &mobileTail4, &deptCode, &deptName); err != nil {
			return nil, err
		}
		name := displayName.String
		if name == "" {
			name = realName.String
		}
		if name == "" {
			name = uid
		}
		items = append(items, map[string]any{
			"id": id, "projectCode": projectCode, "uid": uid, "role": role,
			"sourceProvider": provider, "externalRef": nullableValue(externalRef), "joinedAt": joinedAt,
			"leftAt": nullableValue(leftAt), "status": status, "displayName": name,
			"realName": nullableValue(realName), "email": nullableValue(email),
			"mobileTail4": nullableValue(mobileTail4), "primaryDeptCode": nullableValue(deptCode),
			"deptName": nullableValue(deptName),
		})
	}
	return map[string]any{"items": items, "total": total, "page": page, "pageSize": pageSize}, rows.Err()
}

func (a *Adapter) ConsoleUserProjects(ctx context.Context, uid string, query url.Values) (map[string]any, error) {
	uid = strings.TrimSpace(uid)
	if uid == "" || len(uid) > 128 {
		return nil, httperror.New(http.StatusBadRequest, "directory_uid_invalid", "Directory uid is invalid")
	}
	conditions := []string{"p.status='active'"}
	conditionArgs := []any{}
	if query.Get("onlyGroup") == "true" || query.Get("only_group") == "true" {
		conditions = append(conditions, "p.project_type='group'")
	}
	if query.Get("includeTemplate") == "false" || query.Get("include_template") == "false" {
		conditions = append(conditions, "p.project_type<>'template'")
	}
	parentCode := strings.TrimSpace(firstQuery(query, "parentId", "parent_id"))
	if parentCode != "" {
		if !consoleSafeIdentifier(parentCode, 128) {
			return nil, httperror.New(http.StatusBadRequest, "directory_project_parent_invalid", "Parent project code is invalid")
		}
		conditions = append(conditions, "p.parent_project_code=?")
		conditionArgs = append(conditionArgs, parentCode)
	}
	filterSQL := strings.Join(conditions, " AND ")
	load := func(sqlText string, values ...any) ([]map[string]any, error) {
		rows, err := a.db.QueryContext(ctx, sqlText, values...)
		if err != nil {
			return nil, err
		}
		defer rows.Close()
		result := make([]map[string]any, 0)
		for rows.Next() {
			item, err := scanConsoleProject(rows)
			if err != nil {
				return nil, err
			}
			result = append(result, item)
		}
		return result, rows.Err()
	}
	managedArgs := append([]any{uid, uid}, conditionArgs...)
	managed, err := load(`SELECT p.id,p.project_code,p.parent_project_code,p.project_name,p.project_type,
		p.dept_code,p.owner_uid,p.leader_uid,p.repo_url,p.description,p.status
		FROM directory_projects p
		LEFT JOIN directory_projects parent ON parent.project_code=p.parent_project_code
		WHERE (p.leader_uid=? OR (parent.status='active' AND parent.leader_uid=?))
		AND `+filterSQL+`
		ORDER BY p.created_at DESC LIMIT 101`, managedArgs...)
	if err != nil {
		return nil, err
	}
	joinedArgs := append([]any{uid, uid, uid, uid}, conditionArgs...)
	joined, err := load(`SELECT p.id,p.project_code,p.parent_project_code,p.project_name,p.project_type,
		p.dept_code,p.owner_uid,p.leader_uid,p.repo_url,p.description,p.status
		FROM directory_projects p
		LEFT JOIN directory_projects parent ON parent.project_code=p.parent_project_code
		WHERE (
			EXISTS (SELECT 1 FROM directory_project_members direct_pm
				WHERE direct_pm.project_code=p.project_code AND direct_pm.uid=? AND direct_pm.status='active')
			OR (parent.status='active' AND EXISTS (SELECT 1 FROM directory_project_members inherited_pm
				WHERE inherited_pm.project_code=parent.project_code AND inherited_pm.uid=? AND inherited_pm.status='active'))
		)
		AND COALESCE(p.leader_uid,'')<>?
		AND COALESCE(parent.leader_uid,'')<>?
		AND `+filterSQL+`
		ORDER BY p.created_at DESC LIMIT 101`, joinedArgs...)
	if err != nil {
		return nil, err
	}
	for _, item := range managed {
		item["role"] = "owner"
	}
	items := append(append(make([]map[string]any, 0, len(managed)+len(joined)), managed...), joined...)
	if len(items) > 100 {
		return nil, httperror.New(http.StatusBadRequest, "directory_pagination_required", "Directory user projects query must be paginated")
	}
	return map[string]any{"managed": managed, "joined": joined, "items": items, "total": len(items)}, nil
}

type rowScanner interface {
	Scan(dest ...any) error
}

func scanConsoleDirectoryUser(row rowScanner) (map[string]any, error) {
	var value consoleDirectoryUserRow
	if err := row.Scan(&value.ID, &value.UID, &value.Username, &value.DisplayName, &value.RealName,
		&value.Nickname, &value.Avatar, &value.Email, &value.Mobile, &value.MobileTail4,
		&value.PositionTitle, &value.Gender, &value.DeptCode, &value.DeptName, &value.UserType,
		&value.DingTalkID, &value.Status); err != nil {
		return nil, err
	}
	realName := value.RealName.String
	if realName == "" {
		realName = value.DisplayName.String
	}
	if realName == "" {
		realName = value.Username.String
	}
	if realName == "" {
		realName = value.UID
	}
	gender := 0
	if value.Gender == "male" {
		gender = 1
	} else if value.Gender == "female" {
		gender = 2
	}
	return map[string]any{
		"id": value.ID, "uid": value.UID, "username": nullableValue(value.Username),
		"displayName": nullableValue(value.DisplayName), "realName": realName,
		"nickname": nullableValue(value.Nickname), "email": nullableValue(value.Email),
		"mobile": nullableValue(value.Mobile), "mobileTail4": nullableValue(value.MobileTail4),
		"avatar": nullableValue(value.Avatar), "gender": gender, "status": accountStatus(value.Status),
		"deptCode": nullableValue(value.DeptCode), "deptName": nullableValue(value.DeptName),
		"positionTitle": nullableValue(value.PositionTitle), "userType": value.UserType,
		"dingtalkId": nullableValue(value.DingTalkID),
	}, nil
}

func scanConsoleProject(row rowScanner) (map[string]any, error) {
	var id int64
	var code, name, projectType, status string
	var parent, dept, owner, leader, repo, description sql.NullString
	if err := row.Scan(&id, &code, &parent, &name, &projectType, &dept, &owner, &leader, &repo, &description, &status); err != nil {
		return nil, err
	}
	return map[string]any{
		"id": id, "projectCode": code, "parentId": nullableValue(parent), "name": name,
		"deptCode": nullableValue(dept), "ownerUid": nullableValue(owner), "leaderUid": nullableValue(leader),
		"description": nullableValue(description), "status": accountStatus(status), "statusKey": status,
		"repoUrl": nullableValue(repo), "isGroup": boolInt(projectType == "group"),
		"isTemplate": boolInt(projectType == "template"), "docsSyncedAt": nil,
		"docsCommittedAt": nil, "subProjects": []any{},
	}, nil
}

func scanConsoleCommittee(row rowScanner) (map[string]any, error) {
	var id, memberCount int64
	var code, name, status string
	var parentCode, parentName, managerUID, managerName, leaderUID, leaderName, description sql.NullString
	var sortOrder int
	var createdAt, updatedAt any
	if err := row.Scan(&id, &code, &name, &parentCode, &parentName, &managerUID, &managerName,
		&leaderUID, &leaderName, &description, &sortOrder, &status, &memberCount, &createdAt, &updatedAt); err != nil {
		return nil, err
	}
	return map[string]any{
		"id": id, "committeeCode": code, "name": name,
		"parentDeptCode": nullableValue(parentCode), "parentDeptName": nullableValue(parentName),
		"managerUid": nullableValue(managerUID), "managerName": nullableValue(managerName),
		"leaderUid": nullableValue(leaderUID), "leaderName": nullableValue(leaderName),
		"description": nullableValue(description), "sortOrder": sortOrder, "status": status,
		"memberCount": memberCount, "createdAt": createdAt, "updatedAt": updatedAt,
	}, nil
}

func normalizeConsoleDepartments(rows []consoleDirectoryDepartmentRow) []map[string]any {
	items := make([]map[string]any, 0, len(rows))
	for _, row := range rows {
		items = append(items, map[string]any{
			"id": row.ID, "deptCode": row.Code, "name": row.Name, "parentId": nullableValue(row.ParentCode),
			"level": row.Level, "orgType": row.OrgType, "deptCategory": nullableValue(row.Category),
			"managerId": nullableValue(row.ManagerUID), "manager": nullableValue(row.ManagerName),
			"leaderId": nullableValue(row.LeaderUID), "leader": nullableValue(row.LeaderName),
			"description": nullableValue(row.Description), "sortOrder": row.SortOrder, "children": []any{},
		})
	}
	return items
}

func buildConsoleDepartmentTree(rows []consoleDirectoryDepartmentRow, users []map[string]any) []map[string]any {
	nodes := map[string]map[string]any{}
	for _, item := range normalizeConsoleDepartments(rows) {
		nodes[item["deptCode"].(string)] = item
	}
	roots := make([]map[string]any, 0)
	for _, row := range rows {
		node := nodes[row.Code]
		if users != nil {
			nodeUsers := make([]map[string]any, 0)
			for _, user := range users {
				if user["deptCode"] == row.Code {
					nodeUsers = append(nodeUsers, user)
				}
			}
			node["users"] = nodeUsers
		}
		if row.ParentCode.Valid {
			if parent := nodes[row.ParentCode.String]; parent != nil {
				parent["children"] = append(parent["children"].([]any), node)
				continue
			}
		}
		roots = append(roots, node)
	}
	return roots
}

func buildConsoleProjectTree(items []map[string]any) []map[string]any {
	nodes := map[string]map[string]any{}
	for _, item := range items {
		nodes[item["projectCode"].(string)] = item
	}
	roots := make([]map[string]any, 0)
	for _, item := range items {
		parent, _ := item["parentId"].(string)
		if parent != "" && nodes[parent] != nil {
			children := nodes[parent]["subProjects"].([]any)
			nodes[parent]["subProjects"] = append(children, item)
		} else {
			roots = append(roots, item)
		}
	}
	return roots
}

func boundedPage(query url.Values) (int, int, error) {
	page := parsePositiveInt(query.Get("page"), 1)
	pageSize := parsePositiveInt(firstQuery(query, "pageSize", "limit"), 20)
	if pageSize > 100 {
		return 0, 0, httperror.New(http.StatusBadRequest, "directory_page_size_too_large", "Directory page size must not exceed 100")
	}
	return page, pageSize, nil
}

func parsePositiveInt(raw string, fallback int) int {
	value, err := strconv.Atoi(strings.TrimSpace(raw))
	if err != nil || value <= 0 {
		return fallback
	}
	return value
}

func firstQuery(query url.Values, keys ...string) string {
	for _, key := range keys {
		if value := query.Get(key); value != "" {
			return value
		}
	}
	return ""
}

func nullableValue(value sql.NullString) any {
	if value.Valid {
		return value.String
	}
	return nil
}

func nullableTime(value sql.NullTime) any {
	if value.Valid {
		return value.Time
	}
	return nil
}

func accountStatus(value string) int {
	switch value {
	case "active":
		return 1
	case "deleted":
		return -1
	default:
		return 0
	}
}

func boolInt(value bool) int {
	if value {
		return 1
	}
	return 0
}
