package aims

import (
	"context"
	"encoding/hex"
	"github.com/huizhi-yun/data-runtime/internal/integrationoperation"
	"net/http"
	"net/url"

	"github.com/huizhi-yun/data-runtime/internal/apps/aims/productcenter"
	"github.com/huizhi-yun/data-runtime/internal/httperror"
)

func (a *Adapter) handleProductCenterVersionsRuntime(ctx context.Context, method, path string, query url.Values, body map[string]any) (any, string, bool, error) {
	for _, action := range []string{"plan", "plan-edit", "plan-items", "plan-item-create", "plan-item-edit", "plan-item-delete", "plan-confirm", "execution-coordination", "release-diff", "list", "view", "create", "edit", "scope-list", "scope-history", "scope-create", "scope-edit", "scope-deliver", "scope-reopen", "scope-visibility", "scope-legacy-criteria", "acceptance-preview", "acceptance-list", "acceptance-view", "accept", "publish", "release-view", "reopen", "release-list", "transition", "archive", "delete"} {
		code, match := pathParam(path, "/v1/aims/internal/products/", "/versions:"+action)
		if !match {
			continue
		}
		operation := "aims.product-versions." + action
		if method != http.MethodPost {
			return nil, operation, true, httperror.New(405, "method_not_allowed", "POST required")
		}
		capability := "aims:product-versions:read"
		if action == "create" || action == "edit" || action == "scope-create" || action == "scope-edit" || action == "scope-deliver" || action == "scope-reopen" || action == "scope-visibility" || action == "scope-legacy-criteria" || action == "accept" || action == "publish" || action == "reopen" || action == "archive" || action == "delete" {
			capability = "aims:product-versions:" + action
		}
		if action == "transition" {
			capability = "aims:product-versions:edit"
		}
		if action == "plan-edit" || action == "plan-item-create" || action == "plan-item-edit" || action == "plan-item-delete" || action == "plan-confirm" {
			capability = "aims:product-versions:edit"
		}
		if err := requireProductServiceCapability(query, capability); err != nil {
			return nil, operation, true, err
		}
		if action == "accept" || action == "publish" {
			hash, _ := body["execution_review_hash"].(string)
			digest, err := hex.DecodeString(hash)
			if err != nil || len(digest) != 32 || hex.EncodeToString(digest) != hash {
				return nil, operation, true, httperror.New(400, "product_execution_review_required", "必须提供受信执行明细核验快照")
			}
		}
		var permit productcenter.AuthorizationPermit
		if err := decodeProductCommandPart(body["authorization"], &permit); err != nil {
			return nil, operation, true, err
		}
		if action == "plan" {
			var input struct {
				VersionID int64 `json:"version_id"`
			}
			var requestPermit productcenter.AuthorizationPermit
			if err := decodeProductCommandPart(body["input"], &input); err != nil {
				return nil, operation, true, err
			}
			if err := decodeProductCommandPart(body["request_authorization"], &requestPermit); err != nil {
				return nil, operation, true, err
			}
			result, err := productcenter.ReadLightweightVersionPlan(ctx, a.DB(), code, query.Get("current_user"), input.VersionID, permit, requestPermit)
			return result, operation, true, productRuntimeError(err)
		}
		if action == "plan-items" {
			var input struct {
				VersionID int64 `json:"version_id"`
				productcenter.LightweightVersionPlanItemQuery
			}
			var requestPermit productcenter.AuthorizationPermit
			if err := decodeProductCommandPart(body["input"], &input); err != nil {
				return nil, operation, true, err
			}
			if err := decodeProductCommandPart(body["request_authorization"], &requestPermit); err != nil {
				return nil, operation, true, err
			}
			result, err := productcenter.ListLightweightVersionPlanItems(ctx, a.DB(), code, query.Get("current_user"), input.VersionID, permit, requestPermit, input.LightweightVersionPlanItemQuery)
			return result, operation, true, productRuntimeError(err)
		}
		if action == "plan-edit" {
			var input productcenter.LightweightVersionPlanEdit
			if err := decodeProductCommandPart(body["input"], &input); err != nil {
				return nil, operation, true, err
			}
			key, _ := body["idempotency_key"].(string)
			result, err := productcenter.EditLightweightVersionPlan(ctx, a.DB(), productcenter.CommandIdentity{ProductCode: code, ActorUID: query.Get("current_user"), Action: "product_versions:plan-edit", IdempotencyKey: key}, permit, input)
			return result, operation, true, productRuntimeError(err)
		}
		if action == "plan-item-create" {
			var input productcenter.LightweightVersionPlanItemCreate
			var requestViewPermit, requestDecisionPermit, planningPermit productcenter.AuthorizationPermit
			for _, part := range []struct {
				key    string
				target any
			}{{"input", &input}, {"request_authorization", &requestViewPermit}, {"planning_authorization", &planningPermit}} {
				if err := decodeProductCommandPart(body[part.key], part.target); err != nil {
					return nil, operation, true, err
				}
			}
			if input.AdoptRequest {
				if err := decodeProductCommandPart(body["request_decision_authorization"], &requestDecisionPermit); err != nil {
					return nil, operation, true, err
				}
			}
			key, _ := body["idempotency_key"].(string)
			result, err := productcenter.CreateLightweightVersionPlanItem(ctx, a.DB(), productcenter.CommandIdentity{ProductCode: code, ActorUID: query.Get("current_user"), Action: "product_versions:plan-item-create", IdempotencyKey: key}, permit, requestViewPermit, requestDecisionPermit, planningPermit, input, integrationoperation.TrustedContext{TenantCode: query.Get("hzy_runtime_tenant_code"), DeploymentCode: query.Get("hzy_runtime_deployment_code"), SourceApp: "aims", ServiceClientID: query.Get("hzy_runtime_service_client_id")})
			return result, operation, true, productRuntimeError(err)
		}
		if action == "plan-item-edit" {
			var input productcenter.LightweightVersionPlanItemEdit
			if err := decodeProductCommandPart(body["input"], &input); err != nil {
				return nil, operation, true, err
			}
			key, _ := body["idempotency_key"].(string)
			result, err := productcenter.EditLightweightVersionPlanItem(ctx, a.DB(), productcenter.CommandIdentity{ProductCode: code, ActorUID: query.Get("current_user"), Action: "product_versions:plan-item-edit", IdempotencyKey: key}, permit, input)
			return result, operation, true, productRuntimeError(err)
		}
		if action == "plan-item-delete" {
			var input productcenter.LightweightVersionPlanItemDelete
			if err := decodeProductCommandPart(body["input"], &input); err != nil {
				return nil, operation, true, err
			}
			key, _ := body["idempotency_key"].(string)
			result, err := productcenter.DeleteLightweightVersionPlanItem(ctx, a.DB(), productcenter.CommandIdentity{ProductCode: code, ActorUID: query.Get("current_user"), Action: "product_versions:plan-item-delete", IdempotencyKey: key}, permit, input)
			return result, operation, true, productRuntimeError(err)
		}
		if action == "plan-confirm" {
			var input productcenter.LightweightVersionPlanConfirm
			var planningPermit productcenter.AuthorizationPermit
			for _, part := range []struct {
				key    string
				target any
			}{{"input", &input}, {"planning_authorization", &planningPermit}} {
				if err := decodeProductCommandPart(body[part.key], part.target); err != nil {
					return nil, operation, true, err
				}
			}
			key, _ := body["idempotency_key"].(string)
			result, err := productcenter.ConfirmLightweightVersionPlan(ctx, a.DB(), productcenter.CommandIdentity{ProductCode: code, ActorUID: query.Get("current_user"), Action: "product_versions:plan-confirm", IdempotencyKey: key}, permit, planningPermit, input)
			return result, operation, true, productRuntimeError(err)
		}
		if action == "delete" {
			var input productcenter.ProductVersionDeleteInput
			if err := decodeProductCommandPart(body["input"], &input); err != nil {
				return nil, operation, true, err
			}
			key, _ := body["idempotency_key"].(string)
			result, err := productcenter.DeleteProductCenterVersion(ctx, a.DB(), productcenter.CommandIdentity{ProductCode: code, ActorUID: query.Get("current_user"), Action: "product_versions:delete", IdempotencyKey: key}, permit, input)
			return result, operation, true, productRuntimeError(err)
		}
		if action == "archive" {
			var input productcenter.ProductVersionArchiveInput
			if err := decodeProductCommandPart(body["input"], &input); err != nil {
				return nil, operation, true, err
			}
			key, _ := body["idempotency_key"].(string)
			result, err := productcenter.ArchiveProductVersion(ctx, a.DB(), productcenter.CommandIdentity{ProductCode: code, ActorUID: query.Get("current_user"), Action: "product_versions:archive", IdempotencyKey: key}, permit, input, integrationoperation.TrustedContext{TenantCode: query.Get("hzy_runtime_tenant_code"), DeploymentCode: query.Get("hzy_runtime_deployment_code"), SourceApp: "aims", ServiceClientID: query.Get("hzy_runtime_service_client_id")})
			return result, operation, true, productRuntimeError(err)
		}
		if action == "transition" {
			var input productcenter.ProductVersionTransitionInput
			if err := decodeProductCommandPart(body["input"], &input); err != nil {
				return nil, operation, true, err
			}
			key, _ := body["idempotency_key"].(string)
			result, err := productcenter.TransitionProductVersion(ctx, a.DB(), productcenter.CommandIdentity{ProductCode: code, ActorUID: query.Get("current_user"), Action: "product_versions:transition", IdempotencyKey: key}, permit, input, integrationoperation.TrustedContext{TenantCode: query.Get("hzy_runtime_tenant_code"), DeploymentCode: query.Get("hzy_runtime_deployment_code"), SourceApp: "aims", ServiceClientID: query.Get("hzy_runtime_service_client_id")})
			return result, operation, true, productRuntimeError(err)
		}
		if action == "execution-coordination" {
			var input struct {
				VersionID int64 `json:"version_id"`
			}
			if err := decodeProductCommandPart(body["input"], &input); err != nil {
				return nil, operation, true, err
			}
			result, err := productcenter.ReadVersionExecutionCoordination(ctx, a.DB(), code, query.Get("current_user"), permit, input.VersionID)
			return result, operation, true, productRuntimeError(err)
		}
		if action == "release-diff" {
			var input productcenter.ReleaseScopeDiffQuery
			if err := decodeProductCommandPart(body["input"], &input); err != nil {
				return nil, operation, true, err
			}
			result, err := productcenter.ReadReleaseScopeDiff(ctx, a.DB(), code, query.Get("current_user"), permit, input)
			return result, operation, true, productRuntimeError(err)
		}
		if action == "release-list" {
			var input struct {
				VersionID int64 `json:"version_id"`
				Page      int   `json:"page"`
				PageSize  int   `json:"page_size"`
			}
			if err := decodeProductCommandPart(body["input"], &input); err != nil {
				return nil, operation, true, err
			}
			result, err := productcenter.ListProductVersionReleases(ctx, a.DB(), code, query.Get("current_user"), permit, input.VersionID, productcenter.PlanningPageQuery{Page: input.Page, PageSize: input.PageSize})
			return result, operation, true, productRuntimeError(err)
		}
		if action == "release-view" {
			var input struct {
				VersionID int64 `json:"version_id"`
				RecordID  int64 `json:"record_id"`
			}
			if err := decodeProductCommandPart(body["input"], &input); err != nil {
				return nil, operation, true, err
			}
			result, err := productcenter.ReadProductVersionRelease(ctx, a.DB(), code, query.Get("current_user"), permit, input.VersionID, input.RecordID)
			return result, operation, true, productRuntimeError(err)
		}
		if action == "acceptance-list" || action == "acceptance-view" {
			var input struct {
				VersionID    int64 `json:"version_id"`
				AcceptanceID int64 `json:"acceptance_id"`
				Page         int   `json:"page"`
				PageSize     int   `json:"page_size"`
			}
			if err := decodeProductCommandPart(body["input"], &input); err != nil {
				return nil, operation, true, err
			}
			if action == "acceptance-list" {
				result, err := productcenter.ListProductVersionAcceptances(ctx, a.DB(), code, query.Get("current_user"), permit, input.VersionID, productcenter.PlanningPageQuery{Page: input.Page, PageSize: input.PageSize})
				return result, operation, true, productRuntimeError(err)
			}
			result, err := productcenter.ReadProductVersionAcceptance(ctx, a.DB(), code, query.Get("current_user"), permit, input.VersionID, input.AcceptanceID)
			return result, operation, true, productRuntimeError(err)
		}
		if action == "acceptance-preview" {
			var input struct {
				VersionID int64 `json:"version_id"`
			}
			if err := decodeProductCommandPart(body["input"], &input); err != nil {
				return nil, operation, true, err
			}
			result, err := productcenter.PreviewProductVersionAcceptance(ctx, a.DB(), code, query.Get("current_user"), permit, input.VersionID)
			return result, operation, true, productRuntimeError(err)
		}
		if action == "reopen" {
			var input productcenter.ProductVersionReopenInput
			if err := decodeProductCommandPart(body["input"], &input); err != nil {
				return nil, operation, true, err
			}
			key, _ := body["idempotency_key"].(string)
			result, err := productcenter.ReopenProductVersion(ctx, a.DB(), productcenter.CommandIdentity{ProductCode: code, ActorUID: query.Get("current_user"), Action: "product_versions:reopen", IdempotencyKey: key}, permit, input, integrationoperation.TrustedContext{TenantCode: query.Get("hzy_runtime_tenant_code"), DeploymentCode: query.Get("hzy_runtime_deployment_code"), SourceApp: "aims", ServiceClientID: query.Get("hzy_runtime_service_client_id")})
			return result, operation, true, productRuntimeError(err)
		}
		if action == "publish" {
			var input productcenter.ProductVersionPublishInput
			if err := decodeProductCommandPart(body["input"], &input); err != nil {
				return nil, operation, true, err
			}
			key, _ := body["idempotency_key"].(string)
			executionHash, _ := body["execution_review_hash"].(string)
			result, err := productcenter.PublishProductVersionWithFeedback(ctx, a.DB(), productcenter.CommandIdentity{ProductCode: code, ActorUID: query.Get("current_user"), Action: "product_versions:publish", IdempotencyKey: key}, permit, input, integrationoperation.TrustedContext{TenantCode: query.Get("hzy_runtime_tenant_code"), DeploymentCode: query.Get("hzy_runtime_deployment_code"), SourceApp: "aims", ServiceClientID: query.Get("hzy_runtime_service_client_id")}, executionHash)
			return result, operation, true, productRuntimeError(err)
		}
		if action == "accept" {
			var input productcenter.ProductVersionAcceptanceInput
			if err := decodeProductCommandPart(body["input"], &input); err != nil {
				return nil, operation, true, err
			}
			key, _ := body["idempotency_key"].(string)
			executionHash, _ := body["execution_review_hash"].(string)
			result, err := productcenter.AcceptProductVersion(ctx, a.DB(), productcenter.CommandIdentity{ProductCode: code, ActorUID: query.Get("current_user"), Action: "product_versions:accept", IdempotencyKey: key}, permit, input, executionHash)
			return result, operation, true, productRuntimeError(err)
		}
		if action == "scope-history" {
			var input struct {
				VersionID int64 `json:"version_id"`
				ScopeID   int64 `json:"scope_id"`
				Page      int   `json:"page"`
				PageSize  int   `json:"page_size"`
			}
			if err := decodeProductCommandPart(body["input"], &input); err != nil {
				return nil, operation, true, err
			}
			result, err := productcenter.ListProductVersionScopeHistory(ctx, a.DB(), code, query.Get("current_user"), permit, input.VersionID, input.ScopeID, input.Page, input.PageSize)
			return result, operation, true, productRuntimeError(err)
		}
		if action == "scope-list" {
			var input struct {
				VersionID int64  `json:"version_id"`
				Page      int    `json:"page"`
				PageSize  int    `json:"page_size"`
				Keyword   string `json:"keyword"`
			}
			if err := decodeProductCommandPart(body["input"], &input); err != nil {
				return nil, operation, true, err
			}
			result, err := productcenter.ListProductVersionScope(ctx, a.DB(), code, query.Get("current_user"), permit, input.VersionID, productcenter.PlanningPageQuery{Page: input.Page, PageSize: input.PageSize, Keyword: input.Keyword})
			return result, operation, true, productRuntimeError(err)
		}
		if action == "scope-legacy-criteria" {
			var input productcenter.LegacyProductVersionScopeCriteria
			if err := decodeProductCommandPart(body["input"], &input); err != nil {
				return nil, operation, true, err
			}
			key, _ := body["idempotency_key"].(string)
			result, err := productcenter.UpdateLegacyProductVersionScopeCriteria(ctx, a.DB(), productcenter.CommandIdentity{ProductCode: code, ActorUID: query.Get("current_user"), Action: "product_versions:scope-legacy-criteria", IdempotencyKey: key}, permit, input)
			return result, operation, true, productRuntimeError(err)
		}
		if action == "scope-visibility" {
			var input productcenter.ProductVersionScopeVisibility
			if err := decodeProductCommandPart(body["input"], &input); err != nil {
				return nil, operation, true, err
			}
			key, _ := body["idempotency_key"].(string)
			result, err := productcenter.ChangeProductVersionScopeVisibility(ctx, a.DB(), productcenter.CommandIdentity{ProductCode: code, ActorUID: query.Get("current_user"), Action: "product_versions:scope-visibility", IdempotencyKey: key}, permit, input, integrationoperation.TrustedContext{TenantCode: query.Get("hzy_runtime_tenant_code"), DeploymentCode: query.Get("hzy_runtime_deployment_code"), SourceApp: "aims", ServiceClientID: query.Get("hzy_runtime_service_client_id")})
			return result, operation, true, productRuntimeError(err)
		}
		if action == "scope-reopen" {
			var input productcenter.ProductVersionScopeReopen
			if err := decodeProductCommandPart(body["input"], &input); err != nil {
				return nil, operation, true, err
			}
			key, _ := body["idempotency_key"].(string)
			result, err := productcenter.ReopenProductVersionScope(ctx, a.DB(), productcenter.CommandIdentity{ProductCode: code, ActorUID: query.Get("current_user"), Action: "product_versions:scope-reopen", IdempotencyKey: key}, permit, input, integrationoperation.TrustedContext{TenantCode: query.Get("hzy_runtime_tenant_code"), DeploymentCode: query.Get("hzy_runtime_deployment_code"), SourceApp: "aims", ServiceClientID: query.Get("hzy_runtime_service_client_id")})
			return result, operation, true, productRuntimeError(err)
		}
		if action == "scope-deliver" {
			var input productcenter.ProductVersionScopeDelivery
			if err := decodeProductCommandPart(body["input"], &input); err != nil {
				return nil, operation, true, err
			}
			key, _ := body["idempotency_key"].(string)
			result, err := productcenter.ConfirmProductVersionScopeDelivery(ctx, a.DB(), productcenter.CommandIdentity{ProductCode: code, ActorUID: query.Get("current_user"), Action: "product_versions:scope-deliver", IdempotencyKey: key}, permit, input, integrationoperation.TrustedContext{TenantCode: query.Get("hzy_runtime_tenant_code"), DeploymentCode: query.Get("hzy_runtime_deployment_code"), SourceApp: "aims", ServiceClientID: query.Get("hzy_runtime_service_client_id")})
			return result, operation, true, productRuntimeError(err)
		}
		if action == "scope-edit" {
			var input productcenter.ProductVersionScopeEdit
			var planning productcenter.AuthorizationPermit
			if err := decodeProductCommandPart(body["input"], &input); err != nil {
				return nil, operation, true, err
			}
			if err := decodeProductCommandPart(body["planning_authorization"], &planning); err != nil {
				return nil, operation, true, err
			}
			key, _ := body["idempotency_key"].(string)
			result, err := productcenter.EditProductVersionScope(ctx, a.DB(), productcenter.CommandIdentity{ProductCode: code, ActorUID: query.Get("current_user"), Action: "product_versions:scope-edit", IdempotencyKey: key}, permit, planning, input)
			return result, operation, true, productRuntimeError(err)
		}
		if action == "scope-create" {
			var input productcenter.ProductVersionScopeDraft
			var planning productcenter.AuthorizationPermit
			if err := decodeProductCommandPart(body["input"], &input); err != nil {
				return nil, operation, true, err
			}
			if err := decodeProductCommandPart(body["planning_authorization"], &planning); err != nil {
				return nil, operation, true, err
			}
			key, _ := body["idempotency_key"].(string)
			result, err := productcenter.CreateProductVersionScope(ctx, a.DB(), productcenter.CommandIdentity{ProductCode: code, ActorUID: query.Get("current_user"), Action: "product_versions:scope-create", IdempotencyKey: key}, permit, planning, input, integrationoperation.TrustedContext{TenantCode: query.Get("hzy_runtime_tenant_code"), DeploymentCode: query.Get("hzy_runtime_deployment_code"), SourceApp: "aims", ServiceClientID: query.Get("hzy_runtime_service_client_id")})
			return result, operation, true, productRuntimeError(err)
		}
		if action == "list" {
			var input productcenter.ProductVersionPageQuery
			if err := decodeProductCommandPart(body["input"], &input); err != nil {
				return nil, operation, true, err
			}
			result, err := productcenter.ListProductCenterVersions(ctx, a.DB(), code, query.Get("current_user"), permit, input)
			return result, operation, true, productRuntimeError(err)
		}
		if action == "view" {
			var input struct {
				VersionID int64 `json:"version_id"`
			}
			if err := decodeProductCommandPart(body["input"], &input); err != nil {
				return nil, operation, true, err
			}
			result, err := productcenter.ReadProductCenterVersion(ctx, a.DB(), code, query.Get("current_user"), permit, input.VersionID)
			return result, operation, true, productRuntimeError(err)
		}
		if action == "edit" {
			var input productcenter.ProductVersionEdit
			if err := decodeProductCommandPart(body["input"], &input); err != nil {
				return nil, operation, true, err
			}
			key, _ := body["idempotency_key"].(string)
			result, err := productcenter.EditProductCenterVersion(ctx, a.DB(), productcenter.CommandIdentity{ProductCode: code, ActorUID: query.Get("current_user"), Action: "product_versions:edit", IdempotencyKey: key}, permit, input, integrationoperation.TrustedContext{TenantCode: query.Get("hzy_runtime_tenant_code"), DeploymentCode: query.Get("hzy_runtime_deployment_code"), SourceApp: "aims", ServiceClientID: query.Get("hzy_runtime_service_client_id")})
			return result, operation, true, productRuntimeError(err)
		}
		var input productcenter.ProductVersionDraft
		if err := decodeProductCommandPart(body["input"], &input); err != nil {
			return nil, operation, true, err
		}
		key, _ := body["idempotency_key"].(string)
		result, err := productcenter.CreateProductCenterVersion(ctx, a.DB(), productcenter.CommandIdentity{ProductCode: code, ActorUID: query.Get("current_user"), Action: "product_versions:create", IdempotencyKey: key}, permit, input)
		return result, operation, true, productRuntimeError(err)
	}
	return nil, "", false, nil
}
