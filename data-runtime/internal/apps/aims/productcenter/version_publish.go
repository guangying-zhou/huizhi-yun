package productcenter

import (
	"bytes"
	"context"
	"crypto/sha256"
	"database/sql"
	"encoding/hex"
	"encoding/json"
	"strconv"
	"strings"
	"unicode/utf8"

	"github.com/google/uuid"
	"github.com/huizhi-yun/data-runtime/internal/integrationoperation"
)

type ProductVersionPublishInput struct {
	VersionID               int64  `json:"version_id"`
	AcceptanceID            int64  `json:"acceptance_id"`
	ExpectedRevision        uint64 `json:"expected_revision"`
	ExpectedVersionRevision uint64 `json:"expected_version_revision"`
	ExpectedScopeRevision   uint64 `json:"expected_scope_revision"`
	Reason                  string `json:"reason"`
}

// Publication creates immutable evidence. Reopening requires a separate command;
// a correction appends a new record and an event, never edits earlier evidence.
func PublishProductVersion(ctx context.Context, db *sql.DB, identity CommandIdentity, permit AuthorizationPermit, input ProductVersionPublishInput, executionReviewHash ...string) (CommandResult, error) {
	return PublishProductVersionWithFeedback(ctx, db, identity, permit, input, integrationoperation.TrustedContext{}, executionReviewHash...)
}

// Runtime callers supply verified source context; it is not part of user input.
func PublishProductVersionWithFeedback(ctx context.Context, db *sql.DB, identity CommandIdentity, permit AuthorizationPermit, input ProductVersionPublishInput, trusted integrationoperation.TrustedContext, executionReviewHash ...string) (CommandResult, error) {
	return publishProductVersion(ctx, identity, permit, input, trusted, executionReviewHash, func(authorize AuthorizeCommand, apply ApplyCommand) (CommandResult, error) {
		return ExecuteCommand(ctx, db, identity, input, authorize, apply)
	})
}

// PublishProductVersionInTransaction leaves successful commit to the caller.
func PublishProductVersionInTransaction(ctx context.Context, tx *sql.Tx, identity CommandIdentity, permit AuthorizationPermit, input ProductVersionPublishInput, trusted integrationoperation.TrustedContext, executionReviewHash ...string) (CommandResult, error) {
	result, err := publishProductVersion(ctx, identity, permit, input, trusted, executionReviewHash, func(authorize AuthorizeCommand, apply ApplyCommand) (CommandResult, error) {
		return ExecuteCommandInTransaction(ctx, tx, identity, input, authorize, apply)
	})
	if err != nil && tx != nil {
		_ = tx.Rollback()
	}
	return result, err
}

func publishProductVersion(ctx context.Context, identity CommandIdentity, permit AuthorizationPermit, input ProductVersionPublishInput, trusted integrationoperation.TrustedContext, executionReviewHash []string, execute func(AuthorizeCommand, ApplyCommand) (CommandResult, error)) (CommandResult, error) {

	if identity.Action != "product_versions:publish" {
		return CommandResult{}, invalid("product_command_identity_invalid", "版本发布命令不匹配")
	}
	if input.VersionID <= 0 || input.AcceptanceID <= 0 || input.ExpectedRevision == 0 || input.ExpectedVersionRevision == 0 || input.ExpectedScopeRevision == 0 || !utf8.ValidString(input.Reason) || strings.TrimSpace(input.Reason) == "" || utf8.RuneCountInString(input.Reason) > 2000 || strings.ContainsRune(input.Reason, '\x00') {
		return CommandResult{}, invalid("product_version_publish_invalid", "版本发布参数无效")
	}
	return execute(func(ctx context.Context, tx *sql.Tx) error {
		return AuthorizeWorkspaceTransaction(ctx, tx, identity.ProductCode, identity.ActorUID, "product_versions", "publish", permit)
	}, func(ctx context.Context, tx *sql.Tx) (any, error) {
		root, err := loadWorkspace(ctx, tx, identity.ProductCode)
		if err != nil {
			return nil, err
		}
		if root.Status != "active" {
			return nil, invalid("product_archived", "产品已归档")
		}
		if root.Revision != input.ExpectedRevision {
			return nil, invalid("product_revision_conflict", "产品已变化，请刷新")
		}
		version, err := loadProductVersion(ctx, tx, identity.ProductCode, input.VersionID)
		if err != nil {
			return nil, err
		}
		if version.Revision != input.ExpectedVersionRevision || version.ScopeRevision != input.ExpectedScopeRevision {
			return nil, invalid("product_version_revision_conflict", "版本或范围已变化")
		}
		if (version.Status != "planning" && version.Status != "developing") || version.CurrentReleaseRecordID != nil {
			return nil, invalid("product_version_locked", "当前版本不能发布")
		}
		var actor, acceptedAt string
		var acceptanceScope uint64
		var checklist, exceptions json.RawMessage
		err = tx.QueryRowContext(ctx, `SELECT accepted_by,DATE_FORMAT(accepted_at,'%Y-%m-%dT%H:%i:%s.%fZ'),scope_revision,checklist,exceptions FROM product_version_acceptances WHERE id=? AND version_id=? FOR UPDATE`, input.AcceptanceID, version.ID).Scan(&actor, &acceptedAt, &acceptanceScope, &checklist, &exceptions)
		if err == sql.ErrNoRows {
			return nil, invalid("product_version_acceptance_not_found", "验收记录不存在")
		}
		if err != nil {
			return nil, err
		}
		if version.BusinessOwnerUID == nil || *version.BusinessOwnerUID != actor {
			return nil, invalid("product_version_owner_required", "发布所用验收必须由当前版本业务负责人提交")
		}
		if err := validateVersionOwnerTx(ctx, tx, identity.ProductCode, *version.BusinessOwnerUID); err != nil {
			return nil, err
		}
		if actor == identity.ActorUID {
			return nil, invalid("product_version_self_publish", "验收人与发布人必须不同")
		}
		var accepted struct {
			Version         int                      `json:"version"`
			ReviewedVersion ProductVersionRecord     `json:"reviewed_version"`
			Scopes          []VersionAcceptanceScope `json:"scope_snapshot"`
			Execution       VersionExecutionSnapshot `json:"execution_snapshot"`
		}
		if err = json.Unmarshal(checklist, &accepted); err != nil {
			return nil, err
		}
		if accepted.Version != 1 || acceptanceScope != version.ScopeRevision || accepted.ReviewedVersion.Revision+1 != version.Revision {
			return nil, invalid("product_version_acceptance_stale", "验收后版本已变化，请重新验收")
		}
		scopes, err := loadVersionAcceptanceScopes(ctx, tx, identity.ProductCode, version.ID)
		if err != nil {
			return nil, err
		}
		for _, scope := range scopes {
			if scope.Status != "delivered" && scope.Status != "deferred" {
				return nil, invalid("product_version_scope_unresolved", "范围尚未全部处理")
			}
		}
		execution, err := loadVersionExecution(ctx, tx, version.ID, scopes)
		if err != nil {
			return nil, err
		}
		if len(executionReviewHash) > 0 && executionReviewHash[0] != "" {
			checkedHash, err := versionAcceptanceReviewHash(version, scopes, execution)
			if err != nil {
				return nil, err
			}
			if checkedHash != executionReviewHash[0] {
				return nil, invalid("product_version_review_changed", "项目查看权限核验后的执行范围已变化，请重新核验")
			}
		}
		reviewed := version
		reviewed.Revision--
		currentHash, err := versionAcceptanceReviewHash(reviewed, scopes, execution)
		if err != nil {
			return nil, err
		}
		acceptedHash, err := versionAcceptanceReviewHash(accepted.ReviewedVersion, accepted.Scopes, accepted.Execution)
		if err != nil {
			return nil, err
		}
		if currentHash != acceptedHash {
			return nil, invalid("product_version_acceptance_stale", "验收后的范围或执行事实已变化，请重新验收")
		}
		var exceptionList []VersionAcceptanceException
		if err = json.Unmarshal(exceptions, &exceptionList); err != nil {
			return nil, err
		}
		if err = requireVersionExecutionExceptions(execution, exceptionList); err != nil {
			return nil, err
		}
		var priorRecordID any
		var previousID int64
		var previousSeq uint64
		releaseSeq := uint64(1)
		err = tx.QueryRowContext(ctx, `SELECT id,release_seq FROM product_release_records WHERE version_id=? ORDER BY release_seq DESC LIMIT 1 FOR UPDATE`, version.ID).Scan(&previousID, &previousSeq)
		if err != nil && err != sql.ErrNoRows {
			return nil, err
		}
		if err == nil {
			var withdrawn, superseded bool
			if err = tx.QueryRowContext(ctx, `SELECT EXISTS(SELECT 1 FROM product_release_events WHERE release_record_id=? AND event_type='withdrawn'),EXISTS(SELECT 1 FROM product_release_events WHERE release_record_id=? AND event_type='superseded')`, previousID, previousID).Scan(&withdrawn, &superseded); err != nil {
				return nil, err
			}
			if !withdrawn || superseded || previousSeq == ^uint64(0) {
				return nil, invalid("product_version_locked", "原发布记录尚未进入可更正状态")
			}
			priorRecordID = previousID
			releaseSeq = previousSeq + 1
		}

		features := []map[string]any{}
		for _, scope := range scopes {
			if scope.ProductFeatureBizID != nil {
				features = append(features, map[string]any{"product_feature_biz_id": *scope.ProductFeatureBizID, "status": scope.Status})
			}
		}
		scopeSnapshot, err := json.Marshal(map[string]any{"version": 1, "reviewed_version": version, "scopes": scopes, "features": features, "execution": execution})
		if err != nil {
			return nil, err
		}
		acceptanceSnapshot, err := json.Marshal(map[string]any{"acceptance_id": input.AcceptanceID, "accepted_by": actor, "accepted_at": acceptedAt, "checklist": checklist, "exceptions": exceptions})
		if err != nil {
			return nil, err
		}
		contentHash, err := versionReleaseContentHash(scopeSnapshot, acceptanceSnapshot)
		if err != nil {
			return nil, err
		}
		bizID := uuid.NewString()
		result, err := tx.ExecContext(ctx, `INSERT INTO product_release_records(biz_id,version_id,release_seq,scope_revision,scope_snapshot,acceptance_snapshot,content_hash,released_by,released_at,evidence_level,supersedes_record_id,recorded_at) VALUES(?,?,?,?,?,?,?,?,UTC_TIMESTAMP(3),'verified',?,UTC_TIMESTAMP(3))`, bizID, version.ID, releaseSeq, version.ScopeRevision, scopeSnapshot, acceptanceSnapshot, contentHash, identity.ActorUID, priorRecordID)
		if err != nil {
			return nil, err
		}
		recordID, err := result.LastInsertId()
		if err != nil {
			return nil, err
		}
		if priorRecordID != nil {
			if _, err = tx.ExecContext(ctx, `INSERT INTO product_release_events(release_record_id,event_type,actor_uid,reason,created_at) VALUES(?,'superseded',?,?,UTC_TIMESTAMP(3))`, previousID, identity.ActorUID, input.Reason); err != nil {
				return nil, err
			}
		}
		if _, err = tx.ExecContext(ctx, `UPDATE product_versions SET status='released',current_release_record_id=?,released_at=UTC_TIMESTAMP(3),revision=revision+1,updated_at=UTC_TIMESTAMP(3) WHERE id=?`, recordID, version.ID); err != nil {
			return nil, err
		}
		if _, err = tx.ExecContext(ctx, `UPDATE product_workspaces SET revision=revision+1,updated_by=?,updated_at=UTC_TIMESTAMP(3) WHERE product_code=?`, identity.ActorUID, identity.ProductCode); err != nil {
			return nil, err
		}
		out := map[string]any{"release_record_id": recordID, "release_biz_id": bizID, "version_id": version.ID, "product_code": identity.ProductCode, "status": "released", "content_hash": contentHash, "revision": version.Revision + 1, "workspace_revision": root.Revision + 1}
		if err := enqueueProductFeedbackProgressTx(ctx, tx, trusted, identity.ActorUID, identity.ProductCode, root.Revision+1); err != nil {
			return nil, err
		}
		changes, err := json.Marshal(map[string]any{"result": out, "reason": input.Reason, "acceptance_id": input.AcceptanceID})
		if err != nil {
			return nil, err
		}
		_, err = tx.ExecContext(ctx, `INSERT INTO product_activity_logs(product_code,object_type,object_id,action,actor_uid,revision,changes,request_id,created_at) VALUES(?,'version',?,'publish',?,?,?,?,UTC_TIMESTAMP(3))`, identity.ProductCode, strconv.FormatInt(version.ID, 10), identity.ActorUID, version.Revision+1, changes, identity.IdempotencyKey)
		return out, err
	})
}

// Normalize object key ordering, including nested objects, before hashing so
// MySQL JSON storage normalization does not change the verifiable digest.
func versionReleaseContentHash(scope, acceptance json.RawMessage) (string, error) {
	var scopeValue, acceptanceValue any
	scopeDecoder := json.NewDecoder(bytes.NewReader(scope))
	scopeDecoder.UseNumber()
	if err := scopeDecoder.Decode(&scopeValue); err != nil {
		return "", err
	}
	acceptanceDecoder := json.NewDecoder(bytes.NewReader(acceptance))
	acceptanceDecoder.UseNumber()
	if err := acceptanceDecoder.Decode(&acceptanceValue); err != nil {
		return "", err
	}
	content, err := json.Marshal(map[string]any{"scope": scopeValue, "acceptance": acceptanceValue})
	if err != nil {
		return "", err
	}
	digest := sha256.Sum256(content)
	return hex.EncodeToString(digest[:]), nil
}
