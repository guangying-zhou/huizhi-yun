package productcenter

import (
	"context"
	"database/sql"
	"encoding/json"
	"github.com/google/uuid"
)

type RoadmapCommitmentInput struct {
	ItemBizID             string `json:"item_biz_id"`
	CycleBizID            string `json:"cycle_biz_id"`
	ExpectedRevision      uint64 `json:"expected_revision"`
	ExpectedItemRevision  uint64 `json:"expected_item_revision"`
	ExpectedCycleRevision uint64 `json:"expected_cycle_revision"`
	ExpectedQueueRevision uint64 `json:"expected_queue_revision"`
	ExpectedPreviousID    int64  `json:"expected_previous_id"`
	Reason                string `json:"reason"`
}

func CommitRoadmap(ctx context.Context, db *sql.DB, identity CommandIdentity, permit AuthorizationPermit, input RoadmapCommitmentInput) (CommandResult, error) {
	if identity.Action != "product_roadmaps:commit" {
		return CommandResult{}, invalid("product_command_identity_invalid", "承诺命令不匹配")
	}
	if err := ValidatePlanningRoadmapWindow(PlanningRoadmapWindow{BizID: input.ItemBizID, ExpectedRevision: input.ExpectedRevision, ExpectedItemRevision: input.ExpectedItemRevision, Reason: input.Reason}); err != nil {
		return CommandResult{}, err
	}
	id, err := uuid.Parse(input.CycleBizID)
	if err != nil || id.String() != input.CycleBizID || input.ExpectedCycleRevision < 1 || input.ExpectedQueueRevision < 1 || input.ExpectedPreviousID < 0 {
		return CommandResult{}, invalid("product_roadmap_commitment_invalid", "周期或修订无效")
	}
	return executeSnapshotCommand(ctx, db, identity, input, func(ctx context.Context, tx *sql.Tx) error {
		return AuthorizeWorkspaceTransaction(ctx, tx, identity.ProductCode, identity.ActorUID, "product_roadmaps", "commit", permit)
	}, func(ctx context.Context, tx *sql.Tx) (any, error) {
		if _, err := ValidatePlanningDeliveryTx(ctx, tx, identity.ProductCode, PlanningDeliveryCheck{ItemBizID: input.ItemBizID, CycleBizID: input.CycleBizID, ExpectedRevision: input.ExpectedRevision, ExpectedItemRevision: input.ExpectedItemRevision, ExpectedCycleRevision: input.ExpectedCycleRevision, ExpectedQueueRevision: input.ExpectedQueueRevision}); err != nil {
			return nil, err
		}
		root, err := loadWorkspace(ctx, tx, identity.ProductCode)
		if err != nil {
			return nil, err
		}
		if root.Status != "active" {
			return nil, invalid("product_archived", "产品已归档")
		}
		if root.Revision != input.ExpectedRevision {
			return nil, invalid("product_revision_conflict", "产品已变化")
		}
		cycle, err := loadPlanningCycle(ctx, tx, identity.ProductCode, input.CycleBizID)
		if err != nil {
			return nil, err
		}
		if cycle.Status != "open" {
			return nil, invalid("planning_cycle_readonly", "仅开放周期可确认承诺")
		}
		if cycle.Revision != input.ExpectedCycleRevision {
			return nil, invalid("planning_cycle_revision_conflict", "周期已变化")
		}
		if cycle.QueueRevision != input.ExpectedQueueRevision {
			return nil, invalid("priority_queue_conflict", "决定队列已变化")
		}
		item, err := loadPlanningItemDetail(ctx, tx, identity.ProductCode, input.ItemBizID)
		if err != nil {
			return nil, err
		}
		if item.Revision != input.ExpectedItemRevision {
			return nil, invalid("product_planning_revision_conflict", "事项已变化")
		}
		if item.Lifecycle != "proposed" && item.Lifecycle != "in_delivery" {
			return nil, invalid("product_planning_readonly", "事项只读")
		}
		var start, end *string
		if err = tx.QueryRowContext(ctx, `SELECT DATE_FORMAT(roadmap_starts_on,'%Y-%m-%d'),DATE_FORMAT(roadmap_ends_on,'%Y-%m-%d') FROM product_planning_items WHERE id=?`, item.ID).Scan(&start, &end); err != nil {
			return nil, err
		}
		if start == nil || end == nil {
			return nil, invalid("product_roadmap_commitment_invalid", "请先设置探索窗口")
		}
		var selection string
		var snapshot json.RawMessage
		var assessmentID sql.NullInt64
		if err = tx.QueryRowContext(ctx, `SELECT selection_status,decision_snapshot,current_assessment_id FROM product_planning_cycle_items WHERE cycle_id=? AND planning_item_id=? AND BINARY product_code=BINARY ? FOR UPDATE`, cycle.ID, item.ID, identity.ProductCode).Scan(&selection, &snapshot, &assessmentID); err != nil {
			return nil, err
		}
		var decision struct {
			ScopeRevision    uint64 `json:"scope_revision"`
			EvidenceRevision uint64 `json:"evidence_revision"`
			ModelVersion     string `json:"model_version"`
			AssessmentID     int64  `json:"assessment_id"`
		}
		if selection != "selected" || json.Unmarshal(snapshot, &decision) != nil || decision.ScopeRevision != item.ScopeRevision || decision.EvidenceRevision != item.EvidenceRevision || decision.ModelVersion != cycle.ModelVersion || !assessmentID.Valid || decision.AssessmentID != assessmentID.Int64 {
			return nil, invalid("product_roadmap_commitment_invalid", "请先复评并确认当前选入决定")
		}
		dependencies, err := roadmapCommitmentDependencies(ctx, tx, identity.ProductCode, cycle.ID, item.ID, item.BizID, snapshot)
		if err != nil {
			return nil, err
		}
		crossFingerprint, err := crossDependencyFingerprint(ctx, tx, identity.ProductCode, item.ID)
		if err != nil {
			return nil, err
		}
		var previousFingerprint sql.NullString
		var previousID int64
		var previousItemRevision, previousCycleRevision, previousQueueRevision uint64
		var previousCycleID int64
		err = tx.QueryRowContext(ctx, `SELECT id,item_revision,cycle_id,cycle_revision,queue_revision,JSON_UNQUOTE(JSON_EXTRACT(item_snapshot,'$.cross_dependency_fingerprint')) FROM product_roadmap_commitments WHERE planning_item_id=? AND BINARY product_code=BINARY ? ORDER BY id DESC LIMIT 1 FOR UPDATE`, item.ID, identity.ProductCode).Scan(&previousID, &previousItemRevision, &previousCycleID, &previousCycleRevision, &previousQueueRevision, &previousFingerprint)
		if err != nil && err != sql.ErrNoRows {
			return nil, err
		}
		if previousID != input.ExpectedPreviousID {
			return nil, invalid("product_roadmap_commitment_conflict", "承诺基线已变化，请查看最新基线")
		}
		if previousID > 0 && previousItemRevision == item.Revision && previousCycleID == cycle.ID && previousCycleRevision == cycle.Revision && previousQueueRevision == cycle.QueueRevision && previousFingerprint.Valid && previousFingerprint.String == crossFingerprint {
			return nil, invalid("product_roadmap_commitment_unchanged", "当前安排与已确认基线一致")
		}
		itemJSON, err := json.Marshal(struct {
			PlanningItemDetail
			PreviousCommitmentID       int64                         `json:"previous_commitment_id"`
			Dependencies               []RoadmapCommitmentDependency `json:"dependencies"`
			CrossDependencyFingerprint string                        `json:"cross_dependency_fingerprint"`
		}{item, previousID, dependencies, crossFingerprint})
		if err != nil {
			return nil, err
		}
		bizID := uuid.NewString()
		result, err := tx.ExecContext(ctx, `INSERT INTO product_roadmap_commitments(biz_id,product_code,planning_item_id,cycle_id,item_revision,scope_revision,evidence_revision,cycle_revision,queue_revision,starts_on,ends_on,item_snapshot,decision_snapshot,model_snapshot,reason,created_by,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,UTC_TIMESTAMP(3))`, bizID, identity.ProductCode, item.ID, cycle.ID, item.Revision, item.ScopeRevision, item.EvidenceRevision, cycle.Revision, cycle.QueueRevision, *start, *end, itemJSON, snapshot, cycle.ModelSnapshot, input.Reason, identity.ActorUID)
		if err != nil {
			return nil, err
		}
		recordID, err := result.LastInsertId()
		if err != nil {
			return nil, err
		}
		if err = saveRoadmapCrossSnapshots(ctx, tx, identity.ProductCode, item.ID, recordID); err != nil {
			return nil, err
		}
		if _, err = tx.ExecContext(ctx, `UPDATE product_workspaces SET revision=revision+1,updated_by=?,updated_at=UTC_TIMESTAMP(3) WHERE product_code=?`, identity.ActorUID, identity.ProductCode); err != nil {
			return nil, err
		}
		out := map[string]any{"id": recordID, "previous_commitment_id": previousID, "biz_id": bizID, "product_code": identity.ProductCode, "item_biz_id": item.BizID, "cycle_biz_id": cycle.BizID, "starts_on": start, "ends_on": end, "workspace_revision": root.Revision + 1}
		changes, err := json.Marshal(map[string]any{"after": out, "reason": input.Reason})
		if err != nil {
			return nil, err
		}
		_, err = tx.ExecContext(ctx, `INSERT INTO product_activity_logs(product_code,object_type,object_id,action,actor_uid,revision,changes,request_id,created_at) VALUES(?,'roadmap_commitment',?,'commit',?,1,?,?,UTC_TIMESTAMP(3))`, identity.ProductCode, bizID, identity.ActorUID, changes, identity.IdempotencyKey)
		return out, err
	})
}
