package aims

import (
	"context"
	"database/sql"
	"net/http"
	"net/url"

	"github.com/huizhi-yun/data-runtime/internal/apps/aims/productcenter"
	"github.com/huizhi-yun/data-runtime/internal/httperror"
)

func (a *Adapter) handleProductHandoffRuntime(ctx context.Context, method, path string, query url.Values, body map[string]any) (any, string, bool, error) {
	for _, suffix := range []string{"handoff-project:authorization", "planning-handoff:create"} {
		code, match := pathParam(path, "/v1/aims/internal/products/", "/"+suffix)
		if !match {
			continue
		}
		operation := "aims.product-priorities." + suffix
		if method != http.MethodPost {
			return nil, operation, true, httperror.New(405, "method_not_allowed", "POST required")
		}
		capability := "aims:product-priorities:handoff"
		if suffix == "handoff-project:authorization" {
			capability = "aims:product-priorities:project-authorization"
		}
		if err := requireProductServiceCapability(query, capability); err != nil {
			return nil, operation, true, err
		}
		uid := query.Get("current_user")
		if suffix == "handoff-project:authorization" {
			var input struct {
				ProjectCode string `json:"project_code"`
			}
			if err := decodeProductCommandPart(body["input"], &input); err != nil {
				return nil, operation, true, err
			}
			facts, err := loadProductHandoffProjectFacts(ctx, a.DB(), input.ProjectCode, uid)
			return facts, operation, true, productRuntimeError(err)
		}
		var input productcenter.PlanningHandoffInput
		var planningPermit, requestPermit, versionPermit productcenter.AuthorizationPermit
		var projectPermit productHandoffProjectPermit
		for _, part := range []struct {
			key    string
			target any
		}{{"input", &input}, {"planning_authorization", &planningPermit}, {"project_authorization", &projectPermit}} {
			if err := decodeProductCommandPart(body[part.key], part.target); err != nil {
				return nil, operation, true, err
			}
		}
		if input.RequestBizID != "" {
			if err := decodeProductCommandPart(body["request_authorization"], &requestPermit); err != nil {
				return nil, operation, true, err
			}
		}
		if input.PlannedVersionID > 0 {
			if err := decodeProductCommandPart(body["version_authorization"], &versionPermit); err != nil {
				return nil, operation, true, err
			}
		}
		var projectID int64
		target := productcenter.PlanningHandoffTarget{
			AuthorizeProject: func(ctx context.Context, tx *sql.Tx) (int64, error) {
				if input.PlannedVersionID > 0 {
					if err := productcenter.AuthorizeWorkspaceTransaction(ctx, tx, code, uid, "product_versions", "view", versionPermit); err != nil {
						return 0, err
					}
				}
				var err error
				projectID, err = authorizeProductHandoffProjectTx(ctx, tx, input.ProjectCode, uid, projectPermit)
				return projectID, err
			},
			ResolveRequirement: func(ctx context.Context, tx *sql.Tx) (int64, error) {
				return a.resolveProductHandoffRequirementTx(ctx, tx, code, uid, projectID, input)
			},
		}
		key, _ := body["idempotency_key"].(string)
		result, err := productcenter.HandoffPlanningItem(ctx, a.DB(), productcenter.CommandIdentity{ProductCode: code, ActorUID: uid, Action: "product_priorities:handoff", IdempotencyKey: key}, planningPermit, requestPermit, input, target)
		return result, operation, true, productRuntimeError(err)
	}
	return nil, "", false, nil
}
