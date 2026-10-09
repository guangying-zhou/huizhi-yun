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

func TestEnterpriseAltocReadExactServiceTrustMatrix(t *testing.T) {
	for path, spec := range enterpriseAltocReadPaths {
		for _, scenario := range []string{"valid", "missing-cap", "wrong-audience", "wrong-source", "wrong-tenant", "wrong-deployment", "wrong-client", "wrong-subject", "wrong-target", "expired-token", "missing-expiry", "unsigned-actor", "tampered-actor", "tampered-path", "revoked", "dependency"} {
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
func TestEnterpriseAltocReadPermitBindsIdentityObjectQueryAndFreshness(t *testing.T) {
	now := time.Now()
	verified := delegatedVerified()
	revision := int64(3)
	for _, spec := range enterpriseAltocReadPaths {
		valid := func() enterpriseAltocReadInput {
			id := ""
			if spec.Action == "view" {
				id = "7"
			}
			q := altoc.BasicReadQuery{Page: 1, PageSize: 20}
			return enterpriseAltocReadInput{ID: id, Query: q, Authorization: enterpriseAltocReadPermit{ActorUID: verified.ActorUID, Tenant: verified.Route.Binding.Tenant, Deployment: verified.Route.HostDeployment, Resource: spec.Resource, Action: "view", Operation: spec.Action, ObjectID: id, Query: q, Allowed: true, ExpiresAt: now.Add(14 * time.Second).UnixMilli(), Scope: altoc.BasicReadScope{Access: "self"}, BundleVersion: "v1", BundleHash: "hash", PolicyRevision: &revision}}
		}
		if err := validateEnterpriseAltocReadPermit(valid(), spec, verified, now); err != nil {
			t.Fatal(err)
		}
		changes := map[string]func(*enterpriseAltocReadInput){
			"actor": func(i *enterpriseAltocReadInput) { i.Authorization.ActorUID = "forged" }, "tenant": func(i *enterpriseAltocReadInput) { i.Authorization.Tenant = "other" }, "deployment": func(i *enterpriseAltocReadInput) { i.Authorization.Deployment = "other" }, "action": func(i *enterpriseAltocReadInput) { i.Authorization.Action = "edit" }, "resource": func(i *enterpriseAltocReadInput) { i.Authorization.Resource = "admin" }, "operation": func(i *enterpriseAltocReadInput) { i.Authorization.Operation = "delete" }, "object": func(i *enterpriseAltocReadInput) { i.Authorization.ObjectID = "999" }, "query": func(i *enterpriseAltocReadInput) { i.Query.Page = 2 }, "allowed": func(i *enterpriseAltocReadInput) { i.Authorization.Allowed = false }, "expired": func(i *enterpriseAltocReadInput) { i.Authorization.ExpiresAt = now.UnixMilli() }, "future": func(i *enterpriseAltocReadInput) { i.Authorization.ExpiresAt = now.Add(16 * time.Second).UnixMilli() }, "policy": func(i *enterpriseAltocReadInput) { i.Authorization.PolicyRevision = nil }, "bundle": func(i *enterpriseAltocReadInput) { i.Authorization.BundleHash = "" }, "scope": func(i *enterpriseAltocReadInput) {
				i.Authorization.Scope = altoc.BasicReadScope{Access: "self", DepartmentCodes: []string{"other"}}
			},
		}
		for name, change := range changes {
			t.Run(spec.Resource+"/"+spec.Action+"/"+name, func(t *testing.T) {
				i := valid()
				change(&i)
				if err := validateEnterpriseAltocReadPermit(i, spec, verified, now); err == nil {
					t.Fatal("invalid permit accepted")
				}
			})
		}
	}
}
func TestEnterpriseAltocReadOnlySixFixedPaths(t *testing.T) {
	if len(enterpriseAltocReadPaths) != 6 {
		t.Fatal("unexpected route count")
	}
	for path, spec := range enterpriseAltocReadPaths {
		if spec.Action != "list" && spec.Action != "view" {
			t.Fatal(path)
		}
		if spec.Resource != "customer" && spec.Resource != "contract" && spec.Resource != "receivable" {
			t.Fatal(path)
		}
	}
}

func TestEnterpriseAltocReadPermitIndependentSignatureCoversEveryField(t *testing.T) {
	raw, err := os.ReadFile("../../../foundation/test/fixtures/enterprise-altoc-read-permit.json")
	if err != nil {
		t.Fatal(err)
	}
	var fixture struct {
		Method, Target, Token, Canonical, Signature string
		Authorization                               enterpriseAltocReadPermit
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
	if got := enterpriseAltocReadPermitCanonical(request(), fixture.Authorization); got != fixture.Canonical {
		t.Fatalf("cross-language canonical mismatch\n%s\n%s", got, fixture.Canonical)
	}
	if err = verifyEnterpriseAltocReadPermitSignature(request(), fixture.Authorization); err != nil {
		t.Fatal(err)
	}
	changes := map[string]func(*enterpriseAltocReadPermit){
		"actor": func(p *enterpriseAltocReadPermit) { p.ActorUID = "forged" }, "tenant": func(p *enterpriseAltocReadPermit) { p.Tenant = "other" }, "deployment": func(p *enterpriseAltocReadPermit) { p.Deployment = "other" }, "resource": func(p *enterpriseAltocReadPermit) { p.Resource = "customer" }, "action": func(p *enterpriseAltocReadPermit) { p.Action = "edit" }, "operation": func(p *enterpriseAltocReadPermit) { p.Operation = "view" }, "object": func(p *enterpriseAltocReadPermit) { p.ObjectID = "7" }, "allowed": func(p *enterpriseAltocReadPermit) { p.Allowed = false }, "expiry": func(p *enterpriseAltocReadPermit) { p.ExpiresAt++ }, "bundle-version": func(p *enterpriseAltocReadPermit) { p.BundleVersion = "v2" }, "bundle-hash": func(p *enterpriseAltocReadPermit) { p.BundleHash = "forged" }, "policy-revision": func(p *enterpriseAltocReadPermit) { n := int64(99); p.PolicyRevision = &n }, "access": func(p *enterpriseAltocReadPermit) { p.Scope.Access = "all" }, "departments": func(p *enterpriseAltocReadPermit) { p.Scope.DepartmentCodes = []string{"forged"} }, "page": func(p *enterpriseAltocReadPermit) { p.Query.Page++ }, "page-size": func(p *enterpriseAltocReadPermit) { p.Query.PageSize++ }, "search": func(p *enterpriseAltocReadPermit) { p.Query.Search = "forged" }, "status": func(p *enterpriseAltocReadPermit) { p.Query.Status = "forged" }, "customer": func(p *enterpriseAltocReadPermit) { p.Query.CustomerID = "8" }, "contract": func(p *enterpriseAltocReadPermit) { p.Query.ContractID = "9" },
	}
	for name, change := range changes {
		t.Run(name, func(t *testing.T) {
			p := fixture.Authorization
			change(&p)
			if verifyEnterpriseAltocReadPermitSignature(request(), p) == nil {
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
				r.URL.Path = "/v1/enterprise/altoc/contracts:view"
			case "token":
				r.Header.Set("Authorization", "Bearer other")
			}
			if verifyEnterpriseAltocReadPermitSignature(r, fixture.Authorization) == nil {
				t.Fatal("tampered transport accepted")
			}
		})
	}
}

// includeDescendants widens a contract list to a whole customer subtree, so it
// must be part of the signed query; older permits keep their exact bytes.
func TestEnterpriseAltocReadPermitSignsIncludeDescendants(t *testing.T) {
	raw, err := os.ReadFile("testdata/enterprise-altoc-contract-descendants-read-permit.json")
	if err != nil {
		t.Fatal(err)
	}
	var fixture struct {
		Method, Target, Token, Canonical, Signature string
		Authorization                               enterpriseAltocReadPermit
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
	if !fixture.Authorization.Query.IncludeDescendants {
		t.Fatal("fixture does not set includeDescendants")
	}
	if got := enterpriseAltocReadPermitCanonical(request(), fixture.Authorization); got != fixture.Canonical {
		t.Fatalf("cross-language canonical mismatch\n%s\n%s", got, fixture.Canonical)
	}
	if err = verifyEnterpriseAltocReadPermitSignature(request(), fixture.Authorization); err != nil {
		t.Fatal(err)
	}
	p := fixture.Authorization
	p.Query.IncludeDescendants = false
	if verifyEnterpriseAltocReadPermitSignature(request(), p) == nil {
		t.Fatal("permit accepted after dropping includeDescendants")
	}
	// A permit signed for one customer only must not be widened by the request body.
	p = fixture.Authorization
	input := enterpriseAltocReadInput{Query: p.Query, Authorization: p}
	input.Authorization.Query.IncludeDescendants = false
	if input.Authorization.Query == input.Query {
		t.Fatal("query equality ignores includeDescendants")
	}
}

func TestEnterpriseAltocReadPermitW3FiltersSharedVectors(t *testing.T) {
	raw, e := os.ReadFile("testdata/enterprise-altoc-w3-read-permits.json")
	if e != nil {
		t.Fatal(e)
	}
	var fixtures []struct {
		Method, Target, Token, Canonical, Signature string
		Authorization                               enterpriseAltocReadPermit
	}
	if e = json.Unmarshal(raw, &fixtures); e != nil {
		t.Fatal(e)
	}
	for _, f := range fixtures {
		t.Run(f.Canonical, func(t *testing.T) {
			r := httptest.NewRequest(f.Method, f.Target, nil)
			r.Header.Set("Authorization", "Bearer "+f.Token)
			r.Header.Set("X-HZY-Enterprise-Altoc-Permit-Signature", f.Signature)
			if got := enterpriseAltocReadPermitCanonical(r, f.Authorization); got != f.Canonical {
				t.Fatalf("canonical mismatch %s != %s", got, f.Canonical)
			}
			if e := verifyEnterpriseAltocReadPermitSignature(r, f.Authorization); e != nil {
				t.Fatal(e)
			}
			changes := []func(*enterpriseAltocReadPermit){func(p *enterpriseAltocReadPermit) { p.Query.SignedDateFrom = "2027-01-01" }, func(p *enterpriseAltocReadPermit) { p.Query.SignedDateTo = "2028-01-01" }, func(p *enterpriseAltocReadPermit) { p.Query.ParentContractID = "99" }, func(p *enterpriseAltocReadPermit) { p.Query.CustomerIDs = "8,9" }, func(p *enterpriseAltocReadPermit) { p.Query.ParentID = "9" }, func(p *enterpriseAltocReadPermit) { p.Query.RootsOnly = !p.Query.RootsOnly }, func(p *enterpriseAltocReadPermit) { p.Query.OwnerUnassigned = !p.Query.OwnerUnassigned }, func(p *enterpriseAltocReadPermit) { p.Query.Origin = "native" }, func(p *enterpriseAltocReadPermit) { p.Query.Category = "other" }}
			for _, change := range changes {
				p := f.Authorization
				change(&p)
				if verifyEnterpriseAltocReadPermitSignature(r, p) == nil {
					t.Fatal("tampered filter accepted")
				}
				if p.Query == f.Authorization.Query {
					t.Fatal("query equality omits W3 filter")
				}
			}
		})
	}
}

func TestEnterpriseContractCustomerProjectionPermit(t *testing.T) {
	now := time.Now()
	revision := int64(3)
	verified := delegatedVerified()
	valid := func() enterpriseAltocReadInput {
		p := enterpriseAltocReadPermit{ActorUID: verified.ActorUID, Tenant: verified.Route.Binding.Tenant, Deployment: verified.Route.HostDeployment, Resource: "contract", Action: "view", Operation: "list", Allowed: true, Scope: altoc.BasicReadScope{Access: "self"}, Query: altoc.BasicReadQuery{Page: 1, PageSize: 20}, BundleVersion: "v1", BundleHash: "hash", PolicyRevision: &revision, ExpiresAt: now.Add(10 * time.Second).UnixMilli()}
		c := p
		c.Resource = "customer"
		c.Scope = altoc.BasicReadScope{Access: "dept", DepartmentCodes: []string{"D1"}}
		p.CustomerRead = &c
		return enterpriseAltocReadInput{Query: p.Query, Authorization: p}
	}
	if e := validateEnterpriseAltocReadPermit(valid(), enterpriseAltocReadSpec{"contract", "list"}, verified, now); e != nil {
		t.Fatal(e)
	}
	for name, change := range map[string]func(*enterpriseAltocReadPermit){"actor": func(c *enterpriseAltocReadPermit) { c.ActorUID = "other" }, "tenant": func(c *enterpriseAltocReadPermit) { c.Tenant = "other" }, "deployment": func(c *enterpriseAltocReadPermit) { c.Deployment = "other" }, "resource": func(c *enterpriseAltocReadPermit) { c.Resource = "contract" }, "action": func(c *enterpriseAltocReadPermit) { c.Action = "edit" }, "object": func(c *enterpriseAltocReadPermit) { c.ObjectID = "1" }, "bundle": func(c *enterpriseAltocReadPermit) { c.BundleHash = "other" }, "version": func(c *enterpriseAltocReadPermit) { c.BundleVersion = "other" }, "expired": func(c *enterpriseAltocReadPermit) { c.ExpiresAt = now.UnixMilli() }, "query": func(c *enterpriseAltocReadPermit) { c.Query.Search = "other" }, "nested": func(c *enterpriseAltocReadPermit) { copy := *c; c.CustomerRead = &copy }} {
		t.Run(name, func(t *testing.T) {
			i := valid()
			change(i.Authorization.CustomerRead)
			if validateEnterpriseAltocReadPermit(i, enterpriseAltocReadSpec{"contract", "list"}, verified, now) == nil {
				t.Fatal("invalid secondary permit accepted")
			}
		})
	}
}
