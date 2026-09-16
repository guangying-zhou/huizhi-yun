package altoc

import (
	"errors"
	"net/http"
	"net/url"
	"testing"

	"github.com/huizhi-yun/data-runtime/internal/httperror"
)

func TestPathParam(t *testing.T) {
	t.Parallel()

	tests := []struct {
		name   string
		path   string
		prefix string
		suffix string
		want   string
		ok     bool
	}{
		{
			name:   "plain resource id",
			path:   "/v1/altoc/leads/123/convert",
			prefix: "/v1/altoc/leads/",
			suffix: "/convert",
			want:   "123",
			ok:     true,
		},
		{
			name:   "lead conversion preview",
			path:   "/v1/altoc/leads/123/conversion-preview",
			prefix: "/v1/altoc/leads/",
			suffix: "/conversion-preview",
			want:   "123",
			ok:     true,
		},
		{
			name:   "lead conversion candidates",
			path:   "/v1/altoc/leads/123/conversion-candidates",
			prefix: "/v1/altoc/leads/",
			suffix: "/conversion-candidates",
			want:   "123",
			ok:     true,
		},
		{
			name:   "escaped resource id is returned before unescape",
			path:   "/v1/altoc/service/contracts/CT%2F001/activate-delivery",
			prefix: "/v1/altoc/service/contracts/",
			suffix: "/activate-delivery",
			want:   "CT%2F001",
			ok:     true,
		},
		{
			name:   "customer invoice info command",
			path:   "/v1/altoc/customers/123/invoice-info:save",
			prefix: "/v1/altoc/customers/",
			suffix: "/invoice-info:save",
			want:   "123",
			ok:     true,
		},
		{
			name:   "quotation status command",
			path:   "/v1/altoc/quotes/123/status",
			prefix: "/v1/altoc/quotes/",
			suffix: "/status",
			want:   "123",
			ok:     true,
		},
		{
			name:   "contract status command",
			path:   "/v1/altoc/contracts/123/status",
			prefix: "/v1/altoc/contracts/",
			suffix: "/status",
			want:   "123",
			ok:     true,
		},
		{
			name:   "contract approval command",
			path:   "/v1/altoc/contracts/123/approve",
			prefix: "/v1/altoc/contracts/",
			suffix: "/approve",
			want:   "123",
			ok:     true,
		},
		{
			name:   "nested resource path rejected",
			path:   "/v1/altoc/leads/123/extra/convert",
			prefix: "/v1/altoc/leads/",
			suffix: "/convert",
			ok:     false,
		},
		{
			name:   "missing suffix rejected",
			path:   "/v1/altoc/leads/123",
			prefix: "/v1/altoc/leads/",
			suffix: "/convert",
			ok:     false,
		},
		{
			name:   "empty id rejected",
			path:   "/v1/altoc/leads//convert",
			prefix: "/v1/altoc/leads/",
			suffix: "/convert",
			ok:     false,
		},
	}

	for _, tt := range tests {
		tt := tt
		t.Run(tt.name, func(t *testing.T) {
			t.Parallel()

			got, ok := pathParam(tt.path, tt.prefix, tt.suffix)
			if ok != tt.ok {
				t.Fatalf("ok = %v, want %v", ok, tt.ok)
			}
			if got != tt.want {
				t.Fatalf("value = %q, want %q", got, tt.want)
			}
		})
	}
}

func TestUnescapePathParam(t *testing.T) {
	t.Parallel()

	if got := unescapePathParam("CT%2F001"); got != "CT/001" {
		t.Fatalf("unescapePathParam escaped = %q, want %q", got, "CT/001")
	}
	if got := unescapePathParam("%"); got != "%" {
		t.Fatalf("unescapePathParam invalid = %q, want raw value", got)
	}
}

func TestOpportunityContactRolePath(t *testing.T) {
	t.Parallel()

	opportunityID, roleID, ok := opportunityContactRolePath("/v1/altoc/opportunities/123/contact-roles/456")
	if !ok {
		t.Fatal("opportunityContactRolePath did not match valid path")
	}
	if opportunityID != "123" || roleID != "456" {
		t.Fatalf("ids = %q/%q, want 123/456", opportunityID, roleID)
	}

	opportunityID, roleID, ok = opportunityContactRolePath("/v1/altoc/opportunities/OP%2F001/contact-roles/CR%2F002")
	if !ok {
		t.Fatal("opportunityContactRolePath did not match escaped path")
	}
	if opportunityID != "OP/001" || roleID != "CR/002" {
		t.Fatalf("escaped ids = %q/%q, want OP/001/CR/002", opportunityID, roleID)
	}

	if _, _, ok := opportunityContactRolePath("/v1/altoc/opportunities/123/contact-roles"); ok {
		t.Fatal("opportunityContactRolePath matched collection path")
	}
	if _, _, ok := opportunityContactRolePath("/v1/altoc/opportunities/123/contact-roles/456/extra"); ok {
		t.Fatal("opportunityContactRolePath matched extra nested path")
	}
}

func TestCustomerContactPath(t *testing.T) {
	t.Parallel()

	customerID, contactID, ok := customerContactPath("/v1/altoc/customers/123/contacts")
	if !ok {
		t.Fatal("customerContactPath did not match collection path")
	}
	if customerID != "123" || contactID != "" {
		t.Fatalf("collection ids = %q/%q, want 123/empty", customerID, contactID)
	}

	customerID, contactID, ok = customerContactPath("/v1/altoc/customers/123/contacts/456")
	if !ok {
		t.Fatal("customerContactPath did not match item path")
	}
	if customerID != "123" || contactID != "456" {
		t.Fatalf("item ids = %q/%q, want 123/456", customerID, contactID)
	}

	customerID, contactID, ok = customerContactPath("/v1/altoc/customers/CU%2F001/contacts/CT%2F002")
	if !ok {
		t.Fatal("customerContactPath did not match escaped item path")
	}
	if customerID != "CU/001" || contactID != "CT/002" {
		t.Fatalf("escaped ids = %q/%q, want CU/001/CT/002", customerID, contactID)
	}

	if _, _, ok := customerContactPath("/v1/altoc/customers/123/contacts/456/extra"); ok {
		t.Fatal("customerContactPath matched extra nested path")
	}
	if _, _, ok := customerContactPath("/v1/altoc/customers/123/invoice-infos"); ok {
		t.Fatal("customerContactPath matched another subresource")
	}
}

func TestScopedNestedResourcePaths(t *testing.T) {
	t.Parallel()

	tests := []struct {
		name       string
		path       string
		match      func(string) (string, string, bool)
		wantParent string
		wantChild  string
	}{
		{
			name:       "customer invoice info collection",
			path:       "/v1/altoc/customers/123/invoice-infos",
			match:      customerInvoiceInfoPath,
			wantParent: "123",
		},
		{
			name:       "customer invoice info item",
			path:       "/v1/altoc/customers/123/invoice-infos/456",
			match:      customerInvoiceInfoPath,
			wantParent: "123",
			wantChild:  "456",
		},
		{
			name:       "opportunity activity collection",
			path:       "/v1/altoc/opportunities/123/activities",
			match:      opportunityActivityPath,
			wantParent: "123",
		},
		{
			name:       "opportunity activity item",
			path:       "/v1/altoc/opportunities/123/activities/456",
			match:      opportunityActivityPath,
			wantParent: "123",
			wantChild:  "456",
		},
		{
			name:       "quotation item",
			path:       "/v1/altoc/quotes/123/items/456",
			match:      quotationItemPath,
			wantParent: "123",
			wantChild:  "456",
		},
		{
			name:       "contract stage",
			path:       "/v1/altoc/contracts/123/stages/456",
			match:      contractStagePath,
			wantParent: "123",
			wantChild:  "456",
		},
		{
			name:       "escaped nested path",
			path:       "/v1/altoc/quotes/QU%2F001/items/QI%2F002",
			match:      quotationItemPath,
			wantParent: "QU/001",
			wantChild:  "QI/002",
		},
	}

	for _, tt := range tests {
		tt := tt
		t.Run(tt.name, func(t *testing.T) {
			t.Parallel()

			parent, child, ok := tt.match(tt.path)
			if !ok {
				t.Fatalf("%s did not match", tt.name)
			}
			if parent != tt.wantParent || child != tt.wantChild {
				t.Fatalf("ids = %q/%q, want %q/%q", parent, child, tt.wantParent, tt.wantChild)
			}
		})
	}

	if _, _, ok := quotationItemPath("/v1/altoc/quotes/123/items/456/extra"); ok {
		t.Fatal("quotationItemPath matched extra nested path")
	}
	if _, _, ok := contractStagePath("/v1/altoc/contracts/123/invoices"); ok {
		t.Fatal("contractStagePath matched another subresource")
	}
}

func TestGenericRuntimeActionResourceMapsManifestResources(t *testing.T) {
	t.Parallel()

	tests := map[string]string{
		"/v1/altoc/customers/1":             "customer",
		"/v1/altoc/leads/1":                 "lead",
		"/v1/altoc/opportunities/1":         "opportunity",
		"/v1/altoc/tenders/1":               "quotation",
		"/v1/altoc/quotes/1":                "quotation",
		"/v1/altoc/contracts/1":             "contract",
		"/v1/altoc/payments/1":              "receivable",
		"/v1/altoc/maintenance-contracts/1": "maintenance_contract",
		"/v1/altoc/service-tickets/1":       "service_ticket",
		"/v1/altoc/renewal-opportunities/1": "renewal_opportunity",
		"/v1/altoc/teams/1":                 "admin",
	}
	for path, expected := range tests {
		path := path
		expected := expected
		t.Run(expected, func(t *testing.T) {
			t.Parallel()

			actual, ok := genericRuntimeActionResource(path)
			if !ok {
				t.Fatalf("genericRuntimeActionResource(%q) did not match", path)
			}
			if actual != expected {
				t.Fatalf("resource = %q, want %q", actual, expected)
			}
		})
	}
}

func TestGenericRuntimeActionResourceSkipsServiceAndDashboard(t *testing.T) {
	t.Parallel()

	for _, path := range []string{
		"/v1/altoc/service/contracts/CT-1/activate-delivery",
		"/v1/altoc/config/dict",
		"/v1/altoc/config/opportunity-stages",
		"/v1/altoc/dashboard/kpis",
		"/v1/other/customers/1",
		"/v1/altoc/customers/1/contacts",
		"/v1/altoc/leads/1/assign",
		"/v1/altoc/leads/1/disqualify",
		"/v1/altoc/leads/1/convert",
		"/v1/altoc/leads/1/activities",
		"/v1/altoc/opportunities/1/assign",
		"/v1/altoc/opportunities/scan-stale",
		"/v1/altoc/opportunities/1/transition",
		"/v1/altoc/opportunities/1/close-won",
		"/v1/altoc/opportunities/1/close-lost",
		"/v1/altoc/opportunities/1/pause",
		"/v1/altoc/opportunities/1/reopen",
		"/v1/altoc/opportunities/1/activities",
		"/v1/altoc/opportunities/1/contact-roles",
		"/v1/altoc/tenders/1/milestones",
		"/v1/altoc/tenders/1/members",
		"/v1/altoc/quotes/1/approve",
		"/v1/altoc/quotes/1/status",
		"/v1/altoc/contracts/1/approve",
		"/v1/altoc/contracts/1/status",
		"/v1/altoc/contracts/1/activation/execute",
		"/v1/altoc/contracts/1/activation/jobs/2/retry",
		"/v1/altoc/contracts/1/activation/jobs/2/cancel",
		"/v1/altoc/contracts/1/activation/jobs/2/steps/aims_project_link/result",
		"/v1/altoc/contracts/1/delivery-asset-plans",
		"/v1/altoc/contracts/1/service-agreements",
		"/v1/altoc/contracts/1/stages",
		"/v1/altoc/payments/scan-overdue",
		"/v1/altoc/teams/1/members",
	} {
		path := path
		t.Run(path, func(t *testing.T) {
			t.Parallel()

			if resource, ok := genericRuntimeActionResource(path); ok {
				t.Fatalf("expected %q to be skipped, got %q", path, resource)
			}
		})
	}
}

func TestContractActivationPaths(t *testing.T) {
	t.Parallel()

	contractID, jobID, ok := contractActivationJobPath("/v1/altoc/contracts/CT-1/activation/jobs/COJ-1")
	if !ok || contractID != "CT-1" || jobID != "COJ-1" {
		t.Fatalf("contractActivationJobPath = (%q, %q, %v)", contractID, jobID, ok)
	}

	contractID, jobID, ok = contractActivationJobCommandPath("/v1/altoc/contracts/CT-1/activation/jobs/COJ-1/retry", "retry")
	if !ok || contractID != "CT-1" || jobID != "COJ-1" {
		t.Fatalf("contractActivationJobCommandPath retry = (%q, %q, %v)", contractID, jobID, ok)
	}

	var stepKey string
	contractID, jobID, stepKey, ok = contractActivationStepResultPath("/v1/altoc/contracts/CT-1/activation/jobs/COJ-1/steps/aims_project_link/result")
	if !ok || contractID != "CT-1" || jobID != "COJ-1" || stepKey != "aims_project_link" {
		t.Fatalf("contractActivationStepResultPath = (%q, %q, %q, %v)", contractID, jobID, stepKey, ok)
	}
}

func TestOpportunityTransitionActionPath(t *testing.T) {
	t.Parallel()

	tests := []struct {
		path       string
		wantID     string
		wantAction string
		wantOK     bool
	}{
		{path: "/v1/altoc/opportunities/123/close-won", wantID: "123", wantAction: "close_won", wantOK: true},
		{path: "/v1/altoc/opportunities/OP%2F1/close-lost", wantID: "OP/1", wantAction: "close_lost", wantOK: true},
		{path: "/v1/altoc/opportunities/123/pause", wantID: "123", wantAction: "pause", wantOK: true},
		{path: "/v1/altoc/opportunities/123/reopen", wantID: "123", wantAction: "reopen", wantOK: true},
		{path: "/v1/altoc/opportunities/123/transition", wantOK: false},
	}

	for _, tt := range tests {
		tt := tt
		t.Run(tt.path, func(t *testing.T) {
			t.Parallel()

			gotID, gotAction, ok := opportunityTransitionActionPath(tt.path)
			if ok != tt.wantOK {
				t.Fatalf("ok = %v, want %v", ok, tt.wantOK)
			}
			if gotID != tt.wantID || gotAction != tt.wantAction {
				t.Fatalf("result = %q/%q, want %q/%q", gotID, gotAction, tt.wantID, tt.wantAction)
			}
		})
	}
}

func TestBodyWithRuntimeActionOverridesSpoofedAction(t *testing.T) {
	t.Parallel()

	body := bodyWithRuntimeAction(map[string]any{"action": "won", "reason": "x"}, "reopen")
	if body["action"] != "reopen" || body["reason"] != "x" {
		t.Fatalf("unexpected body %#v", body)
	}
}

func TestRequireDashboardViewScopeRejectsBroadOnlyScope(t *testing.T) {
	query := url.Values{}
	query.Set("current_user", "u1")
	query.Set("current_user_scopes", "altoc.read")

	err := requireDashboardViewScope(query)
	if err == nil {
		t.Fatal("expected dashboard view to reject broad-only runtime scope")
	}
	var httpErr httperror.Error
	if !errors.As(err, &httpErr) || httpErr.Status != http.StatusForbidden || httpErr.Code != "permission_scope_required" {
		t.Fatalf("expected permission_scope_required 403, got %#v", err)
	}
}

func TestRequireDashboardViewScopeAllowsDashboardView(t *testing.T) {
	query := url.Values{}
	query.Set("current_user", "u1")
	query.Set("current_user_scopes", "altoc.read altoc:dashboard:view")

	if err := requireDashboardViewScope(query); err != nil {
		t.Fatalf("expected dashboard view scope to pass, got %v", err)
	}
}

func TestRequireRuntimeViewScopeRejectsBroadOnlyScope(t *testing.T) {
	query := url.Values{}
	query.Set("current_user", "u1")
	query.Set("current_user_scopes", "altoc.read")

	err := requireRuntimeViewScope("/v1/altoc/opportunities", query)
	if err == nil {
		t.Fatal("expected resource read to reject broad-only runtime scope")
	}
	var httpErr httperror.Error
	if !errors.As(err, &httpErr) || httpErr.Status != http.StatusForbidden || httpErr.Code != "permission_scope_required" {
		t.Fatalf("expected permission_scope_required 403, got %#v", err)
	}
}

func TestRequireRuntimeViewScopeAllowsEditForView(t *testing.T) {
	query := url.Values{}
	query.Set("current_user", "u1")
	query.Set("current_user_scopes", "altoc.read altoc:opportunity:edit")

	if err := requireRuntimeViewScope("/v1/altoc/opportunities/1", query); err != nil {
		t.Fatalf("expected edit scope to cover resource view, got %v", err)
	}
}

func TestRuntimeViewScopeResourceMapsManifestResources(t *testing.T) {
	t.Parallel()

	tests := map[string]string{
		"/v1/altoc/customers":                                  "customer",
		"/v1/altoc/leads/1/conversion-preview":                 "lead",
		"/v1/altoc/opportunities/1/activities":                 "opportunity",
		"/v1/altoc/tenders/1":                                  "quotation",
		"/v1/altoc/contracts/1/invoices":                       "contract",
		"/v1/altoc/payments":                                   "receivable",
		"/v1/altoc/maintenance-contracts/1":                    "maintenance_contract",
		"/v1/altoc/service-entitlements":                       "service_entitlement",
		"/v1/altoc/service-tickets/1":                          "service_ticket",
		"/v1/altoc/renewal-opportunities":                      "renewal_opportunity",
		"/v1/altoc/service/customers/CU-1/maintenance-summary": "customer",
		"/v1/altoc/teams/users":                                "admin",
		"/v1/altoc/audit-logs":                                 "admin",
	}
	for path, expected := range tests {
		path := path
		expected := expected
		t.Run(path, func(t *testing.T) {
			t.Parallel()

			actual, ok := runtimeViewScopeResource(path)
			if !ok {
				t.Fatalf("runtimeViewScopeResource(%q) did not match", path)
			}
			if actual != expected {
				t.Fatalf("resource = %q, want %q", actual, expected)
			}
		})
	}
}

func TestRuntimeViewScopeResourceSkipsSelfScopedReads(t *testing.T) {
	t.Parallel()

	for _, path := range []string{
		"/v1/altoc/dashboard/kpis",
		"/v1/altoc/config/customer-levels",
		"/v1/altoc/documents",
		"/v1/other/customers",
	} {
		path := path
		t.Run(path, func(t *testing.T) {
			t.Parallel()

			if resource, ok := runtimeViewScopeResource(path); ok {
				t.Fatalf("expected %q to be skipped, got %q", path, resource)
			}
		})
	}
}

func TestIsDashboardRuntimePathOnlyMatchesKnownDashboardReads(t *testing.T) {
	t.Parallel()

	if !isDashboardRuntimePath("/v1/altoc/dashboard/sales-insights") {
		t.Fatal("expected known dashboard route to match")
	}
	if isDashboardRuntimePath("/v1/altoc/dashboard/unknown") {
		t.Fatal("unexpected dashboard route matched")
	}
}

func TestRequireGenericRuntimeActionScopeSkipsDomainCommandPaths(t *testing.T) {
	t.Parallel()

	for _, path := range []string{
		"/v1/altoc/leads/1/assign",
		"/v1/altoc/leads/1/disqualify",
		"/v1/altoc/leads/1/convert",
		"/v1/altoc/leads/1/activities",
		"/v1/altoc/opportunities/1/assign",
		"/v1/altoc/opportunities/scan-stale",
		"/v1/altoc/opportunities/1/transition",
		"/v1/altoc/opportunities/1/close-won",
		"/v1/altoc/opportunities/1/close-lost",
		"/v1/altoc/opportunities/1/pause",
		"/v1/altoc/opportunities/1/reopen",
		"/v1/altoc/opportunities/1/activities",
		"/v1/altoc/payments/scan-overdue",
		"/v1/altoc/config/dict",
		"/v1/altoc/quotes/1/approve",
		"/v1/altoc/quotes/1/status",
		"/v1/altoc/contracts/1/approve",
		"/v1/altoc/contracts/1/status",
		"/v1/altoc/contracts/1/stages",
	} {
		path := path
		t.Run(path, func(t *testing.T) {
			t.Parallel()

			err := requireGenericRuntimeActionScope(http.MethodPost, path, nil, map[string]any{
				"current_user":        "u1",
				"current_user_scopes": []string{"altoc:lead:edit", "altoc:opportunity:edit"},
			})
			if err != nil {
				t.Fatalf("expected generic scope check to skip %q, got %v", path, err)
			}
		})
	}
}

func TestContractStageGenericResourcePathKeepsStageCommandOutOfCRUD(t *testing.T) {
	t.Parallel()

	tests := []struct {
		name       string
		method     string
		path       string
		wantParent string
		wantOK     bool
	}{
		{
			name:       "get collection uses parent scope and generic list",
			method:     http.MethodGet,
			path:       "/v1/altoc/contracts/123/stages",
			wantParent: "123",
			wantOK:     true,
		},
		{
			name:   "post collection is handled by domain command",
			method: http.MethodPost,
			path:   "/v1/altoc/contracts/123/stages",
		},
		{
			name:       "patch item uses parent scope and generic resource",
			method:     http.MethodPatch,
			path:       "/v1/altoc/contracts/123/stages/456",
			wantParent: "123",
			wantOK:     true,
		},
		{
			name:       "delete item uses parent scope and generic resource",
			method:     http.MethodDelete,
			path:       "/v1/altoc/contracts/123/stages/456",
			wantParent: "123",
			wantOK:     true,
		},
	}
	for _, tt := range tests {
		tt := tt
		t.Run(tt.name, func(t *testing.T) {
			t.Parallel()

			parent, ok := contractStageGenericResourcePath(tt.method, tt.path)
			if ok != tt.wantOK {
				t.Fatalf("ok = %v, want %v", ok, tt.wantOK)
			}
			if parent != tt.wantParent {
				t.Fatalf("parent = %q, want %q", parent, tt.wantParent)
			}
		})
	}
}

func TestRequireGenericRuntimeActionScopeRejectsBroadOnlyScope(t *testing.T) {
	err := requireGenericRuntimeActionScope(http.MethodPatch, "/v1/altoc/customers/1", nil, map[string]any{
		"current_user":        "u1",
		"current_user_scopes": []string{"altoc.write"},
	})
	if err == nil {
		t.Fatal("expected broad-only runtime scope to be rejected")
	}
	var httpErr httperror.Error
	if !errors.As(err, &httpErr) || httpErr.Status != http.StatusForbidden || httpErr.Code != "permission_scope_required" {
		t.Fatalf("expected permission_scope_required 403, got %#v", err)
	}
}

func TestRequireGenericRuntimeActionScopeAllowsResourceEdit(t *testing.T) {
	err := requireGenericRuntimeActionScope(http.MethodPatch, "/v1/altoc/customers/1", nil, map[string]any{
		"current_user":        "u1",
		"current_user_scopes": []string{"altoc.write", "altoc:customer:edit"},
	})
	if err != nil {
		t.Fatalf("expected resource edit scope to pass, got %v", err)
	}
}

func TestRequireGenericRuntimeActionScopeAllowsCreateViaEdit(t *testing.T) {
	err := requireGenericRuntimeActionScope(http.MethodPost, "/v1/altoc/quotes", url.Values{}, map[string]any{
		"current_user":        "u1",
		"current_user_scopes": []string{"altoc.write", "altoc:quotation:edit"},
	})
	if err != nil {
		t.Fatalf("expected edit scope to cover generic create, got %v", err)
	}
}

func TestRequireGenericRuntimeActionScopeRejectsEditForServiceTicketClose(t *testing.T) {
	err := requireGenericRuntimeActionScope(http.MethodPatch, "/v1/altoc/service-tickets/ST-1", nil, map[string]any{
		"current_user":        "u1",
		"current_user_scopes": []string{"altoc.write", "altoc:service_ticket:edit"},
		"status":              "closed",
	})
	if err == nil {
		t.Fatal("expected service_ticket edit scope not to close ticket")
	}
	var httpErr httperror.Error
	if !errors.As(err, &httpErr) || httpErr.Status != http.StatusForbidden || httpErr.Code != "permission_scope_required" {
		t.Fatalf("expected permission_scope_required 403, got %#v", err)
	}
}

func TestRequireGenericRuntimeActionScopeAllowsServiceTicketClose(t *testing.T) {
	err := requireGenericRuntimeActionScope(http.MethodPatch, "/v1/altoc/service-tickets/ST-1", nil, map[string]any{
		"current_user":        "u1",
		"current_user_scopes": []string{"altoc.write", "altoc:service_ticket:close"},
		"status":              "closed",
	})
	if err != nil {
		t.Fatalf("expected service_ticket close scope to pass, got %v", err)
	}
}

func TestOpportunityActivityGenericResourcePathKeepsCollectionCommandsOutOfCRUD(t *testing.T) {
	t.Parallel()

	tests := []struct {
		name       string
		method     string
		path       string
		wantParent string
		wantOK     bool
	}{
		{
			name:   "get collection is handled by domain list",
			method: http.MethodGet,
			path:   "/v1/altoc/opportunities/123/activities",
		},
		{
			name:   "post collection is handled by domain create command",
			method: http.MethodPost,
			path:   "/v1/altoc/opportunities/123/activities",
		},
		{
			name:       "patch item uses parent scope and generic resource",
			method:     http.MethodPatch,
			path:       "/v1/altoc/opportunities/123/activities/456",
			wantParent: "123",
			wantOK:     true,
		},
		{
			name:       "delete item uses parent scope and generic resource",
			method:     http.MethodDelete,
			path:       "/v1/altoc/opportunities/123/activities/456",
			wantParent: "123",
			wantOK:     true,
		},
		{
			name:   "extra nested path is rejected",
			method: http.MethodPatch,
			path:   "/v1/altoc/opportunities/123/activities/456/extra",
		},
		{
			name:   "other opportunity subresource is rejected",
			method: http.MethodPatch,
			path:   "/v1/altoc/opportunities/123/contact-roles/456",
		},
	}

	for _, tt := range tests {
		tt := tt
		t.Run(tt.name, func(t *testing.T) {
			t.Parallel()

			parent, ok := opportunityActivityGenericResourcePath(tt.method, tt.path)
			if ok != tt.wantOK {
				t.Fatalf("ok = %v, want %v", ok, tt.wantOK)
			}
			if parent != tt.wantParent {
				t.Fatalf("parent = %q, want %q", parent, tt.wantParent)
			}
		})
	}
}
