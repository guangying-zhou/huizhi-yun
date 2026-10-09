package productcenter

import (
	"context"
	"database/sql"
	"encoding/json"
	"github.com/google/uuid"
)

type RoadmapSavedViewCreate struct {
	ExpectedRevision uint64                     `json:"expected_revision"`
	Definition       RoadmapSavedViewDefinition `json:"definition"`
}

func CreateRoadmapSavedView(ctx context.Context, db *sql.DB, identity CommandIdentity, planningPermit, roadmapPermit AuthorizationPermit, input RoadmapSavedViewCreate) (CommandResult, error) {
	if identity.Action != "product_roadmaps:view-create" || input.ExpectedRevision == 0 {
		return CommandResult{}, invalid("product_command_identity_invalid", "保存视图命令或修订无效")
	}
	if err := ValidateRoadmapSavedViewDefinition(input.Definition); err != nil {
		return CommandResult{}, err
	}
	action := "view"
	if input.Definition.Visibility == "product" {
		action = "edit"
	}
	return ExecuteCommand(ctx, db, identity, input, func(ctx context.Context, tx *sql.Tx) error {
		if err := AuthorizeWorkspaceTransaction(ctx, tx, identity.ProductCode, identity.ActorUID, "product_priorities", "view", planningPermit); err != nil {
			return err
		}
		return AuthorizeWorkspaceTransaction(ctx, tx, identity.ProductCode, identity.ActorUID, "product_roadmaps", action, roadmapPermit)
	}, func(ctx context.Context, tx *sql.Tx) (any, error) {
		root, err := loadWorkspace(ctx, tx, identity.ProductCode)
		if err != nil {
			return nil, err
		}
		if root.Status != "active" {
			return nil, invalid("product_archived", "归档产品不能创建视图")
		}
		if root.Revision != input.ExpectedRevision {
			return nil, invalid("product_revision_conflict", "产品已变化，请重新读取")
		}
		cycle, err := loadPlanningCycle(ctx, tx, identity.ProductCode, input.Definition.CycleBizID)
		if err != nil {
			return nil, err
		}
		view, bizID := input.Definition, uuid.NewString()
		_, err = tx.ExecContext(ctx, `INSERT INTO product_roadmap_saved_views(biz_id,product_code,cycle_id,owner_uid,title,audience,visibility,roadmap_year,roadmap_quarter,unscheduled,created_by,updated_by,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?, ?,UTC_TIMESTAMP(3),UTC_TIMESTAMP(3))`, bizID, identity.ProductCode, cycle.ID, identity.ActorUID, view.Title, view.Audience, view.Visibility, view.Year, view.Quarter, view.Unscheduled, identity.ActorUID, identity.ActorUID)
		if err != nil {
			return nil, err
		}
		if _, err = tx.ExecContext(ctx, "UPDATE product_workspaces SET revision=revision+1,updated_by=?,updated_at=UTC_TIMESTAMP(3) WHERE product_code=?", identity.ActorUID, identity.ProductCode); err != nil {
			return nil, err
		}
		out := map[string]any{"biz_id": bizID, "product_code": identity.ProductCode, "owner_uid": identity.ActorUID, "definition": view, "revision": 1, "workspace_revision": root.Revision + 1}
		auditValue := out
		if view.Visibility == "personal" {
			auditValue = map[string]any{"biz_id": bizID, "visibility": "personal", "owner_uid": identity.ActorUID, "revision": 1}
		}
		changes, err := json.Marshal(map[string]any{"after": auditValue})
		if err != nil {
			return nil, err
		}
		_, err = tx.ExecContext(ctx, `INSERT INTO product_activity_logs(product_code,object_type,object_id,action,actor_uid,revision,changes,request_id,created_at) VALUES(?,'roadmap_saved_view',?,'create',?,1,?,?,UTC_TIMESTAMP(3))`, identity.ProductCode, bizID, identity.ActorUID, changes, identity.IdempotencyKey)
		return out, err
	})
}
