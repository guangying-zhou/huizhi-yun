package server

import (
	"errors"
	"net/http"
	"strings"
	"testing"
	"time"

	"github.com/huizhi-yun/data-runtime/internal/httperror"
)

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

func TestEnterpriseCodocsCabinetRoutesAreExactlyReadExportOperations(t *testing.T) {
	want := map[string]struct {
		capability string
		method     string
	}{
		"list": {"read", http.MethodGet}, "view": {"read", http.MethodGet},
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
	for _, action := range []string{"create", "delete", "upload", "anything"} {
		if _, ok := enterpriseCodocsCabinetRoutes["/v1/enterprise/codocs/personal-cabinet:"+action]; ok {
			t.Fatalf("unexpected cabinet mutation route %q", action)
		}
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
