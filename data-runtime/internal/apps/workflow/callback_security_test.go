package workflow

import "testing"

func TestTrustedWorkflowCallbackPathRejectsCallerControlledOriginsAndPaths(t *testing.T) {
	for _, test := range []struct {
		name string
		app  string
		raw  string
		want string
	}{
		{name: "codocs registered path", app: "codocs", raw: "https://attacker.invalid/api/reviews/workflow-callback", want: "/api/reviews/workflow-callback"},
		{name: "finance relative path", app: "finance", raw: "/api/v1/finance/workflow/callback", want: "/api/v1/finance/workflow/callback"},
		{name: "aims registered path", app: "aims", raw: "/api/v1/service/workflow/callback", want: "/api/v1/service/workflow/callback"},
		{name: "aims wrong path", app: "aims", raw: "/api/v1/workflow-callback"},
		{name: "wrong path", app: "people", raw: "/api/v1/users"},
		{name: "query is rejected", app: "people", raw: "/api/v1/service/workflow/callback?next=https://attacker.invalid"},
		{name: "userinfo is rejected", app: "people", raw: "https://workflow@attacker.invalid/api/v1/service/workflow/callback"},
	} {
		t.Run(test.name, func(t *testing.T) {
			if got := trustedWorkflowCallbackPath(test.app, test.raw); got != test.want {
				t.Fatalf("trustedWorkflowCallbackPath(%q, %q) = %q, want %q", test.app, test.raw, got, test.want)
			}
		})
	}
}
