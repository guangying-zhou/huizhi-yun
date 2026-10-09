package aims

import (
	"github.com/huizhi-yun/data-runtime/internal/projectscope"
	"testing"
	"time"
)

func TestContractProjectPermissionFactsAndLockOrder(t *testing.T) {
	rev := int64(1)
	p := ContractProjectPlan{ProjectCode: "A", Name: "项目", Create: true}
	a := ContractProjectPermit{ActorUID: "person", Tenant: "tenant", Deployment: "host", ProjectCode: "A", Resource: "projects", Action: "create", Allowed: true, ExpiresAt: time.Now().Add(14 * time.Second).UnixMilli(), BundleVersion: "1", BundleHash: "signed", PolicyRevision: &rev, Scope: &projectscope.Projection{Version: 1, Masks: []int{65535}}}
	id := ContractProjectIdentity{ActorUID: "person", Tenant: "tenant", Deployment: "host", Permits: []ContractProjectPermit{a}}
	if e := projectContractPermission(id, p, "projects", "create", projectscope.Facts{ProjectCode: "A"}); e != nil {
		t.Fatal(e)
	}
	for _, mutate := range []func(*ContractProjectPermit){func(a *ContractProjectPermit) { a.ActorUID = "other" }, func(a *ContractProjectPermit) { a.Deployment = "other" }, func(a *ContractProjectPermit) { a.ExpiresAt = 1 }, func(a *ContractProjectPermit) { a.Action = "edit" }, func(a *ContractProjectPermit) { a.Scope = &projectscope.Projection{Version: 1, Masks: []int{65534}} }} {
		b := a
		mutate(&b)
		id.Permits = []ContractProjectPermit{b}
		if projectContractPermission(id, p, "projects", "create", projectscope.Facts{}) == nil {
			t.Fatal("forged or self-granted create")
		}
	}
	order := ContractProjectLockOrder([]ContractProjectPlan{{ProjectCode: "B"}, {ProjectCode: "A"}})
	if order[0] != "A" || order[1] != "B" {
		t.Fatal(order)
	}
}
