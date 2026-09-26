package server

import (
	"context"
	"errors"
	"net/http"
	"strings"
	"testing"
	"time"

	"github.com/golang-jwt/jwt/v5"
	"github.com/huizhi-yun/data-runtime/internal/auth"
	"github.com/huizhi-yun/data-runtime/internal/httperror"
)

func TestEnterpriseCodocsCabinetConversionServiceTrustMatrix(t *testing.T) {
	for _, action := range []string{"conversion-plan", "convert"} {
		for _, scenario := range []string{"valid", "scope", "audience", "source", "tenant", "deployment", "expired", "unsigned-actor", "revoked", "dependency"} {
			t.Run(action+"/"+scenario, func(t *testing.T) {
				a, r, route := enterpriseContextFixture(t, func(c jwt.MapClaims) {
					c["scope"] = "codocs:personal-cabinet:create"
					switch scenario {
					case "scope":
						c["scope"] = "codocs:personal-cabinet:read codocs.write"
					case "audience":
						c["aud"] = "codocs"
					case "source":
						c["source_app"] = "codocs"
					case "tenant":
						c["tenant"] = "other"
					case "deployment":
						c["deployment"] = "other"
					case "expired":
						c["exp"] = time.Now().Add(-time.Minute).Unix()
					}
				}, true)
				path := "/v1/enterprise/codocs/personal-cabinet:" + action
				spec := enterpriseCodocsCabinetRoutes[path].Spec
				route.LogicalSource, route.LogicalTarget = "codocs", "codocs"
				route.Capability = spec.Domain + ":" + spec.Resource + ":" + spec.Actions[action].PermitAction
				r.Method, r.URL.Path, r.URL.RawQuery = http.MethodPost, path, ""
				bearer := strings.TrimPrefix(r.Header.Get("Authorization"), "Bearer ")
				r.Header.Set("X-HZY-Actor-Signature", testActorSignature(t, bearer, r.Method, r.URL.RequestURI(), "person-a", nil, r.Header.Get("X-HZY-Actor-Signed-At")))
				if scenario == "unsigned-actor" {
					r.Header.Del("X-HZY-Actor-Signature")
				}
				verified, err := authenticateEnterpriseRequest(r, a, route, func(_ context.Context, identity auth.Context, capability string) (bool, error) {
					if identity.ClientID != "enterprise.runtime" || capability != "codocs:personal-cabinet:create" {
						t.Fatal("incorrect conversion trust context")
					}
					if scenario == "revoked" {
						return false, nil
					}
					if scenario == "dependency" {
						return false, errors.New("private diagnostic")
					}
					return true, nil
				})
				if scenario == "valid" {
					if err != nil || verified.ActorUID != "person-a" || verified.PhysicalHost != "enterprise" {
						t.Fatalf("valid conversion rejected: %v", err)
					}
				} else if err == nil {
					t.Fatal("invalid conversion identity accepted")
				}
			})
		}
	}
}

func cabinetServerInput(action string) enterpriseDelegatedInput {
	in := enterpriseCodocsReadInput()
	if action != "list" {
		in.Code = "file-01_A"
	}
	in.Authorization.Resource = "personal-cabinet"
	if action == "list" {
		in.Query = map[string]string{"page": "2", "pageSize": "50", "folder_id": "7"}
	}
	return in
}

func TestEnterpriseCodocsCabinetRoutesAreExactlyRegisteredOperations(t *testing.T) {
	want := map[string]struct {
		capability string
		method     string
	}{
		"conversion-plan": {"create", http.MethodPost}, "convert": {"create", http.MethodPost},
		"upload-plan": {"create", http.MethodPost}, "upload": {"create", http.MethodPost},
		"delete": {"delete", http.MethodDelete},
		"list":   {"read", http.MethodGet}, "view": {"read", http.MethodGet},
		"download": {"export", http.MethodGet}, "converted-info": {"read", http.MethodGet},
	}
	if len(enterpriseCodocsCabinetRoutes) != len(want) {
		t.Fatalf("routes=%d, want %d", len(enterpriseCodocsCabinetRoutes), len(want))
	}
	for action, expected := range want {
		route, ok := enterpriseCodocsCabinetRoutes["/v1/enterprise/codocs/personal-cabinet:"+action]
		if !ok || route.Spec.Domain != "codocs" || route.Spec.Resource != "personal-cabinet" || route.Spec.Actions[action].PermitAction != expected.capability || route.Spec.Actions[action].Method != expected.method {
			t.Fatalf("%s route=%#v", action, route)
		}
	}
	for _, action := range []string{"create", "anything"} {
		if _, ok := enterpriseCodocsCabinetRoutes["/v1/enterprise/codocs/personal-cabinet:"+action]; ok {
			t.Fatalf("unexpected cabinet mutation route %q", action)
		}
	}
}

func TestEnterpriseCodocsCabinetConversionRequiresCreateAndRejectsScopeInjection(t *testing.T) {
	for _, action := range []string{"conversion-plan", "convert"} {
		in := cabinetServerInput(action)
		in.Authorization.Action = "create"
		in.Payload = map[string]any{"title": "Document", "folder_id": nil}
		if action == "convert" {
			in.Payload["source_state"] = strings.Repeat("a", 64)
			in.Payload["content_sha256"] = strings.Repeat("b", 64)
			in.Payload["content_size"] = float64(10)
		}
		if _, err := enterpriseCodocsCabinetQuery(in, action, "person-a"); err != nil {
			t.Fatal(err)
		}
		act := enterpriseCodocsCabinetSpec.Actions[action]
		verified := enterpriseCodocsReadVerified()
		if err := validateEnterpriseDelegatedPermit(in, verified, enterpriseCodocsCabinetSpec, act, time.Now()); err != nil {
			t.Fatal(err)
		}
		for _, permission := range []string{"read", "edit", "delete", "export"} {
			in.Authorization.Action = permission
			if validateEnterpriseDelegatedPermit(in, verified, enterpriseCodocsCabinetSpec, act, time.Now()) == nil {
				t.Fatalf("%s accepted %s", action, permission)
			}
		}
		for _, field := range []string{"uuid", "owner_uid", "dept_code", "project_code", "oss_path", "source_path", "target_prefix", "replayed", "doc_type"} {
			in.Payload[field] = "injected"
			if _, err := enterpriseCodocsCabinetQuery(in, action, "person-a"); err == nil {
				t.Fatalf("%s accepted %s", action, field)
			}
			delete(in.Payload, field)
		}
		in.Code = "../source"
		if _, err := enterpriseCodocsCabinetQuery(in, action, "person-a"); err == nil {
			t.Fatal("conversion accepted invalid source")
		}
		in.Code = "file-01_A"
		in.Query = map[string]string{"owner_uid": "victim"}
		if _, err := enterpriseCodocsCabinetQuery(in, action, "person-a"); err == nil {
			t.Fatal("conversion accepted query")
		}
	}
}

func TestEnterpriseCodocsCabinetUploadRejectsInjectedScopeAndRequiresCreatePermit(t *testing.T) {
	for _, action := range []string{"upload-plan", "upload"} {
		in := cabinetServerInput(action)
		in.Code = ""
		in.Payload = map[string]any{"original_name": "file.txt", "file_ext": "txt", "file_size": float64(3), "content_sha256": strings.Repeat("a", 64), "folder_id": nil}
		in.Authorization.Action = "create"
		if _, err := enterpriseCodocsCabinetQuery(in, action, "person-a"); err != nil {
			t.Fatal(err)
		}
		act := enterpriseCodocsCabinetSpec.Actions[action]
		verified := enterpriseCodocsReadVerified()
		if err := validateEnterpriseDelegatedPermit(in, verified, enterpriseCodocsCabinetSpec, act, time.Now()); err != nil {
			t.Fatal(err)
		}
		for _, permission := range []string{"read", "edit", "delete", "export"} {
			in.Authorization.Action = permission
			if validateEnterpriseDelegatedPermit(in, verified, enterpriseCodocsCabinetSpec, act, time.Now()) == nil {
				t.Fatalf("%s accepted %s permit", action, permission)
			}
		}
		for _, field := range []string{"uuid", "owner_uid", "dept_code", "project_code", "oss_path", "status"} {
			in.Payload[field] = "injected"
			if _, err := enterpriseCodocsCabinetQuery(in, action, "person-a"); err == nil {
				t.Fatalf("%s accepted %s", action, field)
			}
			delete(in.Payload, field)
		}
		in.Query = map[string]string{"folder_id": "7"}
		if _, err := enterpriseCodocsCabinetQuery(in, action, "person-a"); err == nil {
			t.Fatal("upload query accepted")
		}
	}
}

func TestEnterpriseCodocsCabinetDeleteRequiresUUIDAndRejectsPayloadOrQuery(t *testing.T) {
	in := cabinetServerInput("delete")
	query, err := enterpriseCodocsCabinetQuery(in, "delete", "person-a")
	if err != nil || query.Get("current_user") != "person-a" || query.Get("hzy_runtime_actor_delegated") != "1" {
		t.Fatalf("valid delete query=%v err=%v", query, err)
	}
	for _, code := range []string{"", "../secret", "file/other", strings.Repeat("x", 65)} {
		bad := cabinetServerInput("delete")
		bad.Code = code
		_, err := enterpriseCodocsCabinetQuery(bad, "delete", "person-a")
		var he httperror.Error
		if err == nil || !errors.As(err, &he) || he.Status != http.StatusBadRequest {
			t.Fatalf("delete code %q err=%v, want HTTP 400", code, err)
		}
	}
	bad := cabinetServerInput("delete")
	bad.Payload = map[string]any{"uuid": "victim"}
	if _, err := enterpriseCodocsCabinetQuery(bad, "delete", "person-a"); err == nil {
		t.Fatal("delete accepted a payload")
	}
	bad = cabinetServerInput("delete")
	bad.Query = map[string]string{"page": "1"}
	if _, err := enterpriseCodocsCabinetQuery(bad, "delete", "person-a"); err == nil {
		t.Fatal("delete accepted a query key")
	}
}

func TestEnterpriseCodocsCabinetQueryBindsActorAndRejectsUUIDOrQueryInjection(t *testing.T) {
	for _, action := range []string{"list", "view", "download", "converted-info"} {
		query, err := enterpriseCodocsCabinetQuery(cabinetServerInput(action), action, "person-a")
		if err != nil || query.Get("current_user") != "person-a" || query.Get("operator_uid") != "person-a" || query.Get("hzy_runtime_actor_delegated") != "1" {
			t.Fatalf("%s query=%v err=%v", action, query, err)
		}
	}
	for _, key := range []string{"current_user", "operator_uid", "owner_uid", "actorUid", "hzy_runtime_actor_delegated"} {
		in := cabinetServerInput("list")
		in.Query = map[string]string{key: "victim"}
		if _, err := enterpriseCodocsCabinetQuery(in, "list", "person-a"); err == nil {
			t.Fatalf("query injection %q accepted", key)
		}
	}
	for _, code := range []string{"", "../secret", "file/other", "file?x=1", strings.Repeat("x", 65)} {
		in := cabinetServerInput("view")
		in.Code = code
		_, err := enterpriseCodocsCabinetQuery(in, "view", "person-a")
		var he httperror.Error
		if err == nil || !errors.As(err, &he) || he.Status != http.StatusBadRequest {
			t.Fatalf("code %q err=%v, want HTTP 400", code, err)
		}
	}
}

func TestEnterpriseCodocsCabinetListPaginationAndFolderValidation(t *testing.T) {
	query, err := enterpriseCodocsCabinetQuery(enterpriseCodocsReadInput(), "list", "person-a")
	if err != nil || query.Get("page") != "1" || query.Get("pageSize") != "20" {
		t.Fatalf("defaults=%v err=%v", query, err)
	}
	for _, item := range []struct{ key, value string }{
		{"page", "0"}, {"page", "1000001"}, {"pageSize", "0"}, {"pageSize", "201"},
		{"pageSize", "1.5"}, {"folder_id", "01"}, {"folder_id", "0"}, {"folder_id", "-1"},
		{"folder_id", "9007199254740992"}, {"folder_id", "../7"},
	} {
		in := enterpriseCodocsReadInput()
		in.Query = map[string]string{item.key: item.value}
		_, err := enterpriseCodocsCabinetQuery(in, "list", "person-a")
		var he httperror.Error
		if err == nil || !errors.As(err, &he) || he.Status != http.StatusBadRequest {
			t.Fatalf("%s=%q err=%v, want HTTP 400", item.key, item.value, err)
		}
	}
	for _, folder := range []string{"null", "7", "9007199254740991"} {
		in := enterpriseCodocsReadInput()
		in.Query = map[string]string{"folder_id": folder, "page": "1000000", "pageSize": "200"}
		query, err := enterpriseCodocsCabinetQuery(in, "list", "person-a")
		if err != nil || query.Get("folder_id") != folder {
			t.Fatalf("valid folder %q query=%v err=%v", folder, query, err)
		}
	}
}

func TestEnterpriseCodocsCabinetPermitRejectsActorTenantDeploymentAndExpiry(t *testing.T) {
	verified := enterpriseCodocsReadVerified()
	act := enterpriseCodocsCabinetSpec.Actions["list"]
	if err := validateEnterpriseDelegatedPermit(cabinetServerInput("list"), verified, enterpriseCodocsCabinetSpec, act, time.Now()); err != nil {
		t.Fatalf("valid permit rejected: %v", err)
	}
	for name, mutate := range map[string]func(*enterpriseDelegatedInput){
		"actor":      func(in *enterpriseDelegatedInput) { in.Authorization.ActorUID = "other" },
		"tenant":     func(in *enterpriseDelegatedInput) { in.Tenant = "other" },
		"deployment": func(in *enterpriseDelegatedInput) { in.Deployment = "other" },
		"expired": func(in *enterpriseDelegatedInput) {
			in.Authorization.ExpiresAt = time.Now().Add(-time.Second).UnixMilli()
		},
	} {
		in := cabinetServerInput("list")
		mutate(&in)
		if validateEnterpriseDelegatedPermit(in, verified, enterpriseCodocsCabinetSpec, act, time.Now()) == nil {
			t.Fatalf("%s permit accepted", name)
		}
	}
}
