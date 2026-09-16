package productcenter

import (
	"context"
	"database/sql"
	"encoding/json"
	"github.com/google/uuid"
)

type RoadmapSavedViewUpdate struct {
	BizID                string                     `json:"biz_id"`
	ExpectedViewRevision uint64                     `json:"expected_view_revision"`
	ExpectedRevision     uint64                     `json:"expected_revision"`
	Definition           RoadmapSavedViewDefinition `json:"definition"`
}

func UpdateRoadmapSavedView(ctx context.Context, db *sql.DB, identity CommandIdentity, planningPermit, roadmapPermit AuthorizationPermit, input RoadmapSavedViewUpdate) (CommandResult, error) {
	id, idErr := uuid.Parse(input.BizID)
	if idErr != nil || id.String() != input.BizID || input.ExpectedViewRevision == 0 {
		return CommandResult{}, invalid("roadmap_saved_view_invalid", "视图标识或修订无效")
	}
	if identity.Action != "product_roadmaps:view-update" || input.ExpectedRevision == 0 {
		return CommandResult{}, invalid("product_command_identity_invalid", "保存视图命令或修订无效")
	}
	if err := ValidateRoadmapSavedViewDefinition(input.Definition); err != nil {
		return CommandResult{}, err
	}
	var before RoadmapSavedViewRecord
	action := "view"
	if input.Definition.Visibility == "product" || roadmapPermit.Action == "edit" {
		action = "edit"
	}
	return ExecuteCommand(ctx, db, identity, input, func(ctx context.Context, tx *sql.Tx) error {
		if err := AuthorizeWorkspaceTransaction(ctx, tx, identity.ProductCode, identity.ActorUID, "product_priorities", "view", planningPermit); err != nil {
			return err
		}
		var err error
		before, err = loadRoadmapSavedView(ctx, tx, identity.ProductCode, identity.ActorUID, input.BizID)
		if err != nil {
			return err
		}
		if before.Definition.Visibility == "product" {
			action = "edit"
		}
		if before.Definition.Visibility != input.Definition.Visibility && before.OwnerUID != identity.ActorUID {
			return invalid("roadmap_saved_view_owner_required", "仅创建者可切换视图可见性")
		}
		return AuthorizeWorkspaceTransaction(ctx, tx, identity.ProductCode, identity.ActorUID, "product_roadmaps", action, roadmapPermit)
	}, func(ctx context.Context, tx *sql.Tx) (any, error) {
		root, err := loadWorkspace(ctx, tx, identity.ProductCode)
		if err != nil {
			return nil, err
		}
		if root.Status != "active" {
			return nil, invalid("product_archived", "归档产品不能修改视图")
		}
		if root.Revision != input.ExpectedRevision {
			return nil, invalid("product_revision_conflict", "产品已变化，请重新读取")
		}
		if before.Revision != input.ExpectedViewRevision {
			return nil, invalid("roadmap_saved_view_revision_conflict", "视图已变化，请重新读取")
		}
		cycle, err := loadPlanningCycle(ctx, tx, identity.ProductCode, input.Definition.CycleBizID)
		if err != nil {
			return nil, err
		}
		view, bizID := input.Definition, input.BizID
		_, err = tx.ExecContext(ctx, `UPDATE product_roadmap_saved_views SET cycle_id=?,title=?,audience=?,visibility=?,roadmap_year=?,roadmap_quarter=?,unscheduled=?,revision=revision+1,updated_by=?,updated_at=UTC_TIMESTAMP(3) WHERE biz_id=? AND product_code=?`, cycle.ID, view.Title, view.Audience, view.Visibility, view.Year, view.Quarter, view.Unscheduled, identity.ActorUID, bizID, identity.ProductCode)
		if err != nil {
			return nil, err
		}
		if _, err = tx.ExecContext(ctx, "UPDATE product_workspaces SET revision=revision+1,updated_by=?,updated_at=UTC_TIMESTAMP(3) WHERE product_code=?", identity.ActorUID, identity.ProductCode); err != nil {
			return nil, err
		}
		out := map[string]any{"biz_id": bizID, "product_code": identity.ProductCode, "owner_uid": before.OwnerUID, "definition": view, "revision": before.Revision + 1, "workspace_revision": root.Revision + 1}
		auditValue := out
		if view.Visibility == "personal" {
			auditValue = map[string]any{"biz_id": bizID, "visibility": "personal", "owner_uid": before.OwnerUID, "revision": before.Revision + 1}
		}
		changes, err := json.Marshal(map[string]any{"after": auditValue})
		if err != nil {
			return nil, err
		}
		_, err = tx.ExecContext(ctx, `INSERT INTO product_activity_logs(product_code,object_type,object_id,action,actor_uid,revision,changes,request_id,created_at) VALUES(?,'roadmap_saved_view',?,'update',?,?,?, ?,UTC_TIMESTAMP(3))`, identity.ProductCode, bizID, identity.ActorUID, before.Revision+1, changes, identity.IdempotencyKey)
		return out, err
	})
}
