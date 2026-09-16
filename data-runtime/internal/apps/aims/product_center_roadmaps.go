package aims

import (
	"context"
	"github.com/huizhi-yun/data-runtime/internal/apps/aims/productcenter"
	"github.com/huizhi-yun/data-runtime/internal/httperror"
	"net/http"
	"net/url"
)

func (a *Adapter) handleProductCenterRoadmapsRuntime(ctx context.Context, method, path string, query url.Values, body map[string]any) (any, string, bool, error) {
	for _, action := range []string{"window-view", "window-edit", "quarter-view", "commitments", "cross-snapshots", "cross-snapshot-targets", "commit"} {
		code, match := pathParam(path, "/v1/aims/internal/products/", "/roadmaps:"+action)
		if !match {
			continue
		}
		operation := "aims.product-roadmaps." + action
		if method != http.MethodPost {
			return nil, operation, true, httperror.New(405, "method_not_allowed", "POST required")
		}
		capability := "aims:product-roadmaps:" + action
		if action == "window-view" || action == "quarter-view" || action == "commitments" || action == "cross-snapshots" || action == "cross-snapshot-targets" {
			capability = "aims:product-roadmaps:read"
		}
		if err := requireProductServiceCapability(query, capability); err != nil {
			return nil, operation, true, err
		}
		var permit productcenter.AuthorizationPermit
		if err := decodeProductCommandPart(body["authorization"], &permit); err != nil {
			return nil, operation, true, err
		}
		if action == "commit" {
			var input productcenter.RoadmapCommitmentInput
			if err := decodeProductCommandPart(body["input"], &input); err != nil {
				return nil, operation, true, err
			}
			key, _ := body["idempotency_key"].(string)
			identity := productcenter.CommandIdentity{ProductCode: code, ActorUID: query.Get("current_user"), Action: "product_roadmaps:commit", IdempotencyKey: key}
			result, err := productcenter.CommitRoadmap(ctx, a.DB(), identity, permit, input)
			return result, operation, true, productRuntimeError(err)
		}
		if action == "commitments" || action == "cross-snapshots" || action == "cross-snapshot-targets" {
			var planningPermit productcenter.AuthorizationPermit
			if err := decodeProductCommandPart(body["planning_authorization"], &planningPermit); err != nil {
				return nil, operation, true, err
			}
			var input struct {
				BizID    string `json:"biz_id"`
				Page     int    `json:"page"`
				PageSize int    `json:"page_size"`
			}
			if err := decodeProductCommandPart(body["input"], &input); err != nil {
				return nil, operation, true, err
			}
			if action == "cross-snapshot-targets" {
				result, err := productcenter.DiscoverRoadmapCrossSnapshotTargets(ctx, a.DB(), code, query.Get("current_user"), input.BizID, permit, planningPermit)
				return result, operation, true, productRuntimeError(err)
			}
			if action == "cross-snapshots" || action == "cross-snapshot-targets" {
				var targets map[string]productcenter.AuthorizationPermit
				if err := decodeProductCommandPart(body["predecessor_authorizations"], &targets); err != nil {
					return nil, operation, true, err
				}
				result, err := productcenter.ListRoadmapCrossSnapshots(ctx, a.DB(), code, query.Get("current_user"), input.BizID, permit, planningPermit, targets, input.Page, input.PageSize)
				return result, operation, true, productRuntimeError(err)
			}
			result, err := productcenter.ListRoadmapCommitments(ctx, a.DB(), code, query.Get("current_user"), input.BizID, permit, planningPermit, input.Page, input.PageSize)
			return result, operation, true, productRuntimeError(err)
		}
		if action == "quarter-view" {
			var planningPermit productcenter.AuthorizationPermit
			if err := decodeProductCommandPart(body["planning_authorization"], &planningPermit); err != nil {
				return nil, operation, true, err
			}
			var input productcenter.QuarterRoadmapQuery
			if err := decodeProductCommandPart(body["input"], &input); err != nil {
				return nil, operation, true, err
			}
			result, err := productcenter.ReadQuarterRoadmap(ctx, a.DB(), code, query.Get("current_user"), planningPermit, permit, input)
			return result, operation, true, productRuntimeError(err)
		}
		if action == "window-view" {
			var input struct {
				BizID string `json:"biz_id"`
			}
			if err := decodeProductCommandPart(body["input"], &input); err != nil {
				return nil, operation, true, err
			}
			result, err := productcenter.ReadPlanningRoadmapWindow(ctx, a.DB(), code, query.Get("current_user"), input.BizID, permit)
			return result, operation, true, productRuntimeError(err)
		}
		var input productcenter.PlanningRoadmapWindow
		if err := decodeProductCommandPart(body["input"], &input); err != nil {
			return nil, operation, true, err
		}
		key, _ := body["idempotency_key"].(string)
		identity := productcenter.CommandIdentity{ProductCode: code, ActorUID: query.Get("current_user"), Action: "product_roadmaps:window-edit", IdempotencyKey: key}
		result, err := productcenter.EditPlanningRoadmapWindow(ctx, a.DB(), identity, permit, input)
		return result, operation, true, productRuntimeError(err)
	}
	return nil, "", false, nil
}
