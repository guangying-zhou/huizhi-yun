package directory

import (
	"context"
	"database/sql"
	"errors"
	"github.com/huizhi-yun/data-runtime/internal/httperror"
	"regexp"
)

// Read the exact frozen revision, never the latest unrelated employment event.
// This method projects metadata only and cannot replay or mutate either owner.
func (a *Adapter) ConsoleReadLifecycleCommandStatus(ctx context.Context, uid, kind, hash string, revision uint64) (map[string]any, error) {
	if !regexp.MustCompile(`^[A-Za-z0-9][A-Za-z0-9._@-]{0,63}$`).MatchString(uid) || !regexp.MustCompile(`^[a-f0-9]{64}$`).MatchString(hash) || revision == 0 || revision == ^uint64(0) || (kind != "employment" && kind != "offboarding") {
		return nil, httperror.New(400, "directory_status_input_invalid", "Exact lifecycle identity required")
	}
	tx, e := a.db.BeginTx(ctx, &sql.TxOptions{ReadOnly: true, Isolation: sql.LevelRepeatableRead})
	if e != nil {
		return nil, e
	}
	defer tx.Rollback()
	out := map[string]any{"directoryStatus": "pending", "platformStatus": "unknown", "lifecycleType": kind}
	var applied uint64
	var storedHash, storedKind string
	e = tx.QueryRowContext(ctx, "SELECT applied_revision,snapshot_hash,lifecycle_type FROM directory_lifecycle_scope_versions WHERE BINARY employee_uid=BINARY ?", uid).Scan(&applied, &storedHash, &storedKind)
	if e != nil && !errors.Is(e, sql.ErrNoRows) {
		return nil, e
	}
	if e == nil {
		if applied == revision && storedHash == hash && storedKind == kind {
			out["directoryStatus"] = "succeeded"
		} else if applied > revision {
			out["directoryStatus"] = "superseded"
		} else if applied == revision {
			return nil, httperror.New(409, "directory_revision_conflict", "Lifecycle revision differs")
		}
	}
	code := consoleEmploymentPlatformOperation
	if kind == "offboarding" {
		code = consoleOffboardingPlatformOperation
	}
	var status string
	e = tx.QueryRowContext(ctx, "SELECT status FROM integration_operation WHERE tenant_code=? AND source_app='console' AND target_app='platform' AND operation_code=? AND BINARY source_biz_code=BINARY ? AND BINARY operation_key=BINARY ?", a.tenant, code, uid, consoleLifecyclePlatformKey(uid, revision)).Scan(&status)
	if e != nil && !errors.Is(e, sql.ErrNoRows) {
		return nil, e
	}
	if e == nil {
		out["platformStatus"] = status
	}
	if e = tx.Commit(); e != nil {
		return nil, e
	}
	return out, nil
}
