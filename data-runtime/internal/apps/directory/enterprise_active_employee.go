package directory

import (
	"context"
	"database/sql"
	"errors"
	"strings"

	"github.com/huizhi-yun/data-runtime/internal/httperror"
)

// EnterpriseActiveEmployee reports whether uid is currently an active employee
// subject. Directory is authoritative: an unknown uid, a non-employee subject
// or a non-active status is "not active". A Directory failure is a fixed 503
// and never a negative answer. Runtime-only typed read; callers perform it
// before opening their own business transaction.
func (a *Adapter) EnterpriseActiveEmployee(ctx context.Context, uid string) (bool, error) {
	unavailable := httperror.New(503, "directory_subject_status_unavailable", "Directory subject status unavailable")
	if a == nil || a.db == nil {
		return false, unavailable
	}
	if uid == "" || uid != strings.TrimSpace(uid) || strings.HasPrefix(uid, "system:") || strings.HasPrefix(uid, "client:") {
		return false, nil
	}
	var actual, status string
	var kind sql.NullString
	err := a.db.QueryRowContext(ctx, "SELECT uid,status,user_type FROM directory_users WHERE BINARY uid=BINARY ?", uid).Scan(&actual, &status, &kind)
	if errors.Is(err, sql.ErrNoRows) {
		return false, nil
	}
	if err != nil {
		return false, unavailable
	}
	return actual == uid && status == "active" && kind.String == "employee", nil
}
