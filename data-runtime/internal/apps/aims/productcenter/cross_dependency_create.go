package productcenter

import (
	"context"
	"database/sql"
	"encoding/json"
	"github.com/google/uuid"
	"strconv"
	"strings"
	"unicode/utf8"
)

type CrossDependencyCreate struct {
	ItemBizID                          string `json:"item_biz_id"`
	PredecessorProductCode             string `json:"predecessor_product_code"`
	PredecessorBizID                   string `json:"predecessor_biz_id"`
	ExpectedRevision                   uint64 `json:"expected_revision"`
	ExpectedItemRevision               uint64 `json:"expected_item_revision"`
	ExpectedPredecessorProductRevision uint64 `json:"expected_predecessor_product_revision"`
	ExpectedPredecessorRevision        uint64 `json:"expected_predecessor_revision"`
	Reason                             string `json:"reason"`
	ImpactNote                         string `json:"impact_note"`
}

func CreateCrossDependency(ctx context.Context, db *sql.DB, identity CommandIdentity, sourcePermit, targetPermit AuthorizationPermit, input CrossDependencyCreate) (CommandResult, error) {
	if identity.Action != "product_priorities:cross-dependency-create" {
		return CommandResult{}, invalid("product_command_identity_invalid", "跨产品依赖命令不匹配")
	}
	if err := ValidatePlanningDependenciesEdit(PlanningDependenciesEdit{ItemBizID: input.ItemBizID, PredecessorBizIDs: []string{input.PredecessorBizID}, ExpectedRevision: input.ExpectedRevision, ExpectedItemRevision: input.ExpectedItemRevision, Reason: input.Reason, ImpactNote: input.ImpactNote}); err != nil {
		return CommandResult{}, err
	}
	if input.PredecessorProductCode == identity.ProductCode || input.PredecessorProductCode == "" || strings.TrimSpace(input.PredecessorProductCode) != input.PredecessorProductCode || !utf8.ValidString(input.PredecessorProductCode) || utf8.RuneCountInString(input.PredecessorProductCode) > 64 || input.ExpectedPredecessorProductRevision == 0 || input.ExpectedPredecessorRevision == 0 {
		return CommandResult{}, invalid("planning_cross_dependency_invalid", "前置产品或修订无效")
	}
	return ExecuteCommand(ctx, db, identity, input, func(ctx context.Context, tx *sql.Tx) error {
		return authorizeCrossDependencyTransaction(ctx, tx, identity.ProductCode, input.PredecessorProductCode, identity.ActorUID, sourcePermit, targetPermit)
	}, func(ctx context.Context, tx *sql.Tx) (any, error) {
		source, err := loadWorkspace(ctx, tx, identity.ProductCode)
		if err != nil {
			return nil, err
		}
		target, err := loadWorkspace(ctx, tx, input.PredecessorProductCode)
		if err != nil {
			return nil, err
		}
		if source.Status != "active" || target.Status != "active" {
			return nil, invalid("product_archived", "关联产品已归档")
		}
		if source.Revision != input.ExpectedRevision || target.Revision != input.ExpectedPredecessorProductRevision {
			return nil, invalid("product_revision_conflict", "关联产品已变化")
		}
		item, err := loadPlanningItemDetail(ctx, tx, identity.ProductCode, input.ItemBizID)
		if err != nil {
			return nil, err
		}
		predecessor, err := loadPlanningItemDetail(ctx, tx, input.PredecessorProductCode, input.PredecessorBizID)
		if err != nil {
			return nil, err
		}
		if item.Revision != input.ExpectedItemRevision || predecessor.Revision != input.ExpectedPredecessorRevision {
			return nil, invalid("product_planning_revision_conflict", "关联事项已变化")
		}
		if (item.Lifecycle != "proposed" && item.Lifecycle != "in_delivery") || predecessor.Lifecycle == "cancelled" || predecessor.Lifecycle == "merged" {
			return nil, invalid("product_planning_readonly", "关联事项状态不允许新增依赖")
		}
		if item.RequiresImpactNote && strings.TrimSpace(input.ImpactNote) == "" {
			return nil, invalid("planning_impact_note_required", "已选入或执行事项需要影响说明")
		}
		graph, err := loadUnifiedDependencyGraph(ctx, tx)
		if err != nil {
			return nil, err
		}
		sourceID, targetID := strconv.FormatInt(item.ID, 10), strconv.FormatInt(predecessor.ID, 10)
		graph[sourceID] = append(graph[sourceID], targetID)
		if err = ValidateDependencies(graph); err != nil {
			return nil, err
		}
		bizID := uuid.NewString()
		result, err := tx.ExecContext(ctx, `INSERT INTO product_cross_dependencies(biz_id,product_code,planning_item_id,predecessor_product_code,predecessor_id,reason,created_by,updated_by,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,UTC_TIMESTAMP(3),UTC_TIMESTAMP(3))`, bizID, identity.ProductCode, item.ID, input.PredecessorProductCode, predecessor.ID, input.Reason, identity.ActorUID, identity.ActorUID)
		if err != nil {
			return nil, err
		}
		id, err := result.LastInsertId()
		if err != nil {
			return nil, err
		}
		if _, err = tx.ExecContext(ctx, `UPDATE product_planning_items SET revision=revision+1,scope_revision=scope_revision+1,updated_by=?,updated_at=UTC_TIMESTAMP(3) WHERE id=?`, identity.ActorUID, item.ID); err != nil {
			return nil, err
		}
		if _, err = tx.ExecContext(ctx, `UPDATE product_workspaces SET revision=revision+1,updated_by=?,updated_at=UTC_TIMESTAMP(3) WHERE product_code=?`, identity.ActorUID, identity.ProductCode); err != nil {
			return nil, err
		}
		if _, err = tx.ExecContext(ctx, `UPDATE product_dependency_graph_lock SET revision=revision+1 WHERE id=1`); err != nil {
			return nil, err
		}
		out := map[string]any{"id": id, "biz_id": bizID, "product_code": identity.ProductCode, "item_biz_id": item.BizID, "predecessor_product_code": input.PredecessorProductCode, "predecessor_biz_id": predecessor.BizID, "revision": 1, "item_revision": item.Revision + 1, "workspace_revision": source.Revision + 1}
		changes, err := json.Marshal(map[string]any{"after": out, "reason": input.Reason, "impact_note": input.ImpactNote})
		if err != nil {
			return nil, err
		}
		_, err = tx.ExecContext(ctx, `INSERT INTO product_activity_logs(product_code,object_type,object_id,action,actor_uid,revision,changes,request_id,created_at) VALUES(?,'cross_dependency',?,'create',?,1,?,?,UTC_TIMESTAMP(3))`, identity.ProductCode, bizID, identity.ActorUID, changes, identity.IdempotencyKey)
		return out, err
	})
}
