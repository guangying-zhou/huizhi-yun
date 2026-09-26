package server

import (
	"github.com/huizhi-yun/data-runtime/internal/enterprise"
	"testing"
	"time"
)

func TestEnterpriseProjectBoardTargetRetainsOnlyScope(t *testing.T) {
	input := enterpriseProjectBoardInput{ProjectID: "12", Query: map[string]string{"current_user_project_admin_project_codes": "PRJ-12"}}
	path, q, err := enterpriseProjectBoardTarget(input, "person-a")
	if err != nil || path != "/v1/aims/projects/12/board-data" || q.Get("current_user") != "person-a" {
		t.Fatalf("unexpected target %q %v", path, err)
	}
	for _, bad := range []enterpriseProjectBoardInput{{ProjectID: "0"}, {ProjectID: "12", Query: map[string]string{"view": "board"}}} {
		if _, _, err := enterpriseProjectBoardTarget(bad, "person-a"); err == nil {
			t.Fatal("accepted invalid project/query")
		}
	}
}
func TestEnterpriseProjectBoardPermitRejectsTenantActorAndResourceMismatch(t *testing.T) {
	now := time.Now()
	verified := enterpriseRequestContext{ActorUID: "person-a", Route: enterpriseRouteContext{Binding: enterprise.BindingKey{Tenant: "tenant-a"}, HostDeployment: "enterprise-test"}}
	valid := enterpriseProjectBoardInput{Tenant: "tenant-a", Deployment: "enterprise-test", Authorization: enterpriseProjectBoardPermit{ActorUID: "person-a", Tenant: "tenant-a", Deployment: "enterprise-test", Resource: "project-board", Action: "view", ExpiresAt: now.Add(10 * time.Second).UnixMilli()}}
	if validateEnterpriseProjectBoardPermit(valid, verified, now) != nil {
		t.Fatal("valid rejected")
	}
	valid.Authorization.Tenant = "tenant-b"
	if validateEnterpriseProjectBoardPermit(valid, verified, now) == nil {
		t.Fatal("tenant mismatch accepted")
	}
}
