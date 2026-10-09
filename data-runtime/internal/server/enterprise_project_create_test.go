package server

import (
	"encoding/json"
	"github.com/huizhi-yun/data-runtime/internal/enterprise"
	"github.com/huizhi-yun/data-runtime/internal/projectscope"
	"testing"
	"time"
)

func TestEnterpriseProjectCreatePermitRejectsTenantActorAndScope(t *testing.T) {
	now := time.Now()
	verified := enterpriseRequestContext{ActorUID: "person-a", Route: enterpriseRouteContext{Binding: enterprise.BindingKey{Tenant: "tenant-a"}, HostDeployment: "enterprise-test"}}
	revision := int64(27)
	valid := enterpriseProjectCreateInput{Tenant: "tenant-a", Deployment: "enterprise-test", Input: map[string]any{"projectCode": "P1"}, Authorization: enterpriseProjectCreatePermit{ActorUID: "person-a", Tenant: "tenant-a", Deployment: "enterprise-test", Resource: "projects", Action: "create", Allowed: true, ExpiresAt: now.Add(10 * time.Second).UnixMilli(), ProjectCode: "P1", Scope: &projectscope.Projection{Version: 1, Masks: []int{65535}}, BundleVersion: "v27", BundleHash: "hash27", PolicyRevision: &revision}}
	if validateEnterpriseProjectCreatePermit(valid, verified, now) != nil {
		t.Fatal("valid rejected")
	}
	raw, err := json.Marshal(valid)
	if err != nil {
		t.Fatal(err)
	}
	var body map[string]any
	if err := json.Unmarshal(raw, &body); err != nil {
		t.Fatal(err)
	}
	decoded, err := decodeEnterpriseProjectCreateInput(body)
	if err != nil || validateEnterpriseProjectCreatePermit(decoded, verified, now) != nil {
		t.Fatalf("Foundation create permit with empty projectId/workItemId rejected: %v", err)
	}
	checks := []func(*enterpriseProjectCreateInput){func(v *enterpriseProjectCreateInput) { v.Tenant = "tenant-b" }, func(v *enterpriseProjectCreateInput) { v.Authorization.ActorUID = "person-b" }, func(v *enterpriseProjectCreateInput) { v.Authorization.Allowed = false }, func(v *enterpriseProjectCreateInput) { v.Input = map[string]any{"projectCode": "P2"} }, func(v *enterpriseProjectCreateInput) { v.Input = map[string]any{"projectCode": "P1", "deptCode": "B"} }, func(v *enterpriseProjectCreateInput) { v.Authorization.Scope = nil }, func(v *enterpriseProjectCreateInput) { v.Authorization.ProjectID = "263" }, func(v *enterpriseProjectCreateInput) { v.Authorization.WorkItemID = "309" }}
	for _, change := range checks {
		candidate := valid
		change(&candidate)
		if validateEnterpriseProjectCreatePermit(candidate, verified, now) == nil {
			t.Fatal("invalid permit accepted")
		}
	}
}
