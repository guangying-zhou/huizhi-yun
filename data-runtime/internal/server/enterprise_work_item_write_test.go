package server

import (
	"github.com/huizhi-yun/data-runtime/internal/enterprise"
	"github.com/huizhi-yun/data-runtime/internal/projectscope"
	"testing"
	"time"
)

func TestEnterpriseWorkItemWritePermitBindsTenantActorProjectObjectAndAction(t *testing.T) {
	now := time.Now()
	verified := enterpriseRequestContext{ActorUID: "U1", Route: enterpriseRouteContext{Binding: enterprise.BindingKey{Tenant: "T1"}, HostDeployment: "enterprise-test"}}
	valid := enterpriseWorkItemWriteInput{Tenant: "T1", Deployment: "enterprise-test", ProjectID: "1", WorkItemID: "7", Authorization: enterpriseWorkItemWritePermit{enterpriseProjectMemberPermit: enterpriseProjectMemberPermit{ActorUID: "U1", Tenant: "T1", Deployment: "enterprise-test", ProjectID: "1", Resource: "work_items", Action: "edit", Allowed: true, ExpiresAt: now.Add(10 * time.Second).UnixMilli()}, WorkItemID: "7"}}
	revision := int64(27)
	valid.Authorization.Scope = &projectscope.Projection{Version: 1, Masks: []int{65535}}
	valid.Authorization.BundleVersion = "v27"
	valid.Authorization.BundleHash = "hash27"
	valid.Authorization.PolicyRevision = &revision
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

func TestEnterpriseWorkItemScopedPermitFailsClosed(t *testing.T) {
	now := time.Now()
	revision := int64(27)
	verified := enterpriseRequestContext{ActorUID: "U1", Route: enterpriseRouteContext{Binding: enterprise.BindingKey{Tenant: "T1"}, HostDeployment: "enterprise-test"}}
	for _, action := range []string{"create", "edit", "associate", "plan-ready", "start", "reset", "reopen", "complete", "matter-complete", "completion-replay"} {
		permission := "edit"
		itemID := "7"
		if action == "create" {
			permission = "create"
			itemID = ""
		}
		resource := "work_items"
		if action == "completion-replay" {
			resource, permission = "integration_operations", "replay"
		}
		makeInput := func() enterpriseWorkItemWriteInput {
			return enterpriseWorkItemWriteInput{Tenant: "T1", Deployment: "enterprise-test", ProjectID: "1", WorkItemID: itemID, Authorization: enterpriseWorkItemWritePermit{enterpriseProjectMemberPermit: enterpriseProjectMemberPermit{ActorUID: "U1", Tenant: "T1", Deployment: "enterprise-test", ProjectID: "1", Resource: resource, Action: permission, Allowed: true, ExpiresAt: now.Add(10 * time.Second).UnixMilli()}, WorkItemID: itemID, Scope: &projectscope.Projection{Version: 1, Masks: []int{65535}}, BundleVersion: "v27", BundleHash: "hash27", PolicyRevision: &revision}}
		}
		if err := validateEnterpriseWorkItemWritePermit(makeInput(), verified, action, now); err != nil {
			t.Fatal(action, err)
		}
		for _, change := range []func(*enterpriseWorkItemWriteInput){func(i *enterpriseWorkItemWriteInput) { i.Authorization.Scope = nil }, func(i *enterpriseWorkItemWriteInput) { i.Authorization.BundleHash = "" }, func(i *enterpriseWorkItemWriteInput) { i.Authorization.PolicyRevision = nil }, func(i *enterpriseWorkItemWriteInput) {
			i.Authorization.Scope = &projectscope.Projection{Version: 2, Masks: []int{65535}}
		}, func(i *enterpriseWorkItemWriteInput) { i.Authorization.ExpiresAt = now.UnixMilli() - 1 }, func(i *enterpriseWorkItemWriteInput) { i.Authorization.Resource = "projects" }} {
			input := makeInput()
			change(&input)
			if validateEnterpriseWorkItemWritePermit(input, verified, action, now) == nil {
				t.Fatal("invalid scoped write accepted", action)
			}
		}
	}
}
