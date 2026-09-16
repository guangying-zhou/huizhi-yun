package aims

import (
	"context"
	"net/http"
	"net/url"

	"github.com/huizhi-yun/data-runtime/internal/apps/aims/productcenter"
	"github.com/huizhi-yun/data-runtime/internal/httperror"
)

func (a *Adapter) handleProductMembersRuntime(ctx context.Context, method, path string, query url.Values, body map[string]any) (any, string, bool, error) {
	for _, action := range []string{"list", "create", "update", "revoke"} {
		code, match := pathParam(path, "/v1/aims/internal/products/", "/members:"+action)
		if !match {
			continue
		}
		operation := "aims.products.members." + action
		if method != http.MethodPost {
			return nil, operation, true, httperror.New(405, "method_not_allowed", "POST required")
		}
		if err := requireProductServiceCapability(query, "aims:products:admin"); err != nil {
			return nil, operation, true, err
		}
		var permit productcenter.AuthorizationPermit
		if err := decodeProductCommandPart(body["authorization"], &permit); err != nil {
			return nil, operation, true, err
		}
		if action == "list" {
			var input productcenter.MemberPageQuery
			if err := decodeProductCommandPart(body["input"], &input); err != nil {
				return nil, operation, true, err
			}
			result, err := productcenter.ListMembers(ctx, a.DB(), code, query.Get("current_user"), permit, input)
			return result, operation, true, productRuntimeError(err)
		}
		var input productcenter.MemberChange
		var evidence productcenter.MemberDirectoryEvidence
		if err := decodeProductCommandPart(body["input"], &input); err != nil {
			return nil, operation, true, err
		}
		if err := decodeProductCommandPart(body["directory"], &evidence); err != nil {
			return nil, operation, true, err
		}
		key, _ := body["idempotency_key"].(string)
		identity := productcenter.CommandIdentity{ProductCode: code, ActorUID: query.Get("current_user"), Action: "products:member-" + action, IdempotencyKey: key}
		result, err := productcenter.ChangeMember(ctx, a.DB(), identity, permit, evidence, input)
		return result, operation, true, productRuntimeError(err)
	}
	return nil, "", false, nil
}
