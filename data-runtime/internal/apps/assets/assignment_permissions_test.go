package assets

import (
	"net/url"
	"strings"
	"testing"
)

func assignmentPermissionQuery(actor, action, access string, units string) url.Values {
	return url.Values{
		"current_user":                 {actor},
		assetsObjectAccessQueryKey:     {access},
		assetsScopeUnitsQueryKey:       {units},
		assetsPermissionActionQueryKey: {action},
	}
}

func TestAssignmentScopeWhereIncludesRequestTargetAndCurrentAssetRelations(t *testing.T) {
	where, args := assignmentScopeWhere("assignment", "asset", "u1", []assetsScopeUnit{{DirectRelation: true}})
	for _, fragment := range []string{"assignment.requested_by=?", "assignment.target_type='user'", "assignment.target_ref=?", "asset.owner_uid", "asset.custodian_uid", "asset.user_uid"} {
		if !strings.Contains(where, fragment) {
			t.Fatalf("assignment relation scope missing %q in %s", fragment, where)
		}
	}
	if len(args) != 3 {
		t.Fatalf("expected requester, target and asset actor args, got %#v", args)
	}
}

func TestSelfServiceAssignmentRequestIsBoundToActorAndOwnedAsset(t *testing.T) {
	units := `[{"directRelation":true,"departmentCodes":[],"projectCodes":[]}]`
	claim := map[string]any{"action_type": "claim", "target_type": "user", "target_ref": "other"}
	claimAsset := assignmentAssetRecord{ID: 1, Category: "physical", Status: "in_stock"}
	if err := authorizeAssignmentCreate(assignmentPermissionQuery("u1", "request", "relation", units), claim, claimAsset); err != nil {
		t.Fatal(err)
	}
	if claim["target_type"] != "user" || claim["target_ref"] != "u1" || claim["status"] != "pending" {
		t.Fatalf("claim was not normalized to the actor: %#v", claim)
	}

	for _, actionType := range []string{"assign", "transfer", "scrap", "renew", "rotate_secret"} {
		body := map[string]any{"action_type": actionType, "target_type": "user", "target_ref": "u1"}
		if err := authorizeAssignmentCreate(assignmentPermissionQuery("u1", "request", "relation", units), body, claimAsset); err == nil {
			t.Fatalf("self-service request unexpectedly allowed %s", actionType)
		}
	}

	physical := assignmentAssetRecord{ID: 2, Category: "physical", Status: "in_use", UserUID: "u1"}
	if err := authorizeAssignmentCreate(assignmentPermissionQuery("u1", "request", "relation", units), map[string]any{"action_type": "return"}, physical); err != nil {
		t.Fatalf("own physical return should be allowed: %v", err)
	}
	physical.UserUID = "other"
	if err := authorizeAssignmentCreate(assignmentPermissionQuery("u1", "request", "relation", units), map[string]any{"action_type": "return"}, physical); err == nil {
		t.Fatal("returning another user's physical asset should be denied")
	}

	resource := assignmentAssetRecord{ID: 3, Category: "resource", Status: "active", UserUID: "u1"}
	if err := authorizeAssignmentCreate(assignmentPermissionQuery("u1", "request", "relation", units), map[string]any{"action_type": "release"}, resource); err != nil {
		t.Fatalf("own resource release should be allowed: %v", err)
	}
	if err := authorizeAssignmentCreate(assignmentPermissionQuery("u1", "request", "relation", units), map[string]any{"action_type": "return"}, resource); err == nil {
		t.Fatal("resource return should be denied; resources use release")
	}
}

func TestSelfServiceCannotInjectWorkflowOrEffectiveState(t *testing.T) {
	units := `[{"directRelation":true,"departmentCodes":[],"projectCodes":[]}]`
	asset := assignmentAssetRecord{ID: 1, Category: "physical", Status: "in_stock"}
	for _, field := range []string{"workflow_instance_id", "effective_at", "ended_at", "approved_by", "assignment_no", "source_ref"} {
		body := map[string]any{"action_type": "claim", field: "injected"}
		if err := authorizeAssignmentCreate(assignmentPermissionQuery("u1", "request", "relation", units), body, asset); err == nil {
			t.Fatalf("self-service request unexpectedly accepted %s", field)
		}
	}
}

func TestScopedAssignmentEditorCannotOperateOutsideAssetScope(t *testing.T) {
	units := `[{"directRelation":false,"departmentCodes":["D1"],"projectCodes":[]}]`
	query := assignmentPermissionQuery("manager", "edit", "relation", units)
	body := map[string]any{"action_type": "assign", "target_type": "user", "target_ref": "u1"}
	if err := authorizeAssignmentCreate(query, body, assignmentAssetRecord{ID: 1, DepartmentCode: "D2"}); err == nil {
		t.Fatal("scoped editor unexpectedly operated outside department")
	}
	if err := authorizeAssignmentCreate(query, body, assignmentAssetRecord{ID: 1, DepartmentCode: "D1"}); err != nil {
		t.Fatalf("scoped editor should operate inside department: %v", err)
	}
}
