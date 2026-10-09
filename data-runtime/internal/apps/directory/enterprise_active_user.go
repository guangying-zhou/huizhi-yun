package directory

import (
	"context"
	"database/sql"
	"errors"
	"strings"

	"github.com/huizhi-yun/data-runtime/internal/httperror"
)

// EnterpriseActiveUser reports whether uid is a currently active Directory
// user of any user type. It answers who may be made the owner of a business
// object. Platform and client identities and built-in display users are not in
// directory_users and are therefore never active; they are also rejected by
// prefix before any query. A Directory failure is a fixed 503 and never a
// negative answer. Runtime-only typed read; callers perform it before opening
// their own business transaction.
func (a *Adapter) EnterpriseActiveUser(ctx context.Context, uid string) (bool, error) {
	unavailable := httperror.New(503, "directory_subject_status_unavailable", "Directory subject status unavailable")
	if a == nil || a.db == nil {
		return false, unavailable
	}
	lower := strings.ToLower(uid)
	if uid == "" || uid != strings.TrimSpace(uid) || lower == "system" || strings.HasPrefix(lower, "system:") || strings.HasPrefix(lower, "client:") {
		return false, nil
	}
	var actual, status string
	err := a.db.QueryRowContext(ctx, "SELECT uid,status FROM directory_users WHERE BINARY uid=BINARY ?", uid).Scan(&actual, &status)
	if errors.Is(err, sql.ErrNoRows) {
		return false, nil
	}
	if err != nil {
		return false, unavailable
	}
	return actual == uid && status == "active", nil
}
