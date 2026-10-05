package productcenter

import (
	"context"
	"database/sql"
	"encoding/json"
	"github.com/google/uuid"
)

type RoadmapSavedViewDelete struct {
	BizID                string `json:"biz_id"`
	ExpectedRevision     uint64 `json:"expected_revision"`
	ExpectedViewRevision uint64 `json:"expected_view_revision"`
}

func DeleteRoadmapSavedView(ctx context.Context, db *sql.DB, identity CommandIdentity, planningPermit, roadmapPermit AuthorizationPermit, input RoadmapSavedViewDelete) (CommandResult, error) {
	id, err := uuid.Parse(input.BizID)
	if err != nil || id.String() != input.BizID || input.ExpectedRevision == 0 || input.ExpectedViewRevision == 0 || identity.Action != "product_roadmaps:view-delete" {
		return CommandResult{}, invalid("roadmap_saved_view_invalid", "删除视图身份或修订无效")
	}
	var owner, visibility string
	var revision uint64
	var deleted bool
	return ExecuteCommand(ctx, db, identity, input, func(ctx context.Context, tx *sql.Tx) error {
		if err := AuthorizeWorkspaceTransaction(ctx, tx, identity.ProductCode, identity.ActorUID, "product_priorities", "view", planningPermit); err != nil {
			return err
		}
		// Include tombstones so even a successful replay rechecks the original scope.
		if err := tx.QueryRowContext(ctx, `SELECT owner_uid,visibility,revision,deleted_at IS NOT NULL FROM product_roadmap_saved_views WHERE product_code=? AND biz_id=? AND (visibility='product' OR owner_uid=?)`, identity.ProductCode, input.BizID, identity.ActorUID).Scan(&owner, &visibility, &revision, &deleted); err != nil {
			return err
		}
		action := "view"
		if visibility == "product" || roadmapPermit.Action == "edit" {
			action = "edit"
		}
		return AuthorizeWorkspaceTransaction(ctx, tx, identity.ProductCode, identity.ActorUID, "product_roadmaps", action, roadmapPermit)
	}, func(ctx context.Context, tx *sql.Tx) (any, error) {
		if deleted {
			return nil, sql.ErrNoRows
		}
		root, err := loadWorkspace(ctx, tx, identity.ProductCode)
		if err != nil {
			return nil, err
		}
		if root.Status != "active" {
			return nil, invalid("product_archived", "归档产品不能删除视图")
		}
		if root.Revision != input.ExpectedRevision || revision != input.ExpectedViewRevision {
			return nil, invalid("roadmap_saved_view_revision_conflict", "产品或视图已变化，请重新读取")
		}
		if _, err = tx.ExecContext(ctx, "UPDATE product_roadmap_saved_views SET deleted_at=UTC_TIMESTAMP(3),revision=revision+1,updated_by=?,updated_at=UTC_TIMESTAMP(3) WHERE product_code=? AND biz_id=?", identity.ActorUID, identity.ProductCode, input.BizID); err != nil {
			return nil, err
		}
		if _, err = tx.ExecContext(ctx, "UPDATE product_workspaces SET revision=revision+1,updated_by=?,updated_at=UTC_TIMESTAMP(3) WHERE product_code=?", identity.ActorUID, identity.ProductCode); err != nil {
			return nil, err
		}
		out := map[string]any{"biz_id": input.BizID, "product_code": identity.ProductCode, "owner_uid": owner, "visibility": visibility, "deleted": true, "revision": revision + 1, "workspace_revision": root.Revision + 1}
		changes, err := json.Marshal(map[string]any{"after": out})
		if err != nil {
			return nil, err
		}
		_, err = tx.ExecContext(ctx, `INSERT INTO product_activity_logs(product_code,object_type,object_id,action,actor_uid,revision,changes,request_id,created_at) VALUES(?,'roadmap_saved_view',?,'delete',?,?,?,?,UTC_TIMESTAMP(3))`, identity.ProductCode, input.BizID, identity.ActorUID, revision+1, changes, identity.IdempotencyKey)
		return out, err
	})
}
