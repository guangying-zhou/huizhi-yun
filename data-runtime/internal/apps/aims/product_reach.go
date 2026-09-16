package aims

import (
	"context"
	"github.com/huizhi-yun/data-runtime/internal/apps/aims/productcenter"
	"github.com/huizhi-yun/data-runtime/internal/httperror"
	"net/http"
	"net/url"
)

func (a *Adapter) handleProductReachRuntime(ctx context.Context, method, path string, query url.Values, body map[string]any) (any, string, bool, error) {
	var code, action string
	for _, candidate := range []string{"list", "view", "record"} {
		if value, ok := pathParam(path, "/v1/aims/internal/products/", "/reach-observations:"+candidate); ok {
			code, action = value, candidate
			break
		}
	}
	if action == "" {
		return nil, "", false, nil
	}
	operation := "aims.product-reach-observations." + action
	if method != http.MethodPost {
		return nil, operation, true, httperror.New(405, "method_not_allowed", "POST required")
	}
	capability := "aims:product-priorities:read"
	if action == "record" {
		capability = "aims:product-priorities:reach-record"
	}
	if err := requireProductServiceCapability(query, capability); err != nil {
		return nil, operation, true, err
	}
	var permit productcenter.AuthorizationPermit
	if err := decodeProductCommandPart(body["authorization"], &permit); err != nil {
		return nil, operation, true, err
	}
	if action == "record" {
		var input productcenter.RICEObservationCreate
		if err := decodeProductCommandPart(body["input"], &input); err != nil {
			return nil, operation, true, err
		}
		key, _ := body["idempotency_key"].(string)
		identity := productcenter.CommandIdentity{ProductCode: code, ActorUID: query.Get("current_user"), Action: "product_priorities:reach-record", IdempotencyKey: key}
		result, err := productcenter.CreateRICEReachObservation(ctx, a.DB(), identity, permit, input)
		return result, operation, true, productRuntimeError(err)
	}
	if action == "list" {
		var input struct {
			ItemBizID string `json:"item_biz_id"`
			Page      int    `json:"page"`
			PageSize  int    `json:"page_size"`
		}
		if err := decodeProductCommandPart(body["input"], &input); err != nil {
			return nil, operation, true, err
		}
		result, err := productcenter.ListRICEReachObservations(ctx, a.DB(), code, query.Get("current_user"), input.ItemBizID, permit, input.Page, input.PageSize)
		return result, operation, true, productRuntimeError(err)
	}
	var input struct {
		ItemBizID string `json:"item_biz_id"`
		BizID     string `json:"biz_id"`
	}
	if err := decodeProductCommandPart(body["input"], &input); err != nil {
		return nil, operation, true, err
	}
	result, err := productcenter.ReadRICEReachObservation(ctx, a.DB(), code, query.Get("current_user"), input.ItemBizID, input.BizID, permit)
	return result, operation, true, productRuntimeError(err)
}
