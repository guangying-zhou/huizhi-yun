package productcenter

import (
	"context"
	"database/sql"
	"encoding/json"
	"github.com/google/uuid"
	"reflect"
	"sort"
	"strings"
	"unicode/utf8"
)

type PlanningDependenciesEdit struct {
	ItemBizID            string   `json:"item_biz_id"`
	ExpectedRevision     uint64   `json:"expected_revision"`
	ExpectedItemRevision uint64   `json:"expected_item_revision"`
	PredecessorBizIDs    []string `json:"predecessor_biz_ids"`
	Reason               string   `json:"reason"`
	ImpactNote           string   `json:"impact_note"`
}

func ValidatePlanningDependenciesEdit(input PlanningDependenciesEdit) error {
	if input.ExpectedRevision == 0 || input.ExpectedItemRevision == 0 || input.PredecessorBizIDs == nil || len(input.PredecessorBizIDs) > 100 {
		return invalid("planning_dependencies_input_invalid", "必须提供版本与完整前置集合，最多 100 项")
	}
	ids := append([]string{input.ItemBizID}, input.PredecessorBizIDs...)
	seen := map[string]bool{}
	for _, value := range ids {
		id, err := uuid.Parse(value)
		if err != nil || id.String() != value || seen[value] {
			return invalid("planning_dependencies_input_invalid", "事项标识须规范且唯一，不能依赖自身")
		}
		seen[value] = true
	}
	if strings.TrimSpace(input.Reason) == "" {
		return invalid("product_planning_reason_required", "依赖变更必须填写理由")
	}
	for _, value := range []string{input.Reason, input.ImpactNote} {
		if !utf8.ValidString(value) || strings.ContainsRune(value, '\x00') || utf8.RuneCountInString(value) > 2000 {
			return invalid("product_planning_reason_invalid", "变更理由或影响说明无效")
		}
	}
	return nil
}

type dependencyNode struct {
	ID        int64
	Lifecycle string
}

// The full same-product graph is loaded under the authorized root lock. Limits
// fail closed rather than allowing cycle checks on a truncated graph.
func loadPlanningDependencyGraph(ctx context.Context, tx *sql.Tx, code string) (map[string]dependencyNode, map[string][]string, error) {
	rows, err := tx.QueryContext(ctx, `SELECT id,biz_id,lifecycle FROM product_planning_items WHERE product_code=? ORDER BY id LIMIT 10001`, code)
	if err != nil {
		return nil, nil, err
	}
	nodes := map[string]dependencyNode{}
	graph := map[string][]string{}
	for rows.Next() {
		var node dependencyNode
		var id string
		if err = rows.Scan(&node.ID, &id, &node.Lifecycle); err != nil {
			rows.Close()
			return nil, nil, err
		}
		nodes[id] = node
		graph[id] = []string{}
	}
	err = rows.Err()
	rows.Close()
	if err != nil {
		return nil, nil, err
	}
	if len(nodes) > 10000 {
		return nil, nil, invalid("planning_dependency_limit", "产品事项超过依赖校验上限")
	}
	rows, err = tx.QueryContext(ctx, `SELECT i.biz_id,p.biz_id FROM product_planning_dependencies d JOIN product_planning_items i ON i.id=d.planning_item_id AND i.product_code=d.product_code JOIN product_planning_items p ON p.id=d.predecessor_id AND p.product_code=d.product_code WHERE d.product_code=? ORDER BY i.biz_id,p.biz_id LIMIT 100001`, code)
	if err != nil {
		return nil, nil, err
	}
	defer rows.Close()
	count := 0
	for rows.Next() {
		var id, pred string
		if err = rows.Scan(&id, &pred); err != nil {
			return nil, nil, err
		}
		count++
		if count > 100000 {
			return nil, nil, invalid("planning_dependency_limit", "产品依赖超过校验上限")
		}
		graph[id] = append(graph[id], pred)
	}
	return nodes, graph, rows.Err()
}

func EditPlanningDependencies(ctx context.Context, db *sql.DB, identity CommandIdentity, permit AuthorizationPermit, input PlanningDependenciesEdit) (CommandResult, error) {
	if identity.Action != "product_priorities:dependencies-edit" {
		return CommandResult{}, invalid("product_command_identity_invalid", "依赖修改命令不匹配")
	}
	if err := ValidatePlanningDependenciesEdit(input); err != nil {
		return CommandResult{}, err
	}
	return ExecuteCommand(ctx, db, identity, input, func(ctx context.Context, tx *sql.Tx) error {
		if _, err := lockProductDependencyGraph(ctx, tx); err != nil {
			return err
		}
		return AuthorizeWorkspaceTransaction(ctx, tx, identity.ProductCode, identity.ActorUID, "product_priorities", "edit", permit)
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
		item, err := loadPlanningItemDetail(ctx, tx, identity.ProductCode, input.ItemBizID)
		if err != nil {
			return nil, err
		}
		if item.Revision != input.ExpectedItemRevision {
			return nil, invalid("product_planning_revision_conflict", "事项已变化，请刷新")
		}
		if item.Lifecycle != "proposed" && item.Lifecycle != "in_delivery" {
			return nil, invalid("product_planning_readonly", "已结束或合并事项不能修改前置关系")
		}
		nodes, graph, err := loadPlanningDependencyGraph(ctx, tx, identity.ProductCode)
		if err != nil {
			return nil, err
		}
		before := graph[input.ItemBizID]
		after := append([]string{}, input.PredecessorBizIDs...)
		sort.Strings(after)
		for _, id := range after {
			node, ok := nodes[id]
			if !ok {
				return nil, invalid("planning_dependency_not_found", "前置事项不在同一产品中")
			}
			if node.Lifecycle == "cancelled" || node.Lifecycle == "merged" {
				return nil, invalid("planning_dependency_invalid", "不能使用已取消或合并的事项作为前置")
			}
		}
		out := map[string]any{"item_biz_id": item.BizID, "predecessor_biz_ids": after, "workspace_revision": root.Revision, "item_revision": item.Revision, "scope_revision": item.ScopeRevision, "changed": false}
		if reflect.DeepEqual(before, after) {
			return out, nil
		}
		if item.RequiresImpactNote && strings.TrimSpace(input.ImpactNote) == "" {
			return nil, invalid("product_planning_impact_required", "已选入或交付中的事项变更依赖须说明影响")
		}
		graph[input.ItemBizID] = after
		if err = ValidateDependencies(graph); err != nil {
			return nil, err
		}
		previous := map[string]bool{}
		next := map[string]bool{}
		for _, id := range before {
			previous[id] = true
		}
		for _, id := range after {
			next[id] = true
		}
		for _, id := range before {
			if !next[id] {
				if _, err = tx.ExecContext(ctx, `DELETE FROM product_planning_dependencies WHERE product_code=? AND planning_item_id=? AND predecessor_id=?`, identity.ProductCode, item.ID, nodes[id].ID); err != nil {
					return nil, err
				}
			}
		}
		for _, id := range after {
			if !previous[id] {
				if _, err = tx.ExecContext(ctx, `INSERT INTO product_planning_dependencies(product_code,planning_item_id,predecessor_id,created_by,created_at) VALUES (?,?,?,?,UTC_TIMESTAMP(3))`, identity.ProductCode, item.ID, nodes[id].ID, identity.ActorUID); err != nil {
					return nil, err
				}
			}
		}
		unified, err := loadUnifiedDependencyGraph(ctx, tx)
		if err != nil {
			return nil, err
		}
		if err = ValidateDependencies(unified); err != nil {
			return nil, err
		}
		if err = invalidateSimplePlanConfirmationsForPlanningItemTx(ctx, tx, identity.ProductCode, item.ID, identity.ActorUID, input.Reason); err != nil {
			return nil, err
		}
		if _, err = tx.ExecContext(ctx, `UPDATE product_dependency_graph_lock SET revision=revision+1 WHERE id=1`); err != nil {
			return nil, err
		}
		if _, err = tx.ExecContext(ctx, `UPDATE product_planning_items SET revision=revision+1,scope_revision=scope_revision+1,updated_by=?,updated_at=UTC_TIMESTAMP(3) WHERE product_code=? AND id=?`, identity.ActorUID, identity.ProductCode, item.ID); err != nil {
			return nil, err
		}
		if _, err = tx.ExecContext(ctx, `UPDATE product_workspaces SET revision=revision+1,updated_by=?,updated_at=UTC_TIMESTAMP(3) WHERE product_code=?`, identity.ActorUID, identity.ProductCode); err != nil {
			return nil, err
		}
		out["workspace_revision"] = root.Revision + 1
		out["item_revision"] = item.Revision + 1
		out["scope_revision"] = item.ScopeRevision + 1
		out["changed"] = true
		changes, err := json.Marshal(map[string]any{"before": before, "after": after, "reason": input.Reason, "impact_note": input.ImpactNote})
		if err != nil {
			return nil, err
		}
		_, err = tx.ExecContext(ctx, `INSERT INTO product_activity_logs(product_code,object_type,object_id,action,actor_uid,revision,changes,request_id,created_at) VALUES (?,'planning_item',?,'dependencies-edit',?,?,?,?,UTC_TIMESTAMP(3))`, identity.ProductCode, item.BizID, identity.ActorUID, item.Revision+1, changes, identity.IdempotencyKey)
		return out, err
	})
}
