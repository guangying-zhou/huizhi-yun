package productcenter

import (
	"context"
	"database/sql"
	"encoding/json"
	"github.com/google/uuid"
	"strings"
	"unicode/utf8"
)

type PlanningRequestRef struct {
	BizID    string `json:"biz_id"`
	Revision uint64 `json:"revision"`
}
type PlanningItemDraft struct {
	ExpectedRevision   uint64               `json:"expected_revision"`
	Title              string               `json:"title"`
	ScopeSummary       string               `json:"scope_summary"`
	InvestmentCategory string               `json:"investment_category"`
	UrgencyLevel       string               `json:"urgency_level"`
	Requests           []PlanningRequestRef `json:"requests"`
}

func ValidatePlanningItemDraft(input PlanningItemDraft) error {
	if input.ExpectedRevision == 0 {
		return invalid("product_revision_required", "必须提供产品空间版本号")
	}
	for _, field := range []struct {
		value string
		max   int
	}{{input.Title, 500}, {input.ScopeSummary, 10000}} {
		if !utf8.ValidString(field.value) || strings.TrimSpace(field.value) == "" || utf8.RuneCountInString(field.value) > field.max || strings.ContainsRune(field.value, '\x00') {
			return invalid("product_planning_fields_invalid", "请填写有效事项标题和本次范围")
		}
	}
	switch input.InvestmentCategory {
	case "reliability", "usability", "growth":
	default:
		return invalid("product_planning_category_invalid", "投资类别无效")
	}
	switch input.UrgencyLevel {
	case "P0", "P1", "P2", "P3":
	default:
		return invalid("product_request_urgency_invalid", "紧急程度无效")
	}
	if len(input.Requests) > 100 {
		return invalid("product_planning_sources_invalid", "一次最多关联 100 条来源需求")
	}
	seen := map[string]bool{}
	for _, source := range input.Requests {
		id, err := uuid.Parse(source.BizID)
		if err != nil || id.String() != source.BizID || source.Revision == 0 || seen[source.BizID] {
			return invalid("product_planning_sources_invalid", "来源需求标识、版本或重复关联无效")
		}
		seen[source.BizID] = true
	}
	return nil
}

func CreatePlanningItem(ctx context.Context, db *sql.DB, identity CommandIdentity, permit AuthorizationPermit, input PlanningItemDraft) (CommandResult, error) {
	if identity.Action != "product_priorities:create" {
		return CommandResult{}, invalid("product_command_identity_invalid", "需求创建命令不匹配")
	}
	if err := ValidatePlanningItemDraft(input); err != nil {
		return CommandResult{}, err
	}
	return ExecuteCommand(ctx, db, identity, input, func(ctx context.Context, tx *sql.Tx) error {
		return AuthorizeWorkspaceTransaction(ctx, tx, identity.ProductCode, identity.ActorUID, "product_priorities", "edit", permit)
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
		result, err := tx.ExecContext(ctx, `INSERT INTO product_planning_items(biz_id,product_code,title,scope_summary,investment_category,urgency_level,lifecycle,revision,created_by,updated_by,created_at,updated_at) VALUES (?,?,?,?,?,?,'proposed',1,?,?,UTC_TIMESTAMP(3),UTC_TIMESTAMP(3))`, bizID, identity.ProductCode, input.Title, input.ScopeSummary, input.InvestmentCategory, input.UrgencyLevel, identity.ActorUID, identity.ActorUID)
		if err != nil {
			return nil, err
		}
		id, err := result.LastInsertId()
		if err != nil {
			return nil, err
		}
		for _, source := range input.Requests {
			var requestID int64
			var revision uint64
			var state string
			if err := tx.QueryRowContext(ctx, `SELECT id,revision,decision_status FROM product_requests WHERE product_code=? AND biz_id=?`, identity.ProductCode, source.BizID).Scan(&requestID, &revision, &state); err != nil {
				return nil, err
			}
			if revision != source.Revision {
				return nil, invalid("product_request_revision_conflict", "来源需求已变化，请刷新后重试")
			}
			if state == "merged" {
				return nil, invalid("product_request_merged_readonly", "请选择合并后的目标需求作为规划来源")
			}
			if _, err := tx.ExecContext(ctx, `INSERT INTO product_planning_item_requests(product_code,planning_item_id,request_id,created_by,created_at) VALUES (?,?,?,?,UTC_TIMESTAMP(3))`, identity.ProductCode, id, requestID, identity.ActorUID); err != nil {
				return nil, err
			}
		}
		_, err = tx.ExecContext(ctx, `UPDATE product_workspaces SET revision=revision+1,updated_by=?,updated_at=UTC_TIMESTAMP(3) WHERE product_code=?`, identity.ActorUID, identity.ProductCode)
		if err != nil {
			return nil, err
		}
		value := map[string]any{"id": id, "biz_id": bizID, "product_code": identity.ProductCode, "title": input.Title, "scope_summary": input.ScopeSummary, "investment_category": input.InvestmentCategory, "urgency_level": input.UrgencyLevel, "lifecycle": "proposed", "scope_revision": 1, "evidence_revision": 1, "requests": input.Requests, "revision": 1, "workspace_revision": root.Revision + 1}
		changes, err := json.Marshal(map[string]any{"after": value})
		if err != nil {
			return nil, err
		}
		_, err = tx.ExecContext(ctx, `INSERT INTO product_activity_logs(product_code,object_type,object_id,action,actor_uid,revision,changes,request_id,created_at) VALUES (?,'planning_item',?,'create',?,1,?,?,UTC_TIMESTAMP(3))`, identity.ProductCode, bizID, identity.ActorUID, changes, identity.IdempotencyKey)
		return value, err
	})
}
