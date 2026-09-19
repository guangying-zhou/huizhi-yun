package productcenter

import (
	"context"
	"database/sql"
	"encoding/json"
	"github.com/google/uuid"
	"strings"
	"unicode/utf8"
)

// RequestDraft excludes decisions and delivery links; those require separate commands.
type RequestDraft struct {
	// ComponentID is nil for the legacy unclassified create path. A zero value
	// explicitly clears component ownership when used by RequestEdit.
	ComponentID      *int64 `json:"component_id,omitempty"`
	ExpectedRevision uint64 `json:"expected_revision"`
	Title            string `json:"title"`
	ProblemStatement string `json:"problem_statement"`
	SourceType       string `json:"source_type"`
	UrgencyLevel     string `json:"urgency_level"`
}

func ValidateRequestDraft(input RequestDraft) error {
	if input.ExpectedRevision == 0 {
		return invalid("product_revision_required", "必须提供产品空间版本号")
	}
	for _, f := range []struct {
		value string
		max   int
	}{{input.Title, 500}, {input.ProblemStatement, 10000}} {
		if !utf8.ValidString(f.value) || strings.TrimSpace(f.value) == "" || utf8.RuneCountInString(f.value) > f.max || strings.ContainsRune(f.value, '\x00') {
			return invalid("product_request_fields_invalid", "需求标题和问题说明必填，且不得超出长度限制")
		}
	}
	switch input.SourceType {
	case "customer", "internal", "engineering", "other":
	default:
		return invalid("product_request_source_invalid", "需求来源类型无效")
	}
	switch input.UrgencyLevel {
	case "P0", "P1", "P2", "P3":
	default:
		return invalid("product_request_urgency_invalid", "需求紧急程度无效")
	}
	return nil
}
func CreateProductRequest(ctx context.Context, db *sql.DB, identity CommandIdentity, permit AuthorizationPermit, input RequestDraft) (CommandResult, error) {
	return createProductRequest(ctx, identity, permit, input, func(authorize AuthorizeCommand, apply ApplyCommand) (CommandResult, error) {
		return ExecuteCommand(ctx, db, identity, input, authorize, apply)
	})
}

// CreateProductRequestInTransaction is the same owning-domain operation for a
// coordinated Runtime transaction. The caller owns the final commit.
func CreateProductRequestInTransaction(ctx context.Context, tx *sql.Tx, identity CommandIdentity, permit AuthorizationPermit, input RequestDraft) (CommandResult, error) {
	result, err := createProductRequest(ctx, identity, permit, input, func(authorize AuthorizeCommand, apply ApplyCommand) (CommandResult, error) {
		return ExecuteCommandInTransaction(ctx, tx, identity, input, authorize, apply)
	})
	if err != nil && tx != nil {
		_ = tx.Rollback()
	}
	return result, err
}

func createProductRequest(ctx context.Context, identity CommandIdentity, permit AuthorizationPermit, input RequestDraft, execute func(AuthorizeCommand, ApplyCommand) (CommandResult, error)) (CommandResult, error) {
	if identity.Action != "product_requests:create" {
		return CommandResult{}, invalid("product_command_identity_invalid", "需求创建命令不匹配")
	}
	if err := ValidateRequestDraft(input); err != nil {
		return CommandResult{}, err
	}
	return execute(func(ctx context.Context, tx *sql.Tx) error {
		return AuthorizeWorkspaceTransaction(ctx, tx, identity.ProductCode, identity.ActorUID, "product_requests", "create", permit)
	}, func(ctx context.Context, tx *sql.Tx) (any, error) {
		root, err := loadWorkspace(ctx, tx, identity.ProductCode)
		if err != nil {
			return nil, err
		}
		if root.Status != "active" {
			return nil, invalid("product_archived", "产品空间已归档，请先恢复")
		}
		if root.Revision != input.ExpectedRevision {
			return nil, invalid("product_revision_conflict", "产品空间已变化，请刷新后重试")
		}
		bizID := uuid.NewString()
		if err := validateRequestComponentTx(ctx, tx, identity.ProductCode, input.ComponentID); err != nil {
			return nil, err
		}
		result, err := tx.ExecContext(ctx, `INSERT INTO product_requests(biz_id,product_code,component_id,title,problem_statement,source_type,urgency_level,decision_status,revision,created_by,updated_by,created_at,updated_at) VALUES (?,?,?,?,?,?,?,'submitted',1,?,?,UTC_TIMESTAMP(3),UTC_TIMESTAMP(3))`, bizID, identity.ProductCode, nullableRequestComponent(input.ComponentID), input.Title, input.ProblemStatement, input.SourceType, input.UrgencyLevel, identity.ActorUID, identity.ActorUID)
		if err != nil {
			return nil, err
		}
		id, err := result.LastInsertId()
		if err != nil {
			return nil, err
		}
		_, err = tx.ExecContext(ctx, `UPDATE product_workspaces SET revision=revision+1,updated_by=?,updated_at=UTC_TIMESTAMP(3) WHERE product_code=?`, identity.ActorUID, identity.ProductCode)
		if err != nil {
			return nil, err
		}
		value := map[string]any{"id": id, "biz_id": bizID, "product_code": identity.ProductCode, "component_id": nullableRequestComponent(input.ComponentID), "title": input.Title, "problem_statement": input.ProblemStatement, "source_type": input.SourceType, "urgency_level": input.UrgencyLevel, "decision_status": "submitted", "revision": 1, "workspace_revision": root.Revision + 1}
		changes, err := json.Marshal(map[string]any{"after": value})
		if err != nil {
			return nil, err
		}
		_, err = tx.ExecContext(ctx, `INSERT INTO product_activity_logs(product_code,object_type,object_id,action,actor_uid,revision,changes,request_id,created_at) VALUES (?,'request',?,'create',?,1,?,?,UTC_TIMESTAMP(3))`, identity.ProductCode, bizID, identity.ActorUID, changes, identity.IdempotencyKey)
		return value, err
	})
}
