package codocs

import (
	"context"
	"github.com/huizhi-yun/data-runtime/internal/httperror"
	"net/url"
	"testing"
)

func TestProductCreationRuntimeRejectsBeforeStorage(t *testing.T) {
	a := &Adapter{}
	for _, stage := range []string{"template", "prepare", "complete"} {
		path := "/v1/codocs/service/product-documents/create/" + stage
		for _, scope := range []string{"", "codocs.write", "codocs:product-document:read", aimsProductDocumentCreateCapability} {
			query := url.Values{"current_user_scopes": {scope}}
			_, operation, err := a.HandleRuntime(context.Background(), "POST", path, query, nil)
			denied, ok := err.(httperror.Error)
			if !ok || denied.Status != 403 || operation != "codocs.service.product_document.create" {
				t.Fatalf("stage %s scope %s: %s %v", stage, scope, operation, err)
			}
		}
		for _, method := range []string{"GET", "PUT", "DELETE"} {
			_, _, err := a.HandleRuntime(context.Background(), method, path, nil, nil)
			denied, ok := err.(httperror.Error)
			if !ok || denied.Status != 405 {
				t.Fatalf("stage %s method %s: %v", stage, method, err)
			}
		}
	}
}
