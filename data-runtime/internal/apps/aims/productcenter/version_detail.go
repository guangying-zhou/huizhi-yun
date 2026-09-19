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

type ProductVersionDetail struct {
	ProductVersionRecord
	WorkspaceRevision uint64 `json:"workspace_revision"`
}

// The version root is locked by readers and writers so release and scope
// commands can share the same serialization boundary.
func loadProductVersion(ctx context.Context, tx *sql.Tx, code string, id int64) (ProductVersionRecord, error) {
	var v ProductVersionRecord
	err := tx.QueryRowContext(ctx, `SELECT id,product_code,version_code,name,description,status,DATE_FORMAT(planned_release_date,'%Y-%m-%d'),owner_project_id,revision,scope_revision,current_release_record_id,business_owner_uid,planning_mode FROM product_versions WHERE id=? AND BINARY product_code=? FOR UPDATE`, id, code).Scan(&v.ID, &v.ProductCode, &v.VersionCode, &v.Name, &v.Description, &v.Status, &v.PlannedReleaseDate, &v.OwnerProjectID, &v.Revision, &v.ScopeRevision, &v.CurrentReleaseRecordID, &v.BusinessOwnerUID, &v.PlanningMode)
	return v, err
}

func ReadProductCenterVersion(ctx context.Context, db *sql.DB, code, uid string, permit AuthorizationPermit, id int64) (ProductVersionDetail, error) {
	var out ProductVersionDetail
	if id <= 0 {
		return out, invalid("product_version_id_invalid", "版本标识无效")
	}
	tx, err := db.BeginTx(ctx, &sql.TxOptions{Isolation: sql.LevelReadCommitted})
	if err != nil {
		return out, err
	}
	defer tx.Rollback()
	out, err = ReadProductCenterVersionInTransaction(ctx, tx, code, uid, permit, id)
	if err != nil {
		return out, err
	}
	return out, tx.Commit()
}

// ReadProductCenterVersionInTransaction keeps authorization and reads inside the caller's
// generation-fenced transaction. The caller owns commit and rollback.
func ReadProductCenterVersionInTransaction(ctx context.Context, tx *sql.Tx, code, uid string, permit AuthorizationPermit, id int64) (ProductVersionDetail, error) {
	var out ProductVersionDetail
	if id <= 0 {
		return out, invalid("product_version_id_invalid", "版本标识无效")
	}
	if tx == nil {
		return out, invalid("product_command_configuration", "缺少产品读取事务")
	}
	var err error
	if err = AuthorizeWorkspaceTransaction(ctx, tx, code, uid, "product_versions", "view", permit); err != nil {
		return out, err
	}
	out.ProductVersionRecord, err = loadProductVersion(ctx, tx, code, id)
	if err != nil {
		return out, err
	}
	out.WorkspaceRevision = permit.Facts.Revision
	return out, nil
}

type ProductVersionEdit struct {
	ProductVersionDraft
	VersionID               int64  `json:"version_id"`
	ExpectedVersionRevision uint64 `json:"expected_version_revision"`
	Reason                  string `json:"reason"`
}

func ValidateProductVersionEdit(v ProductVersionEdit) error {
	if err := ValidateProductVersionDraft(v.ProductVersionDraft); err != nil {
		return err
	}
	if v.VersionID <= 0 || v.ExpectedVersionRevision == 0 {
		return invalid("product_version_revision_required", "必须提供版本标识与版本号")
	}
	if strings.TrimSpace(v.Reason) == "" || !utf8.ValidString(v.Reason) || utf8.RuneCountInString(v.Reason) > 2000 || strings.ContainsRune(v.Reason, '\x00') {
		return invalid("product_version_reason_invalid", "修改原因须为1至2000字")
	}
	return nil
}

func EditProductCenterVersion(ctx context.Context, db *sql.DB, identity CommandIdentity, permit AuthorizationPermit, input ProductVersionEdit, sourceContext ...integrationoperation.TrustedContext) (CommandResult, error) {
	return editProductCenterVersion(ctx, identity, permit, input, sourceContext, func(authorize AuthorizeCommand, apply ApplyCommand) (CommandResult, error) {
		return ExecuteCommand(ctx, db, identity, input, authorize, apply)
	})
}
func EditProductCenterVersionInTransaction(ctx context.Context, tx *sql.Tx, identity CommandIdentity, permit AuthorizationPermit, input ProductVersionEdit, sourceContext ...integrationoperation.TrustedContext) (CommandResult, error) {
	result, err := editProductCenterVersion(ctx, identity, permit, input, sourceContext, func(authorize AuthorizeCommand, apply ApplyCommand) (CommandResult, error) {
		return ExecuteCommandInTransaction(ctx, tx, identity, input, authorize, apply)
	})
	if err != nil && tx != nil {
		_ = tx.Rollback()
	}
	return result, err
}
func editProductCenterVersion(ctx context.Context, identity CommandIdentity, permit AuthorizationPermit, input ProductVersionEdit, sourceContext []integrationoperation.TrustedContext, execute func(AuthorizeCommand, ApplyCommand) (CommandResult, error)) (CommandResult, error) {

	if identity.Action != "product_versions:edit" {
		return CommandResult{}, invalid("product_command_identity_invalid", "版本编辑命令不匹配")
	}
	if err := ValidateProductVersionEdit(input); err != nil {
		return CommandResult{}, err
	}
	return execute(func(ctx context.Context, tx *sql.Tx) error {
		return AuthorizeWorkspaceTransaction(ctx, tx, identity.ProductCode, identity.ActorUID, "product_versions", "edit", permit)
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
		before, err := loadProductVersion(ctx, tx, identity.ProductCode, input.VersionID)
		if err != nil {
			return nil, err
		}
		if before.Revision != input.ExpectedVersionRevision {
			return nil, invalid("product_version_revision_conflict", "版本已变化，请刷新")
		}
		if before.Status != "planning" && before.Status != "developing" {
			return nil, invalid("product_version_locked", "已发布或归档版本须通过专用更正流程修改")
		}
		// The legacy version editor may still update shared version facts. A
		// simple-plan confirmation is bound to those facts and must never remain
		// usable after this alternate write path.
		if before.PlanningMode == "simple" {
			if err = invalidateSimplePlanTx(ctx, tx, input.VersionID, identity.ActorUID, input.Reason); err != nil {
				return nil, err
			}
		}
		if input.BusinessOwnerUID != nil {
			if err := validateVersionOwnerTx(ctx, tx, identity.ProductCode, *input.BusinessOwnerUID); err != nil {
				return nil, err
			}
			if _, err = tx.ExecContext(ctx, `UPDATE product_versions SET business_owner_uid=? WHERE id=?`, *input.BusinessOwnerUID, input.VersionID); err != nil {
				return nil, err
			}
		}
		nullable := func(s string) any {
			if strings.TrimSpace(s) == "" {
				return nil
			}
			return s
		}
		_, err = tx.ExecContext(ctx, `UPDATE product_versions SET version_code=?,name=?,description=?,planned_release_date=?,revision=revision+1,updated_at=UTC_TIMESTAMP(3) WHERE id=?`, input.VersionCode, nullable(input.Name), nullable(input.Description), nullable(input.PlannedReleaseDate), input.VersionID)
		if err != nil {
			return nil, err
		}
		if _, err = tx.ExecContext(ctx, `UPDATE product_workspaces SET revision=revision+1,updated_by=?,updated_at=UTC_TIMESTAMP(3) WHERE product_code=?`, identity.ActorUID, identity.ProductCode); err != nil {
			return nil, err
		}
		after, err := loadProductVersion(ctx, tx, identity.ProductCode, input.VersionID)
		if err != nil {
			return nil, err
		}
		var trusted integrationoperation.TrustedContext
		if len(sourceContext) == 1 {
			trusted = sourceContext[0]
		}
		if err := enqueueProductFeedbackProgressTx(ctx, tx, trusted, identity.ActorUID, identity.ProductCode, root.Revision+1); err != nil {
			return nil, err
		}
		changes, err := json.Marshal(map[string]any{"before": before, "after": after, "reason": input.Reason})
		if err != nil {
			return nil, err
		}
		_, err = tx.ExecContext(ctx, `INSERT INTO product_activity_logs(product_code,object_type,object_id,action,actor_uid,revision,changes,request_id,created_at) VALUES(?,'version',?,'edit',?,?,?,?,UTC_TIMESTAMP(3))`, identity.ProductCode, strconv.FormatInt(input.VersionID, 10), identity.ActorUID, after.Revision, changes, identity.IdempotencyKey)
		return ProductVersionDetail{ProductVersionRecord: after, WorkspaceRevision: root.Revision + 1}, err
	})
}
