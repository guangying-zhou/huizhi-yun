package productcenter

import (
	"context"
	"database/sql"
	"encoding/json"
	"github.com/huizhi-yun/data-runtime/internal/integrationoperation"
	"strconv"
	"strings"
	"unicode/utf8"
)

type ProductVersionReopenInput struct {
	VersionID               int64  `json:"version_id"`
	ReleaseRecordID         int64  `json:"release_record_id"`
	ExpectedRevision        uint64 `json:"expected_revision"`
	ExpectedVersionRevision uint64 `json:"expected_version_revision"`
	Reason                  string `json:"reason"`
}

func ReopenProductVersion(ctx context.Context, db *sql.DB, identity CommandIdentity, permit AuthorizationPermit, input ProductVersionReopenInput, sourceContext ...integrationoperation.TrustedContext) (CommandResult, error) {
	return reopenProductVersion(ctx, identity, permit, input, sourceContext, func(authorize AuthorizeCommand, apply ApplyCommand) (CommandResult, error) {
		return ExecuteCommand(ctx, db, identity, input, authorize, apply)
	})
}
func ReopenProductVersionInTransaction(ctx context.Context, tx *sql.Tx, identity CommandIdentity, permit AuthorizationPermit, input ProductVersionReopenInput, sourceContext ...integrationoperation.TrustedContext) (CommandResult, error) {
	result, err := reopenProductVersion(ctx, identity, permit, input, sourceContext, func(authorize AuthorizeCommand, apply ApplyCommand) (CommandResult, error) {
		return ExecuteCommandInTransaction(ctx, tx, identity, input, authorize, apply)
	})
	if err != nil && tx != nil {
		_ = tx.Rollback()
	}
	return result, err
}
func reopenProductVersion(ctx context.Context, identity CommandIdentity, permit AuthorizationPermit, input ProductVersionReopenInput, sourceContext []integrationoperation.TrustedContext, execute func(AuthorizeCommand, ApplyCommand) (CommandResult, error)) (CommandResult, error) {

	if identity.Action != "product_versions:reopen" {
		return CommandResult{}, invalid("product_command_identity_invalid", "版本更正命令不匹配")
	}
	if input.VersionID <= 0 || input.ReleaseRecordID <= 0 || input.ExpectedRevision == 0 || input.ExpectedVersionRevision == 0 || !utf8.ValidString(input.Reason) || strings.TrimSpace(input.Reason) == "" || utf8.RuneCountInString(input.Reason) > 2000 || strings.ContainsRune(input.Reason, '\x00') {
		return CommandResult{}, invalid("product_version_reopen_invalid", "更正需要原发布记录、修订号和原因")
	}
	return execute(func(ctx context.Context, tx *sql.Tx) error {
		return AuthorizeWorkspaceTransaction(ctx, tx, identity.ProductCode, identity.ActorUID, "product_versions", "reopen", permit)
	}, func(ctx context.Context, tx *sql.Tx) (any, error) {
		root, err := loadWorkspace(ctx, tx, identity.ProductCode)
		if err != nil {
			return nil, err
		}
		if root.Status != "active" {
			return nil, invalid("product_archived", "产品已归档")
		}
		if root.Revision != input.ExpectedRevision {
			return nil, invalid("product_revision_conflict", "产品已变化")
		}
		version, err := loadProductVersion(ctx, tx, identity.ProductCode, input.VersionID)
		if err != nil {
			return nil, err
		}
		if version.Revision != input.ExpectedVersionRevision {
			return nil, invalid("product_version_revision_conflict", "版本已变化")
		}
		if version.Status != "released" || version.CurrentReleaseRecordID == nil || *version.CurrentReleaseRecordID != input.ReleaseRecordID {
			return nil, invalid("product_version_locked", "只能更正当前已发布记录")
		}
		var recordID int64
		if err = tx.QueryRowContext(ctx, `SELECT id FROM product_release_records WHERE id=? AND version_id=? FOR UPDATE`, input.ReleaseRecordID, version.ID).Scan(&recordID); err != nil {
			return nil, err
		}
		var events int
		if err = tx.QueryRowContext(ctx, `SELECT COUNT(*) FROM product_release_events WHERE release_record_id=?`, recordID).Scan(&events); err != nil {
			return nil, err
		}
		if events != 0 {
			return nil, invalid("product_version_locked", "该发布记录已经撤回或更正")
		}
		if _, err = tx.ExecContext(ctx, `INSERT INTO product_release_events(release_record_id,event_type,actor_uid,reason,created_at) VALUES(?,'withdrawn',?,?,UTC_TIMESTAMP(3))`, recordID, identity.ActorUID, input.Reason); err != nil {
			return nil, err
		}
		if _, err = tx.ExecContext(ctx, `UPDATE product_versions SET status='developing',current_release_record_id=NULL,released_at=NULL,revision=revision+1,scope_revision=scope_revision+1,updated_at=UTC_TIMESTAMP(3) WHERE id=?`, version.ID); err != nil {
			return nil, err
		}
		if _, err = tx.ExecContext(ctx, `UPDATE product_workspaces SET revision=revision+1,updated_by=?,updated_at=UTC_TIMESTAMP(3) WHERE product_code=?`, identity.ActorUID, identity.ProductCode); err != nil {
			return nil, err
		}
		out := map[string]any{"version_id": version.ID, "release_record_id": recordID, "status": "developing", "revision": version.Revision + 1, "scope_revision": version.ScopeRevision + 1, "workspace_revision": root.Revision + 1}
		var trusted integrationoperation.TrustedContext
		if len(sourceContext) == 1 {
			trusted = sourceContext[0]
		}
		if err := enqueueProductFeedbackProgressTx(ctx, tx, trusted, identity.ActorUID, identity.ProductCode, root.Revision+1); err != nil {
			return nil, err
		}
		changes, err := json.Marshal(map[string]any{"result": out, "reason": input.Reason})
		if err != nil {
			return nil, err
		}
		_, err = tx.ExecContext(ctx, `INSERT INTO product_activity_logs(product_code,object_type,object_id,action,actor_uid,revision,changes,request_id,created_at) VALUES(?,'version',?,'reopen',?,?,?,?,UTC_TIMESTAMP(3))`, identity.ProductCode, strconv.FormatInt(version.ID, 10), identity.ActorUID, version.Revision+1, changes, identity.IdempotencyKey)
		return out, err
	})
}
