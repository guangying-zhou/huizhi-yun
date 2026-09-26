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

func restoreServerInput(action string) enterpriseDelegatedInput {
	payload := map[string]any{}
	if action == "restore" {
		payload["state_sha256"] = strings.Repeat("a", 64)
	}
	now := time.Now().Add(10 * time.Second).UnixMilli()
	return enterpriseDelegatedInput{Code: "doc-1_A", Payload: payload, Tenant: "tenant-a", Deployment: "enterprise-test", Authorization: enterpriseDelegatedPermit{ActorUID: "actor-a", Tenant: "tenant-a", Deployment: "enterprise-test", Resource: "personal-documents", Action: "edit", ExpiresAt: now}}
}

func TestEnterpriseCodocsRestoreRoutesAreFixedEditOperations(t *testing.T) {
	if len(enterpriseCodocsRestoreRoutes) != 2 {
		t.Fatalf("routes=%d", len(enterpriseCodocsRestoreRoutes))
	}
	for action, suffix := range map[string]string{"restore-plan": "/restore-plan", "restore": "/restore"} {
		route, ok := enterpriseCodocsRestoreRoutes["/v1/enterprise/codocs/personal-documents:"+action]
		if !ok || route.Spec.Actions[action].PermitAction != "edit" || route.Spec.Actions[action].Method != http.MethodPost {
			t.Fatalf("route %s=%#v", action, route)
		}
		if target := route.Spec.Actions[action].Target(restoreServerInput(action)); target != "/v1/codocs/documents/doc-1_A"+suffix {
			t.Fatalf("target=%q", target)
		}
	}
}

func TestEnterpriseCodocsRestoreQueryRejectsUUIDAndPayloadInjection(t *testing.T) {
	for _, action := range []string{"restore-plan", "restore"} {
		valid := restoreServerInput(action)
		query, err := enterpriseCodocsRestoreQuery(valid, action, "actor-a")
		if err != nil || query.Get("current_user") != "actor-a" {
			t.Fatalf("valid %s query=%v err=%v", action, query, err)
		}
		for _, code := range []string{"", "../x", "doc?x", strings.Repeat("x", 65)} {
			bad := valid
			bad.Code = code
			_, err := enterpriseCodocsRestoreQuery(bad, action, "actor-a")
			var he httperror.Error
			if err == nil || !errors.As(err, &he) || he.Status != 400 {
				t.Fatalf("%s code %q err=%v", action, code, err)
			}
		}
		bad := valid
		bad.Query = map[string]string{"current_user": "victim", "owner_uid": "victim"}
		_, err = enterpriseCodocsRestoreQuery(bad, action, "actor-a")
		var he httperror.Error
		if err == nil || !errors.As(err, &he) || he.Status != 400 {
			t.Fatalf("%s query injection err=%v", action, err)
		}
	}
	for _, payload := range []map[string]any{{"owner_uid": "victim"}, {"folder_id": 7}, {"oss_path": "escape"}} {
		input := restoreServerInput("restore-plan")
		input.Payload = payload
		_, err := enterpriseCodocsRestoreQuery(input, "restore-plan", "actor-a")
		var he httperror.Error
		if err == nil || !errors.As(err, &he) || he.Status != 400 {
			t.Fatalf("payload=%v err=%v", payload, err)
		}
	}
	input := restoreServerInput("restore")
	delete(input.Payload, "state_sha256")
	_, err := enterpriseCodocsRestoreQuery(input, "restore", "actor-a")
	var he httperror.Error
	if err == nil || !errors.As(err, &he) || he.Status != 400 {
		t.Fatalf("missing commit state err=%v", err)
	}
}

func TestEnterpriseCodocsRestorePermitBindsActorTenantDeploymentExpiryAndAction(t *testing.T) {
	verified := enterpriseRequestContext{ActorUID: "actor-a", Route: enterpriseRouteContext{Binding: enterprise.BindingKey{Tenant: "tenant-a", Environment: "test", RuntimeDeployment: "runtime-a"}, HostDeployment: "enterprise-test"}}
	spec := enterpriseCodocsRestoreSpec
	action := spec.Actions["restore"]
	if err := validateEnterpriseDelegatedPermit(restoreServerInput("restore"), verified, spec, action, time.Now()); err != nil {
		t.Fatal(err)
	}
	for name, mutate := range map[string]func(*enterpriseDelegatedInput){
		"actor":      func(in *enterpriseDelegatedInput) { in.Authorization.ActorUID = "other" },
		"tenant":     func(in *enterpriseDelegatedInput) { in.Tenant = "other" },
		"deployment": func(in *enterpriseDelegatedInput) { in.Deployment = "other" },
		"resource":   func(in *enterpriseDelegatedInput) { in.Authorization.Resource = "documents" },
		"action":     func(in *enterpriseDelegatedInput) { in.Authorization.Action = "delete" },
		"expired": func(in *enterpriseDelegatedInput) {
			in.Authorization.ExpiresAt = time.Now().Add(-time.Second).UnixMilli()
		},
	} {
		in := restoreServerInput("restore")
		mutate(&in)
		if err := validateEnterpriseDelegatedPermit(in, verified, spec, action, time.Now()); err == nil {
			t.Fatalf("%s permit accepted", name)
		}
	}
}
