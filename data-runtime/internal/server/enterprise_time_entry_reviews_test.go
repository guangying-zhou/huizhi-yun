package server

import (
	"context"
	"crypto/hmac"
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"errors"
	"github.com/golang-jwt/jwt/v5"
	"github.com/huizhi-yun/data-runtime/internal/auth"
	"github.com/huizhi-yun/data-runtime/internal/httperror"
	"net/http"
	"net/http/httptest"
	"os"
	"strings"
	"testing"
	"time"

	"github.com/huizhi-yun/data-runtime/internal/enterprise"
	"github.com/huizhi-yun/data-runtime/internal/projectscope"
)

func reviewTestPermit() (enterpriseReviewInput, enterpriseRequestContext, time.Time) {
	now := time.UnixMilli(1800000000000)
	revision := int64(3)
	q := map[string]string{"periodKey": "2026-W39", "page": "2", "pageSize": "100"}
	branch := enterpriseReviewBranch{Action: "submit", Scope: projectscope.Projection{Version: 1, ProjectCodes: []string{}, DepartmentCodes: []string{}, DepartmentTreeRoots: []string{}, Masks: []int{65535}}, BundleVersion: "v1", BundleHash: "hash", PolicyRevision: &revision, ExpiresAt: now.Add(10 * time.Second).UnixMilli()}
	p := enterpriseReviewPermit{ActorUID: "U1", Tenant: "tenant", Deployment: "host", Resource: "time-entry-reviews", Action: "view", Operation: "list", ProjectID: "12", Query: q, Branches: []enterpriseReviewBranch{branch}, ExpiresAt: branch.ExpiresAt}
	return enterpriseReviewInput{Tenant: "tenant", Deployment: "host", ProjectID: "12", Query: q, Authorization: p}, enterpriseRequestContext{Route: enterpriseRouteContext{Binding: enterprise.BindingKey{Tenant: "tenant"}, HostDeployment: "host"}, ActorUID: "U1"}, now
}
func TestEnterpriseReviewPermitAuthorizationBindingMatrix(t *testing.T) {
	valid, verified, now := reviewTestPermit()
	if e := validateEnterpriseReviewPermit(valid, verified, now); e != nil {
		t.Fatal(e)
	}
	mutations := map[string]func(*enterpriseReviewInput){
		"wrong-resource":     func(p *enterpriseReviewInput) { p.Authorization.Resource = "time-entries" },
		"wrong-action":       func(p *enterpriseReviewInput) { p.Authorization.Action = "edit" },
		"wrong-actor":        func(p *enterpriseReviewInput) { p.Authorization.ActorUID = "U2" },
		"cross-tenant":       func(p *enterpriseReviewInput) { p.Tenant = "other" },
		"cross-deployment":   func(p *enterpriseReviewInput) { p.Deployment = "other" },
		"cross-project":      func(p *enterpriseReviewInput) { p.ProjectID = "13" },
		"period-query-drift": func(p *enterpriseReviewInput) { p.Query["periodKey"] = "2026-W40" },
		"expired":            func(p *enterpriseReviewInput) { p.Authorization.ExpiresAt = now.UnixMilli() },
		"over-15s":           func(p *enterpriseReviewInput) { p.Authorization.ExpiresAt = now.Add(16 * time.Second).UnixMilli() },
		"edit-is-not-review": func(p *enterpriseReviewInput) { p.Authorization.Branches[0].Action = "edit" },
		"no-branch":          func(p *enterpriseReviewInput) { p.Authorization.Branches = nil },
		"expired-source":     func(p *enterpriseReviewInput) { p.Authorization.Branches[0].ExpiresAt = now.UnixMilli() },
		"no-metadata":        func(p *enterpriseReviewInput) { p.Authorization.Branches[0].PolicyRevision = nil },
		"invalid-projection": func(p *enterpriseReviewInput) { p.Authorization.Branches[0].Scope.Masks = nil },
		"browser-flag":       func(p *enterpriseReviewInput) { p.Query["current_user_can_approve_timesheet"] = "1" },
	}
	for name, mutate := range mutations {
		t.Run(name, func(t *testing.T) {
			raw, _ := json.Marshal(valid)
			var p enterpriseReviewInput
			_ = json.Unmarshal(raw, &p)
			mutate(&p)
			if e := validateEnterpriseReviewPermit(p, verified, now); e == nil {
				t.Fatal("accepted")
			}
		})
	}
}
func TestEnterpriseReviewPeriodPaginationAndBrowserFlags(t *testing.T) {
	for _, q := range []map[string]string{{"periodKey": "2021-W53"}, {"periodKey": "2026-W00"}, {"periodKey": "2026-W39", "page": "01"}, {"periodKey": "2026-W39", "pageSize": "101"}, {"period_key": "2026-W39"}, {"periodKey": "2026-W39", "current_user_can_review_assigned_timesheet": "1"}, {"periodKey": "2026-W39", "status": "submitted"}, {"periodKey": "2026-W39", "uid": "U2"}} {
		if _, e := enterpriseReviewQuery(q); e == nil {
			t.Fatal(q)
		}
	}
	if _, e := enterpriseReviewQuery(map[string]string{"periodKey": "2020-W53", "pageSize": "100"}); e != nil {
		t.Fatal(e)
	}
}
func TestEnterpriseReviewIndependentHMACRejectsBodyAndQueryTampering(t *testing.T) {
	in, _, _ := reviewTestPermit()
	p := in.Authorization
	r := httptest.NewRequest(http.MethodPost, "http://runtime/v1/enterprise/aims/time-entry-reviews:list", nil)
	r.Header.Set("Authorization", "Bearer test-service-token")
	mac := hmac.New(sha256.New, []byte("test-service-token"))
	mac.Write([]byte(enterpriseReviewPermitCanonical(r, p)))
	r.Header.Set("X-HZY-Enterprise-Timesheet-Review-Permit-Signature", base64.RawURLEncoding.EncodeToString(mac.Sum(nil)))
	if e := verifyEnterpriseReviewSignature(r, p); e != nil {
		t.Fatal(e)
	}
	for _, mutate := range []func(*enterpriseReviewPermit){func(p *enterpriseReviewPermit) { p.ProjectID = "13" }, func(p *enterpriseReviewPermit) { p.Query["periodKey"] = "2026-W40" }, func(p *enterpriseReviewPermit) { p.Branches[0].Action = "approve" }, func(p *enterpriseReviewPermit) { p.Branches[0].Scope.Masks[0] = 0 }} {
		raw, _ := json.Marshal(in.Authorization)
		var changed enterpriseReviewPermit
		_ = json.Unmarshal(raw, &changed)
		mutate(&changed)
		if e := verifyEnterpriseReviewSignature(r, changed); e == nil {
			t.Fatal("tamper accepted")
		}
	}
	r.Header.Del("X-HZY-Enterprise-Timesheet-Review-Permit-Signature")
	if e := verifyEnterpriseReviewSignature(r, p); e == nil {
		t.Fatal("actor signature cannot replace body signature")
	}
}

func TestEnterpriseReviewTSGoIndependentSignatureVector(t *testing.T) {
	raw, e := os.ReadFile("../../../foundation/test/fixtures/enterprise-time-entry-review-permit.json")
	if e != nil {
		t.Fatal(e)
	}
	var fixture struct {
		Method        string
		Target        string
		Token         string
		Authorization enterpriseReviewPermit
		Canonical     string
		Signature     string
	}
	if e = json.Unmarshal(raw, &fixture); e != nil {
		t.Fatal(e)
	}
	r := httptest.NewRequest(fixture.Method, "http://runtime"+fixture.Target, nil)
	if got := enterpriseReviewPermitCanonical(r, fixture.Authorization); got != fixture.Canonical {
		t.Fatalf("canonical drift: %s", got)
	}
	r.Header.Set("Authorization", "Bearer "+fixture.Token)
	r.Header.Set("X-HZY-Enterprise-Timesheet-Review-Permit-Signature", fixture.Signature)
	if e = verifyEnterpriseReviewSignature(r, fixture.Authorization); e != nil {
		t.Fatal(e)
	}
}

func TestEnterpriseReviewExactServiceTrustMatrix(t *testing.T) {
	for path, spec := range map[string]struct{ Resource, Action string }{"/v1/enterprise/aims/time-entry-reviews:list": {"time-entry-reviews", "list"}} {
		for _, scenario := range []string{"valid", "missing-cap", "wrong-audience", "wrong-source", "wrong-tenant", "wrong-deployment", "wrong-client", "wrong-subject", "wrong-target", "expired-token", "missing-expiry", "unsigned-actor", "tampered-actor", "tampered-path", "revoked", "dependency"} {
			t.Run(spec.Resource+"/"+spec.Action+"/"+scenario, func(t *testing.T) {
				a, r, route := enterpriseContextFixture(t, func(c jwt.MapClaims) {
					c["scope"] = "aims:enterprise-host:execute"
					switch scenario {
					case "missing-cap":
						c["scope"] = "altoc:enterprise-host:execute"
					case "wrong-audience":
						c["aud"] = "altoc"
					case "wrong-source":
						c["source_app"] = "altoc"
					case "wrong-tenant":
						c["tenant"] = "tenant-b"
					case "wrong-deployment":
						c["deployment"] = "altoc-test"
					case "wrong-subject":
						c["sub"] = "client:altoc.runtime"
					case "wrong-target":
						c["target_app"] = "altoc"
					case "expired-token":
						c["exp"] = time.Now().Add(-time.Minute).Unix()
					case "missing-expiry":
						delete(c, "exp")
					case "wrong-client":
						c["client_id"] = "altoc.runtime"
					}
				}, true)
				r.Method, r.URL.Path, r.URL.RawQuery = http.MethodPost, path, ""
				bearer := strings.TrimPrefix(r.Header.Get("Authorization"), "Bearer ")
				r.Header.Set("X-HZY-Actor-Signature", testActorSignature(t, bearer, r.Method, r.URL.RequestURI(), "person-a", nil, r.Header.Get("X-HZY-Actor-Signed-At")))
				if scenario == "unsigned-actor" {
					r.Header.Del("X-HZY-Actor-Signature")
				}
				if scenario == "tampered-actor" {
					r.Header.Set("X-HZY-Actor-Uid", "forged")
				}
				if scenario == "tampered-path" {
					r.URL.Path = "/v1/enterprise/altoc/forged"
				}
				route.LogicalSource, route.LogicalTarget = "aims", "aims"
				verifier := func(_ context.Context, identity auth.Context, capability string) (bool, error) {
					if identity.ClientID != "enterprise.runtime" || identity.CredentialID != 7 || capability != "aims:enterprise-host:execute" {
						t.Fatal("incorrect exact verifier context")
					}
					if scenario == "dependency" {
						return false, errors.New("private secret")
					}
					return scenario != "revoked", nil
				}
				_, err := authenticateEnterpriseRequest(r, a, route, verifier)
				if scenario == "valid" {
					if err != nil {
						t.Fatal(err)
					}
					return
				}
				var failure httperror.Error
				if !errors.As(err, &failure) {
					t.Fatalf("expected authorization failure, got %v", err)
				}
				expected := 403
				if scenario == "expired-token" || scenario == "wrong-audience" {
					expected = 401
				}
				if scenario == "dependency" {
					expected = 503
				}
				if failure.Status != expected {
					t.Fatalf("%s got %d (%v), want %d", scenario, failure.Status, err, expected)
				}
			})
		}
	}
}

func TestEnterpriseReviewDatabaseFailureHasFixed503WithoutPrivateText(t *testing.T) {
	err := enterpriseReviewReadError(errors.New("private-sql-and-address"))
	var failure httperror.Error
	if !errors.As(err, &failure) || failure.Status != 503 || strings.Contains(err.Error(), "private-sql") {
		t.Fatal(err)
	}
	denied := httperror.New(403, "scope_forbidden", "forbidden")
	if enterpriseReviewReadError(denied) != denied {
		t.Fatal("scope denial masked")
	}
}
