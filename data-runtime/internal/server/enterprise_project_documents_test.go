package server

import (
	"testing"
	"time"
)

func TestEnterpriseProjectDocumentReadTargetDoesNotAcceptClientAuthorizationFacts(t *testing.T) {
	for _, key := range []string{"current_user", "operator_uid", "current_user_is_project_admin", "current_user_project_admin_project_codes", "path", "projectId"} {
		_, _, err := enterpriseProjectDocumentReadTarget(enterpriseProjectDocumentReadInput{ProjectID: "12", Query: map[string]string{key: "forged"}}, "person-a", false)
		if err == nil {
			t.Fatalf("accepted %s", key)
		}
	}
	path, q, err := enterpriseProjectDocumentReadTarget(enterpriseProjectDocumentReadInput{ProjectID: "12", DocumentID: "9"}, "person-a", true)
	if err != nil || path != "/v1/aims/projects/12/documents/9" || q.Get("current_user") != "person-a" {
		t.Fatalf("unexpected target %s %v %v", path, q, err)
	}
	for _, in := range []enterpriseProjectDocumentReadInput{{ProjectID: "12", DocumentID: "../9"}, {ProjectID: "12", DocumentID: "9", Query: map[string]string{"docCategory": "private"}}, {ProjectID: "01", DocumentID: "9"}} {
		if _, _, err = enterpriseProjectDocumentReadTarget(in, "person-a", true); err == nil {
			t.Fatal("accepted malformed detail")
		}
	}
}

func TestEnterpriseProjectDocumentReadRequiresCurrentParentBoundPermit(t *testing.T) {
	now := time.UnixMilli(1_800_000_000_000)
	v := delegatedVerified()
	in := enterpriseProjectDocumentReadInput{Tenant: "tenant-a", Deployment: "enterprise-test", ProjectID: "12", Authorization: enterpriseProjectDocumentReadPermit{ActorUID: "person-a", Tenant: "tenant-a", Deployment: "enterprise-test", Resource: "projects", Action: "view", ExpiresAt: now.Add(10 * time.Second).UnixMilli()}, ProjectReadAuthorization: validNestedProjectReadPermit(now, "12")}
	if err := validateEnterpriseProjectDocumentReadPermit(in, v, now); err != nil {
		t.Fatal(err)
	}
	in.ProjectReadAuthorization = validNestedProjectReadPermit(now, "13")
	if err := validateEnterpriseProjectDocumentReadPermit(in, v, now); err == nil {
		t.Fatal("accepted other project")
	}
	in.ProjectReadAuthorization = validNestedProjectReadPermit(now, "12")
	in.Authorization.Action = "edit"
	if err := validateEnterpriseProjectDocumentReadPermit(in, v, now); err == nil {
		t.Fatal("accepted wrong action")
	}
}

func TestEnterpriseProjectDocumentReadPreservesSignedScopeContextOnly(t *testing.T) {
	in := enterpriseProjectDocumentReadInput{ProjectID: "12", ProjectScopeQuery: map[string]string{"current_user_project_admin_project_codes": "P12", "current_user_dept_codes": "D1"}}
	_, q, err := enterpriseProjectDocumentReadTarget(in, "person-a", false)
	if err != nil || q.Get("current_user_project_admin_project_codes") != "P12" || q.Get("current_user") != "person-a" {
		t.Fatalf("q=%v err=%v", q, err)
	}
	for _, key := range []string{"current_user", "operator_uid", "projectId", "tenant", "path", "current_user_project_admin_other"} {
		in.ProjectScopeQuery = map[string]string{key: "forged"}
		if _, _, err = enterpriseProjectDocumentReadTarget(in, "person-a", false); err == nil {
			t.Fatalf("accepted %s", key)
		}
	}
}

func TestEnterpriseDocumentCreateRequiresStableUUIDAndNoCallerIdentityFields(t *testing.T) {
	good := map[string]any{"uuid": "11111111-1111-4111-8111-111111111111", "title": "test", "projectId": 12}
	if err := validateEnterpriseProjectDocumentCreationPayload(good, true); err != nil {
		t.Fatal(err)
	}
	for _, key := range []string{"actorUid", "created_by", "current_user", "runtimeUrl", "scope", "projectAdmin"} {
		bad := map[string]any{}
		for k, v := range good {
			bad[k] = v
		}
		bad[key] = "forged"
		if validateEnterpriseProjectDocumentCreationPayload(bad, true) == nil {
			t.Fatalf("accepted %s", key)
		}
	}
	for _, uuid := range []any{nil, 1, "", "not-a-uuid"} {
		if validateEnterpriseProjectDocumentCreationPayload(map[string]any{"uuid": uuid, "title": "test", "projectId": 12}, true) == nil {
			t.Fatalf("accepted UUID %v", uuid)
		}
	}
}
