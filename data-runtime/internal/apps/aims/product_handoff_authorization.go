package aims

import (
	"context"
	"database/sql"
	"net/http"
	"strings"
	"unicode"
	"unicode/utf8"

	"github.com/huizhi-yun/data-runtime/internal/apps/aims/productcenter"
	"github.com/huizhi-yun/data-runtime/internal/httperror"
)

type productHandoffProjectFacts struct {
	ProjectID      int64  `json:"project_id"`
	ProjectCode    string `json:"project_code"`
	ActorUID       string `json:"actor_uid"`
	DepartmentCode string `json:"department_code"`
	LeaderUID      string `json:"leader_uid"`
	CreatedBy      string `json:"created_by"`
	IsMember       bool   `json:"is_member"`
}
type productHandoffProjectPermit struct {
	Resource  string                     `json:"resource"`
	Action    string                     `json:"action"`
	Facts     productHandoffProjectFacts `json:"facts"`
	ExpiresAt int64                      `json:"expires_at"`
}

func loadProductHandoffProjectFacts(ctx context.Context, q productcenter.AuthorizationQuery, projectCode, uid string) (productHandoffProjectFacts, error) {
	var out productHandoffProjectFacts
	for _, value := range []string{projectCode, uid} {
		if value == "" || value != strings.TrimSpace(value) || !utf8.ValidString(value) || utf8.RuneCountInString(value) > 64 || strings.IndexFunc(value, unicode.IsControl) >= 0 {
			return out, httperror.New(http.StatusBadRequest, "planning_handoff_project_invalid", "项目或用户标识无效")
		}
	}
	err := q.QueryRowContext(ctx, `SELECT p.id,p.project_code,COALESCE(p.dept_code,''),COALESCE(p.leader_uid,''),COALESCE(p.created_by,''),EXISTS(SELECT 1 FROM aims_project_members m WHERE m.project_id=p.id AND m.uid=? AND m.status='active') FROM aims_projects p WHERE p.project_code=?`, uid, projectCode).Scan(&out.ProjectID, &out.ProjectCode, &out.DepartmentCode, &out.LeaderUID, &out.CreatedBy, &out.IsMember)
	if err != nil {
		return out, err
	}
	out.ActorUID = uid
	return out, nil
}

// The internal service boundary authenticates this BFF-produced permission.
// No roles are interpreted here: only the exact Foundation decision facts are
// rechecked, with project and actor-membership rows locked before receipt read.
func authorizeProductHandoffProjectTx(ctx context.Context, tx *sql.Tx, code, uid string, permit productHandoffProjectPermit) (int64, error) {
	reject := func(key, message string) (int64, error) { return 0, httperror.New(http.StatusForbidden, key, message) }
	if permit.Resource != "requirements" || permit.Action != "edit" || permit.Facts.ProjectCode != code || permit.Facts.ActorUID != uid || permit.Facts.ProjectID <= 0 {
		return reject("planning_handoff_project_authorization_invalid", "项目授权上下文不匹配")
	}
	var projectID int64
	if err := tx.QueryRowContext(ctx, `SELECT id FROM aims_projects WHERE project_code=? FOR UPDATE`, code).Scan(&projectID); err != nil {
		return 0, err
	}
	rows, err := tx.QueryContext(ctx, `SELECT id FROM aims_project_members WHERE project_id=? AND uid=? FOR UPDATE`, projectID, uid)
	if err != nil {
		return 0, err
	}
	for rows.Next() {
		var id int64
		if err = rows.Scan(&id); err != nil {
			rows.Close()
			return 0, err
		}
	}
	err = rows.Err()
	rows.Close()
	if err != nil {
		return 0, err
	}
	var now int64
	if err = tx.QueryRowContext(ctx, `SELECT CAST(UNIX_TIMESTAMP(CURRENT_TIMESTAMP(3))*1000 AS SIGNED)`).Scan(&now); err != nil {
		return 0, err
	}
	if permit.ExpiresAt <= now || permit.ExpiresAt > now+30000 {
		return reject("planning_handoff_project_authorization_expired", "项目授权已过期，请重试")
	}
	facts, err := loadProductHandoffProjectFacts(ctx, tx, code, uid)
	if err != nil {
		return 0, err
	}
	if facts != permit.Facts {
		return reject("planning_handoff_project_authorization_changed", "项目范围或成员关系已变化，请重新授权")
	}
	return projectID, nil
}
