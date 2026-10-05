package productcenter

import (
	"context"
	"database/sql"
	"encoding/json"
	"strings"
	"unicode/utf8"

	"github.com/google/uuid"
)

type WeightedModelCreate struct {
	ExpectedRevision uint64                  `json:"expected_revision"`
	Title            string                  `json:"title"`
	Reason           string                  `json:"reason"`
	Model            WeightedAssessmentModel `json:"model"`
}

func CreateWeightedModelVersion(ctx context.Context, db *sql.DB, identity CommandIdentity, permit AuthorizationPermit, input WeightedModelCreate) (CommandResult, error) {
	if identity.Action != "product_priorities:model-create" {
		return CommandResult{}, invalid("product_command_identity_invalid", "模型命令不匹配")
	}
	if err := input.Model.Validate(); err != nil {
		return CommandResult{}, err
	}
	if input.Model.Version == AssessmentModel {
		return CommandResult{}, invalid("assessment_model_reserved", "内置版本不能重复创建")
	}
	config := map[string]any{"version": input.Model.Version, "weights": map[string]int{"strategic": input.Model.Strategic, "user_value": input.Model.UserValue, "business": input.Model.Business, "risk": input.Model.Risk}, "effort_unit": "person_day", "confidence_values": []string{"0.50", "0.80", "1.00"}, "minimum_effort_person_days": "0.50", "dimension_scale": "integer_0_to_5", "value_scale": 100, "priority_decimal_places": 8, "rounding": "half_up"}
	return createPriorityModelVersion(ctx, db, identity, permit, input, input.ExpectedRevision, input.Title, input.Reason, input.Model.Version, "weighted-value-effort", config)
}

func createPriorityModelVersion(ctx context.Context, db *sql.DB, identity CommandIdentity, permit AuthorizationPermit, payload any, expectedRevision uint64, title, reason, version, method string, configuration any) (CommandResult, error) {
	if identity.Action != "product_priorities:model-create" {
		return CommandResult{}, invalid("product_command_identity_invalid", "模型命令不匹配")
	}
	if expectedRevision == 0 {
		return CommandResult{}, invalid("assessment_model_invalid", "模型创建需要产品修订")
	}
	for _, field := range []struct {
		value string
		max   int
	}{{title, 200}, {reason, 2000}} {
		if !utf8.ValidString(field.value) || strings.TrimSpace(field.value) == "" || utf8.RuneCountInString(field.value) > field.max || strings.ContainsRune(field.value, 0) {
			return CommandResult{}, invalid("assessment_model_invalid", "模型名称或原因无效")
		}
	}
	return ExecuteCommand(ctx, db, identity, payload, func(ctx context.Context, tx *sql.Tx) error {
		return AuthorizeWorkspaceTransaction(ctx, tx, identity.ProductCode, identity.ActorUID, "product_priorities", "admin", permit)
	}, func(ctx context.Context, tx *sql.Tx) (any, error) {
		root, err := loadWorkspace(ctx, tx, identity.ProductCode)
		if err != nil {
			return nil, err
		}
		if root.Status != "active" {
			return nil, invalid("product_archived", "归档产品不能新增模型")
		}
		if root.Revision != expectedRevision {
			return nil, invalid("product_revision_conflict", "产品已变化，请刷新")
		}
		var exists bool
		if err = tx.QueryRowContext(ctx, `SELECT EXISTS(SELECT 1 FROM product_priority_model_versions WHERE BINARY product_code=BINARY ? AND BINARY version=BINARY ?)`, identity.ProductCode, version).Scan(&exists); err != nil {
			return nil, err
		}
		if exists {
			return nil, invalid("assessment_model_version_conflict", "模型版本已存在，请使用新版本标识")
		}
		config, err := json.Marshal(configuration)
		if err != nil {
			return nil, err
		}
		bizID := uuid.NewString()
		if _, err = tx.ExecContext(ctx, `INSERT INTO product_priority_model_versions(biz_id,product_code,version,title,method,configuration,reason,created_by,created_at) VALUES(?,?,?,?,?,?,?,?,UTC_TIMESTAMP(3))`, bizID, identity.ProductCode, version, title, method, config, reason, identity.ActorUID); err != nil {
			return nil, err
		}
		if _, err = tx.ExecContext(ctx, `UPDATE product_workspaces SET revision=revision+1,updated_by=?,updated_at=UTC_TIMESTAMP(3) WHERE product_code=?`, identity.ActorUID, identity.ProductCode); err != nil {
			return nil, err
		}
		out := map[string]any{"biz_id": bizID, "product_code": identity.ProductCode, "version": version, "title": title, "method": method, "configuration": json.RawMessage(config), "workspace_revision": root.Revision + 1}
		changes, err := json.Marshal(map[string]any{"after": out, "reason": reason})
		if err != nil {
			return nil, err
		}
		_, err = tx.ExecContext(ctx, `INSERT INTO product_activity_logs(product_code,object_type,object_id,action,actor_uid,revision,changes,request_id,created_at) VALUES(?,'priority_model',?,'create',?,1,?,?,UTC_TIMESTAMP(3))`, identity.ProductCode, bizID, identity.ActorUID, changes, identity.IdempotencyKey)
		return out, err
	})
}
