package productcenter

import (
	"context"
	"database/sql"
	"encoding/json"
	"github.com/google/uuid"
	"time"
)

type RICEObservationCreate struct {
	ItemBizID                string `json:"item_biz_id"`
	ModelVersion             string `json:"model_version"`
	ExpectedRevision         uint64 `json:"expected_revision"`
	ExpectedItemRevision     uint64 `json:"expected_item_revision"`
	ExpectedScopeRevision    uint64 `json:"expected_scope_revision"`
	ExpectedEvidenceRevision uint64 `json:"expected_evidence_revision"`
	Reach                    int64  `json:"reach"`
	SourceReference          string `json:"source_reference"`
	Methodology              string `json:"methodology"`
}

func CreateRICEReachObservation(ctx context.Context, db *sql.DB, identity CommandIdentity, permit AuthorizationPermit, input RICEObservationCreate) (CommandResult, error) {
	if identity.Action != "product_priorities:reach-record" {
		return CommandResult{}, invalid("product_command_identity_invalid", "Reach 观测命令不匹配")
	}
	parsed, err := uuid.Parse(input.ItemBizID)
	if err != nil || parsed.String() != input.ItemBizID || input.ExpectedRevision == 0 || input.ExpectedItemRevision == 0 || input.ExpectedScopeRevision == 0 || input.ExpectedEvidenceRevision == 0 {
		return CommandResult{}, invalid("rice_observation_invalid", "Reach 观测需要事项身份及完整修订")
	}
	return ExecuteCommand(ctx, db, identity, input, func(ctx context.Context, tx *sql.Tx) error {
		return AuthorizeWorkspaceTransaction(ctx, tx, identity.ProductCode, identity.ActorUID, "product_priorities", "assess", permit)
	}, func(ctx context.Context, tx *sql.Tx) (any, error) {
		root, err := loadWorkspace(ctx, tx, identity.ProductCode)
		if err != nil {
			return nil, err
		}
		if root.Status != "active" {
			return nil, invalid("product_archived", "归档产品不能记录 Reach")
		}
		if root.Revision != input.ExpectedRevision {
			return nil, invalid("product_revision_conflict", "产品已变化，请刷新")
		}
		item, err := loadPlanningItemDetail(ctx, tx, identity.ProductCode, input.ItemBizID)
		if err != nil {
			return nil, err
		}
		if item.Revision != input.ExpectedItemRevision || item.ScopeRevision != input.ExpectedScopeRevision || item.EvidenceRevision != input.ExpectedEvidenceRevision {
			return nil, invalid("product_planning_revision_conflict", "事项范围或证据已变化")
		}
		if item.Lifecycle != "proposed" && item.Lifecycle != "in_delivery" {
			return nil, invalid("product_planning_readonly", "当前事项不可记录 Reach")
		}
		var configuration json.RawMessage
		if err = tx.QueryRowContext(ctx, `SELECT configuration FROM product_priority_model_versions WHERE BINARY product_code=BINARY ? AND BINARY version=BINARY ?`, identity.ProductCode, input.ModelVersion).Scan(&configuration); err != nil {
			return nil, err
		}
		model, err := loadFrozenRICEModel(ctx, tx, identity.ProductCode, input.ModelVersion, configuration)
		if err != nil {
			return nil, err
		}
		observation := RICEReachObservation{BizID: uuid.NewString(), ProductCode: identity.ProductCode, ItemBizID: item.BizID, ModelVersion: model.Version, ScopeRevision: item.ScopeRevision, EvidenceRevision: item.EvidenceRevision + 1, Reach: input.Reach, ReachUnit: model.ReachUnit, ReachStartsOn: model.ReachStartsOn, ReachEndsOn: model.ReachEndsOn, ReachDefinition: model.ReachDefinition, SourceDefinition: model.SourceDefinition, SourceReference: input.SourceReference, Methodology: input.Methodology, RecordedBy: identity.ActorUID, RecordedAt: time.Now().UTC().Format(time.RFC3339Nano)}
		if err = ValidateRICEReachObservation(model, observation, identity.ProductCode, item.BizID, item.ScopeRevision, item.EvidenceRevision+1); err != nil {
			return nil, err
		}
		snapshot, err := json.Marshal(observation)
		if err != nil {
			return nil, err
		}
		if _, err = tx.ExecContext(ctx, `INSERT INTO product_rice_reach_observations(biz_id,product_code,planning_item_id,model_version,scope_revision,evidence_revision,reach_count,snapshot,recorded_by,recorded_at) VALUES(?,?,?,?,?,?,?,?,?,UTC_TIMESTAMP(3))`, observation.BizID, identity.ProductCode, item.ID, model.Version, observation.ScopeRevision, observation.EvidenceRevision, observation.Reach, snapshot, identity.ActorUID); err != nil {
			return nil, err
		}
		if _, err = tx.ExecContext(ctx, `UPDATE product_planning_items SET revision=revision+1,evidence_revision=evidence_revision+1,updated_by=?,updated_at=UTC_TIMESTAMP(3) WHERE id=?`, identity.ActorUID, item.ID); err != nil {
			return nil, err
		}
		if _, err = tx.ExecContext(ctx, `UPDATE product_workspaces SET revision=revision+1,updated_by=?,updated_at=UTC_TIMESTAMP(3) WHERE product_code=?`, identity.ActorUID, identity.ProductCode); err != nil {
			return nil, err
		}
		out := map[string]any{"observation": observation, "item_revision": item.Revision + 1, "workspace_revision": root.Revision + 1}
		changes, err := json.Marshal(map[string]any{"after": out})
		if err != nil {
			return nil, err
		}
		_, err = tx.ExecContext(ctx, `INSERT INTO product_activity_logs(product_code,object_type,object_id,action,actor_uid,revision,changes,request_id,created_at) VALUES(?,'planning_item',?,'reach-record',?,?,?,?,UTC_TIMESTAMP(3))`, identity.ProductCode, item.BizID, identity.ActorUID, item.Revision+1, changes, identity.IdempotencyKey)
		return out, err
	})
}
