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
		{name: "finance relative path", app: "finance", raw: "/api/v1/finance/workflow/callback"},
		{name: "aims registered path", app: "aims", raw: "/api/v1/service/workflow/callback", want: "/api/v1/service/workflow/callback"},
		{name: "aims completion path", app: "aims", raw: aimsCompletionWorkflowCallback, want: aimsCompletionWorkflowCallback},
		{name: "completion wrong app", app: "people", raw: aimsCompletionWorkflowCallback},
		{name: "completion query rejected", app: "aims", raw: aimsCompletionWorkflowCallback + "?next=/"},
		{name: "completion empty query rejected", app: "aims", raw: aimsCompletionWorkflowCallback + "?"},
		{name: "completion empty fragment rejected", app: "aims", raw: aimsCompletionWorkflowCallback + "#"},
		{name: "completion fragment rejected", app: "aims", raw: aimsCompletionWorkflowCallback + "#next"},
		{name: "completion userinfo rejected", app: "aims", raw: "https://user@example.invalid" + aimsCompletionWorkflowCallback},
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

func TestAltocCallbackClosedBusinessTuples(t *testing.T) {
	const path = "/api/v1/service/workflow/callback"
	for _, resource := range []string{"quotation", "contract"} {
		if got := trustedWorkflowCallbackPath("altoc", path, resource, "approve"); got != path {
			t.Fatal(got)
		}
		for _, raw := range []string{path + "?", path + "#", path + "/extra", "https://evil.invalid" + path, "//evil.invalid" + path, "/api/v1/service/customer/callback"} {
			if trustedWorkflowCallbackPath("altoc", raw, resource, "approve") != "" {
				t.Fatal("unregistered path", raw)
			}
		}
	}
	for _, tuple := range [][]string{{"customer", "approve"}, {"quotation", "edit"}, {"Quotation", "approve"}, {"contract", "approve "}} {
		if trustedWorkflowCallbackPath("altoc", path, tuple...) != "" {
			t.Fatal("unregistered tuple", tuple)
		}
	}
	if trustedWorkflowCallbackPath("altoc", path) != "" {
		t.Fatal("app wildcard allowed")
	}
}

func TestFinanceCallbackClosedBusinessTupleAndLegacyPaths(t *testing.T) {
	for _, path := range []string{"/api/v1/finance/workflow/callback", "/finance/api/v1/finance/workflow/callback"} {
		if trustedWorkflowCallbackPath("finance", path, "invoices", "request") != path {
			t.Fatal("registered legacy path", path)
		}
		for _, raw := range []string{path + "?", path + "#", path + "/extra", "https://evil.invalid" + path, "//evil.invalid" + path} {
			if trustedWorkflowCallbackPath("finance", raw, "invoices", "request") != "" {
				t.Fatal("unregistered path", raw)
			}
		}
		for _, tuple := range [][]string{{"invoices", "approve"}, {"Invoices", "request"}, {"invoices", "request "}, {"expenses", "approve"}} {
			if path == "/api/v1/finance/workflow/callback" && tuple[0] == "expenses" {
				continue
			}
			if trustedWorkflowCallbackPath("finance", path, tuple...) != "" {
				t.Fatal("widened tuple", tuple)
			}
		}
	}
	for _, action := range []string{"claim", "project_expense", "payment"} {
		path := "/api/v1/finance/workflow/callback"
		if trustedWorkflowCallbackPath("finance", path, "expenses", action) != path {
			t.Fatal("legacy expense changed", action)
		}
	}
}

func TestAPF13aExpenseCallbackExactTuples(t *testing.T) {
	for _, action := range []string{"claim", "project_expense", "payment"} {
		for _, path := range []string{"/api/v1/finance/workflow/callback", "/finance/api/v1/finance/workflow/callback"} {
			if trustedWorkflowCallbackPath("finance", path, "expenses", action) != path {
				t.Fatal(action, path)
			}
			for _, raw := range []string{path + "?", path + "#", path + "/more", "https://evil.invalid" + path} {
				if trustedWorkflowCallbackPath("finance", raw, "expenses", action) != "" {
					t.Fatal(raw)
				}
			}
		}
	}
	if trustedWorkflowCallbackPath("finance", "/finance/api/v1/finance/workflow/callback", "expenses", "unknown") != "" {
		t.Fatal("unknown tuple allowed")
	}
}
