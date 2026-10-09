package workflow

import (
	"net/url"
	"testing"
)

func TestWorkflowRuntimeBodyFromRequestPrefersTrustedQueryActor(t *testing.T) {
	query := url.Values{}
	query.Set("current_user", "trusted-current")
	query.Set("operator_uid", "trusted-operator")

	body := map[string]any{
		"current_user": "body-current",
		"operator_uid": "body-operator",
		"actor_uid":    "body-actor",
		"comment":      "ok",
		"attachments":  []any{"a1"},
	}

	actual := workflowRuntimeBodyFromRequest(query, body)

	if got := cleanAnyString(actual["current_user"]); got != "trusted-current" {
		t.Fatalf("current_user = %q, want trusted current user", got)
	}
	if got := cleanAnyString(actual["operator_uid"]); got != "trusted-current" {
		t.Fatalf("operator_uid = %q, want trusted current user", got)
	}
	if _, ok := actual["actor_uid"]; ok {
		t.Fatalf("actor_uid should be stripped from body-derived auth context: %#v", actual)
	}
	if got := cleanAnyString(actual["comment"]); got != "ok" {
		t.Fatalf("comment = %q, want preserved business field", got)
	}
	if _, ok := actual["attachments"]; !ok {
		t.Fatalf("attachments should be preserved: %#v", actual)
	}
}

func TestWorkflowRuntimeBodyFromRequestAllowsBodyFallbackWithoutQueryActor(t *testing.T) {
	body := map[string]any{
		"current_user": "body-current",
		"operator_uid": "body-operator",
		"comment":      "ok",
	}

	actual := workflowRuntimeBodyFromRequest(url.Values{}, body)

	if actual["current_user"] != "body-current" || actual["operator_uid"] != "body-operator" {
		t.Fatalf("body fallback auth was changed: %#v", actual)
	}
	if actual["comment"] != "ok" {
		t.Fatalf("business field was changed: %#v", actual)
	}
}
