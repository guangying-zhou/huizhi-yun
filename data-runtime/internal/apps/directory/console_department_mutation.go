package directory

import (
	"context"
	"database/sql"
	"fmt"
	"maps"
	"net/http"
	"strings"

	"github.com/huizhi-yun/data-runtime/internal/httperror"
)

var consoleDepartmentFields = map[string]bool{
	"deptCode": true, "committeeCode": true, "name": true, "deptName": true,
	"parentDeptCode": true, "managerId": true, "leaderId": true, "orgType": true,
	"deptCategory": true, "description": true, "sortOrder": true, "status": true,
}

type consoleDepartmentParent struct {
	id    any
	code  any
	path  string
	level int
}

func (a *Adapter) ConsoleCreateDepartment(
	ctx context.Context,
	body map[string]any,
	committee bool,
	meta ConsoleMutationMeta,
) (result map[string]any, err error) {
	if err := rejectUnknownConsoleFields(body, consoleDepartmentFields); err != nil {
		return nil, err
	}
	codeValue := body["deptCode"]
	if committee && consoleNullableString(body["committeeCode"]) != "" {
		codeValue = body["committeeCode"]
	}
	code, err := requiredConsoleString(codeValue, "department code")
	if err != nil {
		return nil, err
	}
	nameValue := body["deptName"]
	if consoleNullableString(nameValue) == "" {
		nameValue = body["name"]
	}
	name, err := requiredConsoleString(nameValue, "department name")
	if err != nil {
		return nil, err
	}
	operation := "directory.department.create"
	targetType := "directory_department"
	if committee {
		operation, targetType = "directory.committee.create", "directory_committee"
	}
	payload := map[string]any{"code": code, "committee": committee, "body": body}
	session, replay, err := a.beginConsoleMutation(ctx, operation, meta, payload)
	if err != nil || replay != nil {
		return replay, err
	}
	defer func() {
		if err != nil {
			rollbackConsoleMutation(session)
		}
	}()
	var exists int
	if err = session.tx.QueryRowContext(ctx, "SELECT COUNT(*) FROM directory_departments WHERE dept_code=?", code).Scan(&exists); err != nil {
		return nil, err
	}
	if exists > 0 {
		return nil, httperror.New(http.StatusConflict, "directory_department_exists", "Directory organization already exists")
	}
	parentCode := consoleNullableString(body["parentDeptCode"])
	parent, err := resolveConsoleDepartmentParent(ctx, session.tx, parentCode, "")
	if err != nil {
		return nil, err
	}
	managerUID, leaderUID := consoleNullableString(body["managerId"]), consoleNullableString(body["leaderId"])
	if committee {
		managerUID, leaderUID = "", ""
	}
	if err = assertConsoleUserTx(ctx, session.tx, managerUID, "manager"); err != nil {
		return nil, err
	}
	if err = assertConsoleUserTx(ctx, session.tx, leaderUID, "leader"); err != nil {
		return nil, err
	}
	orgType := "committee"
	if !committee {
		orgType, err = enumConsoleValue(body["orgType"], "department", []string{"department", "committee", "virtual"}, "directory_org_type_invalid")
		if err != nil {
			return nil, err
		}
	}
	status, err := enumConsoleValue(body["status"], "active", []string{"active", "inactive", "deleted"}, "directory_department_status_invalid")
	if err != nil {
		return nil, err
	}
	sortOrder := consoleInt(body["sortOrder"], 100)
	category := consoleNullableString(body["deptCategory"])
	if committee {
		category = ""
	}
	if _, err = session.tx.ExecContext(ctx, `INSERT INTO directory_departments
		(dept_code,dept_name,parent_id,parent_dept_code,dept_path,level_no,sort_order,
		 manager_uid,leader_uid,org_type,dept_category,description,source_provider,
		 external_ref,synced_at,status,created_at,updated_at)
		VALUES (?,?,?,?,?,?,?,?,?,?,?,?,'manual',?,UTC_TIMESTAMP(),?,UTC_TIMESTAMP(),UTC_TIMESTAMP())`,
		code, name, parent.id, parent.code, parent.path, parent.level, sortOrder,
		nullableConsoleText(managerUID), nullableConsoleText(leaderUID), orgType,
		nullableConsoleText(category), nullableConsoleText(consoleNullableString(body["description"])),
		code, status); err != nil {
		return nil, err
	}
	if err = upsertConsoleDepartmentSubject(ctx, session.tx, code); err != nil {
		return nil, err
	}
	result = map[string]any{"code": 0, "data": map[string]any{"code": code}}
	err = finishConsoleMutation(ctx, session, operation, targetType, code,
		map[string]any{"code": code, "parentDeptCode": nullableConsoleText(parentCode)}, result)
	return result, err
}

func (a *Adapter) ConsoleUpdateDepartment(
	ctx context.Context,
	code string,
	body map[string]any,
	committee bool,
	meta ConsoleMutationMeta,
) (result map[string]any, err error) {
	code = strings.TrimSpace(code)
	if code == "" || len(code) > 128 {
		return nil, httperror.New(http.StatusBadRequest, "directory_department_code_invalid", "Directory organization code is invalid")
	}
	if err := rejectUnknownConsoleFields(body, consoleDepartmentFields); err != nil {
		return nil, err
	}
	operation := "directory.department.update"
	targetType := "directory_department"
	if committee {
		operation, targetType = "directory.committee.update", "directory_committee"
	}
	session, replay, err := a.beginConsoleMutation(ctx, operation, meta, map[string]any{
		"code": code, "committee": committee, "changes": body,
	})
	if err != nil || replay != nil {
		return replay, err
	}
	defer func() {
		if err != nil {
			rollbackConsoleMutation(session)
		}
	}()
	var currentOrgType, currentStatus string
	if err = session.tx.QueryRowContext(ctx, `SELECT org_type,status FROM directory_departments
		WHERE dept_code=? FOR UPDATE`, code).Scan(&currentOrgType, &currentStatus); err != nil {
		if err == sql.ErrNoRows {
			return nil, httperror.New(http.StatusNotFound, "directory_department_not_found", "Directory organization was not found")
		}
		return nil, err
	}
	if currentStatus == "deleted" || (committee && currentOrgType != "committee") {
		return nil, httperror.New(http.StatusNotFound, "directory_department_not_found", "Directory organization was not found")
	}
	dingTalkManaged := false
	if !committee && consoleDingTalkAuthoritativeDepartmentMutation(body) {
		var mapped int
		if err = session.tx.QueryRowContext(ctx, `SELECT COUNT(*) FROM directory_department_identities
			WHERE provider_code='dingtalk' AND dept_code=?`, code).Scan(&mapped); err != nil {
			return nil, err
		}
		dingTalkManaged = mapped > 0
		if dingTalkManaged {
			managedChanges := maps.Clone(body)
			if _, hasManager := body["managerId"]; hasManager {
				var localRootManager int
				if err = session.tx.QueryRowContext(ctx, `SELECT COUNT(*) FROM directory_department_identities identities
					JOIN directory_departments departments ON departments.dept_code=identities.dept_code
					WHERE identities.provider_code='dingtalk' AND identities.external_department_id='1'
						AND identities.dept_code=? AND identities.status='active'
						AND COALESCE(identities.manager_external_subject,'')=''
						AND COALESCE(departments.parent_dept_code,'')=''
						AND departments.org_type='department' AND departments.status='active'`, code).Scan(&localRootManager); err != nil {
					return nil, err
				}
				if localRootManager > 0 {
					delete(managedChanges, "managerId")
				}
			}
			if consoleDingTalkAuthoritativeDepartmentMutation(managedChanges) {
				return nil, httperror.New(http.StatusConflict, "dingtalk_department_field_managed", "钉钉同步的部门字段需在钉钉维护；仅根公司未提供负责人时可在此补充负责人")
			}
		}
	}
	fields, args := make([]string, 0), make([]any, 0)
	if _, ok := body["deptName"]; ok || consoleNullableString(body["name"]) != "" {
		value := body["deptName"]
		if consoleNullableString(value) == "" {
			value = body["name"]
		}
		name, validationErr := requiredConsoleString(value, "department name")
		if validationErr != nil {
			return nil, validationErr
		}
		fields, args = append(fields, "dept_name=?"), append(args, name)
	}
	if value, ok := body["managerId"]; ok && !committee {
		uid := consoleNullableString(value)
		if err = assertConsoleUserTx(ctx, session.tx, uid, "manager"); err != nil {
			return nil, err
		}
		fields, args = append(fields, "manager_uid=?"), append(args, nullableConsoleText(uid))
	}
	if value, ok := body["leaderId"]; ok && !committee {
		uid := consoleNullableString(value)
		if err = assertConsoleUserTx(ctx, session.tx, uid, "leader"); err != nil {
			return nil, err
		}
		fields, args = append(fields, "leader_uid=?"), append(args, nullableConsoleText(uid))
	}
	if value, ok := body["description"]; ok {
		fields, args = append(fields, "description=?"), append(args, nullableConsoleText(consoleNullableString(value)))
	}
	if value, ok := body["sortOrder"]; ok {
		fields, args = append(fields, "sort_order=?"), append(args, consoleInt(value, 100))
	}
	if value, ok := body["status"]; ok {
		status, validationErr := enumConsoleValue(value, "active", []string{"active", "inactive", "deleted"}, "directory_department_status_invalid")
		if validationErr != nil {
			return nil, validationErr
		}
		fields, args = append(fields, "status=?"), append(args, status)
	}
	if value, ok := body["orgType"]; ok && !committee {
		orgType, validationErr := enumConsoleValue(value, "department", []string{"department", "committee", "virtual"}, "directory_org_type_invalid")
		if validationErr != nil {
			return nil, validationErr
		}
		fields, args = append(fields, "org_type=?"), append(args, orgType)
	}
	if value, ok := body["deptCategory"]; ok && !committee {
		fields, args = append(fields, "dept_category=?"), append(args, nullableConsoleText(consoleNullableString(value)))
	}
	if value, ok := body["parentDeptCode"]; ok {
		parent, validationErr := resolveConsoleDepartmentParent(ctx, session.tx, consoleNullableString(value), code)
		if validationErr != nil {
			return nil, validationErr
		}
		fields = append(fields, "parent_id=?", "parent_dept_code=?", "dept_path=?", "level_no=?")
		args = append(args, parent.id, parent.code, parent.path, parent.level)
	}
	if committee {
		fields = append(fields, "org_type='committee'", "dept_category=NULL")
	}
	if len(fields) > 0 {
		if !dingTalkManaged {
			fields = append(fields, "source_provider='manual'")
		}
		fields = append(fields, "synced_at=UTC_TIMESTAMP()", "updated_at=UTC_TIMESTAMP()")
		args = append(args, code)
		if _, err = session.tx.ExecContext(ctx, "UPDATE directory_departments SET "+strings.Join(fields, ",")+" WHERE dept_code=?", args...); err != nil {
			return nil, err
		}
	}
	if err = upsertConsoleDepartmentSubject(ctx, session.tx, code); err != nil {
		return nil, err
	}
	result = map[string]any{"code": 0, "data": map[string]any{"code": code}}
	err = finishConsoleMutation(ctx, session, operation, targetType, code,
		map[string]any{"code": code, "changedFields": sortedConsoleKeys(body)}, result)
	return result, err
}

func consoleDingTalkAuthoritativeDepartmentMutation(body map[string]any) bool {
	for _, field := range []string{"deptName", "name", "parentDeptCode", "managerId", "sortOrder", "status", "orgType"} {
		if _, present := body[field]; present {
			return true
		}
	}
	return false
}

func (a *Adapter) ConsoleDeleteDepartment(
	ctx context.Context,
	code string,
	committee bool,
	meta ConsoleMutationMeta,
) (result map[string]any, err error) {
	code = strings.TrimSpace(code)
	if code == "" || len(code) > 128 {
		return nil, httperror.New(http.StatusBadRequest, "directory_department_code_invalid", "Directory organization code is invalid")
	}
	operation, targetType := "directory.department.delete", "directory_department"
	if committee {
		operation, targetType = "directory.committee.delete", "directory_committee"
	}
	session, replay, err := a.beginConsoleMutation(ctx, operation, meta, map[string]any{"code": code, "committee": committee})
	if err != nil || replay != nil {
		return replay, err
	}
	defer func() {
		if err != nil {
			rollbackConsoleMutation(session)
		}
	}()
	var orgType, status string
	if err = session.tx.QueryRowContext(ctx, `SELECT org_type,status FROM directory_departments
		WHERE dept_code=? FOR UPDATE`, code).Scan(&orgType, &status); err != nil {
		if err == sql.ErrNoRows {
			return nil, httperror.New(http.StatusNotFound, "directory_department_not_found", "Directory organization was not found")
		}
		return nil, err
	}
	if status == "deleted" || (committee && orgType != "committee") {
		return nil, httperror.New(http.StatusNotFound, "directory_department_not_found", "Directory organization was not found")
	}
	if !committee {
		var mapped int
		if err = session.tx.QueryRowContext(ctx, `SELECT COUNT(*) FROM directory_department_identities
			WHERE provider_code='dingtalk' AND dept_code=?`, code).Scan(&mapped); err != nil {
			return nil, err
		}
		if mapped > 0 {
			return nil, httperror.New(http.StatusConflict, "dingtalk_department_field_managed", "DingTalk-managed department cannot be deleted in Console")
		}
	}
	var children, members int
	if err = session.tx.QueryRowContext(ctx, `SELECT COUNT(*) FROM directory_departments
		WHERE parent_dept_code=? AND status<>'deleted'`, code).Scan(&children); err != nil {
		return nil, err
	}
	if err = session.tx.QueryRowContext(ctx, `SELECT COUNT(*) FROM directory_user_departments
		WHERE dept_code=? AND status='active'`, code).Scan(&members); err != nil {
		return nil, err
	}
	if children > 0 {
		return nil, httperror.New(http.StatusBadRequest, "directory_department_has_children", "Directory organization has children")
	}
	if members > 0 {
		return nil, httperror.New(http.StatusBadRequest, "directory_department_has_members", "Directory organization has active members")
	}
	if _, err = session.tx.ExecContext(ctx, `UPDATE directory_departments
		SET status='deleted',source_provider='manual',synced_at=UTC_TIMESTAMP(),updated_at=UTC_TIMESTAMP()
		WHERE dept_code=?`, code); err != nil {
		return nil, err
	}
	if err = upsertConsoleDepartmentSubject(ctx, session.tx, code); err != nil {
		return nil, err
	}
	result = map[string]any{"code": 0, "data": map[string]any{"deleted": true}}
	err = finishConsoleMutation(ctx, session, operation, targetType, code, map[string]any{"code": code}, result)
	return result, err
}

func resolveConsoleDepartmentParent(ctx context.Context, tx *sql.Tx, parentCode, selfCode string) (consoleDepartmentParent, error) {
	if parentCode == "" {
		return consoleDepartmentParent{id: nil, code: nil, path: "/", level: 1}, nil
	}
	if parentCode == selfCode {
		return consoleDepartmentParent{}, httperror.New(http.StatusBadRequest, "directory_parent_invalid", "Parent organization cannot be itself")
	}
	var id int64
	var path string
	var level int
	var next sql.NullString
	if err := tx.QueryRowContext(ctx, `SELECT id,dept_path,level_no,parent_dept_code
		FROM directory_departments WHERE dept_code=? AND status<>'deleted'`, parentCode).
		Scan(&id, &path, &level, &next); err != nil {
		if err == sql.ErrNoRows {
			return consoleDepartmentParent{}, httperror.New(http.StatusBadRequest, "directory_parent_not_found", "Parent organization does not exist")
		}
		return consoleDepartmentParent{}, err
	}
	current := next
	for current.Valid && current.String != "" {
		if current.String == selfCode {
			return consoleDepartmentParent{}, httperror.New(http.StatusBadRequest, "directory_parent_cycle", "Parent organization cannot be a descendant")
		}
		if err := tx.QueryRowContext(ctx, `SELECT parent_dept_code FROM directory_departments
			WHERE dept_code=? AND status<>'deleted'`, current.String).Scan(&current); err != nil {
			return consoleDepartmentParent{}, err
		}
	}
	return consoleDepartmentParent{
		id: id, code: parentCode, path: fmt.Sprintf("%s%s/", path, parentCode), level: level + 1,
	}, nil
}

func assertConsoleUserTx(ctx context.Context, tx *sql.Tx, uid, label string) error {
	if uid == "" {
		return nil
	}
	var count int
	if err := tx.QueryRowContext(ctx, `SELECT COUNT(*) FROM directory_users
		WHERE uid=? AND status<>'deleted'`, uid).Scan(&count); err != nil {
		return err
	}
	if count == 0 {
		return httperror.New(http.StatusBadRequest, "directory_user_not_found", label+" user does not exist")
	}
	return nil
}

func upsertConsoleDepartmentSubject(ctx context.Context, tx *sql.Tx, code string) error {
	_, err := tx.ExecContext(ctx, `INSERT INTO directory_subject_exports
		(subject_type,subject_code,external_ref,parent_subject_type,parent_subject_code,
		 source_object_type,source_object_code,snapshot_hash,status,exported_at,created_at,updated_at)
		SELECT CASE WHEN d.org_type='committee' THEN 'committee' ELSE 'department' END,
			d.dept_code,SHA2(CONCAT('console:',d.org_type,':',d.dept_code),256),
			CASE WHEN d.parent_dept_code IS NULL THEN NULL ELSE 'department' END,d.parent_dept_code,
			'directory_departments',d.dept_code,
			SHA2(CONCAT_WS('|',d.org_type,d.dept_code,COALESCE(d.parent_dept_code,''),d.status),256),
			d.status,UTC_TIMESTAMP(),UTC_TIMESTAMP(),UTC_TIMESTAMP()
		FROM directory_departments d WHERE d.dept_code=?
		ON DUPLICATE KEY UPDATE external_ref=VALUES(external_ref),
			parent_subject_type=VALUES(parent_subject_type),parent_subject_code=VALUES(parent_subject_code),
			snapshot_hash=VALUES(snapshot_hash),status=VALUES(status),
			exported_at=VALUES(exported_at),updated_at=VALUES(updated_at)`, code)
	return err
}

func consoleInt(value any, fallback int) int {
	if value == nil || consoleNullableString(value) == "" {
		return fallback
	}
	var parsed int
	if _, err := fmt.Sscan(consoleNullableString(value), &parsed); err != nil {
		return fallback
	}
	return parsed
}

type consoleCommitteeMemberInput struct {
	UID  string
	Role string
}

func (a *Adapter) ConsoleSaveCommitteeMembers(
	ctx context.Context,
	code string,
	body map[string]any,
	meta ConsoleMutationMeta,
) (result map[string]any, err error) {
	code = strings.TrimSpace(code)
	if code == "" || len(code) > 128 {
		return nil, httperror.New(http.StatusBadRequest, "directory_committee_code_invalid", "Committee code is invalid")
	}
	members, err := normalizeConsoleCommitteeMembers(body)
	if err != nil {
		return nil, err
	}
	if len(members) == 0 {
		return nil, httperror.New(http.StatusBadRequest, "directory_committee_members_required", "At least one committee member is required")
	}
	session, replay, err := a.beginConsoleMutation(ctx, "directory.committee.members.update", meta,
		map[string]any{"committeeCode": code, "members": body})
	if err != nil || replay != nil {
		return replay, err
	}
	defer func() {
		if err != nil {
			rollbackConsoleMutation(session)
		}
	}()
	if err = lockConsoleCommittee(ctx, session.tx, code); err != nil {
		return nil, err
	}
	for _, member := range members {
		var active int
		if err = session.tx.QueryRowContext(ctx, `SELECT COUNT(*) FROM directory_users
			WHERE uid=? AND status='active'`, member.UID).Scan(&active); err != nil {
			return nil, err
		}
		if active == 0 {
			return nil, httperror.New(http.StatusBadRequest, "directory_committee_user_inactive", "Committee member does not exist or is inactive")
		}
		relationType := "member"
		if member.Role == "observer" {
			relationType = "observer"
		}
		var joinedAt sql.NullTime
		_ = session.tx.QueryRowContext(ctx, `SELECT joined_at FROM directory_user_departments
			WHERE uid=? AND dept_code=? AND relation_type=? AND status='active' LIMIT 1`,
			member.UID, code, relationType).Scan(&joinedAt)
		if _, err = session.tx.ExecContext(ctx, `UPDATE directory_user_departments
			SET status='inactive',is_primary=0,left_at=UTC_TIMESTAMP(),updated_at=UTC_TIMESTAMP()
			WHERE uid=? AND dept_code=? AND status='active' AND relation_type<>?`,
			member.UID, code, relationType); err != nil {
			return nil, err
		}
		var joined any = nil
		if joinedAt.Valid {
			joined = joinedAt.Time
		}
		if _, err = session.tx.ExecContext(ctx, `INSERT INTO directory_user_departments
			(uid,dept_code,relation_type,is_primary,source_provider,external_ref,joined_at,left_at,status,created_at,updated_at)
			VALUES (?,?,?,0,'manual',?,COALESCE(?,UTC_TIMESTAMP()),NULL,'active',UTC_TIMESTAMP(),UTC_TIMESTAMP())
			ON DUPLICATE KEY UPDATE is_primary=0,source_provider='manual',
				external_ref=VALUES(external_ref),joined_at=VALUES(joined_at),left_at=NULL,
				status='active',updated_at=UTC_TIMESTAMP()`,
			member.UID, code, relationType, member.UID+":"+code+":"+relationType, joined); err != nil {
			return nil, err
		}
		if _, err = session.tx.ExecContext(ctx, `UPDATE directory_departments
			SET leader_uid=CASE WHEN leader_uid=? AND ?<>'leader' THEN NULL WHEN ?='leader' THEN ? ELSE leader_uid END,
				manager_uid=CASE WHEN manager_uid=? AND ?<>'manager' THEN NULL WHEN ?='manager' THEN ? ELSE manager_uid END,
				source_provider='manual',synced_at=UTC_TIMESTAMP(),updated_at=UTC_TIMESTAMP()
			WHERE dept_code=?`,
			member.UID, member.Role, member.Role, member.UID,
			member.UID, member.Role, member.Role, member.UID, code); err != nil {
			return nil, err
		}
	}
	result = map[string]any{"code": 0, "data": map[string]any{"committeeCode": code, "updatedCount": len(members)}}
	err = finishConsoleMutation(ctx, session, "directory.committee.members.update", "directory_committee", code,
		map[string]any{"committeeCode": code, "memberCount": len(members)}, result)
	return result, err
}

func (a *Adapter) ConsoleRemoveCommitteeMember(
	ctx context.Context,
	code string,
	uid string,
	meta ConsoleMutationMeta,
) (result map[string]any, err error) {
	code, uid = strings.TrimSpace(code), strings.TrimSpace(uid)
	if code == "" || uid == "" || len(code) > 128 || len(uid) > 128 {
		return nil, httperror.New(http.StatusBadRequest, "directory_committee_member_invalid", "Committee member path is invalid")
	}
	session, replay, err := a.beginConsoleMutation(ctx, "directory.committee.member.remove", meta,
		map[string]any{"committeeCode": code, "uid": uid})
	if err != nil || replay != nil {
		return replay, err
	}
	defer func() {
		if err != nil {
			rollbackConsoleMutation(session)
		}
	}()
	if err = lockConsoleCommittee(ctx, session.tx, code); err != nil {
		return nil, err
	}
	var present int
	if err = session.tx.QueryRowContext(ctx, `SELECT
		(SELECT COUNT(*) FROM directory_user_departments WHERE dept_code=? AND uid=? AND status='active')
		+(SELECT COUNT(*) FROM directory_departments WHERE dept_code=? AND (leader_uid=? OR manager_uid=?))`,
		code, uid, code, uid, uid).Scan(&present); err != nil {
		return nil, err
	}
	if present == 0 {
		return nil, httperror.New(http.StatusNotFound, "directory_committee_member_not_found", "Committee member was not found")
	}
	if _, err = session.tx.ExecContext(ctx, `UPDATE directory_user_departments
		SET status='inactive',is_primary=0,left_at=UTC_TIMESTAMP(),updated_at=UTC_TIMESTAMP()
		WHERE dept_code=? AND uid=? AND status='active'`, code, uid); err != nil {
		return nil, err
	}
	if _, err = session.tx.ExecContext(ctx, `UPDATE directory_departments
		SET leader_uid=CASE WHEN leader_uid=? THEN NULL ELSE leader_uid END,
			manager_uid=CASE WHEN manager_uid=? THEN NULL ELSE manager_uid END,
			source_provider='manual',synced_at=UTC_TIMESTAMP(),updated_at=UTC_TIMESTAMP()
		WHERE dept_code=?`, uid, uid, code); err != nil {
		return nil, err
	}
	result = map[string]any{"code": 0, "data": map[string]any{"removed": true}}
	err = finishConsoleMutation(ctx, session, "directory.committee.member.remove", "directory_committee", code,
		map[string]any{"committeeCode": code, "uid": uid}, result)
	return result, err
}

func normalizeConsoleCommitteeMembers(body map[string]any) ([]consoleCommitteeMemberInput, error) {
	raw, ok := body["members"].([]any)
	if !ok {
		if uids, uidOK := body["memberUids"].([]any); uidOK {
			raw = make([]any, 0, len(uids))
			for _, uid := range uids {
				raw = append(raw, map[string]any{"uid": uid, "role": body["role"]})
			}
		}
	}
	result := make([]consoleCommitteeMemberInput, 0, len(raw))
	seen := map[string]bool{}
	leaders, managers := 0, 0
	for _, item := range raw {
		entry, ok := item.(map[string]any)
		if !ok {
			return nil, httperror.New(http.StatusBadRequest, "directory_committee_member_invalid", "Committee member entry is invalid")
		}
		uid := consoleNullableString(entry["uid"])
		if uid == "" || seen[uid] {
			return nil, httperror.New(http.StatusBadRequest, "directory_committee_member_duplicate", "Committee member is missing or duplicated")
		}
		seen[uid] = true
		role, err := enumConsoleValue(entry["role"], "member", []string{"leader", "manager", "member", "observer"}, "directory_committee_role_invalid")
		if err != nil {
			return nil, err
		}
		if role == "leader" {
			leaders++
		}
		if role == "manager" {
			managers++
		}
		result = append(result, consoleCommitteeMemberInput{UID: uid, Role: role})
	}
	if leaders > 1 || managers > 1 {
		return nil, httperror.New(http.StatusBadRequest, "directory_committee_leadership_invalid", "Committee supports at most one leader and one manager per mutation")
	}
	if len(result) > 100 {
		return nil, httperror.New(http.StatusBadRequest, "directory_batch_too_large", "Committee members must not exceed 100")
	}
	return result, nil
}

func lockConsoleCommittee(ctx context.Context, tx *sql.Tx, code string) error {
	var orgType, status string
	if err := tx.QueryRowContext(ctx, `SELECT org_type,status FROM directory_departments
		WHERE dept_code=? FOR UPDATE`, code).Scan(&orgType, &status); err != nil {
		if err == sql.ErrNoRows {
			return httperror.New(http.StatusNotFound, "directory_committee_not_found", "Committee was not found")
		}
		return err
	}
	if orgType != "committee" || status == "deleted" {
		return httperror.New(http.StatusNotFound, "directory_committee_not_found", "Committee was not found")
	}
	return nil
}
