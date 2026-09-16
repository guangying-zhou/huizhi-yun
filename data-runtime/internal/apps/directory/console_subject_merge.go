package directory

import (
	"context"
	"database/sql"
	"errors"
	"net/http"
	"strings"

	"github.com/huizhi-yun/data-runtime/internal/httperror"
)

// 遗留 dt-* 主体的受控归并（Console 侧）。
//
// dt-* 是钉钉同步在无法命中既有身份时合成的临时 UID。它已经是一个 active
// Directory 用户，因此归并必须按固定顺序执行：先停用旧主体切断新引用，
// 再迁移事实，最后重绑外部身份。顺序颠倒会让归并期间产生的新引用逃过检查。

// ConsoleMergePreview 返回归并前的只读对照，供管理员确认。
// 不做任何写入，也不返回密文、Token 或会话内容。
func (a *Adapter) ConsoleMergePreview(ctx context.Context, legacyUID, canonicalUID string) (map[string]any, error) {
	legacy := strings.TrimSpace(legacyUID)
	canonical := strings.TrimSpace(canonicalUID)
	if err := validateConsoleMergePair(legacy, canonical); err != nil {
		return nil, err
	}

	legacyUser, err := a.consoleMergeUserSummary(ctx, legacy)
	if err != nil {
		return nil, err
	}
	canonicalUser, err := a.consoleMergeUserSummary(ctx, canonical)
	if err != nil {
		return nil, err
	}
	if legacyUser == nil {
		return nil, httperror.New(http.StatusNotFound, "directory_merge_legacy_missing",
			"The legacy dt-* Directory user was not found")
	}
	if canonicalUser == nil {
		return nil, httperror.New(http.StatusNotFound, "directory_merge_canonical_missing",
			"The canonical Directory user does not exist yet")
	}

	identities, err := a.queryMergeRows(ctx, `SELECT provider_code,provider_subject,status
		FROM directory_identities WHERE uid=? AND status<>'deleted'`, legacy)
	if err != nil {
		return nil, err
	}
	memberships, err := a.queryMergeRows(ctx, `SELECT dept_code,CAST(is_primary AS CHAR),status
		FROM directory_user_departments WHERE uid=?`, legacy)
	if err != nil {
		return nil, err
	}
	// 同一外部主体已经绑定到 canonical UID 时无需重绑，属于正常的部分完成状态。
	conflicting, err := a.queryMergeRows(ctx, `SELECT di.provider_code,di.provider_subject,di.uid
		FROM directory_identities di
		WHERE di.status<>'deleted' AND di.uid=?
		  AND EXISTS (SELECT 1 FROM directory_identities other
			WHERE other.provider_code=di.provider_code
			  AND other.provider_subject=di.provider_subject
			  AND other.uid=? AND other.status<>'deleted')`, legacy, canonical)
	if err != nil {
		return nil, err
	}

	return map[string]any{
		"legacy":                 legacyUser,
		"canonical":              canonicalUser,
		"legacyIdentities":       identities,
		"legacyMemberships":      memberships,
		"alreadyBoundIdentities": conflicting,
	}, nil
}

// ConsoleMergeDirectorySubject 执行 Console 侧归并。
//
// 步骤固定为：停用旧主体 → 撤销旧会话 → 迁移部门归属 → 重绑外部身份。
// 先停用是为了切断归并期间可能产生的新引用；先撤销会话是为了让持有旧
// 主体登录态的浏览器立刻失效，而不是继续以已废弃的身份操作。
func (a *Adapter) ConsoleMergeDirectorySubject(
	ctx context.Context,
	legacyUID string,
	canonicalUID string,
	actor string,
	requestID string,
) (map[string]any, error) {
	legacy := strings.TrimSpace(legacyUID)
	canonical := strings.TrimSpace(canonicalUID)
	if err := validateConsoleMergePair(legacy, canonical); err != nil {
		return nil, err
	}
	if strings.TrimSpace(actor) == "" {
		return nil, httperror.New(http.StatusForbidden, "directory_merge_actor_required", "A verified actor is required")
	}

	tx, err := a.db.BeginTx(ctx, nil)
	if err != nil {
		return nil, err
	}
	defer func() { _ = tx.Rollback() }()

	var legacyStatus, canonicalStatus string
	if err = tx.QueryRowContext(ctx, `SELECT status FROM directory_users WHERE uid=? FOR UPDATE`, legacy).
		Scan(&legacyStatus); errors.Is(err, sql.ErrNoRows) {
		return nil, httperror.New(http.StatusNotFound, "directory_merge_legacy_missing",
			"The legacy dt-* Directory user was not found")
	} else if err != nil {
		return nil, err
	}
	if err = tx.QueryRowContext(ctx, `SELECT status FROM directory_users WHERE uid=? FOR UPDATE`, canonical).
		Scan(&canonicalStatus); errors.Is(err, sql.ErrNoRows) {
		return nil, httperror.New(http.StatusNotFound, "directory_merge_canonical_missing",
			"The canonical Directory user does not exist yet")
	} else if err != nil {
		return nil, err
	}
	if canonicalStatus == "deleted" {
		return nil, httperror.New(http.StatusConflict, "directory_merge_canonical_unusable",
			"The canonical Directory user is deleted and cannot receive the merge")
	}
	// 归并期间旧主体不得存在在途的 Connector 操作，否则回执会写回一个
	// 已经被停用的主体。
	var pending int
	if err = tx.QueryRowContext(ctx, `SELECT COUNT(*) FROM integration_operation
		WHERE source_biz_code=? AND status IN ('pending','processing','retry_wait','partial_unknown')`,
		legacy).Scan(&pending); err != nil {
		return nil, err
	}
	if pending > 0 {
		return nil, httperror.New(http.StatusConflict, "directory_merge_operations_in_flight",
			"The legacy subject still has in-flight operations; wait for them to settle before merging")
	}

	// 1. 停用旧主体，切断归并期间的新引用。
	if _, err = tx.ExecContext(ctx, `UPDATE directory_users
		SET status='inactive',updated_at=UTC_TIMESTAMP() WHERE uid=? AND status<>'deleted'`, legacy); err != nil {
		return nil, err
	}
	// 2. 撤销旧主体的会话与刷新令牌。
	if _, err = tx.ExecContext(ctx, `UPDATE auth_refresh_tokens rt
		INNER JOIN local_sessions ls ON ls.id=rt.session_id
		SET rt.status='revoked',rt.revoked_at=COALESCE(rt.revoked_at,UTC_TIMESTAMP())
		WHERE ls.uid=? AND rt.status IN ('active','rotated')`, legacy); err != nil {
		return nil, err
	}
	if _, err = tx.ExecContext(ctx, `UPDATE local_sessions
		SET status='revoked',revoked_at=COALESCE(revoked_at,UTC_TIMESTAMP()),updated_at=UTC_TIMESTAMP()
		WHERE uid=? AND status='active'`, legacy); err != nil {
		return nil, err
	}
	// 3. 合并部门归属。canonical 已有的归属优先保留，旧主体的多余行停用。
	if _, err = tx.ExecContext(ctx, `UPDATE IGNORE directory_user_departments
		SET uid=?,updated_at=UTC_TIMESTAMP() WHERE uid=?`, canonical, legacy); err != nil {
		return nil, err
	}
	// 状态取值受 ck_directory_user_departments_status 约束，只允许
	// active / inactive / deleted；离职语义的 'left' 会被 3819 拒绝。
	if _, err = tx.ExecContext(ctx, `UPDATE directory_user_departments
		SET status='inactive',left_at=COALESCE(left_at,UTC_TIMESTAMP()),updated_at=UTC_TIMESTAMP()
		WHERE uid=? AND status<>'inactive'`, legacy); err != nil {
		return nil, err
	}
	// 4. 重绑外部身份。canonical 已绑定同一主体时旧行停用，不制造重复绑定。
	if _, err = tx.ExecContext(ctx, `UPDATE IGNORE directory_identities
		SET uid=?,last_synced_at=UTC_TIMESTAMP(),updated_at=UTC_TIMESTAMP()
		WHERE uid=? AND status<>'deleted'`, canonical, legacy); err != nil {
		return nil, err
	}
	rebound, err := tx.ExecContext(ctx, `UPDATE directory_identities
		SET status='inactive',updated_at=UTC_TIMESTAMP() WHERE uid=? AND status<>'deleted'`, legacy)
	if err != nil {
		return nil, err
	}
	retired, _ := rebound.RowsAffected()

	if _, err = tx.ExecContext(ctx, `INSERT INTO operation_logs
		(domain_code,action,target_type,target_key,actor_type,actor_id,request_id,detail_json,created_at)
		VALUES ('directory','directory.subject.merge','directory_user',?,'human',?,?,
			JSON_OBJECT('legacyUid',?,'canonicalUid',?,'retiredIdentities',?),UTC_TIMESTAMP())`,
		canonical, strings.TrimSpace(actor), nullableConsoleText(requestID),
		legacy, canonical, retired); err != nil {
		return nil, err
	}
	// 导出必须使用当前事务；通过 a.db 的独立连接看不到尚未提交的停用和重绑。
	if err = rebuildUserSubjectExportsWith(ctx, tx); err != nil {
		return nil, err
	}
	if err = tx.Commit(); err != nil {
		return nil, err
	}
	return map[string]any{
		"legacyUid": legacy, "canonicalUid": canonical,
		"retiredLegacyIdentities": retired, "legacySubjectDisabled": true,
	}, nil
}

func validateConsoleMergePair(legacy, canonical string) error {
	if legacy == "" || canonical == "" {
		return httperror.New(http.StatusBadRequest, "directory_merge_uid_required",
			"Both the legacy and canonical UID are required")
	}
	if legacy == canonical {
		return httperror.New(http.StatusBadRequest, "directory_merge_same_uid",
			"The legacy and canonical UID must differ")
	}
	// 只允许把合成主体并入真实主体，不允许反向，也不允许在两个真实主体之间并。
	if !strings.HasPrefix(strings.ToLower(legacy), "dt-") {
		return httperror.New(http.StatusBadRequest, "directory_merge_legacy_not_synthetic",
			"Only a synthetic dt-* subject can be merged away")
	}
	if strings.HasPrefix(strings.ToLower(canonical), "dt-") {
		return httperror.New(http.StatusBadRequest, "directory_merge_canonical_synthetic",
			"A synthetic dt-* identifier cannot be the merge target")
	}
	return nil
}

func (a *Adapter) consoleMergeUserSummary(ctx context.Context, uid string) (map[string]any, error) {
	var username, displayName, email, status string
	var deptCode sql.NullString
	err := a.db.QueryRowContext(ctx, `SELECT COALESCE(username,''),COALESCE(display_name,''),
		COALESCE(email,''),status,primary_dept_code FROM directory_users WHERE uid=? LIMIT 1`, uid).
		Scan(&username, &displayName, &email, &status, &deptCode)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	return map[string]any{
		"uid": uid, "username": username, "displayName": displayName,
		"email": email, "status": status, "primaryDeptCode": deptCode.String,
	}, nil
}

func (a *Adapter) queryMergeRows(ctx context.Context, query string, args ...any) ([]map[string]any, error) {
	rows, err := a.db.QueryContext(ctx, query, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	columns, err := rows.Columns()
	if err != nil {
		return nil, err
	}
	result := make([]map[string]any, 0)
	for rows.Next() {
		values := make([]sql.NullString, len(columns))
		targets := make([]any, len(columns))
		for i := range values {
			targets[i] = &values[i]
		}
		if err := rows.Scan(targets...); err != nil {
			return nil, err
		}
		item := make(map[string]any, len(columns))
		for i, column := range columns {
			item[column] = values[i].String
		}
		result = append(result, item)
	}
	return result, rows.Err()
}
