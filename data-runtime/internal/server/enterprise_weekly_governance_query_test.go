package server

import (
	"net/http"
	"testing"
	"time"

	"github.com/huizhi-yun/data-runtime/internal/enterprise"
)

// The Host derives the weekly-governance flags from the verified session and
// Console role holders; the Runtime must accept exactly those keys and still
// refuse anything else.
func TestEnterpriseWeeklyGovernanceAcceptsHostDerivedFlags(t *testing.T) {
	cases := []struct {
		spec   enterpriseDelegatedSpec
		action string
		query  map[string]string
	}{
		{enterpriseWeeklyReportingPeriodSpec, "director-workbench", map[string]string{"current_user_is_project_director": "1"}},
		{enterpriseWeeklyReportingPeriodSpec, "generate", map[string]string{"current_user_is_project_director": "1", "current_user_can_configure_weekly_reports": "0", "current_user_project_director_revision": "7"}},
		{enterpriseCompanyWeeklySummarySpec, "publish", map[string]string{"current_user_is_project_director": "1", "current_user_project_director_revision": "7"}},
		{enterpriseWeeklyReportReviewSpec, "review", map[string]string{"current_user_is_project_director": "1", "current_user_project_director_revision": "7"}},
	}
	for _, tc := range cases {
		act, ok := tc.spec.Actions[tc.action]
		if !ok {
			t.Fatalf("missing action %s", tc.action)
		}
		input := enterpriseDelegatedInput{Query: tc.query}
		if act.CodePattern != nil {
			input.Code = "2026-W40"
		}
		if act.NeedsObject {
			input.ObjectID = "12"
		}
		if _, err := enterpriseDelegatedQuery(input, tc.spec, act, "u1"); err != nil {
			t.Fatalf("%s/%s rejected host-derived flags: %v", tc.spec.Resource, tc.action, err)
		}
		input.Query = map[string]string{"current_user_is_admin": "1"}
		if _, err := enterpriseDelegatedQuery(input, tc.spec, act, "u1"); err == nil {
			t.Fatalf("%s/%s accepted an unregistered key", tc.spec.Resource, tc.action)
		}
	}
}

// Weekly reporting settings: two exact routes onto the single company row. The
// configure flag is the only non-actor key; scope keys, identifiers and caller
// actors are refused, the permit must name configure, and update needs a key.
func TestEnterpriseWeeklyReportingSettingsSpec(t *testing.T) {
	for path, method := range map[string]string{
		"/v1/enterprise/aims/weekly-reporting-settings:view":   http.MethodGet,
		"/v1/enterprise/aims/weekly-reporting-settings:update": http.MethodPut,
	} {
		route, ok := enterpriseDelegatedRoutes[path]
		if !ok {
			t.Fatalf("missing route %s", path)
		}
		act := route.Spec.Actions[route.Action]
		if act.Method != method || act.PermitAction != "configure" || act.AllowScope || act.NeedsProject || act.NeedsObject || act.NeedsSub || act.CodePattern != nil {
			t.Fatalf("%s is not an unscoped configure action: %+v", path, act)
		}
		if got := act.Target(enterpriseDelegatedInput{}); got != "/v1/aims/admin/weekly-reporting-settings" {
			t.Fatalf("%s targets %s", path, got)
		}
		if act.AllowPayload != (route.Action == "update") {
			t.Fatalf("%s payload policy is wrong", path)
		}
		if enterpriseDelegatedRequiresIdempotencyKey(route.Spec.Resource, route.Action) != (route.Action == "update") {
			t.Fatalf("%s idempotency policy is wrong", path)
		}

		if _, err := enterpriseDelegatedQuery(enterpriseDelegatedInput{Query: map[string]string{"current_user_can_configure_weekly_reports": "1", "current_user": "attacker"}}, route.Spec, act, "u1"); err == nil {
			t.Fatalf("%s accepted a caller actor key", path)
		}
		query, err := enterpriseDelegatedQuery(enterpriseDelegatedInput{Query: map[string]string{"current_user_can_configure_weekly_reports": "1"}}, route.Spec, act, "u1")
		if err != nil || query.Get("current_user_can_configure_weekly_reports") != "1" || query.Get("current_user") != "u1" || query.Get("operator_uid") != "u1" {
			t.Fatalf("%s rejected the host-derived flag: %v %v", path, query, err)
		}
		for _, rejected := range []enterpriseDelegatedInput{
			{Query: map[string]string{"current_user_dept_codes": "D1"}},
			{Query: map[string]string{"current_user_is_project_director": "1"}},
			{Code: "2026-W40"},
			{ObjectID: "1"},
			{ProjectID: "1"},
		} {
			if _, err := enterpriseDelegatedQuery(rejected, route.Spec, act, "u1"); err == nil {
				t.Fatalf("%s accepted %+v", path, rejected)
			}
		}
		if route.Action == "view" {
			if _, err := enterpriseDelegatedQuery(enterpriseDelegatedInput{Payload: map[string]any{"timezone": "UTC"}}, route.Spec, act, "u1"); err == nil {
				t.Fatalf("%s accepted a payload", path)
			}
		}

		now := time.Now()
		verified := enterpriseRequestContext{ActorUID: "u1", Route: enterpriseRouteContext{Binding: enterprise.BindingKey{Tenant: "T1"}, HostDeployment: "host"}}
		input := enterpriseDelegatedInput{Tenant: "T1", Deployment: "host", Authorization: enterpriseDelegatedPermit{
			ActorUID: "u1", Tenant: "T1", Deployment: "host", Resource: "weekly-reporting-settings", Action: "configure", ExpiresAt: now.Add(10 * time.Second).UnixMilli(),
		}}
		if err := validateEnterpriseDelegatedPermit(input, verified, route.Spec, act, now); err != nil {
			t.Fatalf("%s rejected the configure permit: %v", path, err)
		}
		for _, action := range []string{"view", "edit", "admin"} {
			input.Authorization.Action = action
			if err := validateEnterpriseDelegatedPermit(input, verified, route.Spec, act, now); err == nil {
				t.Fatalf("%s accepted a %s permit", path, action)
			}
		}
		input.Authorization.Action = "configure"
		input.Authorization.Resource = "weekly-reporting-periods"
		if err := validateEnterpriseDelegatedPermit(input, verified, route.Spec, act, now); err == nil {
			t.Fatalf("%s accepted a period permit", path)
		}
	}
	if enterpriseDelegatedRequiresIdempotencyKey("weekly-reporting-periods", "generate") {
		t.Fatal("unrelated weekly action unexpectedly requires the settings key")
	}
}

// The recipient-resolution flag is written by the Host only after it expanded
// the Runtime's frozen selections through the Console directory. It is a
// publish-only key: no other company summary action may carry it.
func TestEnterpriseCompanyWeeklySummaryRecipientFlagIsPublishOnly(t *testing.T) {
	query := map[string]string{"current_user_is_project_director": "1", "current_user_project_director_revision": "7", "company_summary_recipient_resolution_verified": "1"}
	for name, act := range enterpriseCompanyWeeklySummarySpec.Actions {
		values, err := enterpriseDelegatedQuery(enterpriseDelegatedInput{Code: "2026-W40", Query: query}, enterpriseCompanyWeeklySummarySpec, act, "u1")
		if name == "publish" {
			if err != nil || values.Get("company_summary_recipient_resolution_verified") != "1" || values.Get("current_user") != "u1" {
				t.Fatalf("publish rejected the host-derived recipient flag: %v %v", values, err)
			}
			continue
		}
		if err == nil {
			t.Fatalf("%s accepted the publish-only recipient flag", name)
		}
	}
}
