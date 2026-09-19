package server

import (
	"errors"
	"net/http"
	"strings"
	"testing"
	"time"

	"github.com/huizhi-yun/data-runtime/internal/enterprise"
	"github.com/huizhi-yun/data-runtime/internal/httperror"
)

func enterpriseCodocsReadInput() enterpriseDelegatedInput {
	expires := time.Now().Add(10 * time.Second).UnixMilli()
	return enterpriseDelegatedInput{
		Tenant: "tenant-a", Deployment: "enterprise-test",
		Authorization: enterpriseDelegatedPermit{
			ActorUID: "person-a", Tenant: "tenant-a", Deployment: "enterprise-test",
			Resource: "personal-documents", Action: "read", ExpiresAt: expires,
		},
	}
}

func enterpriseCodocsReadVerified() enterpriseRequestContext {
	return enterpriseRequestContext{
		ActorUID: "person-a",
		Route: enterpriseRouteContext{
			Binding:        enterprise.BindingKey{Tenant: "tenant-a", Environment: "test", RuntimeDeployment: "runtime-a"},
			HostDeployment: "enterprise-test",
		},
	}
}

func TestEnterpriseCodocsReadQueryBindsActorAndOwner(t *testing.T) {
	for _, action := range []string{"list", "folders"} {
		input := enterpriseCodocsReadInput()
		if action == "folders" {
			input.Query = map[string]string{"folder_type": "private"}
		}
		query, err := enterpriseCodocsReadQuery(input, action, "person-a")
		if err != nil {
			t.Fatalf("%s: valid input rejected: %v", action, err)
		}
		for _, key := range []string{"current_user", "operator_uid", "hzy_runtime_actor_delegated", "owner", "owner_uid"} {
			if query.Get(key) == "" {
				t.Fatalf("%s: missing trusted %s in %v", action, key, query)
			}
		}
		if query.Get("current_user") != "person-a" || query.Get("operator_uid") != "person-a" || query.Get("owner") != "person-a" || query.Get("owner_uid") != "person-a" {
			t.Fatalf("%s: actor/owner was not bound: %v", action, query)
		}
	}

	for _, key := range []string{"current_user", "operator_uid", "actorUid", "owner", "owner_uid", "dept_code", "current_user_dept_codes", "codocs_trusted_department_read_dept_code"} {
		input := enterpriseCodocsReadInput()
		input.Query = map[string]string{key: "forged"}
		if _, err := enterpriseCodocsReadQuery(input, "list", "person-a"); err == nil {
			t.Fatalf("caller-supplied actor/owner/department marker %q was accepted", key)
		}
	}
}

func TestEnterpriseCodocsCheckNameBindsActorAndNormalizesRoot(t *testing.T) {
	input := enterpriseCodocsReadInput()
	input.Query = map[string]string{"title": "  Deck  ", "doc_type": "slide", "exclude_uuid": "doc-1_A"}
	query, err := enterpriseCodocsReadQuery(input, "check-name", "person-a")
	if err != nil {
		t.Fatalf("valid check-name rejected: %v", err)
	}
	if query.Get("title") != "Deck" || query.Get("folder_id") != "null" || query.Get("owner_uid") != "person-a" || query.Get("owner") != "person-a" || query.Get("hzy_runtime_actor_delegated") != "1" {
		t.Fatalf("check-name scope/root normalization = %v", query)
	}
	for key, value := range map[string]string{"owner_uid": "victim", "owner": "victim", "current_user": "victim", "folder_id": "1.5", "doc_type": "department", "exclude_uuid": "../x"} {
		bad := enterpriseCodocsReadInput()
		bad.Query = map[string]string{"title": "Deck", "doc_type": "private", key: value}
		if _, err := enterpriseCodocsReadQuery(bad, "check-name", "person-a"); err == nil {
			t.Fatalf("invalid check-name %s=%q accepted", key, value)
		} else {
			var httpErr httperror.Error
			if !errors.As(err, &httpErr) || httpErr.Status != http.StatusBadRequest {
				t.Fatalf("%s error = %v, want HTTP 400", key, err)
			}
		}
	}
	for _, folder := range []string{"0", "01", "-1", "9007199254740992"} {
		bad := enterpriseCodocsReadInput()
		bad.Query = map[string]string{"title": "Deck", "doc_type": "private", "folder_id": folder}
		_, err := enterpriseCodocsReadQuery(bad, "check-name", "person-a")
		var httpErr httperror.Error
		if err == nil || !errors.As(err, &httpErr) || httpErr.Status != http.StatusBadRequest {
			t.Fatalf("folder_id %q error = %v, want HTTP 400", folder, err)
		}
	}
}

func TestEnterpriseCodocsTrashAllowsPersonalTypesAndRejectsSharedScopes(t *testing.T) {
	for _, kind := range []string{"", "private", "slide", "worklog", "weekly-report"} {
		input := enterpriseCodocsReadInput()
		if kind != "" {
			input.Query = map[string]string{"type": kind}
		}
		query, err := enterpriseCodocsReadQuery(input, "trash", "person-a")
		if err != nil || query.Get("owner") != "person-a" || query.Get("owner_uid") != "person-a" {
			t.Fatalf("trash type %q = %v, err=%v", kind, query, err)
		}
	}
	for _, kind := range []string{"department", "project", "shared"} {
		input := enterpriseCodocsReadInput()
		input.Query = map[string]string{"type": kind}
		_, err := enterpriseCodocsReadQuery(input, "trash", "person-a")
		var httpErr httperror.Error
		if err == nil || !errors.As(err, &httpErr) || httpErr.Status != http.StatusBadRequest {
			t.Fatalf("trash type %q error = %v, want HTTP 400", kind, err)
		}
	}
}

func TestEnterpriseCodocsReadQueryRejectsForgedScopeAndInvalidTypes(t *testing.T) {
	for _, key := range []string{"current_user_management_dept_codes", "current_user_project_admin_project_codes", "department_manager", "hzy_runtime_actor_purpose"} {
		input := enterpriseCodocsReadInput()
		input.Query = map[string]string{key: "D1"}
		if _, err := enterpriseCodocsReadQuery(input, "folders", "person-a"); err == nil {
			t.Fatalf("forged scope marker %q was accepted", key)
		}
	}

	for _, value := range []string{"department", "project", "shared", "company"} {
		input := enterpriseCodocsReadInput()
		input.Query = map[string]string{"type": value}
		if _, err := enterpriseCodocsReadQuery(input, "list", "person-a"); err == nil {
			t.Fatalf("unsupported document type %q was accepted", value)
		}
	}
	for _, value := range []string{"department", "private/../department", "project"} {
		input := enterpriseCodocsReadInput()
		input.Query = map[string]string{"folder_type": value}
		if _, err := enterpriseCodocsReadQuery(input, "folders", "person-a"); err == nil {
			t.Fatalf("unsupported folder type %q was accepted", value)
		}
	}
}

func TestEnterpriseCodocsReadQueryRejectsUUIDPathTraversal(t *testing.T) {
	for _, code := range []string{"../secret", "doc/other", "doc?x=1", "doc#fragment", "doc..", "", strings.Repeat("d", 65)} {
		input := enterpriseCodocsReadInput()
		input.Code = code
		if _, err := enterpriseCodocsReadQuery(input, "view", "person-a"); err == nil {
			t.Fatalf("unsafe document UUID/path segment %q was accepted", code)
		}
	}
	input := enterpriseCodocsReadInput()
	input.Code = "doc-01_A"
	query, err := enterpriseCodocsReadQuery(input, "view", "person-a")
	if err != nil || enterpriseCodocsDocumentReads.Actions["view"].Target(input) != "/v1/codocs/documents/doc-01_A" {
		t.Fatalf("valid document UUID path rejected or misrouted: query=%v err=%v", query, err)
	}
}

func TestEnterpriseCodocsReadQueryAppliesPaginationDefaultsAndLimits(t *testing.T) {
	for _, action := range []string{"list", "folders"} {
		input := enterpriseCodocsReadInput()
		if action == "folders" {
			input.Query = map[string]string{"folder_type": "private"}
		}
		query, err := enterpriseCodocsReadQuery(input, action, "person-a")
		if err != nil || query.Get("page") != "1" || query.Get("pageSize") != "20" {
			t.Fatalf("%s defaults = %v, err=%v", action, query, err)
		}
	}
	for _, item := range []struct{ key, value string }{
		{key: "page", value: "0"}, {key: "page", value: "1000001"},
		{key: "pageSize", value: "0"}, {key: "pageSize", value: "201"}, {key: "pageSize", value: "not-a-number"},
	} {
		input := enterpriseCodocsReadInput()
		input.Query = map[string]string{item.key: item.value}
		if _, err := enterpriseCodocsReadQuery(input, "list", "person-a"); err == nil {
			t.Fatalf("invalid %s=%q was accepted", item.key, item.value)
		}
	}
	input := enterpriseCodocsReadInput()
	input.Query = map[string]string{"page": "1000000", "pageSize": "200"}
	if query, err := enterpriseCodocsReadQuery(input, "list", "person-a"); err != nil || query.Get("page") != "1000000" || query.Get("pageSize") != "200" {
		t.Fatalf("maximum valid pagination rejected: %v %v", query, err)
	}
}

func TestEnterpriseCodocsReadPermitRejectsTenantDeploymentActorAndExpiryMismatch(t *testing.T) {
	verified := enterpriseCodocsReadVerified()
	spec := enterpriseCodocsDocumentReads
	act := spec.Actions["list"]
	now := time.Now()
	if err := validateEnterpriseDelegatedPermit(enterpriseCodocsReadInput(), verified, spec, act, now); err != nil {
		t.Fatalf("valid permit rejected: %v", err)
	}
	mutations := map[string]func(*enterpriseDelegatedInput){
		"tenant": func(in *enterpriseDelegatedInput) { in.Tenant, in.Authorization.Tenant = "tenant-b", "tenant-b" },
		"deployment": func(in *enterpriseDelegatedInput) {
			in.Deployment, in.Authorization.Deployment = "enterprise-other", "enterprise-other"
		},
		"actor":    func(in *enterpriseDelegatedInput) { in.Authorization.ActorUID = "person-b" },
		"expired":  func(in *enterpriseDelegatedInput) { in.Authorization.ExpiresAt = now.Add(-time.Second).UnixMilli() },
		"too-long": func(in *enterpriseDelegatedInput) { in.Authorization.ExpiresAt = now.Add(16 * time.Second).UnixMilli() },
	}
	for name, mutate := range mutations {
		input := enterpriseCodocsReadInput()
		mutate(&input)
		if err := validateEnterpriseDelegatedPermit(input, verified, spec, act, now); err == nil {
			t.Fatalf("%s permit mismatch was accepted", name)
		}
	}
}

func TestEnterpriseCodocsReadRoutesRegisterExplicitReadAndExportEndpoints(t *testing.T) {
	want := map[string]struct{}{
		"/v1/enterprise/codocs/personal-documents:check-name": {},
		"/v1/enterprise/codocs/personal-documents:download":   {},
		"/v1/enterprise/codocs/personal-documents:list":       {},
		"/v1/enterprise/codocs/personal-documents:view":       {},
		"/v1/enterprise/codocs/personal-documents:trash":      {},
		"/v1/enterprise/codocs/personal-documents:folders":    {},
	}
	if len(enterpriseCodocsReadRoutes) != len(want) {
		t.Fatalf("registered route count = %d, want %d", len(enterpriseCodocsReadRoutes), len(want))
	}
	for path, route := range enterpriseCodocsReadRoutes {
		if route.Action == "download" && route.Spec.Actions[route.Action].PermitAction != "export" {
			t.Fatal("download must require export, not read")
		}
		if _, ok := want[path]; !ok || route.Spec.Domain != "codocs" || route.Spec.Resource != "personal-documents" || route.Spec.Actions[route.Action].Method != http.MethodGet {
			t.Fatalf("unexpected/non-read route: %s %#v", path, route)
		}
	}
	for _, path := range []string{
		"/v1/enterprise/codocs/personal-documents:create",
		"/v1/enterprise/codocs/personal-documents:delete",
		"/v1/enterprise/codocs/personal-documents:anything",
		"/v1/enterprise/codocs/documents:list",
	} {
		if _, ok := enterpriseCodocsReadRoutes[path]; ok {
			t.Fatalf("unapproved route registered: %s", path)
		}
	}
}
