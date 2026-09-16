package codocs

import (
	"net/url"
	"testing"
)

func TestCodocsRuntimeBodyFromRequestPrefersTrustedQueryActor(t *testing.T) {
	query := url.Values{}
	query.Set("current_user", "trusted-current")
	query.Set("operator_uid", "trusted-operator")

	body := map[string]any{
		"current_user":      "body-current",
		"operator_uid":      "body-operator",
		"actorUid":          "body-actor",
		"actor_uid":         "body-actor-snake",
		"ownerUid":          "body-owner",
		"owner_uid":         "body-owner-snake",
		"editorUid":         "body-editor",
		"last_editor_uid":   "body-last-editor",
		"created_by":        "body-created",
		"updatedBy":         "body-updated",
		"serverAuthorized":  true,
		"server_authorized": true,
		"actorProjectCodes": []string{"forged-project"},
		"actorDeptCodes":    []string{"forged-dept"},
		"actorRoles":        []string{"forged-role"},
		"uid":               "target-user",
		"title":             "Design Doc",
	}

	actual := codocsRuntimeBodyFromRequest(query, body)

	for _, key := range []string{"current_user", "currentUser", "operator_uid", "operatorUid", "actorUid", "actor_uid"} {
		if got := stringValue(actual[key]); got != "trusted-current" {
			t.Fatalf("%s = %q, want trusted current user", key, got)
		}
	}
	for _, key := range []string{"ownerUid", "owner_uid", "editorUid", "last_editor_uid"} {
		if _, ok := actual[key]; ok {
			t.Fatalf("%s should be stripped from body auth context: %#v", key, actual)
		}
	}
	for _, key := range []string{"serverAuthorized", "server_authorized", "actorProjectCodes", "actorDeptCodes", "actorRoles"} {
		if _, ok := actual[key]; ok {
			t.Fatalf("%s should be stripped from body auth context: %#v", key, actual)
		}
	}
	for _, key := range []string{"created_by", "createdBy", "updated_by", "updatedBy"} {
		if got := stringValue(actual[key]); got != "trusted-current" {
			t.Fatalf("%s = %q, want trusted current user", key, got)
		}
	}
	if got := stringValue(actual["title"]); got != "Design Doc" {
		t.Fatalf("title = %q, want preserved business field", got)
	}
	if got := stringValue(actual["uid"]); got != "target-user" {
		t.Fatalf("uid = %q, want preserved target field", got)
	}
	if got := actorFromBody(actual); got != "trusted-current" {
		t.Fatalf("actorFromBody() = %q, want trusted current user", got)
	}
}

func TestCodocsRuntimeBodyFromRequestAllowsBodyFallbackWithoutQueryActor(t *testing.T) {
	body := map[string]any{
		"current_user": "body-current",
		"operator_uid": "body-operator",
		"actorUid":     "body-actor",
		"ownerUid":     "body-owner",
		"title":        "Design Doc",
	}

	actual := codocsRuntimeBodyFromRequest(url.Values{}, body)

	if actual["current_user"] != "body-current" || actual["operator_uid"] != "body-operator" || actual["ownerUid"] != "body-owner" {
		t.Fatalf("body fallback auth was changed: %#v", actual)
	}
	if actual["title"] != "Design Doc" {
		t.Fatalf("business field was changed: %#v", actual)
	}
}

func TestCodocsActorFromQueryPrefersCurrentUser(t *testing.T) {
	query := url.Values{}
	query.Set("actorUid", "query-actor")
	query.Set("operator_uid", "query-operator")
	query.Set("current_user", "query-current")

	if got := actorFromQuery(query); got != "query-current" {
		t.Fatalf("actorFromQuery() = %q, want current_user", got)
	}
	if got := codocsRuntimeActorFromQuery(query); got != "query-current" {
		t.Fatalf("codocsRuntimeActorFromQuery() = %q, want current_user", got)
	}
}

func TestDepartmentDocumentReadAllowedByTrustedContext(t *testing.T) {
	doc := map[string]any{
		"doc_type":  "department",
		"dept_code": "dept-sales",
	}

	query := url.Values{}
	query.Set("trusted_department_read_dept_code", "dept-sales")
	if !departmentDocumentReadAllowedByTrustedContext(doc, query) {
		t.Fatal("trusted snake-case department context should allow matching department document")
	}

	query = url.Values{}
	query.Set("trustedDepartmentReadDeptCode", "dept-sales")
	if !departmentDocumentReadAllowedByTrustedContext(doc, query) {
		t.Fatal("trusted camel-case department context should allow matching department document")
	}

	query = url.Values{}
	query.Set("trusted_department_read_dept_code", "dept-finance")
	if departmentDocumentReadAllowedByTrustedContext(doc, query) {
		t.Fatal("mismatched department context must not allow document read")
	}

	query = url.Values{}
	query.Set("trusted_department_read_dept_code", "dept-sales")
	privateDoc := map[string]any{
		"doc_type":  "private",
		"dept_code": "dept-sales",
	}
	if departmentDocumentReadAllowedByTrustedContext(privateDoc, query) {
		t.Fatal("trusted department context must not allow non-department documents")
	}
}
