package altoc

import (
	"context"
	"net/url"
	"testing"
)

func TestProductFeedbackStatusRuntimeRejectsBeforeStorage(t *testing.T) {
	var adapter Adapter
	for _, scope := range []string{"*", "altoc.*", "altoc.write", "altoc:product-feedback:*", "altoc:product-feedback:update-status"} {
		query := url.Values{"scope": {scope}}
		if _, _, matched, err := adapter.handleProductFeedbackStatusRuntime(context.Background(), "POST", "/v1/altoc/internal/product-feedback:status", query, map[string]any{}); !matched || err == nil {
			t.Fatalf("unsigned scope %s accepted", scope)
		}
	}
	if _, _, matched, err := adapter.handleProductFeedbackStatusRuntime(context.Background(), "GET", "/v1/altoc/internal/product-feedback:status", nil, nil); !matched || err == nil {
		t.Fatal("GET accepted")
	}
}
