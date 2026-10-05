package aims

import (
	"net/url"
	"testing"
)

func TestCurrentUserFromPrefersTrustedQuery(t *testing.T) {
	uid := currentUserFrom(
		url.Values{
			"current_user": {"trusted-user"},
		},
		map[string]any{
			"current_user": "spoofed-user",
			"operator_uid": "spoofed-operator",
			"uid":          "spoofed-uid",
		},
	)
	if uid != "trusted-user" {
		t.Fatalf("expected trusted query user, got %q", uid)
	}
}

func TestCurrentUserFromUsesOperatorQueryBeforeBody(t *testing.T) {
	uid := currentUserFrom(
		url.Values{
			"operator_uid": {"trusted-operator"},
		},
		map[string]any{
			"current_user": "spoofed-user",
		},
	)
	if uid != "trusted-operator" {
		t.Fatalf("expected trusted query operator, got %q", uid)
	}
}

func TestCurrentUserFromKeepsBodyFallback(t *testing.T) {
	uid := currentUserFrom(
		url.Values{},
		map[string]any{
			"operator_uid": "legacy-operator",
		},
	)
	if uid != "legacy-operator" {
		t.Fatalf("expected legacy body fallback, got %q", uid)
	}
}
