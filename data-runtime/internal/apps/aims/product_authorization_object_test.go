package aims

import (
	"context"
	"maps"
	"net/http"
	"net/url"
	"testing"
)

func TestProductAuthorizationCapabilityBeforeDatabase(t *testing.T) {
	valid := url.Values{
		"current_user": {"u1"}, "current_user_scopes": {"aims.read aims:products:authorization-object"},
		"hzy_runtime_source_app": {"aims"}, "hzy_runtime_tenant_code": {"tenant"},
		"hzy_runtime_deployment_code": {"deployment"}, "hzy_runtime_service_client_id": {"aims.runtime"},
		"hzy_runtime_actor_delegated": {"1"},
	}
	if err := requireProductAuthorizationService(valid); err != nil {
		t.Fatal(err)
	}
	var adapter Adapter // no DB: all rejected requests must stop before DB access
	for _, field := range []string{"current_user", "current_user_scopes", "hzy_runtime_source_app", "hzy_runtime_tenant_code", "hzy_runtime_deployment_code", "hzy_runtime_service_client_id", "hzy_runtime_actor_delegated"} {
		query := maps.Clone(valid)
		query.Del(field)
		_, _, handled, err := adapter.handleProductAuthorizationRuntime(context.Background(), http.MethodGet, "/v1/aims/internal/products/P-A/authorization-object", query)
		if !handled || err == nil {
			t.Fatalf("accepted missing %s", field)
		}
	}
	for _, purpose := range []string{"notification-detail-authorization", "service-command"} {
		query := maps.Clone(valid)
		query.Set("hzy_runtime_actor_purpose", purpose)
		if err := requireProductAuthorizationService(query); err == nil {
			t.Fatal("accepted delegated purpose override")
		}
	}
	for _, scope := range []string{"*", "aims.*", "aims.read", "aims:products:view", "aims:products:authorization-object-extra"} {
		query := maps.Clone(valid)
		query.Set("current_user_scopes", scope)
		if err := requireProductAuthorizationService(query); err == nil {
			t.Fatalf("accepted broad/wrong capability %s", scope)
		}
	}
	query := maps.Clone(valid)
	query.Set("hzy_runtime_source_app", "assets")
	if err := requireProductAuthorizationService(query); err == nil {
		t.Fatal("accepted cross-app caller")
	}
	_, _, handled, err := adapter.handleProductAuthorizationRuntime(context.Background(), http.MethodPost, "/v1/aims/internal/products/P-A/authorization-object", valid)
	if !handled || err == nil {
		t.Fatal("accepted mutation")
	}
}
