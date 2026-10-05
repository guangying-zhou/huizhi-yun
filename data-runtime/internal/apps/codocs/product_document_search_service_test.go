package codocs

import (
	"context"
	"errors"
	"github.com/huizhi-yun/data-runtime/internal/httperror"
	"github.com/huizhi-yun/data-runtime/internal/integrationoperation"
	"net/http"
	"testing"
)

func TestProductDocumentSearchSignedCommand(t *testing.T) {
	body := projectDocumentServiceBody("doc", "P")
	envelope := body[integrationoperation.ServiceCommandEnvelopeKey].(map[string]any)
	envelope["operationCode"] = aimsProductDocumentSearchOperation
	envelope["commandSchemaVersion"] = aimsProductDocumentSearchOperation
	envelope["requiredCapability"] = aimsProductDocumentReadCapability
	command := map[string]any{"actorUid": "reader-uid", "productCode": "P", "action": "search", "search": "", "page": 2, "pageSize": 20}
	envelope["command"] = command
	query := productDocumentServiceQuery()
	actor, input, err := productDocumentSearchCommand(body, query)
	if err != nil || actor != "reader-uid" || input.Page != 2 || input.PageSize != 20 {
		t.Fatalf("valid %s %+v %v", actor, input, err)
	}
	for _, change := range []struct {
		key   string
		value any
	}{{"actorUid", 123}, {"productCode", "OTHER/PRODUCT"}, {"action", "metadata:read"}, {"search", nil}, {"search", "bad\n"}, {"page", "2"}, {"page", 1.5}, {"pageSize", 101}, {"role", "admin"}} {
		old, exists := command[change.key]
		command[change.key] = change.value
		if _, _, err = productDocumentSearchCommand(body, query); err == nil {
			t.Fatalf("accepted %s=%v", change.key, change.value)
		}
		if exists {
			command[change.key] = old
		} else {
			delete(command, change.key)
		}
	}
	query.Set("current_user", "other")
	if _, _, err = productDocumentSearchCommand(body, query); err == nil {
		t.Fatal("actor substitution accepted")
	}
	query.Set("current_user", "reader-uid")
	query.Set("current_user_scopes", "codocs.read")
	if _, _, err = productDocumentSearchCommand(body, query); err == nil {
		t.Fatal("broad scope accepted")
	}
}

func TestProductDocumentSearchRuntimeBoundary(t *testing.T) {
	a := &Adapter{}
	q := productDocumentServiceQuery()
	for _, scope := range []string{"", "codocs.read", "codocs:*", "codocs:project-document:content:read"} {
		q.Set("current_user_scopes", scope)
		_, op, err := a.HandleRuntime(context.Background(), http.MethodPost, "/v1/codocs/service/product-documents/search", q, nil)
		var e httperror.Error
		if op != "codocs.service.product_document.search" || !errors.As(err, &e) || e.Status != 403 {
			t.Fatalf("scope %s op %s err %v", scope, op, err)
		}
	}
	_, _, err := a.HandleRuntime(context.Background(), http.MethodGet, "/v1/codocs/service/product-documents/search", q, nil)
	var e httperror.Error
	if !errors.As(err, &e) || e.Status != 405 {
		t.Fatalf("GET %v", err)
	}
}
