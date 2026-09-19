package server

import (
	"testing"
	"time"

	aimsapp "github.com/huizhi-yun/data-runtime/internal/apps/aims"
	"github.com/huizhi-yun/data-runtime/internal/enterprise"
)

// Deletion is a sensitive action with its own capability and permit action; the
// state transitions stay on the edit permit. Both must remain routable.
func TestEnterpriseWorkItemWriteActionsCarryTheirOwnCapability(t *testing.T) {
	for path, action := range map[string]string{
		"/v1/enterprise/aims/work-items:delete": "delete",
		"/v1/enterprise/aims/work-items:start":  "start",
		"/v1/enterprise/aims/work-items:reset":  "reset",
		"/v1/enterprise/aims/work-items:reopen": "reopen",
	} {
		if enterpriseWorkItemWritePaths[path] != action {
			t.Fatalf("%s is not routed to %s", path, action)
		}
	}
	if aimsapp.EnterpriseWorkItemDeleteCapability == aimsapp.EnterpriseWorkItemEditCapability {
		t.Fatal("deletion must not reuse the edit capability")
	}
	for action, capability := range aimsapp.EnterpriseWorkItemStateCapabilities {
		if capability == aimsapp.EnterpriseWorkItemEditCapability || capability == aimsapp.EnterpriseWorkItemDeleteCapability {
			t.Fatalf("%s must keep its own capability", action)
		}
	}
}

func TestEnterpriseWorkItemDeletePermitRequiresDeleteAction(t *testing.T) {
	now := time.Now()
	verified := enterpriseRequestContext{ActorUID: "person-a", Route: enterpriseRouteContext{Binding: enterprise.BindingKey{Tenant: "tenant-a"}, HostDeployment: "enterprise-test"}}
	input := func(action string) enterpriseWorkItemWriteInput {
		return enterpriseWorkItemWriteInput{
			Tenant: "tenant-a", Deployment: "enterprise-test", ProjectID: "7", WorkItemID: "42",
			Authorization: enterpriseWorkItemWritePermit{
				enterpriseProjectMemberPermit: enterpriseProjectMemberPermit{
					ActorUID: "person-a", Tenant: "tenant-a", Deployment: "enterprise-test",
					Resource: "work_items", Action: action, ProjectID: "7", Allowed: true,
					ExpiresAt: now.Add(10 * time.Second).UnixMilli(),
				},
				WorkItemID: "42",
			},
		}
	}
	if err := validateEnterpriseWorkItemWritePermit(input("delete"), verified, "delete", now); err != nil {
		t.Fatalf("delete permit rejected: %v", err)
	}
	// An edit permit must not authorize deletion.
	if err := validateEnterpriseWorkItemWritePermit(input("edit"), verified, "delete", now); err == nil {
		t.Fatal("edit permit accepted for deletion")
	}
	if err := validateEnterpriseWorkItemWritePermit(input("delete"), verified, "start", now); err == nil {
		t.Fatal("delete permit accepted for a state transition")
	}
	if err := validateEnterpriseWorkItemWritePermit(input("edit"), verified, "start", now); err != nil {
		t.Fatalf("state transition edit permit rejected: %v", err)
	}
}

// Distribution confirm/revoke keep their own capabilities; confirm needs the
// explicitly granted confirm permit and revoke needs an edit permit.
func TestEnterpriseWorkItemDistributionRoutesCapabilitiesAndPermits(t *testing.T) {
	for path, action := range map[string]string{
		"/v1/enterprise/aims/work-items:confirm-distribute": "confirm-distribute",
		"/v1/enterprise/aims/work-items:revoke-distribute":  "revoke-distribute",
	} {
		if enterpriseWorkItemWritePaths[path] != action {
			t.Fatalf("%s is not routed to %s", path, action)
		}
	}
	seen := map[string]bool{aimsapp.EnterpriseWorkItemEditCapability: true, aimsapp.EnterpriseWorkItemDeleteCapability: true}
	for _, capability := range aimsapp.EnterpriseWorkItemStateCapabilities {
		seen[capability] = true
	}
	for action, capability := range aimsapp.EnterpriseWorkItemDistributionCapabilities {
		if seen[capability] {
			t.Fatalf("%s reuses another work item capability", action)
		}
		seen[capability] = true
	}
	now := time.Now()
	verified := enterpriseRequestContext{ActorUID: "person-a", Route: enterpriseRouteContext{Binding: enterprise.BindingKey{Tenant: "tenant-a"}, HostDeployment: "enterprise-test"}}
	input := func(permitAction string) enterpriseWorkItemWriteInput {
		return enterpriseWorkItemWriteInput{
			Tenant: "tenant-a", Deployment: "enterprise-test", ProjectID: "7", WorkItemID: "42",
			Authorization: enterpriseWorkItemWritePermit{
				enterpriseProjectMemberPermit: enterpriseProjectMemberPermit{
					ActorUID: "person-a", Tenant: "tenant-a", Deployment: "enterprise-test",
					Resource: "work_items", Action: permitAction, ProjectID: "7", Allowed: true,
					ExpiresAt: now.Add(10 * time.Second).UnixMilli(),
				},
				WorkItemID: "42",
			},
		}
	}
	if err := validateEnterpriseWorkItemWritePermit(input("confirm"), verified, "confirm-distribute", now); err != nil {
		t.Fatalf("confirm permit rejected: %v", err)
	}
	if err := validateEnterpriseWorkItemWritePermit(input("edit"), verified, "confirm-distribute", now); err == nil {
		t.Fatal("edit permit accepted for confirming distribution")
	}
	if err := validateEnterpriseWorkItemWritePermit(input("edit"), verified, "revoke-distribute", now); err != nil {
		t.Fatalf("revoke edit permit rejected: %v", err)
	}
	if err := validateEnterpriseWorkItemWritePermit(input("confirm"), verified, "revoke-distribute", now); err == nil {
		t.Fatal("confirm permit accepted for revoking distribution")
	}
}

// Appended tasks are accepted or discarded by an approver: both decisions carry
// their own capability and require the explicitly granted confirm permit.
func TestEnterpriseWorkItemAppendDecisionsRequireConfirmPermit(t *testing.T) {
	for path, action := range map[string]string{
		"/v1/enterprise/aims/work-items:confirm-append": "confirm-append",
		"/v1/enterprise/aims/work-items:reject-append":  "reject-append",
	} {
		if enterpriseWorkItemWritePaths[path] != action {
			t.Fatalf("%s is not routed to %s", path, action)
		}
	}
	if aimsapp.EnterpriseWorkItemDistributionCapabilities["confirm-append"] == aimsapp.EnterpriseWorkItemDistributionCapabilities["reject-append"] {
		t.Fatal("append confirm and reject share a capability")
	}
	now := time.Now()
	verified := enterpriseRequestContext{ActorUID: "person-a", Route: enterpriseRouteContext{Binding: enterprise.BindingKey{Tenant: "tenant-a"}, HostDeployment: "enterprise-test"}}
	permit := func(action string) enterpriseWorkItemWriteInput {
		return enterpriseWorkItemWriteInput{
			Tenant: "tenant-a", Deployment: "enterprise-test", ProjectID: "7", WorkItemID: "42",
			Authorization: enterpriseWorkItemWritePermit{
				enterpriseProjectMemberPermit: enterpriseProjectMemberPermit{
					ActorUID: "person-a", Tenant: "tenant-a", Deployment: "enterprise-test",
					Resource: "work_items", Action: action, ProjectID: "7", Allowed: true,
					ExpiresAt: now.Add(10 * time.Second).UnixMilli(),
				},
				WorkItemID: "42",
			},
		}
	}
	for _, action := range []string{"confirm-append", "reject-append"} {
		if err := validateEnterpriseWorkItemWritePermit(permit("confirm"), verified, action, now); err != nil {
			t.Fatalf("%s rejected a confirm permit: %v", action, err)
		}
		if err := validateEnterpriseWorkItemWritePermit(permit("edit"), verified, action, now); err == nil {
			t.Fatalf("%s accepted an edit permit", action)
		}
	}
}

// Appending tasks is a planning edit with its own capability; the project
// manager rule is enforced again inside the Runtime transaction.
func TestEnterpriseWorkItemAppendTasksRoutesCapabilityAndEditPermit(t *testing.T) {
	if enterpriseWorkItemWritePaths["/v1/enterprise/aims/work-items:append-tasks"] != "append-tasks" {
		t.Fatal("append-tasks is not routed")
	}
	if aimsapp.EnterpriseWorkItemAppendTasksCapability == aimsapp.EnterpriseWorkItemEditCapability || aimsapp.EnterpriseWorkItemAppendTasksCapability == aimsapp.EnterpriseWorkItemCreateCapability {
		t.Fatal("append-tasks reuses another work item capability")
	}
	for _, capability := range aimsapp.EnterpriseWorkItemDistributionCapabilities {
		if capability == aimsapp.EnterpriseWorkItemAppendTasksCapability {
			t.Fatal("append-tasks reuses a distribution capability")
		}
	}
	now := time.Now()
	verified := enterpriseRequestContext{ActorUID: "person-a", Route: enterpriseRouteContext{Binding: enterprise.BindingKey{Tenant: "tenant-a"}, HostDeployment: "enterprise-test"}}
	permit := func(action string) enterpriseWorkItemWriteInput {
		return enterpriseWorkItemWriteInput{
			Tenant: "tenant-a", Deployment: "enterprise-test", ProjectID: "7", WorkItemID: "42",
			Authorization: enterpriseWorkItemWritePermit{
				enterpriseProjectMemberPermit: enterpriseProjectMemberPermit{
					ActorUID: "person-a", Tenant: "tenant-a", Deployment: "enterprise-test",
					Resource: "work_items", Action: action, ProjectID: "7", Allowed: true,
					ExpiresAt: now.Add(10 * time.Second).UnixMilli(),
				},
				WorkItemID: "42",
			},
		}
	}
	if err := validateEnterpriseWorkItemWritePermit(permit("edit"), verified, "append-tasks", now); err != nil {
		t.Fatalf("append-tasks rejected an edit permit: %v", err)
	}
	for _, other := range []string{"confirm", "create", "delete"} {
		if err := validateEnterpriseWorkItemWritePermit(permit(other), verified, "append-tasks", now); err == nil {
			t.Fatalf("append-tasks accepted a %s permit", other)
		}
	}
}

// Saving a breakdown is a planning edit with its own capability; coverage,
// locking and the manager rule are enforced inside the Runtime transaction.
func TestEnterpriseWorkItemBreakdownRoutesCapabilityAndEditPermit(t *testing.T) {
	if enterpriseWorkItemWritePaths["/v1/enterprise/aims/work-items:breakdown"] != "breakdown" {
		t.Fatal("breakdown is not routed")
	}
	for _, other := range []string{aimsapp.EnterpriseWorkItemEditCapability, aimsapp.EnterpriseWorkItemCreateCapability, aimsapp.EnterpriseWorkItemAppendTasksCapability} {
		if aimsapp.EnterpriseWorkItemBreakdownCapability == other {
			t.Fatal("breakdown reuses another work item capability")
		}
	}
	now := time.Now()
	verified := enterpriseRequestContext{ActorUID: "person-a", Route: enterpriseRouteContext{Binding: enterprise.BindingKey{Tenant: "tenant-a"}, HostDeployment: "enterprise-test"}}
	permit := func(action string) enterpriseWorkItemWriteInput {
		return enterpriseWorkItemWriteInput{
			Tenant: "tenant-a", Deployment: "enterprise-test", ProjectID: "7", WorkItemID: "42",
			Authorization: enterpriseWorkItemWritePermit{
				enterpriseProjectMemberPermit: enterpriseProjectMemberPermit{
					ActorUID: "person-a", Tenant: "tenant-a", Deployment: "enterprise-test",
					Resource: "work_items", Action: action, ProjectID: "7", Allowed: true,
					ExpiresAt: now.Add(10 * time.Second).UnixMilli(),
				},
				WorkItemID: "42",
			},
		}
	}
	if err := validateEnterpriseWorkItemWritePermit(permit("edit"), verified, "breakdown", now); err != nil {
		t.Fatalf("breakdown rejected an edit permit: %v", err)
	}
	for _, other := range []string{"confirm", "create", "delete"} {
		if err := validateEnterpriseWorkItemWritePermit(permit(other), verified, "breakdown", now); err == nil {
			t.Fatalf("breakdown accepted a %s permit", other)
		}
	}
}
