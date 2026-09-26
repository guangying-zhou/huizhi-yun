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
		Allowed    bool   `json:"allowed"`
		ExpiresAt  int64  `json:"expiresAt"`
	}{"U1", "T1", "enterprise-test", "projects", "edit", "7", true, now.Add(10 * time.Second).UnixMilli()}
	if validateEnterpriseProjectUpdatePermit("T1", "enterprise-test", "7", valid, verified, now) != nil {
		t.Fatal("valid permit rejected")
	}
	for _, change := range []func(*string, *string, *string){func(tn, actor, pid *string) { *tn = "T2" }, func(tn, actor, pid *string) { *actor = "U2" }, func(tn, actor, pid *string) { *pid = "8" }} {
		tenant, actor, pid := "T1", "U1", "7"
		candidate := valid
		change(&tenant, &actor, &pid)
		candidate.ActorUID = actor
		if validateEnterpriseProjectUpdatePermit(tenant, "enterprise-test", pid, candidate, verified, now) == nil {
			t.Fatal("invalid permit accepted")
		}
	}
}
