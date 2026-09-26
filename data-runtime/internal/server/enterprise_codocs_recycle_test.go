package server

import (
	"errors"
	"net/http"
	"strings"
	"testing"

	"github.com/huizhi-yun/data-runtime/internal/httperror"
)

func TestEnterpriseCodocsRecycleQueryUsesFixedDeleteContract(t *testing.T) {
	input := enterpriseDelegatedInput{Code: "doc-1_A", Query: map[string]string{"current_user": "spoof"}}
	query, err := enterpriseCodocsRecycleQuery(input, "recycle", "actor-1")
	var he httperror.Error
	if err == nil || !errors.As(err, &he) || he.Status != http.StatusBadRequest {
		t.Fatalf("query injection err=%v, want HTTP 400", err)
	}
	input.Query = nil
	query, err = enterpriseCodocsRecycleQuery(input, "recycle", "actor-1")
	if err != nil || query.Get("current_user") != "actor-1" || query.Get("operator_uid") != "actor-1" {
		t.Fatalf("valid query=%v err=%v", query, err)
	}
	if target := enterpriseCodocsRecycleSpec.Actions["recycle"].Target(input); target != "/v1/codocs/documents/doc-1_A" {
		t.Fatalf("target=%q", target)
	}
	for _, code := range []string{"", "../x", "doc?x", strings.Repeat("x", 65)} {
		bad := input
		bad.Code = code
		_, err := enterpriseCodocsRecycleQuery(bad, "recycle", "actor-1")
		if err == nil || !errors.As(err, &he) || he.Status != http.StatusBadRequest {
			t.Fatalf("code %q err=%v, want HTTP 400", code, err)
		}
	}
}

func TestEnterpriseCodocsRecycleRouteIsSingleDeleteCapability(t *testing.T) {
	if len(enterpriseCodocsRecycleRoutes) != 1 {
		t.Fatalf("routes=%d", len(enterpriseCodocsRecycleRoutes))
	}
	route, ok := enterpriseCodocsRecycleRoutes["/v1/enterprise/codocs/personal-documents:recycle"]
	if !ok || route.Spec.Actions["recycle"].Method != http.MethodDelete || route.Spec.Actions["recycle"].PermitAction != "delete" {
		t.Fatalf("route=%#v", enterpriseCodocsRecycleRoutes)
	}
}
