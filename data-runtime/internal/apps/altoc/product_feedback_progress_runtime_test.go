package altoc

import (
	"context"
	"net/url"
	"testing"
)

func TestProductFeedbackProgressRuntimeRejectsBeforeStorage(t *testing.T) {
	var adapter Adapter
	for _, scope := range []string{"*", "altoc.*", "altoc.write", "altoc:product-feedback:*", "altoc:product-feedback:update-progress"} {
		query := url.Values{"scope": {scope}}
		if _, _, matched, err := adapter.handleProductFeedbackProgressRuntime(context.Background(), "POST", "/v1/altoc/internal/product-feedback:progress", query, map[string]any{}); !matched || err == nil {
			t.Fatalf("unsigned scope %s accepted", scope)
		}
	}
	if _, _, matched, err := adapter.handleProductFeedbackProgressRuntime(context.Background(), "GET", "/v1/altoc/internal/product-feedback:progress", nil, nil); !matched || err == nil {
		t.Fatal("GET accepted")
	}
}
