package server

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"os"
	"strings"
	"testing"
	"time"

	"github.com/golang-jwt/jwt/v5"
	"github.com/huizhi-yun/data-runtime/internal/apps/altoc"
	"github.com/huizhi-yun/data-runtime/internal/auth"
	"github.com/huizhi-yun/data-runtime/internal/httperror"
)

func TestEnterpriseAltocSalesReadExactServiceTrustMatrix(t *testing.T) {
	for path, spec := range enterpriseAltocSalesReadPaths {
		for _, scenario := range []string{"valid", "missing-cap", "wrong-audience", "wrong-source", "wrong-tenant", "wrong-deployment", "wrong-client", "wrong-subject", "wrong-target", "wrong-token-use", "expired-token", "missing-expiry", "unsigned-actor", "tampered-actor", "tampered-path", "revoked", "dependency"} {
			t.Run(spec.Resource+"/"+spec.Action+"/"+scenario, func(t *testing.T) {
				a, r, route := enterpriseContextFixture(t, func(c jwt.MapClaims) {
					c["scope"] = "altoc:enterprise-host:execute"
					switch scenario {
					case "missing-cap":
						c["scope"] = "altoc:read"
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
					case "wrong-token-use":
						c["token_use"] = "user"
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
				route.LogicalSource, route.LogicalTarget = "altoc", "altoc"
				verifier := func(_ context.Context, identity auth.Context, capability string) (bool, error) {
					if identity.ClientID != "enterprise.runtime" || identity.CredentialID != 7 || capability != "altoc:enterprise-host:execute" {
						t.Fatal("incorrect exact verifier context")
					}
					if scenario == "dependency" {
						return false, errors.New("private secret")
					}
					return scenario != "revoked", nil
				}
				_, err := authenticateEnterpriseAltocRead(r, a, route, verifier)
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
func TestEnterpriseAltocSalesReadPermitBindsIdentityObjectQueryAndFreshness(t *testing.T) {
	now := time.Now()
	verified := delegatedVerified()
	revision := int64(3)
	for _, spec := range enterpriseAltocSalesReadPaths {
		valid := func() enterpriseAltocSalesReadInput {
			id := ""
			if spec.Action == "view" {
				id = "7"
			}
			q := altoc.SalesReadQuery{Page: 1, PageSize: 20}
			return enterpriseAltocSalesReadInput{ID: id, Query: q, Authorization: enterpriseAltocSalesReadPermit{ActorUID: verified.ActorUID, Tenant: verified.Route.Binding.Tenant, Deployment: verified.Route.HostDeployment, Resource: spec.Resource, Action: "view", Operation: spec.Action, ObjectID: id, Query: q, Allowed: true, ExpiresAt: now.Add(14 * time.Second).UnixMilli(), Scope: altoc.BasicReadScope{Access: "self"}, BundleVersion: "v1", BundleHash: "hash", PolicyRevision: &revision}}
		}
		if err := validateEnterpriseAltocSalesReadPermit(valid(), spec, verified, now); err != nil {
			t.Fatal(err)
		}
		changes := map[string]func(*enterpriseAltocSalesReadInput){
			"actor": func(i *enterpriseAltocSalesReadInput) { i.Authorization.ActorUID = "forged" }, "tenant": func(i *enterpriseAltocSalesReadInput) { i.Authorization.Tenant = "other" }, "deployment": func(i *enterpriseAltocSalesReadInput) { i.Authorization.Deployment = "other" }, "action": func(i *enterpriseAltocSalesReadInput) { i.Authorization.Action = "edit" }, "resource": func(i *enterpriseAltocSalesReadInput) { i.Authorization.Resource = "admin" }, "operation": func(i *enterpriseAltocSalesReadInput) { i.Authorization.Operation = "delete" }, "object": func(i *enterpriseAltocSalesReadInput) { i.Authorization.ObjectID = "999" }, "query": func(i *enterpriseAltocSalesReadInput) { i.Query.Page = 2 }, "allowed": func(i *enterpriseAltocSalesReadInput) { i.Authorization.Allowed = false }, "expired": func(i *enterpriseAltocSalesReadInput) { i.Authorization.ExpiresAt = now.UnixMilli() }, "future": func(i *enterpriseAltocSalesReadInput) {
				i.Authorization.ExpiresAt = now.Add(16 * time.Second).UnixMilli()
			}, "policy": func(i *enterpriseAltocSalesReadInput) { i.Authorization.PolicyRevision = nil }, "bundle": func(i *enterpriseAltocSalesReadInput) { i.Authorization.BundleHash = "" }, "scope": func(i *enterpriseAltocSalesReadInput) {
				i.Authorization.Scope = altoc.BasicReadScope{Access: "self", DepartmentCodes: []string{"other"}}
			},
		}
		for name, change := range changes {
			t.Run(spec.Resource+"/"+spec.Action+"/"+name, func(t *testing.T) {
				i := valid()
				change(&i)
				if err := validateEnterpriseAltocSalesReadPermit(i, spec, verified, now); err == nil {
					t.Fatal("invalid permit accepted")
				}
			})
		}
	}
}
func TestEnterpriseAltocSalesReadOnlySixFixedPaths(t *testing.T) {
	if len(enterpriseAltocSalesReadPaths) != 6 {
		t.Fatal("unexpected route count")
	}
	for path, spec := range enterpriseAltocSalesReadPaths {
		if spec.Action != "list" && spec.Action != "view" {
			t.Fatal(path)
		}
		if spec.Resource != "lead" && spec.Resource != "opportunity" && spec.Resource != "quotation" {
			t.Fatal(path)
		}
	}
}

func TestEnterpriseAltocSalesReadPermitIndependentSignatureCoversEveryField(t *testing.T) {
	raw, err := os.ReadFile("testdata/enterprise-altoc-sales-read-permit.json")
	if err != nil {
		t.Fatal(err)
	}
	var fixture struct {
		Method, Target, Token, Canonical, Signature string
		Authorization                               enterpriseAltocSalesReadPermit
	}
	if err = json.Unmarshal(raw, &fixture); err != nil {
		t.Fatal(err)
	}
	request := func() *http.Request {
		r := httptest.NewRequest(fixture.Method, fixture.Target, nil)
		r.Header.Set("Authorization", "Bearer "+fixture.Token)
		r.Header.Set("X-HZY-Enterprise-Altoc-Permit-Signature", fixture.Signature)
		return r
	}
	if got := enterpriseAltocSalesReadPermitCanonical(request(), fixture.Authorization); got != fixture.Canonical {
		t.Fatalf("cross-language canonical mismatch\n%s\n%s", got, fixture.Canonical)
	}
	if err = verifyEnterpriseAltocSalesReadPermitSignature(request(), fixture.Authorization); err != nil {
		t.Fatal(err)
	}
	changes := map[string]func(*enterpriseAltocSalesReadPermit){
		"actor": func(p *enterpriseAltocSalesReadPermit) { p.ActorUID = "forged" }, "tenant": func(p *enterpriseAltocSalesReadPermit) { p.Tenant = "other" }, "deployment": func(p *enterpriseAltocSalesReadPermit) { p.Deployment = "other" }, "resource": func(p *enterpriseAltocSalesReadPermit) { p.Resource = "customer" }, "action": func(p *enterpriseAltocSalesReadPermit) { p.Action = "edit" }, "operation": func(p *enterpriseAltocSalesReadPermit) { p.Operation = "view" }, "object": func(p *enterpriseAltocSalesReadPermit) { p.ObjectID = "7" }, "allowed": func(p *enterpriseAltocSalesReadPermit) { p.Allowed = false }, "expiry": func(p *enterpriseAltocSalesReadPermit) { p.ExpiresAt++ }, "bundle-version": func(p *enterpriseAltocSalesReadPermit) { p.BundleVersion = "v2" }, "bundle-hash": func(p *enterpriseAltocSalesReadPermit) { p.BundleHash = "forged" }, "policy-revision": func(p *enterpriseAltocSalesReadPermit) { n := int64(99); p.PolicyRevision = &n }, "access": func(p *enterpriseAltocSalesReadPermit) { p.Scope.Access = "all" }, "departments": func(p *enterpriseAltocSalesReadPermit) { p.Scope.DepartmentCodes = []string{"forged"} }, "page": func(p *enterpriseAltocSalesReadPermit) { p.Query.Page++ }, "page-size": func(p *enterpriseAltocSalesReadPermit) { p.Query.PageSize++ }, "search": func(p *enterpriseAltocSalesReadPermit) { p.Query.Search = "forged" }, "status": func(p *enterpriseAltocSalesReadPermit) { p.Query.Status = "forged" }, "customer": func(p *enterpriseAltocSalesReadPermit) { p.Query.CustomerID = "8" }, "contract": func(p *enterpriseAltocSalesReadPermit) { p.Query.OpportunityID = "9" },
	}
	for name, change := range changes {
		t.Run(name, func(t *testing.T) {
			p := fixture.Authorization
			change(&p)
			if verifyEnterpriseAltocSalesReadPermitSignature(request(), p) == nil {
				t.Fatal("tampered permit accepted")
			}
		})
	}
	for _, name := range []string{"unsigned", "method", "path", "token"} {
		t.Run(name, func(t *testing.T) {
			r := request()
			switch name {
			case "unsigned":
				r.Header.Del("X-HZY-Enterprise-Altoc-Permit-Signature")
			case "method":
				r.Method = "GET"
			case "path":
				r.URL.Path = "/v1/enterprise/altoc/leads:view"
			case "token":
				r.Header.Set("Authorization", "Bearer other")
			}
			if verifyEnterpriseAltocSalesReadPermitSignature(r, fixture.Authorization) == nil {
				t.Fatal("tampered transport accepted")
			}
		})
	}
}
