package aims

import (
	"bytes"
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"net/http"
	"net/url"

	"github.com/go-sql-driver/mysql"
	"github.com/huizhi-yun/data-runtime/internal/apps/aims/productcenter"
	"github.com/huizhi-yun/data-runtime/internal/httperror"
)

func (a *Adapter) handleProductWorkspaceRuntime(ctx context.Context, method, path string, query url.Values, body map[string]any) (any, string, bool, error) {
	for _, action := range []string{"view", "edit", "archive", "restore"} {
		code, match := pathParam(path, "/v1/aims/internal/products/", "/workspace:"+action)
		if !match {
			continue
		}
		operation := "aims.products.workspace." + action
		if method != http.MethodPost {
			return nil, operation, true, httperror.New(http.StatusMethodNotAllowed, "method_not_allowed", "POST required")
		}
		if err := requireProductServiceCapability(query, "aims:products:"+action); err != nil {
			return nil, operation, true, err
		}
		var permit productcenter.AuthorizationPermit
		if err := decodeProductCommandPart(body["authorization"], &permit); err != nil {
			return nil, operation, true, err
		}
		uid := query.Get("current_user")
		if action == "view" {
			data, err := productcenter.ReadWorkspace(ctx, a.DB(), code, uid, permit)
			return data, operation, true, productRuntimeError(err)
		}
		var input productcenter.WorkspaceChange
		if err := decodeProductCommandPart(body["input"], &input); err != nil {
			return nil, operation, true, err
		}
		if action == "edit" {
			fields, ok := body["input"].(map[string]any)
			if !ok {
				return nil, operation, true, httperror.New(400, "invalid_product_input", "workspace fields required")
			}
			for _, key := range []string{"positioning", "target_users", "value_statement"} {
				if _, present := fields[key]; !present {
					return nil, operation, true, httperror.New(400, "invalid_product_input", "all positioning fields must be explicit")
				}
			}
		}
		key, _ := body["idempotency_key"].(string)
		identity := productcenter.CommandIdentity{ProductCode: code, ActorUID: uid, Action: "products:" + action, IdempotencyKey: key}
		data, err := productcenter.ChangeWorkspace(ctx, a.DB(), identity, permit, input)
		return data, operation, true, productRuntimeError(err)
	}
	return nil, "", false, nil
}

func decodeProductCommandPart(value any, target any) error {
	if value == nil {
		return httperror.New(400, "invalid_product_input", "product command data required")
	}
	encoded, err := json.Marshal(value)
	if err != nil || len(encoded) > 256*1024 {
		return httperror.New(400, "invalid_product_input", "invalid product command data")
	}
	decoder := json.NewDecoder(bytes.NewReader(encoded))
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(target); err != nil {
		return httperror.New(400, "invalid_product_input", "invalid product command fields")
	}
	return nil
}

func productRuntimeError(err error) error {
	if err == nil {
		return nil
	}
	if errors.Is(err, sql.ErrNoRows) {
		return httperror.New(404, "product_not_found", "产品空间不存在或不可见")
	}
	var sqlErr *mysql.MySQLError
	if errors.As(err, &sqlErr) && sqlErr.Number == 1062 {
		return httperror.New(409, "product_unique_conflict", "相同产品关系已存在")
	}
	if errors.As(err, &sqlErr) && (sqlErr.Number == 1146 || sqlErr.Number == 1054) {
		return httperror.New(503, "product_schema_unavailable", "产品中心数据库尚未就绪")
	}
	var rule *productcenter.RuleError
	if errors.As(err, &rule) {
		status := http.StatusBadRequest
		switch rule.Code {
		case "planning_comment_not_found":
			status = http.StatusNotFound
		case "product_line_already_managed", "product_line_has_managed_products", "product_line_source_changed", "product_line_code_conflict", "product_managed_by_line", "product_component_source_bound", "planning_comment_revision_conflict", "planning_comment_deleted", "planning_cycle_closed", "planning_handoff_slice_conflict", "planning_handoff_source_required", "planning_delivery_selection_required", "planning_consumption_state_invalid", "planning_withdrawal_not_selected", "planning_withdrawal_consumption_required", "planning_observation_already_corrected", "planning_selection_already_selected", "planning_decision_changed", "assessment_required", "priority_queue_conflict", "planning_dependency_order_invalid", "product_planning_revision_conflict", "product_planning_readonly", "planning_cycle_revision_conflict", "planning_cycle_readonly", "planning_cycle_state_conflict", "planning_cycle_already_open", "planning_cycle_period_expired":
			status = http.StatusConflict
		case "product_version_referenced", "product_version_owner_required", "product_version_owner_unavailable", "product_version_review_changed", "product_version_acceptance_stale", "product_version_self_publish", "product_version_scope_unresolved", "product_version_scope_binding_invalid", "product_version_execution_unresolved", "product_version_execution_binding_invalid", "product_version_exception_stale", "product_version_acceptance_criteria_required", "product_version_scope_locked", "product_version_scope_feature_changed", "product_version_scope_conflict", "product_version_scope_feature_invalid", "product_version_revision_conflict", "product_version_locked", "product_planning_feature_conflict", "product_feature_lifecycle_conflict", "product_feature_release_evidence_invalid", "product_feature_request_state_conflict", "product_feature_request_state_invalid", "product_feature_referenced", "product_feature_delete_state_invalid", "product_feature_revision_conflict", "product_source_revision_conflict", "product_source_external_contract_required", "product_request_state_conflict", "product_request_revision_conflict", "product_request_merged_readonly", "product_catalog_revision_conflict", "product_catalog_changed", "product_catalog_superseded", "product_already_onboarded", "product_source_evidence_invalid", "product_last_manager", "product_member_revision_conflict", "product_directory_evidence_invalid":
			status = http.StatusConflict
		case "planning_comment_author_required", "product_authorization_invalid":
			status = http.StatusForbidden
		case "assessment_model_version_conflict", "assessment_model_unchanged", "planning_cross_dependency_conflict", "product_roadmap_commitment_conflict", "product_roadmap_commitment_unchanged", "product_component_referenced", "product_component_revision_conflict", "product_objective_cycle_mapping_conflict", "product_objective_revision_conflict", "product_objective_state_conflict", "product_objective_correction_conflict", "product_authorization_expired", "product_authorization_changed", "product_revision_conflict", "product_state_conflict", "product_archived", "idempotency_payload_mismatch", "product_command_incomplete_receipt":
			status = http.StatusConflict
		}
		return httperror.New(status, rule.Code, rule.Message)
	}
	return err
}

// EnterpriseProductCommandError preserves the existing owning-domain HTTP
// contract for unified Runtime callers without exposing unclassified SQL errors.
func EnterpriseProductCommandError(err error) error {
	mapped := productRuntimeError(err)
	if mapped == nil {
		return nil
	}
	var public httperror.Error
	if errors.As(mapped, &public) {
		return public
	}
	return httperror.New(503, "enterprise_product_command_unavailable", "产品需求服务暂不可用")
}
