package server

import (
	"github.com/huizhi-yun/data-runtime/internal/enterprise"
	"testing"
	"time"
)

func TestEnterpriseWorkItemWritePermitBindsTenantActorProjectObjectAndAction(t *testing.T) {
	now := time.Now()
	verified := enterpriseRequestContext{ActorUID: "U1", Route: enterpriseRouteContext{Binding: enterprise.BindingKey{Tenant: "T1"}, HostDeployment: "enterprise-test"}}
	valid := enterpriseWorkItemWriteInput{Tenant: "T1", Deployment: "enterprise-test", ProjectID: "1", WorkItemID: "7", Authorization: enterpriseWorkItemWritePermit{enterpriseProjectMemberPermit: enterpriseProjectMemberPermit{ActorUID: "U1", Tenant: "T1", Deployment: "enterprise-test", ProjectID: "1", Resource: "work_items", Action: "edit", Allowed: true, ExpiresAt: now.Add(10 * time.Second).UnixMilli()}, WorkItemID: "7"}}
	if err := validateEnterpriseWorkItemWritePermit(valid, verified, "edit", now); err != nil {
		t.Fatal(err)
	}
	for _, change := range []func(*enterpriseWorkItemWriteInput){func(v *enterpriseWorkItemWriteInput) { v.Tenant = "T2" }, func(v *enterpriseWorkItemWriteInput) { v.Authorization.ActorUID = "U2" }, func(v *enterpriseWorkItemWriteInput) { v.ProjectID = "2" }, func(v *enterpriseWorkItemWriteInput) { v.WorkItemID = "8" }, func(v *enterpriseWorkItemWriteInput) { v.Authorization.Action = "create" }, func(v *enterpriseWorkItemWriteInput) { v.Authorization.Allowed = false }} {
		v := valid
		change(&v)
		if validateEnterpriseWorkItemWritePermit(v, verified, "edit", now) == nil {
			t.Fatal("invalid write permit accepted")
		}
	}
}
