package directory

import (
	"context"
	"database/sql"
	"errors"
	"net/http"
	"strings"

	"github.com/huizhi-yun/data-runtime/internal/httperror"
)

var consoleProjectFields = map[string]bool{
	"projectCode": true, "name": true, "projectName": true, "parentProjectCode": true,
	"projectType": true, "deptCode": true, "ownerUid": true, "leaderUid": true,
	"repoUrl": true, "description": true, "status": true, "memberUids": true, "members": true,
}

type consoleProjectMember struct {
	UID  string
	Role string
}

func (a *Adapter) ConsoleCreateProject(
	ctx context.Context,
	body map[string]any,
	meta ConsoleMutationMeta,
) (result map[string]any, err error) {
	if err := rejectUnknownConsoleFields(body, consoleProjectFields); err != nil {
		return nil, err
	}
	code, err := requiredConsoleString(body["projectCode"], "project code")
	if err != nil {
		return nil, err
	}
	nameValue := body["projectName"]
	if consoleNullableString(nameValue) == "" {
		nameValue = body["name"]
	}
	name, err := requiredConsoleString(nameValue, "project name")
	if err != nil {
		return nil, err
	}
	session, replay, err := a.beginConsoleMutation(ctx, "directory.project.create", meta, body)
	if err != nil || replay != nil {
		return replay, err
	}
	defer func() {
		if err != nil {
			rollbackConsoleMutation(session)
		}
	}()
	var exists int
	if err = session.tx.QueryRowContext(ctx, "SELECT COUNT(*) FROM directory_projects WHERE project_code=?", code).Scan(&exists); err != nil {
		return nil, err
	}
	if exists > 0 {
		return nil, httperror.New(http.StatusConflict, "directory_project_exists", "Directory project already exists")
	}
	parentCode := consoleNullableString(body["parentProjectCode"])
	if err = assertConsoleProjectParent(ctx, session.tx, parentCode, code); err != nil {
		return nil, err
	}
	deptCode := consoleNullableString(body["deptCode"])
	if err = assertConsoleDepartmentTx(ctx, session.tx, deptCode); err != nil {
		return nil, err
	}
	ownerUID, leaderUID := consoleNullableString(body["ownerUid"]), consoleNullableString(body["leaderUid"])
	if err = assertConsoleUserTx(ctx, session.tx, ownerUID, "owner"); err != nil {
		return nil, err
	}
	if err = assertConsoleUserTx(ctx, session.tx, leaderUID, "leader"); err != nil {
		return nil, err
	}
	projectType, err := enumConsoleValue(body["projectType"], "project", []string{"group", "project", "template"}, "directory_project_type_invalid")
	if err != nil {
		return nil, err
	}
	status, err := enumConsoleValue(body["status"], "active", []string{"active", "inactive", "archived", "deleted"}, "directory_project_status_invalid")
	if err != nil {
		return nil, err
	}
	if _, err = session.tx.ExecContext(ctx, `INSERT INTO directory_projects
		(project_code,parent_project_code,project_name,project_type,dept_code,owner_uid,
		 leader_uid,repo_url,description,source_provider,external_ref,synced_at,status,created_at,updated_at)
		VALUES (?,?,?,?,?,?,?,?,?,'manual',?,UTC_TIMESTAMP(),?,UTC_TIMESTAMP(),UTC_TIMESTAMP())`,
		code, nullableConsoleText(parentCode), name, projectType, nullableConsoleText(deptCode),
		nullableConsoleText(ownerUID), nullableConsoleText(leaderUID),
		nullableConsoleText(consoleNullableString(body["repoUrl"])),
		nullableConsoleText(consoleNullableString(body["description"])), code, status); err != nil {
		return nil, err
	}
	members, err := normalizeConsoleProjectMembers(body)
	if err != nil {
		return nil, err
	}
	if err = replaceConsoleProjectMembers(ctx, session.tx, code, members); err != nil {
		return nil, err
	}
	result = map[string]any{"code": 0, "data": map[string]any{"projectCode": code}}
	err = finishConsoleMutation(ctx, session, "directory.project.create", "directory_project", code,
		map[string]any{"projectCode": code, "parentProjectCode": nullableConsoleText(parentCode), "memberCount": len(members)}, result)
	return result, err
}

func (a *Adapter) ConsoleUpdateProject(
	ctx context.Context,
	code string,
	body map[string]any,
	meta ConsoleMutationMeta,
) (result map[string]any, err error) {
	code = strings.TrimSpace(code)
	if code == "" || len(code) > 128 {
		return nil, httperror.New(http.StatusBadRequest, "directory_project_code_invalid", "Directory project code is invalid")
	}
	if err := rejectUnknownConsoleFields(body, consoleProjectFields); err != nil {
		return nil, err
	}
	session, replay, err := a.beginConsoleMutation(ctx, "directory.project.update", meta,
		map[string]any{"projectCode": code, "changes": body})
	if err != nil || replay != nil {
		return replay, err
	}
	defer func() {
		if err != nil {
			rollbackConsoleMutation(session)
		}
	}()
	var status string
	if err = session.tx.QueryRowContext(ctx, `SELECT status FROM directory_projects
		WHERE project_code=? FOR UPDATE`, code).Scan(&status); err != nil {
		if err == sql.ErrNoRows {
			return nil, httperror.New(http.StatusNotFound, "directory_project_not_found", "Directory project was not found")
		}
		return nil, err
	}
	if status == "deleted" {
		return nil, httperror.New(http.StatusNotFound, "directory_project_not_found", "Directory project was not found")
	}
	fields, args := make([]string, 0), make([]any, 0)
	if _, ok := body["projectName"]; ok || consoleNullableString(body["name"]) != "" {
		value := body["projectName"]
		if consoleNullableString(value) == "" {
			value = body["name"]
		}
		name, validationErr := requiredConsoleString(value, "project name")
		if validationErr != nil {
			return nil, validationErr
		}
		fields, args = append(fields, "project_name=?"), append(args, name)
	}
	if value, ok := body["parentProjectCode"]; ok {
		parent := consoleNullableString(value)
		if err = assertConsoleProjectParent(ctx, session.tx, parent, code); err != nil {
			return nil, err
		}
		fields, args = append(fields, "parent_project_code=?"), append(args, nullableConsoleText(parent))
	}
	if value, ok := body["projectType"]; ok {
		normalized, validationErr := enumConsoleValue(value, "project", []string{"group", "project", "template"}, "directory_project_type_invalid")
		if validationErr != nil {
			return nil, validationErr
		}
		fields, args = append(fields, "project_type=?"), append(args, normalized)
	}
	if value, ok := body["status"]; ok {
		normalized, validationErr := enumConsoleValue(value, "active", []string{"active", "inactive", "archived", "deleted"}, "directory_project_status_invalid")
		if validationErr != nil {
			return nil, validationErr
		}
		fields, args = append(fields, "status=?"), append(args, normalized)
	}
	for field, column := range map[string]string{"deptCode": "dept_code", "ownerUid": "owner_uid", "leaderUid": "leader_uid"} {
		if value, ok := body[field]; ok {
			normalized := consoleNullableString(value)
			if field == "deptCode" {
				err = assertConsoleDepartmentTx(ctx, session.tx, normalized)
			} else {
				err = assertConsoleUserTx(ctx, session.tx, normalized, field)
			}
			if err != nil {
				return nil, err
			}
			fields, args = append(fields, column+"=?"), append(args, nullableConsoleText(normalized))
		}
	}
	for field, column := range map[string]string{"repoUrl": "repo_url", "description": "description"} {
		if value, ok := body[field]; ok {
			fields, args = append(fields, column+"=?"), append(args, nullableConsoleText(consoleNullableString(value)))
		}
	}
	if len(fields) > 0 {
		fields = append(fields, "source_provider='manual'", "synced_at=UTC_TIMESTAMP()", "updated_at=UTC_TIMESTAMP()")
		args = append(args, code)
		if _, err = session.tx.ExecContext(ctx, "UPDATE directory_projects SET "+strings.Join(fields, ",")+" WHERE project_code=?", args...); err != nil {
			return nil, err
		}
	}
	if _, hasMembers := body["members"]; hasMembers {
		members, validationErr := normalizeConsoleProjectMembers(body)
		if validationErr != nil {
			return nil, validationErr
		}
		if err = replaceConsoleProjectMembers(ctx, session.tx, code, members); err != nil {
			return nil, err
		}
	} else if _, hasUIDs := body["memberUids"]; hasUIDs {
		members, validationErr := normalizeConsoleProjectMembers(body)
		if validationErr != nil {
			return nil, validationErr
		}
		if err = replaceConsoleProjectMembers(ctx, session.tx, code, members); err != nil {
			return nil, err
		}
	}
	result = map[string]any{"code": 0, "data": map[string]any{"projectCode": code}}
	err = finishConsoleMutation(ctx, session, "directory.project.update", "directory_project", code,
		map[string]any{"projectCode": code, "changedFields": sortedConsoleKeys(body)}, result)
	return result, err
}

func (a *Adapter) ConsoleDeleteProject(
	ctx context.Context,
	code string,
	meta ConsoleMutationMeta,
) (result map[string]any, err error) {
	code = strings.TrimSpace(code)
	if code == "" || len(code) > 128 {
		return nil, httperror.New(http.StatusBadRequest, "directory_project_code_invalid", "Directory project code is invalid")
	}
	session, replay, err := a.beginConsoleMutation(ctx, "directory.project.delete", meta, map[string]any{"projectCode": code})
	if err != nil || replay != nil {
		return replay, err
	}
	defer func() {
		if err != nil {
			rollbackConsoleMutation(session)
		}
	}()
	var status string
	if err = session.tx.QueryRowContext(ctx, `SELECT status FROM directory_projects
		WHERE project_code=? FOR UPDATE`, code).Scan(&status); err != nil {
		if err == sql.ErrNoRows {
			return nil, httperror.New(http.StatusNotFound, "directory_project_not_found", "Directory project was not found")
		}
		return nil, err
	}
	var children int
	if err = session.tx.QueryRowContext(ctx, `SELECT COUNT(*) FROM directory_projects
		WHERE parent_project_code=? AND status<>'deleted'`, code).Scan(&children); err != nil {
		return nil, err
	}
	if children > 0 {
		return nil, httperror.New(http.StatusBadRequest, "directory_project_has_children", "Directory project has children")
	}
	if _, err = session.tx.ExecContext(ctx, `UPDATE directory_project_members
		SET status='deleted',left_at=UTC_TIMESTAMP(),updated_at=UTC_TIMESTAMP()
		WHERE project_code=? AND status='active'`, code); err != nil {
		return nil, err
	}
	if _, err = session.tx.ExecContext(ctx, `UPDATE directory_projects
		SET status='deleted',source_provider='manual',synced_at=UTC_TIMESTAMP(),updated_at=UTC_TIMESTAMP()
		WHERE project_code=?`, code); err != nil {
		return nil, err
	}
	result = map[string]any{"code": 0, "data": map[string]any{"deleted": true}}
	err = finishConsoleMutation(ctx, session, "directory.project.delete", "directory_project", code,
		map[string]any{"projectCode": code}, result)
	return result, err
}

func (a *Adapter) ConsoleReplaceProjectMembers(
	ctx context.Context,
	code string,
	body map[string]any,
	meta ConsoleMutationMeta,
) (result map[string]any, err error) {
	code = strings.TrimSpace(code)
	if code == "" || len(code) > 128 {
		return nil, httperror.New(http.StatusBadRequest, "directory_project_code_invalid", "Directory project code is invalid")
	}
	members, err := normalizeConsoleProjectMembers(body)
	if err != nil {
		return nil, err
	}
	session, replay, err := a.beginConsoleMutation(ctx, "directory.project.members.replace", meta,
		map[string]any{"projectCode": code, "members": body})
	if err != nil || replay != nil {
		return replay, err
	}
	defer func() {
		if err != nil {
			rollbackConsoleMutation(session)
		}
	}()
	var lockedProjectCode string
	if err = session.tx.QueryRowContext(ctx, `SELECT project_code FROM directory_projects
		WHERE project_code=? AND status<>'deleted' FOR UPDATE`, code).Scan(&lockedProjectCode); errors.Is(err, sql.ErrNoRows) {
		return nil, httperror.New(http.StatusNotFound, "directory_project_not_found", "Directory project was not found")
	} else if err != nil {
		return nil, err
	}
	if err = replaceConsoleProjectMembers(ctx, session.tx, code, members); err != nil {
		return nil, err
	}
	result = map[string]any{"code": 0, "data": map[string]any{"projectCode": code, "memberCount": len(members)}}
	err = finishConsoleMutation(ctx, session, "directory.project.members.replace", "directory_project", code,
		map[string]any{"projectCode": code, "memberCount": len(members)}, result)
	return result, err
}

func normalizeConsoleProjectMembers(body map[string]any) ([]consoleProjectMember, error) {
	raw, ok := body["members"].([]any)
	if !ok {
		if uids, uidOK := body["memberUids"].([]any); uidOK {
			raw = make([]any, 0, len(uids))
			for _, uid := range uids {
				raw = append(raw, map[string]any{"uid": uid, "role": "member"})
			}
		}
	}
	result := make([]consoleProjectMember, 0, len(raw))
	seen := map[string]bool{}
	for _, item := range raw {
		entry, objectOK := item.(map[string]any)
		if !objectOK {
			if uid := consoleNullableString(item); uid != "" {
				entry = map[string]any{"uid": uid, "role": "member"}
			} else {
				continue
			}
		}
		uid := consoleNullableString(entry["uid"])
		if uid == "" {
			continue
		}
		role, err := enumConsoleValue(entry["role"], "member", []string{"owner", "admin", "member", "viewer"}, "directory_project_member_role_invalid")
		if err != nil {
			return nil, err
		}
		key := uid + ":" + role
		if seen[key] {
			continue
		}
		seen[key] = true
		result = append(result, consoleProjectMember{UID: uid, Role: role})
	}
	if len(result) > 100 {
		return nil, httperror.New(http.StatusBadRequest, "directory_batch_too_large", "Project members must not exceed 100")
	}
	return result, nil
}

func replaceConsoleProjectMembers(ctx context.Context, tx *sql.Tx, code string, members []consoleProjectMember) error {
	if _, err := tx.ExecContext(ctx, `UPDATE directory_project_members
		SET status='deleted',left_at=UTC_TIMESTAMP(),updated_at=UTC_TIMESTAMP()
		WHERE project_code=? AND status='active'`, code); err != nil {
		return err
	}
	for _, member := range members {
		if err := assertConsoleUserTx(ctx, tx, member.UID, "member"); err != nil {
			return err
		}
		if _, err := tx.ExecContext(ctx, `INSERT INTO directory_project_members
			(project_code,uid,member_role,source_provider,external_ref,joined_at,status,created_at,updated_at)
			VALUES (?,? ,?,'manual',?,UTC_TIMESTAMP(),'active',UTC_TIMESTAMP(),UTC_TIMESTAMP())
			ON DUPLICATE KEY UPDATE member_role=VALUES(member_role),source_provider='manual',
				external_ref=VALUES(external_ref),left_at=NULL,status='active',updated_at=UTC_TIMESTAMP()`,
			code, member.UID, member.Role, code+":"+member.UID+":"+member.Role); err != nil {
			return err
		}
	}
	return nil
}

func assertConsoleProjectParent(ctx context.Context, tx *sql.Tx, parentCode, selfCode string) error {
	if parentCode == "" {
		return nil
	}
	if parentCode == selfCode {
		return httperror.New(http.StatusBadRequest, "directory_project_parent_invalid", "Parent project cannot be itself")
	}
	current := parentCode
	for current != "" {
		var parent sql.NullString
		var status string
		if err := tx.QueryRowContext(ctx, `SELECT parent_project_code,status FROM directory_projects
			WHERE project_code=?`, current).Scan(&parent, &status); err != nil {
			if err == sql.ErrNoRows {
				return httperror.New(http.StatusBadRequest, "directory_project_parent_not_found", "Parent project does not exist")
			}
			return err
		}
		if status == "deleted" {
			return httperror.New(http.StatusBadRequest, "directory_project_parent_not_found", "Parent project does not exist")
		}
		if parent.Valid && parent.String == selfCode {
			return httperror.New(http.StatusBadRequest, "directory_project_parent_cycle", "Parent project cannot be a descendant")
		}
		current = parent.String
	}
	return nil
}
