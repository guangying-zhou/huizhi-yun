package directory

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"net/http"
	"sort"
	"strings"

	"github.com/huizhi-yun/data-runtime/internal/httperror"
)

var consoleDirectoryUserFields = map[string]bool{
	"uid": true, "username": true, "displayName": true, "realName": true,
	"nickname": true, "avatarUrl": true, "email": true, "mobile": true,
	"mobileTail4": true, "positionTitle": true, "gender": true,
	"primaryDeptCode": true, "userType": true, "status": true, "remark": true,
}

var consoleDirectoryAvatarFields = map[string]bool{
	"avatarPath":  true,
	"contentType": true,
	"size":        true,
}

func (a *Adapter) ConsoleUpdateOwnAvatar(
	ctx context.Context,
	body map[string]any,
	meta ConsoleMutationMeta,
) (result map[string]any, err error) {
	if err := rejectUnknownConsoleFields(body, consoleDirectoryAvatarFields); err != nil {
		return nil, err
	}
	uid := strings.TrimSpace(meta.ActorID)
	if uid == "" || len(uid) > 128 {
		return nil, httperror.New(http.StatusForbidden, "trusted_console_actor_required", "A trusted Console actor is required")
	}
	avatarPath := strings.TrimSpace(fmt.Sprint(body["avatarPath"]))
	if body["avatarPath"] == nil || avatarPath == "" || avatarPath == "<nil>" || len(avatarPath) > 512 {
		return nil, httperror.New(http.StatusBadRequest, "directory_avatar_path_invalid", "Avatar path is invalid")
	}
	contentType := strings.TrimSpace(fmt.Sprint(body["contentType"]))
	if contentType != "image/png" && contentType != "image/jpeg" && contentType != "image/webp" {
		return nil, httperror.New(http.StatusBadRequest, "directory_avatar_content_type_invalid", "Avatar content type is invalid")
	}
	size, ok := consolePositiveInt64(body["size"])
	if !ok || size > 3*1024*1024 {
		return nil, httperror.New(http.StatusBadRequest, "directory_avatar_size_invalid", "Avatar size is invalid")
	}
	payload := map[string]any{
		"uid": uid, "avatarPath": avatarPath, "contentType": contentType, "size": size,
	}
	session, replay, err := a.beginConsoleMutation(ctx, "directory.profile.avatar.update", meta, payload)
	if err != nil || replay != nil {
		return replay, err
	}
	defer func() {
		if err != nil {
			rollbackConsoleMutation(session)
		}
	}()
	update, err := session.tx.ExecContext(ctx, `UPDATE directory_users
		SET avatar_url=?,updated_at=UTC_TIMESTAMP()
		WHERE uid=? AND status='active'`, avatarPath, uid)
	if err != nil {
		return nil, err
	}
	affected, err := update.RowsAffected()
	if err != nil {
		return nil, err
	}
	if affected != 1 {
		return nil, httperror.New(http.StatusNotFound, "directory_user_not_active", "Current Directory user does not exist or is inactive")
	}
	result = map[string]any{"code": 0, "data": map[string]any{"avatar": avatarPath}}
	err = finishConsoleMutation(ctx, session, "directory.profile.avatar.update", "directory_user", uid,
		map[string]any{
			"uid": uid, "objectPath": avatarPath, "contentType": contentType, "size": size,
		}, result)
	return result, err
}

func (a *Adapter) ConsoleCreateUser(
	ctx context.Context,
	body map[string]any,
	meta ConsoleMutationMeta,
) (result map[string]any, err error) {
	uid, err := requiredConsoleString(body["uid"], "uid")
	if err != nil {
		return nil, err
	}
	if err := rejectUnknownConsoleFields(body, consoleDirectoryUserFields); err != nil {
		return nil, err
	}
	session, replay, err := a.beginConsoleMutation(ctx, "directory.user.create", meta, body)
	if err != nil || replay != nil {
		return replay, err
	}
	defer func() {
		if err != nil {
			rollbackConsoleMutation(session)
		}
	}()
	var exists int
	if err = session.tx.QueryRowContext(ctx, "SELECT COUNT(*) FROM directory_users WHERE uid=?", uid).Scan(&exists); err != nil {
		return nil, err
	}
	if exists > 0 {
		return nil, httperror.New(http.StatusConflict, "directory_user_exists", "Directory user already exists")
	}
	primaryDept := consoleNullableString(body["primaryDeptCode"])
	if err = assertConsoleDepartmentTx(ctx, session.tx, primaryDept); err != nil {
		return nil, err
	}
	realName := consoleNullableString(body["realName"])
	displayName := consoleNullableString(body["displayName"])
	if displayName == "" {
		displayName = realName
	}
	if displayName == "" {
		displayName = uid
	}
	mobile := consoleNullableString(body["mobile"])
	gender, err := enumConsoleValue(body["gender"], "unknown", []string{"unknown", "male", "female"}, "directory_gender_invalid")
	if err != nil {
		return nil, err
	}
	userType, err := enumConsoleValue(body["userType"], "employee", []string{"system", "employee", "external", "service"}, "directory_user_type_invalid")
	if err != nil {
		return nil, err
	}
	status, err := enumConsoleValue(body["status"], "active", []string{"active", "inactive", "pending", "deleted"}, "directory_user_status_invalid")
	if err != nil {
		return nil, err
	}
	if _, err = session.tx.ExecContext(ctx, `INSERT INTO directory_users
		(uid,username,display_name,real_name,nickname,avatar_url,email,mobile,mobile_tail4,
		 position_title,gender,primary_dept_code,user_type,source_provider,external_ref,
		 synced_at,status,remark,created_at,updated_at)
		VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,'manual',?,UTC_TIMESTAMP(),?,?,UTC_TIMESTAMP(),UTC_TIMESTAMP())`,
		uid, nullableConsoleText(consoleNullableString(body["username"])), displayName,
		nullableConsoleText(realName), nullableConsoleText(consoleNullableString(body["nickname"])),
		nullableConsoleText(consoleNullableString(body["avatarUrl"])),
		nullableConsoleText(consoleNullableString(body["email"])), nullableConsoleText(mobile),
		nullableConsoleText(consoleMobileTail4(mobile, consoleNullableString(body["mobileTail4"]))),
		nullableConsoleText(consoleNullableString(body["positionTitle"])), gender,
		nullableConsoleText(primaryDept), userType, uid, status,
		nullableConsoleText(consoleNullableString(body["remark"]))); err != nil {
		return nil, err
	}
	if err = writeConsolePrimaryDepartment(ctx, session.tx, uid, primaryDept); err != nil {
		return nil, err
	}
	if err = upsertConsoleUserSubject(ctx, session.tx, uid); err != nil {
		return nil, err
	}
	result = map[string]any{"code": 0, "data": map[string]any{"uid": uid}}
	err = finishConsoleMutation(ctx, session, "directory.user.create", "directory_user", uid,
		map[string]any{"uid": uid, "primaryDeptCode": nullableConsoleText(primaryDept)}, result)
	return result, err
}

func (a *Adapter) ConsoleUpdateUser(
	ctx context.Context,
	uid string,
	body map[string]any,
	meta ConsoleMutationMeta,
) (result map[string]any, err error) {
	uid = strings.TrimSpace(uid)
	if uid == "" || len(uid) > 128 {
		return nil, httperror.New(http.StatusBadRequest, "directory_uid_invalid", "Directory uid is invalid")
	}
	if err := rejectUnknownConsoleFields(body, consoleDirectoryUserFields); err != nil {
		return nil, err
	}
	payload := map[string]any{"uid": uid, "changes": body}
	session, replay, err := a.beginConsoleMutation(ctx, "directory.user.update", meta, payload)
	if err != nil || replay != nil {
		return replay, err
	}
	defer func() {
		if err != nil {
			rollbackConsoleMutation(session)
		}
	}()
	var lockedUID string
	var sourceProvider sql.NullString
	if err = session.tx.QueryRowContext(ctx, "SELECT uid,source_provider FROM directory_users WHERE uid=? FOR UPDATE", uid).Scan(&lockedUID, &sourceProvider); errors.Is(err, sql.ErrNoRows) {
		return nil, httperror.New(http.StatusNotFound, "directory_user_not_found", "Directory user was not found")
	} else if err != nil {
		return nil, err
	}
	peopleOwned := strings.EqualFold(sourceProvider.String, "people") || strings.EqualFold(sourceProvider.String, "hr")
	if peopleOwned && consolePeopleAuthoritativeUserMutation(body) {
		return nil, httperror.New(http.StatusConflict, "people_user_field_managed", "People-managed employee fields are read-only in Console")
	}
	fields := make([]string, 0)
	args := make([]any, 0)
	setNullable := func(column, field string) {
		if value, ok := body[field]; ok {
			fields = append(fields, column+"=?")
			args = append(args, nullableConsoleText(consoleNullableString(value)))
		}
	}
	setNullable("username", "username")
	setNullable("display_name", "displayName")
	setNullable("real_name", "realName")
	setNullable("nickname", "nickname")
	setNullable("avatar_url", "avatarUrl")
	setNullable("email", "email")
	setNullable("position_title", "positionTitle")
	setNullable("remark", "remark")
	if value, ok := body["mobile"]; ok {
		mobile := consoleNullableString(value)
		fields = append(fields, "mobile=?", "mobile_tail4=?")
		args = append(args, nullableConsoleText(mobile),
			nullableConsoleText(consoleMobileTail4(mobile, consoleNullableString(body["mobileTail4"]))))
	} else {
		setNullable("mobile_tail4", "mobileTail4")
	}
	if value, ok := body["gender"]; ok {
		normalized, validationErr := enumConsoleValue(value, "unknown", []string{"unknown", "male", "female"}, "directory_gender_invalid")
		if validationErr != nil {
			return nil, validationErr
		}
		fields, args = append(fields, "gender=?"), append(args, normalized)
	}
	if value, ok := body["userType"]; ok {
		normalized, validationErr := enumConsoleValue(value, "employee", []string{"system", "employee", "external", "service"}, "directory_user_type_invalid")
		if validationErr != nil {
			return nil, validationErr
		}
		fields, args = append(fields, "user_type=?"), append(args, normalized)
	}
	if value, ok := body["status"]; ok {
		normalized, validationErr := enumConsoleValue(value, "active", []string{"active", "inactive", "pending", "deleted"}, "directory_user_status_invalid")
		if validationErr != nil {
			return nil, validationErr
		}
		fields, args = append(fields, "status=?"), append(args, normalized)
	}
	primaryDept, hasPrimaryDept := body["primaryDeptCode"]
	primaryCode := consoleNullableString(primaryDept)
	if hasPrimaryDept {
		if err = assertConsoleDepartmentTx(ctx, session.tx, primaryCode); err != nil {
			return nil, err
		}
		fields, args = append(fields, "primary_dept_code=?"), append(args, nullableConsoleText(primaryCode))
	}
	if len(fields) > 0 {
		if !peopleOwned {
			fields = append(fields, "source_provider='manual'")
		}
		fields = append(fields, "synced_at=UTC_TIMESTAMP()", "updated_at=UTC_TIMESTAMP()")
		args = append(args, uid)
		if _, err = session.tx.ExecContext(ctx, "UPDATE directory_users SET "+strings.Join(fields, ",")+" WHERE uid=?", args...); err != nil {
			return nil, err
		}
	}
	if hasPrimaryDept {
		if err = writeConsolePrimaryDepartment(ctx, session.tx, uid, primaryCode); err != nil {
			return nil, err
		}
	}
	if err = upsertConsoleUserSubject(ctx, session.tx, uid); err != nil {
		return nil, err
	}
	result = map[string]any{"code": 0, "data": map[string]any{"uid": uid}}
	err = finishConsoleMutation(ctx, session, "directory.user.update", "directory_user", uid,
		map[string]any{"uid": uid, "changedFields": sortedConsoleKeys(body)}, result)
	return result, err
}

func consolePeopleAuthoritativeUserMutation(body map[string]any) bool {
	for _, field := range []string{"displayName", "realName", "nickname", "email", "mobile", "mobileTail4", "positionTitle", "primaryDeptCode", "userType"} {
		if _, present := body[field]; present {
			return true
		}
	}
	if value, present := body["status"]; present {
		status := strings.ToLower(strings.TrimSpace(fmt.Sprint(value)))
		return status != "inactive" && status != "deleted"
	}
	return false
}

func writeConsolePrimaryDepartment(ctx context.Context, tx *sql.Tx, uid, deptCode string) error {
	if deptCode == "" {
		_, err := tx.ExecContext(ctx, `UPDATE directory_user_departments
			SET is_primary=0,updated_at=UTC_TIMESTAMP()
			WHERE uid=? AND relation_type='member'`, uid)
		return err
	}
	if _, err := tx.ExecContext(ctx, `UPDATE directory_user_departments
		SET is_primary=0,updated_at=UTC_TIMESTAMP()
		WHERE uid=? AND relation_type='member' AND dept_code<>?`, uid, deptCode); err != nil {
		return err
	}
	_, err := tx.ExecContext(ctx, `INSERT INTO directory_user_departments
		(uid,dept_code,relation_type,is_primary,source_provider,external_ref,status,created_at,updated_at)
		VALUES (?,?,'member',1,'manual',?,'active',UTC_TIMESTAMP(),UTC_TIMESTAMP())
		ON DUPLICATE KEY UPDATE is_primary=1,status='active',left_at=NULL,updated_at=UTC_TIMESTAMP()`,
		uid, deptCode, uid+":"+deptCode+":member")
	return err
}

func upsertConsoleUserSubject(ctx context.Context, tx *sql.Tx, uid string) error {
	_, err := tx.ExecContext(ctx, `INSERT INTO directory_subject_exports
		(subject_type,subject_code,external_ref,parent_subject_type,parent_subject_code,
		 source_object_type,source_object_code,snapshot_hash,status,exported_at,created_at,updated_at)
		SELECT 'user',u.uid,SHA2(CONCAT('console:user:',u.uid),256),
			CASE WHEN pd.dept_code IS NULL THEN NULL ELSE 'department' END,pd.dept_code,
			'directory_users',u.uid,
			SHA2(CONCAT_WS('|','user',u.uid,COALESCE(pd.dept_code,''),u.status),256),
			CASE WHEN u.status='pending' THEN 'inactive' ELSE u.status END,
			UTC_TIMESTAMP(),UTC_TIMESTAMP(),UTC_TIMESTAMP()
		FROM directory_users u
		LEFT JOIN (
			SELECT ranked.uid,ranked.dept_code FROM (
				SELECT ud.uid,ud.dept_code,ROW_NUMBER() OVER (
					PARTITION BY ud.uid ORDER BY ud.is_primary DESC,d.sort_order ASC,d.id ASC,ud.id ASC
				) row_no
				FROM directory_user_departments ud
				INNER JOIN directory_departments d ON d.dept_code=ud.dept_code
				WHERE ud.status='active' AND ud.relation_type='member'
					AND d.status='active' AND d.org_type='department' AND ud.uid=?
			) ranked WHERE ranked.row_no=1
		) pd ON pd.uid=u.uid
		WHERE u.uid=?
		ON DUPLICATE KEY UPDATE external_ref=VALUES(external_ref),
			parent_subject_type=VALUES(parent_subject_type),parent_subject_code=VALUES(parent_subject_code),
			snapshot_hash=VALUES(snapshot_hash),status=VALUES(status),
			exported_at=VALUES(exported_at),updated_at=VALUES(updated_at)`, uid, uid)
	return err
}

func assertConsoleDepartmentTx(ctx context.Context, tx *sql.Tx, deptCode string) error {
	if deptCode == "" {
		return nil
	}
	var count int
	if err := tx.QueryRowContext(ctx, `SELECT COUNT(*) FROM directory_departments
		WHERE dept_code=? AND status<>'deleted'`, deptCode).Scan(&count); err != nil {
		return err
	}
	if count == 0 {
		return httperror.New(http.StatusBadRequest, "directory_department_not_found",
			fmt.Sprintf("Primary department does not exist: %s", deptCode))
	}
	return nil
}

func requiredConsoleString(value any, label string) (string, error) {
	result := strings.TrimSpace(fmt.Sprint(value))
	if value == nil || result == "" || result == "<nil>" || len(result) > 128 {
		return "", httperror.New(http.StatusBadRequest, "directory_field_invalid", label+" is required")
	}
	return result, nil
}

func consoleNullableString(value any) string {
	if value == nil {
		return ""
	}
	return strings.TrimSpace(fmt.Sprint(value))
}

func consoleMobileTail4(mobile, explicit string) string {
	value := explicit
	if value == "" {
		value = mobile
	}
	runes := []rune(value)
	if len(runes) > 4 {
		runes = runes[len(runes)-4:]
	}
	return string(runes)
}

func consolePositiveInt64(value any) (int64, bool) {
	switch typed := value.(type) {
	case float64:
		integer := int64(typed)
		return integer, typed == float64(integer) && integer > 0
	case int:
		return int64(typed), typed > 0
	case int64:
		return typed, typed > 0
	default:
		return 0, false
	}
}

func enumConsoleValue(value any, fallback string, allowed []string, code string) (string, error) {
	result := consoleNullableString(value)
	if result == "" {
		result = fallback
	}
	for _, candidate := range allowed {
		if result == candidate {
			return result, nil
		}
	}
	return "", httperror.New(http.StatusBadRequest, code, "Directory enum value is invalid")
}

func rejectUnknownConsoleFields(body map[string]any, allowed map[string]bool) error {
	for key := range body {
		if !allowed[key] {
			return httperror.New(http.StatusBadRequest, "directory_field_unknown", "Unknown Directory field: "+key)
		}
	}
	return nil
}

func sortedConsoleKeys(body map[string]any) []string {
	keys := make([]string, 0, len(body))
	for key := range body {
		keys = append(keys, key)
	}
	// A stable audit detail also makes idempotency evidence easier to compare.
	sort.Strings(keys)
	return keys
}
