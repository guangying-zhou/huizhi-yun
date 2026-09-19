package server

import (
	"encoding/json"
	aimsapp "github.com/huizhi-yun/data-runtime/internal/apps/aims"
	pc "github.com/huizhi-yun/data-runtime/internal/apps/aims/productcenter"
	"github.com/huizhi-yun/data-runtime/internal/enterprise"
	"github.com/huizhi-yun/data-runtime/internal/httperror"
	"net/http"
	"regexp"
	"time"
)

var enterpriseVersionActions = map[string]string{
	"/v1/enterprise/aims/product-version:execution-coordination":          "execution-coordination",
	"/v1/enterprise/aims/product-version:release-view":                    "release-view",
	"/v1/enterprise/aims/product-version:release-list":                    "release-list",
	"/v1/enterprise/aims/product-version:acceptance-view":                 "acceptance-view",
	"/v1/enterprise/aims/product-version:acceptance-list":                 "acceptance-list",
	"/v1/enterprise/aims/product-version:edit":                            "edit",
	"/v1/enterprise/aims/product-version:delete":                          "delete",
	"/v1/enterprise/aims/product-version:transition":                      "transition",
	"/v1/enterprise/aims/product-version:reopen":                          "reopen",
	"/v1/enterprise/aims/product-version:archive":                         "archive",
	"/v1/enterprise/aims/product-version:accept":                          "accept",
	"/v1/enterprise/aims/product-version:publish":                         "publish",
	"/v1/enterprise/aims/product-version:acceptance-preview":              "acceptance-preview",
	"/v1/enterprise/aims/product-version:execution-project-authorization": "execution-project-authorization",
}

var enterpriseVersionReviewHash = regexp.MustCompile(`^[0-9a-f]{64}$`)

type enterpriseVersionInput struct {
	ProductCode         string                 `json:"productCode"`
	Tenant              string                 `json:"tenant"`
	Deployment          string                 `json:"deployment"`
	Input               json.RawMessage        `json:"input"`
	Authorization       pc.AuthorizationPermit `json:"authorization"`
	ExecutionReviewHash string                 `json:"execution_review_hash,omitempty"`
}

func (s *Server) routeEnterpriseVersionCommand(r *http.Request, action string) (routeResult, error) {
	if !s.cfg.Enterprise.Enabled || s.enterpriseVersions == nil {
		return routeResult{}, httperror.New(503, "enterprise_version_unavailable", "Enterprise version service is not enabled")
	}
	permission := action
	if action == "transition" {
		permission = "edit"
	}
	capability := permission
	if action == "execution-coordination" || action == "acceptance-preview" || action == "execution-project-authorization" || action == "acceptance-list" || action == "acceptance-view" || action == "release-list" || action == "release-view" {
		permission, capability = "view", "read"
	}
	route := enterpriseRouteContext{Binding: enterprise.BindingKey{Tenant: s.cfg.Tenant, Environment: s.cfg.Enterprise.Environment, RuntimeDeployment: s.cfg.Deployment}, HostDeployment: s.cfg.DeploymentBindings["enterprise"], LogicalSource: "aims", LogicalTarget: "aims", Action: capability, Capability: "aims:product-versions:" + capability}
	verified, err := authenticateEnterpriseRequest(r, s.auth, route, s.verifyEnterpriseCredential)
	if err != nil {
		return routeResult{}, err
	}
	result := routeResult{Operation: "enterprise.aims.versions." + action, Auth: &verified.Service}
	if r.URL.RawQuery != "" {
		return result, httperror.New(400, "enterprise_version_input_invalid", "Version query parameters are not supported")
	}
	body, err := readJSONBody(r)
	if err != nil {
		return result, err
	}
	raw, err := json.Marshal(body)
	if err != nil {
		return result, err
	}
	var input enterpriseVersionInput
	if err = decodeEnterprisePlanningInput(raw, &input); err != nil {
		return result, err
	}
	if err = validateEnterpriseProductPermit(input.ProductCode, input.Tenant, input.Deployment, input.Authorization, "product_versions", permission, verified, time.Now()); err != nil {
		return result, err
	}
	if action == "accept" || action == "publish" {
		if !enterpriseVersionReviewHash.MatchString(input.ExecutionReviewHash) {
			return result, httperror.New(400, "enterprise_version_review_required", "A verified execution review hash is required")
		}
	} else if input.ExecutionReviewHash != "" {
		return result, httperror.New(400, "enterprise_version_review_unexpected", "Execution review is not supported for this action")
	}
	if action == "acceptance-preview" {
		var value struct {
			VersionID int64 `json:"version_id"`
		}
		if err = decodeEnterprisePlanningInput(input.Input, &value); err != nil {
			return result, err
		}
		preview, readErr := s.enterpriseVersions.AcceptancePreview(r.Context(), input.ProductCode, verified.ActorUID, input.Authorization, value.VersionID)
		if readErr != nil {
			return result, aimsapp.EnterpriseProductCommandError(readErr)
		}
		result.Body = map[string]any{"code": 0, "data": preview}
		return result, nil
	}
	if action == "acceptance-list" || action == "acceptance-view" || action == "release-list" || action == "release-view" {
		var history any
		switch action {
		case "acceptance-list", "release-list":
			var v struct {
				VersionID int64 `json:"version_id"`
				Page      int   `json:"page"`
				PageSize  int   `json:"page_size"`
			}
			if err = decodeEnterprisePlanningInput(input.Input, &v); err != nil {
				return result, err
			}
			q := pc.PlanningPageQuery{Page: v.Page, PageSize: v.PageSize}
			if action == "acceptance-list" {
				history, err = s.enterpriseVersions.ListProductVersionAcceptances(r.Context(), input.ProductCode, verified.ActorUID, input.Authorization, v.VersionID, q)
			} else {
				history, err = s.enterpriseVersions.ListProductVersionReleases(r.Context(), input.ProductCode, verified.ActorUID, input.Authorization, v.VersionID, q)
			}
		case "acceptance-view":
			var v struct {
				VersionID    int64 `json:"version_id"`
				AcceptanceID int64 `json:"acceptance_id"`
			}
			if err = decodeEnterprisePlanningInput(input.Input, &v); err != nil {
				return result, err
			}
			history, err = s.enterpriseVersions.ReadProductVersionAcceptance(r.Context(), input.ProductCode, verified.ActorUID, input.Authorization, v.VersionID, v.AcceptanceID)
		case "release-view":
			var v struct {
				VersionID int64 `json:"version_id"`
				RecordID  int64 `json:"record_id"`
			}
			if err = decodeEnterprisePlanningInput(input.Input, &v); err != nil {
				return result, err
			}
			history, err = s.enterpriseVersions.ReadProductVersionRelease(r.Context(), input.ProductCode, verified.ActorUID, input.Authorization, v.VersionID, v.RecordID)
		}
		if err != nil {
			return result, aimsapp.EnterpriseProductCommandError(err)
		}
		result.Body = map[string]any{"code": 0, "data": history}
		return result, nil
	}
	identity := pc.CommandIdentity{ProductCode: input.ProductCode, ActorUID: verified.ActorUID, Action: "product_versions:" + action, IdempotencyKey: r.Header.Get("Idempotency-Key")}
	if action == "execution-coordination" {
		var v struct {
			VersionID int64 `json:"version_id"`
		}
		if err = decodeEnterprisePlanningInput(input.Input, &v); err != nil {
			return result, err
		}
		out, readErr := s.enterpriseVersions.ExecutionCoordination(r.Context(), input.ProductCode, verified.ActorUID, input.Authorization, v.VersionID)
		if readErr != nil {
			return result, aimsapp.EnterpriseProductCommandError(readErr)
		}
		result.Body = map[string]any{"code": 0, "data": out}
		return result, nil
	}
	if action == "execution-project-authorization" {
		var value struct {
			VersionID int64 `json:"version_id"`
			ProjectID int64 `json:"project_id"`
		}
		if err = decodeEnterprisePlanningInput(input.Input, &value); err != nil {
			return result, err
		}
		facts, readErr := s.enterpriseVersions.ExecutionProjectAuthorization(r.Context(), input.ProductCode, verified.ActorUID, input.Authorization, value.VersionID, value.ProjectID)
		if readErr != nil {
			return result, aimsapp.EnterpriseProductCommandError(readErr)
		}
		result.Body = map[string]any{"code": 0, "data": facts}
		return result, nil
	}
	var output pc.CommandResult
	switch action {
	case "accept":
		var value pc.ProductVersionAcceptanceInput
		if err = decodeEnterprisePlanningInput(input.Input, &value); err == nil {
			output, err = s.enterpriseVersions.Accept(r.Context(), identity, input.Authorization, value, input.ExecutionReviewHash)
		}
	case "publish":
		var value pc.ProductVersionPublishInput
		if err = decodeEnterprisePlanningInput(input.Input, &value); err == nil {
			output, err = s.enterpriseVersions.Publish(r.Context(), identity, input.Authorization, value, input.ExecutionReviewHash)
		}
	case "edit":
		var value pc.ProductVersionEdit
		if err = decodeEnterprisePlanningInput(input.Input, &value); err == nil {
			output, err = s.enterpriseVersions.Edit(r.Context(), identity, input.Authorization, value)
		}
	case "delete":
		var value pc.ProductVersionDeleteInput
		if err = decodeEnterprisePlanningInput(input.Input, &value); err == nil {
			output, err = s.enterpriseVersions.Delete(r.Context(), identity, input.Authorization, value)
		}
	case "transition":
		var value pc.ProductVersionTransitionInput
		if err = decodeEnterprisePlanningInput(input.Input, &value); err == nil {
			output, err = s.enterpriseVersions.Transition(r.Context(), identity, input.Authorization, value)
		}
	case "reopen":
		var value pc.ProductVersionReopenInput
		if err = decodeEnterprisePlanningInput(input.Input, &value); err == nil {
			output, err = s.enterpriseVersions.Reopen(r.Context(), identity, input.Authorization, value)
		}
	case "archive":
		var value pc.ProductVersionArchiveInput
		if err = decodeEnterprisePlanningInput(input.Input, &value); err == nil {
			output, err = s.enterpriseVersions.Archive(r.Context(), identity, input.Authorization, value)
		}
	default:
		return result, httperror.New(404, "enterprise_version_action_unknown", "Unknown version action")
	}
	if err != nil {
		return result, aimsapp.EnterpriseProductCommandError(err)
	}
	result.Body = map[string]any{"code": 0, "data": output}
	return result, nil
}
