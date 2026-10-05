package server

import (
	"github.com/huizhi-yun/data-runtime/internal/enterprise"
	"testing"
	"time"
)

func TestEnterpriseProjectUpdatePermitRejectsTenantActorAndProject(t *testing.T) {
	now := time.Now()
	verified := enterpriseRequestContext{ActorUID: "U1", Route: enterpriseRouteContext{Binding: enterprise.BindingKey{Tenant: "T1"}, HostDeployment: "enterprise-test"}}
	valid := struct {
		ActorUID   string `json:"actorUid"`
		Tenant     string `json:"tenant"`
		Deployment string `json:"deployment"`
		Resource   string `json:"resource"`
		Action     string `json:"action"`
		ProjectID  string `json:"projectId"`
		Mode       string `json:"mode"`
		Allowed    bool   `json:"allowed"`
		ExpiresAt  int64  `json:"expiresAt"`
	}{"U1", "T1", "enterprise-test", "projects", "edit", "7", "", true, now.Add(10 * time.Second).UnixMilli()}
	if validateEnterpriseProjectUpdatePermit("T1", "enterprise-test", "7", valid, verified, now, false) != nil {
		t.Fatal("valid permit rejected")
	}

	conditional := valid
	conditional.Mode = "static-or-project-manager"
	conditional.Allowed = false
	if err := validateEnterpriseProjectUpdatePermit("T1", "enterprise-test", "7", conditional, verified, now, false); err != nil {
		t.Fatal(err)
	}
	for name, change := range map[string]func(){"expired": func() { conditional.ExpiresAt = now.UnixMilli() }, "mode": func() { conditional.Mode = "manager" }, "legacy-denial": func() { conditional.Mode = "" }, "long-lived": func() { conditional.ExpiresAt = now.Add(16 * time.Second).UnixMilli() }} {
		conditional = valid
		conditional.Mode = "static-or-project-manager"
		conditional.Allowed = false
		change()
		if err := validateEnterpriseProjectUpdatePermit("T1", "enterprise-test", "7", conditional, verified, now, false); err == nil {
			t.Fatalf("accepted %s", name)
		}
	}
	for _, change := range []func(*string, *string, *string){func(tn, actor, pid *string) { *tn = "T2" }, func(tn, actor, pid *string) { *actor = "U2" }, func(tn, actor, pid *string) { *pid = "8" }} {
		tenant, actor, pid := "T1", "U1", "7"
		candidate := valid
		change(&tenant, &actor, &pid)
		candidate.ActorUID = actor
		if validateEnterpriseProjectUpdatePermit(tenant, "enterprise-test", pid, candidate, verified, now, false) == nil {
			t.Fatal("invalid permit accepted")
		}
	}
}
