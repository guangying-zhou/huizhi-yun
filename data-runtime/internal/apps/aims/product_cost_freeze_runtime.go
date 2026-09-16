package aims

import (
	"context"
	"database/sql"
	"errors"
	"net/http"
	"net/url"
	"strconv"
	"time"

	"github.com/google/uuid"
	"github.com/huizhi-yun/data-runtime/internal/httperror"
	"github.com/huizhi-yun/data-runtime/internal/integrationoperation"
)

func (a *Adapter) handleProductCostFreezeRuntime(ctx context.Context, method, path string, query url.Values, body map[string]any) (any, string, bool, error) {
	readStatus := path == "/v1/aims/internal/product-cost-rules:status"
	if path != "/v1/aims/internal/product-cost-rules:freeze" && !readStatus {
		return nil, "", false, nil
	}
	action := "freeze"
	if readStatus {
		action = "status"
	}
	operation := "aims.product-cost-rules." + action
	fail := func(status int, code string) (any, string, bool, error) {
		return nil, operation, true, httperror.New(status, code, code)
	}
	if method != http.MethodPost {
		return fail(405, "method_not_allowed")
	}
	if err := requireProductServiceCapability(query, "aims:product-cost-rules:"+action); err != nil {
		return nil, operation, true, err
	}
	if query.Get("hzy_runtime_service_client_id") != "aims.runtime" {
		return fail(403, "product_cost_source_invalid")
	}
	command, ok := body["command"].(map[string]any)
	if !readStatus && (!ok || !validProductCostRulesOperation(command) || len(body) != 3) || readStatus && len(body) != 2 {
		return fail(400, "product_cost_command_invalid")
	}
	requestID, _ := body["requestId"].(string)
	parsedID, parseErr := uuid.Parse(requestID)
	if parseErr != nil || parsedID == uuid.Nil || parsedID.String() != requestID {
		return fail(400, "product_cost_request_invalid")
	}
	permit, ok := body["authorization"].(map[string]any)
	if !ok || len(permit) != 7 {
		return fail(403, "product_cost_authorization_invalid")
	}
	actor := query.Get("current_user")
	projectID, _ := permit["projectId"].(string)
	id, err := strconv.ParseInt(projectID, 10, 64)
	expiry, validExpiry := permit["expiresAt"].(float64)
	now := time.Now().UnixMilli()
	if err != nil || id <= 0 || strconv.FormatInt(id, 10) != projectID || !validExpiry ||
		expiry != float64(int64(expiry)) || expiry <= float64(now) || expiry > float64(now+30000) ||
		permit["actorUid"] != actor || (!readStatus && (command["actorUid"] != actor || permit["projectCode"] != command["projectCode"])) ||
		permit["resource"] != "projects" || permit["action"] != "edit" || permit["purpose"] != "product_cost_rules_"+action {
		return fail(403, "product_cost_authorization_invalid")
	}
	tx, err := a.DB().BeginTx(ctx, nil)
	if err != nil {
		return nil, operation, true, err
	}
	defer tx.Rollback()
	var projectCode string
	err = tx.QueryRowContext(ctx, "SELECT project_code FROM aims_projects WHERE id=? FOR UPDATE", id).Scan(&projectCode)
	if errors.Is(err, sql.ErrNoRows) {
		return fail(404, "project_not_found")
	}
	if err != nil {
		return nil, operation, true, err
	}
	if projectCode != permit["projectCode"] {
		return fail(409, "product_cost_project_changed")
	}
	trusted := integrationoperation.TrustedContext{TenantCode: query.Get("hzy_runtime_tenant_code"), DeploymentCode: query.Get("hzy_runtime_deployment_code"), SourceApp: "aims", ServiceClientID: "aims.runtime"}

	if readStatus {
		var status string
		err = tx.QueryRowContext(ctx, `SELECT status FROM integration_operation WHERE operation_id=? AND BINARY tenant_code=BINARY ? AND BINARY deployment_code=BINARY ? AND source_app='aims' AND target_app='finance' AND operation_code=? AND required_capability='finance:product-cost:replace-rules' AND BINARY original_actor_uid=BINARY ? AND BINARY JSON_UNQUOTE(JSON_EXTRACT(command_json,'$.projectCode'))=BINARY ?`, requestID, trusted.TenantCode, trusted.DeploymentCode, productCostRulesOperationCode, actor, projectCode).Scan(&status)
		if errors.Is(err, sql.ErrNoRows) {
			return fail(404, "product_cost_request_not_found")
		}
		if err != nil {
			return nil, operation, true, err
		}
		pending := false
		switch status {
		case "pending", "processing", "retry_wait", "partial_unknown":
			pending = true
		case "succeeded", "cancelled", "failed_permanent", "dead_letter":
		default:
			return fail(503, "product_cost_request_status_invalid")
		}
		if err = tx.Commit(); err != nil {
			return nil, operation, true, err
		}
		return map[string]any{"requestId": requestID, "projectCode": projectCode, "status": status, "synced": status == "succeeded", "pending": pending}, operation, true, nil
	}
	if err := validateProductCostReferences(ctx, tx, command); err != nil {
		if errors.Is(err, errProductCostReferenceMissing) {
			return fail(400, "product_cost_product_reference_invalid")
		}
		return nil, operation, true, err
	}
	key, err := freezeProductCostRules(ctx, tx, trusted, requestID, actor, projectCode, command)
	if errors.Is(err, errProductCostFreezeConflict) {
		return fail(409, "product_cost_request_conflict")
	}
	if err != nil {
		return nil, operation, true, err
	}
	if err = tx.Commit(); err != nil {
		return nil, operation, true, err
	}
	return map[string]any{"requestId": requestID, "operationKey": key, "projectCode": projectCode}, operation, true, nil
}
