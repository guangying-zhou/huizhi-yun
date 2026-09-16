package productcenter

import (
	"context"
	"database/sql"
	"encoding/json"
)

func ChangeFeatureLifecycle(ctx context.Context, db *sql.DB, identity CommandIdentity, permit AuthorizationPermit, input FeatureLifecycleChange) (CommandResult, error) {
	if identity.Action != "product_features:lifecycle" {
		return CommandResult{}, invalid("product_command_identity_invalid", "功能生命周期命令不匹配")
	}
	if err := ValidateFeatureLifecycleChange(input); err != nil {
		return CommandResult{}, err
	}
	return ExecuteCommand(ctx, db, identity, input, func(ctx context.Context, tx *sql.Tx) error {
		if err := AuthorizeWorkspaceTransaction(ctx, tx, identity.ProductCode, identity.ActorUID, "product_features", "edit", permit); err != nil {
			return err
		}
		if !permit.Facts.IsManager {
			return invalid("product_feature_manager_required", "生命周期变更需产品负责人确认")
		}
		return nil
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
		before, err := scanFeature(tx.QueryRowContext(ctx, `SELECT `+featureColumns+` FROM product_features WHERE product_code=? AND biz_id=?`, identity.ProductCode, input.BizID))
		if err != nil {
			return nil, err
		}
		if before.Revision != input.ExpectedFeatureRevision {
			return nil, invalid("product_feature_revision_conflict", "功能已变化，请刷新后重试")
		}

		if err := ValidateFeatureLifecycleTransition(before.Lifecycle, input.Target, permit.Facts.IsManager); err != nil {
			return nil, err
		}
		evidence := []byte(before.LifecycleEvidence)
		if input.Target == "active" {
			if input.Evidence.Kind == "release" {
				if err := verifyFeatureReleaseEvidence(ctx, tx, identity.ProductCode, before.BizID, input.Evidence.ReleaseBizID); err != nil {
					return nil, err
				}
			}
			var confirmedAt string
			if err := tx.QueryRowContext(ctx, `SELECT CONCAT(LEFT(DATE_FORMAT(UTC_TIMESTAMP(3),'%Y-%m-%dT%H:%i:%s.%f'),23),'Z')`).Scan(&confirmedAt); err != nil {
				return nil, err
			}
			evidence, err = json.Marshal(map[string]any{"version": 1, "kind": input.Evidence.Kind, "description": input.Evidence.Description, "release_biz_id": input.Evidence.ReleaseBizID, "confirmed_by": identity.ActorUID, "confirmed_at": confirmedAt, "reason": input.Reason})
			if err != nil {
				return nil, err
			}
		}
		_, err = tx.ExecContext(ctx, `UPDATE product_features SET lifecycle=?,lifecycle_evidence=?,revision=revision+1,updated_by=?,updated_at=UTC_TIMESTAMP(3) WHERE product_code=? AND id=?`, input.Target, evidence, identity.ActorUID, identity.ProductCode, before.ID)
		if err != nil {
			return nil, err
		}

		_, err = tx.ExecContext(ctx, `UPDATE product_workspaces SET revision=revision+1,updated_by=?,updated_at=UTC_TIMESTAMP(3) WHERE product_code=?`, identity.ActorUID, identity.ProductCode)
		if err != nil {
			return nil, err
		}
		after, err := scanFeature(tx.QueryRowContext(ctx, `SELECT `+featureColumns+` FROM product_features WHERE product_code=? AND id=?`, identity.ProductCode, before.ID))
		if err != nil {
			return nil, err
		}
		changes, err := json.Marshal(map[string]any{"before": before, "after": after, "reason": input.Reason})
		if err != nil {
			return nil, err
		}
		_, err = tx.ExecContext(ctx, `INSERT INTO product_activity_logs(product_code,object_type,object_id,action,actor_uid,revision,changes,request_id,created_at) VALUES (?,'feature',?,'lifecycle',?,?,?,?,UTC_TIMESTAMP(3))`, identity.ProductCode, input.BizID, identity.ActorUID, after.Revision, changes, identity.IdempotencyKey)
		return map[string]any{"feature": after, "workspace_revision": root.Revision + 1}, err
	})
}

// FeatureReleaseScope is the capability evidence projection of a v1 frozen
// release scope. Unknown/legacy shapes never prove a feature was delivered.
type FeatureReleaseScope struct {
	Version  int `json:"version"`
	Features []struct {
		FeatureBizID string `json:"product_feature_biz_id"`
		Status       string `json:"status"`
	} `json:"features"`
}

func verifyFeatureReleaseEvidence(ctx context.Context, tx *sql.Tx, code, featureID, releaseID string) error {
	var snapshot []byte
	err := tx.QueryRowContext(ctx, `SELECT r.scope_snapshot FROM product_release_records r JOIN product_versions v ON v.id=r.version_id WHERE v.product_code=? AND r.biz_id=? AND v.current_release_record_id=r.id AND v.status='released' AND r.evidence_level='verified' AND r.released_at IS NOT NULL AND r.released_by IS NOT NULL AND NOT EXISTS (SELECT 1 FROM product_release_events e WHERE e.release_record_id=r.id)`, code, releaseID).Scan(&snapshot)
	if err == sql.ErrNoRows {
		return invalid("product_feature_release_evidence_invalid", "发布记录不是本产品当前有效的已核验发布")
	}
	if err != nil {
		return err
	}
	var scope FeatureReleaseScope
	if err := json.Unmarshal(snapshot, &scope); err != nil || scope.Version != 1 {
		return invalid("product_feature_release_evidence_invalid", "发布范围缺少可核验的长期功能证据")
	}
	matches := 0
	for _, feature := range scope.Features {
		if feature.FeatureBizID == featureID {
			if feature.Status != "delivered" {
				return invalid("product_feature_release_evidence_invalid", "该功能未在引用发布范围中交付")
			}
			matches++
		}
	}
	if matches != 1 {
		return invalid("product_feature_release_evidence_invalid", "发布范围必须唯一包含已交付的目标功能")
	}
	return nil
}
