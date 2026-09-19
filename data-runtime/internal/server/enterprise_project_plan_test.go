package server

import (
	"github.com/huizhi-yun/data-runtime/internal/enterprise"
	"testing"
	"time"
)

func TestEnterpriseProjectPlanTargetRetainsProjectScope(t *testing.T) {
	input := enterpriseProjectPlanInput{ProjectID: "12", Query: map[string]string{"current_user_project_admin_project_codes": "PRJ-12", "page": "1"}}
	path, q, err := enterpriseProjectPlanTarget("milestones", input, "person-a")
	if err != nil || path != "/v1/aims/projects/12/milestones" || q.Get("current_user") != "person-a" || q.Get("current_user_project_admin_project_codes") != "PRJ-12" {
		t.Fatalf("invalid target %q %v %v", path, q, err)
	}
	for _, bad := range []enterpriseProjectPlanInput{{ProjectID: "0"}, {ProjectID: "12", Query: map[string]string{"tenant": "other"}}} {
		if _, _, err := enterpriseProjectPlanTarget("items", bad, "person-a"); err == nil {
			t.Fatal("accepted invalid project or query")
		}
	}
}
func TestEnterpriseProjectPlanPermitRejectsTenantAndActorMismatch(t *testing.T) {
	now := time.Now()
	verified := enterpriseRequestContext{ActorUID: "person-a", Route: enterpriseRouteContext{Binding: enterprise.BindingKey{Tenant: "tenant-a"}, HostDeployment: "enterprise-test"}}
	valid := enterpriseProjectPlanInput{Tenant: "tenant-a", Deployment: "enterprise-test", Authorization: enterpriseProjectPlanPermit{ActorUID: "person-a", Tenant: "tenant-a", Deployment: "enterprise-test", Resource: "project-plan", Action: "view", ExpiresAt: now.Add(10 * time.Second).UnixMilli()}}
	if validateEnterpriseProjectPlanPermit(valid, verified, now) != nil {
		t.Fatal("valid permit rejected")
	}
	valid.Authorization.ActorUID = "person-b"
	if validateEnterpriseProjectPlanPermit(valid, verified, now) == nil {
		t.Fatal("mismatched actor accepted")
	}
}
