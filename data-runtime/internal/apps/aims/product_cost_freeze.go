package aims

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"

	"github.com/google/uuid"
	"github.com/huizhi-yun/data-runtime/internal/integrationoperation"
)

var errProductCostFreezeConflict = errors.New("product cost rules request identity conflict")

// freezeProductCostRules requires a caller-owned transaction and an already
// authorized whole-project command. It neither grants Finance access nor
// commits: the source request and its operation must be committed together.
func freezeProductCostRules(ctx context.Context, tx *sql.Tx, trusted integrationoperation.TrustedContext, requestID, actorUID, projectCode string, command map[string]any) (string, error) {
	id, err := uuid.Parse(requestID)
	if err != nil || id == uuid.Nil || id.String() != requestID ||
		trusted.SourceApp != "aims" || trusted.ServiceClientID != "aims.runtime" ||
		!validProductCostRulesOperation(command) || command["actorUid"] != actorUID || command["projectCode"] != projectCode {
		return "", errors.New("invalid product cost rules freeze identity")
	}
	// Use the shared canonical digest contract, also used by target receipts.
	hash, err := integrationoperation.ValidateAndDigestCommand(command)
	if err != nil {
		return "", err
	}
	key := "aims:product-cost-rules:" + requestID
	identity := integrationoperation.Identity{
		TenantCode: trusted.TenantCode, DeploymentCode: trusted.DeploymentCode,
		SourceApp: "aims", TargetApp: "finance", OperationCode: productCostRulesOperationCode,
		SourceBizType: "product_cost_rules_request", SourceBizCode: requestID,
		IdempotencyKey: key, CommandSHA256: hash,
	}
	if err = identity.Validate(); err != nil {
		return "", err
	}
	if tx == nil {
		return "", errors.New("product cost rules freeze requires transaction")
	}
	payload, err := json.Marshal(command)
	if err != nil {
		return "", err
	}
	_, err = tx.ExecContext(ctx, trusted.SQL(`INSERT INTO integration_operation(operation_id,operation_key,correlation_key,tenant_code,deployment_code,source_app,target_app,operation_code,required_capability,source_biz_type,source_biz_code,idempotency_key,command_schema_version,command_json,command_sha256,status,next_attempt_at,original_actor_uid) VALUES(?,?,?,?,?,'aims','finance',?,'finance:product-cost:replace-rules','product_cost_rules_request',?,?,'product-cost-rules.v1',?,?,'pending',UTC_TIMESTAMP(3),?) ON DUPLICATE KEY UPDATE operation_id=operation_id`),
		requestID, key, key, trusted.TenantCode, trusted.DeploymentCode, productCostRulesOperationCode, requestID, key, string(payload), hash, actorUID)
	if err != nil {
		return "", err
	}

	// A duplicate must never rewrite the command or requeue a succeeded task.
	// INSERT serializes concurrent submissions; the locking read then checks
	// every frozen identity field rather than trusting a colliding request key.
	var existing integrationoperation.Identity
	var existingID, existingKey, capability, schema, actor string
	err = tx.QueryRowContext(ctx, trusted.SQL(`SELECT operation_id,operation_key,tenant_code,deployment_code,source_app,target_app,operation_code,source_biz_type,source_biz_code,idempotency_key,command_sha256,required_capability,command_schema_version,original_actor_uid FROM integration_operation WHERE operation_id=? FOR UPDATE`), requestID).Scan(
		&existingID, &existingKey, &existing.TenantCode, &existing.DeploymentCode,
		&existing.SourceApp, &existing.TargetApp, &existing.OperationCode,
		&existing.SourceBizType, &existing.SourceBizCode, &existing.IdempotencyKey,
		&existing.CommandSHA256, &capability, &schema, &actor)
	if errors.Is(err, sql.ErrNoRows) {
		return "", errProductCostFreezeConflict
	}
	if err != nil {
		return "", err
	}
	if existingID != requestID || existingKey != key || capability != "finance:product-cost:replace-rules" ||
		schema != "product-cost-rules.v1" || actor != actorUID ||
		integrationoperation.ValidateImmutableIdentity(existing, identity) != nil {
		return "", errProductCostFreezeConflict
	}
	return key, nil
}
