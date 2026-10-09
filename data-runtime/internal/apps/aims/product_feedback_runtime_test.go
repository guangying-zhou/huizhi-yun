package aims

import (
	"context"
	"errors"
	"net/http"
	"net/url"
	"testing"

	"github.com/huizhi-yun/data-runtime/internal/httperror"
)

func TestProductFeedbackRuntimeRejectsBeforeStorage(t *testing.T) {
	var adapter Adapter
	for _, scope := range []string{"", "aims.write", "*", productFeedbackCapability} {
		_, op, err := adapter.HandleRuntime(context.Background(), http.MethodPost, "/v1/aims/internal/product-requests:from-feedback", url.Values{"current_user_scopes": {scope}}, map[string]any{})
		var e httperror.Error
		if op != "aims.product-requests.from-feedback" || !errors.As(err, &e) || e.Status != 403 {
			t.Fatalf("scope %s: %s %v", scope, op, err)
		}
	}
	_, _, err := adapter.HandleRuntime(context.Background(), http.MethodGet, "/v1/aims/internal/product-requests:from-feedback", nil, nil)
	var e httperror.Error
	if !errors.As(err, &e) || e.Status != 405 {
		t.Fatalf("GET: %v", err)
	}
}

func TestProductFeedbackAuthorizationRejectsUnsignedActor(t *testing.T) {
	var adapter Adapter
	for _, scope := range []string{"aims.read", "aims:products:authorization-object", productFeedbackCapability} {
		_, op, err := adapter.HandleRuntime(context.Background(), http.MethodPost, "/v1/aims/internal/product-requests:feedback-authorization", url.Values{"current_user_scopes": {scope}, "current_user": {"forged"}}, map[string]any{})
		var e httperror.Error
		if op != "aims.product-requests.feedback-authorization" || !errors.As(err, &e) || e.Status != 403 {
			t.Fatalf("unsigned actor accepted: %s %v", op, err)
		}
	}
}
