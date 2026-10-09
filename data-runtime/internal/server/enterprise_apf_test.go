package server

import (
	"context"
	"crypto/hmac"
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"strings"
	"testing"
	"time"

	"github.com/golang-jwt/jwt/v5"
	"github.com/huizhi-yun/data-runtime/internal/apps/altoc"
	"github.com/huizhi-yun/data-runtime/internal/apps/people"
	"github.com/huizhi-yun/data-runtime/internal/auth"
	"github.com/huizhi-yun/data-runtime/internal/config"
	"github.com/huizhi-yun/data-runtime/internal/enterpriseapf"
)

func TestAPFThreeChannels(t *testing.T) {
	for _, domain := range []string{"altoc", "people", "finance"} {
		for _, scope := range []string{domain + ":enterprise-host:execute", domain + ":scheduler:execute", domain + ":notification-detail:authorize", "aims:enterprise-host:execute"} {
			t.Run(domain+"/"+scope, func(t *testing.T) {
				a, r, route := enterpriseContextFixture(t, func(c jwt.MapClaims) { c["scope"] = scope }, true)
				route.LogicalTarget = domain
				verify := func(context.Context, auth.Context, string) (bool, error) { return true, nil }
				_, err := authenticateEnterpriseRequest(r, a, route, verify)
				if (err == nil) != (scope == domain+":enterprise-host:execute") {
					t.Fatal("user channel", err)
				}
				// System rejects even correctly signed actors; clear all actor headers for the positive.
				cfg := config.Config{Tenant: "tenant-a", DeploymentBindings: map[string]string{"enterprise": "enterprise-test"}}
				if _, e := authenticateEnterpriseSystemRequest(r, cfg, a, verify, domain, ""); e == nil {
					t.Fatal("actor-bearing system request allowed")
				}
				for k := range r.Header {
					if len(k) >= 12 && k[:12] == "X-Hzy-Actor-" {
						r.Header.Del(k)
					}
				}
				_, err = authenticateEnterpriseSystemRequest(r, cfg, a, verify, domain, "")
				if (err == nil) != (scope == domain+":scheduler:execute") {
					t.Fatal("system channel", err)
				}
				_, err = authenticateEnterpriseNotificationDetail(r, cfg, a, verify, domain)
				if (err == nil) != (scope == domain+":notification-detail:authorize") {
					t.Fatal("purpose channel", err)
				}
				if _, _, e := notificationDetailViewer(r, auth.Context{Subject: "client:enterprise.runtime"}); e == nil {
					t.Fatal("unsigned viewer accepted")
				}
			})
		}
	}
}
func TestAPFPermitBindsIntent(t *testing.T) {
	now := time.Now()
	revision := int64(1)
	a, r, route := enterpriseContextFixture(t, func(c jwt.MapClaims) { c["scope"] = "finance:enterprise-host:execute" }, true)
	route.LogicalTarget = "finance"
	v, e := authenticateEnterpriseRequest(r, a, route, func(context.Context, auth.Context, string) (bool, error) { return true, nil })
	if e != nil {
		t.Fatal(e)
	}
	r.Method = http.MethodPost
	i := apfInput{Input: enterpriseapf.Input{Code: "BA-TEST", Name: "isolated"}, Authorization: apfPermit{ActorUID: v.ActorUID, Tenant: v.Service.Tenant, Deployment: route.HostDeployment, Resource: "bank_accounts", Action: "admin", Operation: "save", Allowed: true, ExpiresAt: now.Add(10 * time.Second).UnixMilli(), BundleVersion: "1", BundleHash: "hash", PolicyRevision: &revision, Scope: altoc.BasicReadScope{Access: "all", DepartmentCodes: []string{}}}}
	sign := func() {
		mac := hmac.New(sha256.New, []byte(runtimeBearerToken(r)))
		mac.Write([]byte(apfPermitCanonical(r, i)))
		r.Header.Set("X-HZY-Enterprise-APF-Permit-Signature", base64.RawURLEncoding.EncodeToString(mac.Sum(nil)))
	}
	spec := apfRoute{"finance", "save", "user"}
	sign()
	if e = validateAPFPermit(r, i, spec, v, now); e != nil {
		t.Fatal(e)
	}
	i.Name = "tampered"
	if validateAPFPermit(r, i, spec, v, now) == nil {
		t.Fatal("changed intent allowed")
	}
	sign()
	i.Authorization.Action = "view"
	sign()
	if validateAPFPermit(r, i, spec, v, now) == nil {
		t.Fatal("view used to write")
	}
	i.Authorization.Action = "admin"
	i.Authorization.ExpiresAt = now.Add(-time.Second).UnixMilli()
	sign()
	if validateAPFPermit(r, i, spec, v, now) == nil {
		t.Fatal("expired allowed")
	}
	dueCount, deadCount := 0, 0
	for _, spec := range enterpriseAPFPaths {
		if enterpriseapf.DeadLetterOperation(spec.operation) {
			deadCount++
			if spec.channel != "system" {
				t.Fatal("dead-letter command requires S")
			}
		}
		if _, _, ok := enterpriseapf.DueOperation(spec.operation); ok {
			dueCount++
		}
	}
	if dueCount != 18 || deadCount != 12 || len(enterpriseAPFPaths)-dueCount-deadCount != 284 {
		t.Fatal("operation budget changed")
	}
}

func TestAPFPermitSharedCanonicalFixture(t *testing.T) {
	raw, err := os.ReadFile("../../../foundation/test/fixtures/enterprise-apf-permit.json")
	if err != nil {
		t.Fatal(err)
	}
	var fixture struct {
		Method, Target, Canonical string
		Body                      apfInput
	}
	if err = json.Unmarshal(raw, &fixture); err != nil {
		t.Fatal(err)
	}
	r := httptest.NewRequest(fixture.Method, fixture.Target, nil)
	if actual := apfPermitCanonical(r, fixture.Body); actual != fixture.Canonical {
		t.Fatalf("canonical mismatch: %s", actual)
	}
}

func TestAPFFinanceSharedCanonicalFixture(t *testing.T) {
	raw, e := os.ReadFile("../../../foundation/test/fixtures/enterprise-finance-permit.json")
	if e != nil {
		t.Fatal(e)
	}
	var f struct {
		Method, Target, Canonical string
		Body                      apfInput
	}
	if e = json.Unmarshal(raw, &f); e != nil {
		t.Fatal(e)
	}
	r := httptest.NewRequest(f.Method, f.Target, nil)
	if apfPermitCanonical(r, f.Body) != f.Canonical {
		t.Fatal("Finance canonical mismatch")
	}
	// Valid Finance action gate is independent of domain authentication.
	now := time.Now()
	rev := int64(1)
	a, r, route := enterpriseContextFixture(t, func(c jwt.MapClaims) { c["scope"] = "finance:enterprise-host:execute" }, true)
	route.LogicalTarget = "finance"
	v, e := authenticateEnterpriseRequest(r, a, route, func(context.Context, auth.Context, string) (bool, error) { return true, nil })
	if e != nil {
		t.Fatal(e)
	}
	r.Method = "POST"
	f.Body.Authorization = apfPermit{ActorUID: v.ActorUID, Tenant: v.Service.Tenant, Deployment: route.HostDeployment, Resource: "bank_accounts", Action: "admin", Operation: "accounts-update", ObjectID: f.Body.Finance.Code, Allowed: true, ExpiresAt: now.Add(10 * time.Second).UnixMilli(), BundleVersion: "1", BundleHash: "hash", PolicyRevision: &rev, Scope: altoc.BasicReadScope{Access: "all", DepartmentCodes: []string{}}}
	sign := func() {
		mac := hmac.New(sha256.New, []byte(runtimeBearerToken(r)))
		mac.Write([]byte(apfPermitCanonical(r, f.Body)))
		r.Header.Set("X-HZY-Enterprise-APF-Permit-Signature", base64.RawURLEncoding.EncodeToString(mac.Sum(nil)))
	}
	sign()
	spec := apfRoute{"finance", "accounts-update", "user"}
	if e = validateAPFPermit(r, f.Body, spec, v, now); e != nil {
		t.Fatal(e)
	}
	for _, field := range []string{"view", "edit"} {
		f.Body.Authorization.Action = field
		sign()
		if validateAPFPermit(r, f.Body, spec, v, now) == nil {
			t.Fatal("weak account action accepted")
		}
	}
	f.Body.Authorization.Action = "admin"
	f.Body.Authorization.ObjectID = "other"
	sign()
	if validateAPFPermit(r, f.Body, spec, v, now) == nil {
		t.Fatal("wrong object permit accepted")
	}
}

func TestAPFCustomerSharedCanonicalFixture(t *testing.T) {
	raw, e := os.ReadFile("../../../foundation/test/fixtures/enterprise-customer-permit.json")
	if e != nil {
		t.Fatal(e)
	}
	var f struct {
		Method, Target, Canonical string
		Body                      apfInput
	}
	if e = json.Unmarshal(raw, &f); e != nil {
		t.Fatal(e)
	}
	r := httptest.NewRequest(f.Method, f.Target, nil)
	if apfPermitCanonical(r, f.Body) != f.Canonical {
		t.Fatal("Customer canonical mismatch")
	}
	// Valid Customer action gate is independent of domain authentication.
	now := time.Now()
	rev := int64(1)
	a, r, route := enterpriseContextFixture(t, func(c jwt.MapClaims) { c["scope"] = "altoc:enterprise-host:execute" }, true)
	route.LogicalTarget = "altoc"
	v, e := authenticateEnterpriseRequest(r, a, route, func(context.Context, auth.Context, string) (bool, error) { return true, nil })
	if e != nil {
		t.Fatal(e)
	}
	r.Method = "POST"
	f.Body.Authorization = apfPermit{ActorUID: v.ActorUID, Tenant: v.Service.Tenant, Deployment: route.HostDeployment, Resource: "customer", Action: "edit", Operation: "contacts-update", ObjectID: f.Body.Customer.CustomerID + "|" + f.Body.Customer.ChildCode, Allowed: true, ExpiresAt: now.Add(10 * time.Second).UnixMilli(), BundleVersion: "1", BundleHash: "hash", PolicyRevision: &rev, Scope: altoc.BasicReadScope{Access: "self", DepartmentCodes: []string{}}}
	sign := func() {
		mac := hmac.New(sha256.New, []byte(runtimeBearerToken(r)))
		mac.Write([]byte(apfPermitCanonical(r, f.Body)))
		r.Header.Set("X-HZY-Enterprise-APF-Permit-Signature", base64.RawURLEncoding.EncodeToString(mac.Sum(nil)))
	}
	sign()
	spec := apfRoute{"altoc", "contacts-update", "user"}
	if e = validateAPFPermit(r, f.Body, spec, v, now); e != nil {
		t.Fatal(e)
	}
	for _, field := range []string{"view", "approve"} {
		f.Body.Authorization.Action = field
		sign()
		if validateAPFPermit(r, f.Body, spec, v, now) == nil {
			t.Fatal("weak account action accepted")
		}
	}
	f.Body.Authorization.Action = "edit"
	f.Body.Authorization.ObjectID = "other"
	sign()
	if validateAPFPermit(r, f.Body, spec, v, now) == nil {
		t.Fatal("wrong object permit accepted")
	}
}

func TestAPFQuotationSharedCanonicalFixture(t *testing.T) {
	raw, e := os.ReadFile("../../../foundation/test/fixtures/enterprise-quotation-permit.json")
	if e != nil {
		t.Fatal(e)
	}
	var f struct {
		Method, Target, Canonical string
		Body                      apfInput
	}
	if e = json.Unmarshal(raw, &f); e != nil {
		t.Fatal(e)
	}
	r := httptest.NewRequest(f.Method, f.Target, nil)
	if apfPermitCanonical(r, f.Body) != f.Canonical {
		t.Fatal("Quotation canonical mismatch")
	}
	// Valid Quotation action gate is independent of domain authentication.
	now := time.Now()
	rev := int64(1)
	a, r, route := enterpriseContextFixture(t, func(c jwt.MapClaims) { c["scope"] = "altoc:enterprise-host:execute" }, true)
	route.LogicalTarget = "altoc"
	v, e := authenticateEnterpriseRequest(r, a, route, func(context.Context, auth.Context, string) (bool, error) { return true, nil })
	if e != nil {
		t.Fatal(e)
	}
	r.Method = "POST"
	f.Body.Authorization = apfPermit{ActorUID: v.ActorUID, Tenant: v.Service.Tenant, Deployment: route.HostDeployment, Resource: "quotation", Action: "edit", Operation: "quotation-items-replace", ObjectID: f.Body.Quotation.ID + "||0", Allowed: true, ExpiresAt: now.Add(10 * time.Second).UnixMilli(), BundleVersion: "1", BundleHash: "hash", PolicyRevision: &rev, Scope: altoc.BasicReadScope{Access: "self", DepartmentCodes: []string{}}}
	sign := func() {
		mac := hmac.New(sha256.New, []byte(runtimeBearerToken(r)))
		mac.Write([]byte(apfPermitCanonical(r, f.Body)))
		r.Header.Set("X-HZY-Enterprise-APF-Permit-Signature", base64.RawURLEncoding.EncodeToString(mac.Sum(nil)))
	}
	sign()
	spec := apfRoute{"altoc", "quotation-items-replace", "user"}
	if e = validateAPFPermit(r, f.Body, spec, v, now); e != nil {
		t.Fatal(e)
	}
	for _, field := range []string{"view", "approve"} {
		f.Body.Authorization.Action = field
		sign()
		if validateAPFPermit(r, f.Body, spec, v, now) == nil {
			t.Fatal("weak account action accepted")
		}
	}
	f.Body.Authorization.Action = "edit"
	f.Body.Authorization.ObjectID = "other"
	sign()
	if validateAPFPermit(r, f.Body, spec, v, now) == nil {
		t.Fatal("wrong object permit accepted")
	}
}

func TestAPFContractSharedCanonicalFixture(t *testing.T) {
	raw, e := os.ReadFile("../../../foundation/test/fixtures/enterprise-contract-permit.json")
	if e != nil {
		t.Fatal(e)
	}
	var f struct {
		Method, Target, Canonical string
		Body                      apfInput
	}
	if e = json.Unmarshal(raw, &f); e != nil {
		t.Fatal(e)
	}
	r := httptest.NewRequest(f.Method, f.Target, nil)
	if got := apfPermitCanonical(r, f.Body); got != f.Canonical {
		t.Fatal("contract canonical", got)
	}
	f.Body.Contract.Projects[0].ProjectCode = "OTHER"
	if apfPermitCanonical(r, f.Body) == f.Canonical {
		t.Fatal("tamper not bound")
	}
}

func TestAPFContractPermitBeforeBusiness(t *testing.T) {
	now := time.Now()
	revision := int64(1)
	a, r, route := enterpriseContextFixture(t, func(c jwt.MapClaims) { c["scope"] = "altoc:enterprise-host:execute" }, true)
	route.LogicalTarget = "altoc"
	v, e := authenticateEnterpriseRequest(r, a, route, func(context.Context, auth.Context, string) (bool, error) { return true, nil })
	if e != nil {
		t.Fatal(e)
	}
	r.Method = "POST"
	i := apfInput{Contract: &enterpriseapf.ContractInput{ID: "1", Payload: map[string]any{"expectedVersion": float64(1), "name": "合同"}}, Authorization: apfPermit{ActorUID: v.ActorUID, Tenant: v.Service.Tenant, Deployment: route.HostDeployment, Resource: "contract", Action: "edit", Operation: "contracts-update", ObjectID: "1||", Allowed: true, ExpiresAt: now.Add(10 * time.Second).UnixMilli(), BundleVersion: "1", BundleHash: "hash", PolicyRevision: &revision, Scope: altoc.BasicReadScope{Access: "all"}}}
	sign := func() {
		m := hmac.New(sha256.New, []byte(runtimeBearerToken(r)))
		m.Write([]byte(apfPermitCanonical(r, i)))
		r.Header.Set("X-HZY-Enterprise-APF-Permit-Signature", base64.RawURLEncoding.EncodeToString(m.Sum(nil)))
	}
	spec := apfRoute{"altoc", "contracts-update", "user"}
	sign()
	if e = validateAPFPermit(r, i, spec, v, now); e != nil {
		t.Fatal(e)
	}
	for _, mutate := range []func(*apfInput){func(i *apfInput) { i.Authorization.Action = "view" }, func(i *apfInput) { i.Authorization.Resource = "customer" }, func(i *apfInput) { i.Contract.Payload["status"] = "approved" }, func(i *apfInput) { i.Authorization.ActorUID = "other" }} {
		clone := i
		raw, _ := json.Marshal(i)
		json.Unmarshal(raw, &clone)
		mutate(&clone)
		old := i
		i = clone
		sign()
		if validateAPFPermit(r, i, spec, v, now) == nil {
			t.Fatal("authorization bypass")
		}
		i = old
	}
}

func TestAPFPeopleSharedCanonicalFixture(t *testing.T) {
	raw, e := os.ReadFile("../../../foundation/test/fixtures/enterprise-people-permit.json")
	if e != nil {
		t.Fatal(e)
	}
	var f struct {
		Method, Target, Canonical string
		Body                      apfInput
	}
	if e = json.Unmarshal(raw, &f); e != nil {
		t.Fatal(e)
	}
	r := httptest.NewRequest(f.Method, f.Target, nil)
	if apfPermitCanonical(r, f.Body) != f.Canonical {
		t.Fatal("People canonical mismatch")
	}
}

func TestAPFPeoplePermitBeforeBusiness(t *testing.T) {
	now := time.Now()
	rev := int64(1)
	a, r, route := enterpriseContextFixture(t, func(c jwt.MapClaims) { c["scope"] = "people:enterprise-host:execute" }, true)
	route.LogicalTarget = "people"
	v, e := authenticateEnterpriseRequest(r, a, route, func(context.Context, auth.Context, string) (bool, error) { return true, nil })
	if e != nil {
		t.Fatal(e)
	}
	r.Method = "POST"
	i := apfInput{People: &enterpriseapf.PeopleInput{ID: "Person", Payload: map[string]any{}, CostScope: people.EnterpriseMasterScope{Access: "none"}}, Authorization: apfPermit{ActorUID: v.ActorUID, Tenant: v.Service.Tenant, Deployment: route.HostDeployment, Resource: "employees", Action: "view", Operation: "employees-profile", ObjectID: "Person", Allowed: true, ExpiresAt: now.Add(10 * time.Second).UnixMilli(), BundleVersion: "1", BundleHash: "hash", PolicyRevision: &rev, Scope: altoc.BasicReadScope{Access: "self"}}}
	sign := func() {
		m := hmac.New(sha256.New, []byte(runtimeBearerToken(r)))
		m.Write([]byte(apfPermitCanonical(r, i)))
		r.Header.Set("X-HZY-Enterprise-APF-Permit-Signature", base64.RawURLEncoding.EncodeToString(m.Sum(nil)))
	}
	spec := apfRoute{"people", "employees-profile", "user"}
	sign()
	if e = validateAPFPermit(r, i, spec, v, now); e != nil {
		t.Fatal(e)
	}
	i.People.CostAllowed = true
	i.People.CostScope.Access = "all"
	if validateAPFPermit(r, i, spec, v, now) == nil {
		t.Fatal("unsigned mask accepted")
	}
	i.People.CostAllowed = false
	i.People.CostScope.Access = "none"
	for _, mutate := range []func(*apfInput){func(i *apfInput) { i.Authorization.Action = "edit" }, func(i *apfInput) { i.Authorization.Resource = "standard_costs" }, func(i *apfInput) { i.Authorization.ActorUID = "Other" }, func(i *apfInput) { i.Authorization.ObjectID = "Other" }, func(i *apfInput) { i.Authorization.ExpiresAt = now.Add(-time.Second).UnixMilli() }, func(i *apfInput) { i.People.Payload["mobile"] = "forged" }} {
		raw, _ := json.Marshal(i)
		var clone apfInput
		json.Unmarshal(raw, &clone)
		old := i
		i = clone
		mutate(&i)
		sign()
		if validateAPFPermit(r, i, spec, v, now) == nil {
			t.Fatal("permit bypass")
		}
		i = old
	}
}

func TestAPF11bFinancePermitBindsApprovalAndSource(t *testing.T) {
	now := time.Now()
	revision := int64(1)
	a, r, route := enterpriseContextFixture(t, func(c jwt.MapClaims) { c["scope"] = "finance:enterprise-host:execute" }, true)
	route.LogicalTarget = "finance"
	verified, e := authenticateEnterpriseRequest(r, a, route, func(context.Context, auth.Context, string) (bool, error) { return true, nil })
	if e != nil {
		t.Fatal(e)
	}
	r.Method = "POST"
	for _, op := range []string{"invoice-approval-request", "invoice-approval-bind", "invoice-requests-from-altoc"} {
		body := apfInput{Finance: &enterpriseapf.FinanceInput{Code: "IR1", Payload: map[string]any{"expectedVersion": float64(1)}}}
		if op == "invoice-requests-from-altoc" {
			body.Finance.Code = ""
			body.Finance.Payload = map[string]any{"contractId": "1", "billingScheduleCode": "BS1", "expectedContractVersion": float64(1), "scheduleVersion": float64(1), "requestedAmount": "10.00", "invoiceItem": "Marked", "altocAuthorization": "{\"actorUid\":\"locked\"}"}
		}
		r.URL.Path = "/v1/enterprise/finance/" + op
		body.Authorization = apfPermit{ActorUID: verified.ActorUID, Tenant: verified.Service.Tenant, Deployment: route.HostDeployment, Resource: "invoices", Action: "edit", Operation: op, ObjectID: body.Finance.Code, Allowed: true, ExpiresAt: now.Add(10 * time.Second).UnixMilli(), BundleVersion: "1", BundleHash: "hash", PolicyRevision: &revision, Scope: altoc.BasicReadScope{Access: "self", DepartmentCodes: []string{}}}
		sign := func() {
			mac := hmac.New(sha256.New, []byte(runtimeBearerToken(r)))
			mac.Write([]byte(apfPermitCanonical(r, body)))
			r.Header.Set("X-HZY-Enterprise-APF-Permit-Signature", base64.RawURLEncoding.EncodeToString(mac.Sum(nil)))
		}
		spec := apfRoute{"finance", op, "user"}
		sign()
		if e := validateAPFPermit(r, body, spec, verified, now); e != nil {
			t.Fatal(op, e)
		}
		field := "expectedVersion"
		if op == "invoice-requests-from-altoc" {
			field = "altocAuthorization"
		}
		body.Finance.Payload[field] = "changed"
		if validateAPFPermit(r, body, spec, verified, now) == nil {
			t.Fatal("unsigned intent accepted", op)
		}
		body.Authorization.Action = "view"
		sign()
		if validateAPFPermit(r, body, spec, verified, now) == nil {
			t.Fatal("weak personnel gate", op)
		}
		body.Authorization.Action = "edit"
		body.Authorization.ExpiresAt = now.Add(-time.Second).UnixMilli()
		sign()
		if validateAPFPermit(r, body, spec, verified, now) == nil {
			t.Fatal("expired permit", op)
		}
	}
}

func TestAPFSalesSharedCanonicalAndAction(t *testing.T) {
	raw, e := os.ReadFile("../../../foundation/test/fixtures/enterprise-sales-permit.json")
	if e != nil {
		t.Fatal(e)
	}
	var f struct {
		Method, Target, Canonical string
		Body                      apfInput
	}
	if e = json.Unmarshal(raw, &f); e != nil {
		t.Fatal(e)
	}
	r := httptest.NewRequest(f.Method, f.Target, nil)
	if apfPermitCanonical(r, f.Body) != f.Canonical {
		t.Fatal("Sales canonical mismatch")
	}
	now := time.Now()
	f.Body.Authorization.ExpiresAt = now.Add(10 * time.Second).UnixMilli()
	spec := enterpriseAPFPaths[f.Target]
	v := enterpriseRequestContext{ActorUID: f.Body.Authorization.ActorUID}
	v.Route.Binding.Tenant = f.Body.Authorization.Tenant
	v.Route.HostDeployment = f.Body.Authorization.Deployment
	sign := func() {
		r.Header.Set("Authorization", "Bearer token")
		mac := hmac.New(sha256.New, []byte("token"))
		mac.Write([]byte(apfPermitCanonical(r, f.Body)))
		r.Header.Set("X-HZY-Enterprise-APF-Permit-Signature", base64.RawURLEncoding.EncodeToString(mac.Sum(nil)))
	}
	sign()
	if e = validateAPFPermit(r, f.Body, spec, v, now); e != nil {
		t.Fatal(e)
	}
	f.Body.Authorization.Action = "edit"
	sign()
	if validateAPFPermit(r, f.Body, spec, v, now) == nil {
		t.Fatal("edit upgraded to convert")
	}
	f.Body.Authorization.Action = "convert"
	f.Body.Authorization.ObjectID = "2"
	sign()
	if validateAPFPermit(r, f.Body, spec, v, now) == nil {
		t.Fatal("cross object allowed")
	}
}

func TestAPFSalesSupportPermitMatrix(t *testing.T) {
	now := time.Now()
	revision := int64(1)
	a, r, route := enterpriseContextFixture(t, func(c jwt.MapClaims) { c["scope"] = "altoc:enterprise-host:execute" }, true)
	route.LogicalTarget = "altoc"
	v, e := authenticateEnterpriseRequest(r, a, route, func(context.Context, auth.Context, string) (bool, error) { return true, nil })
	if e != nil {
		t.Fatal(e)
	}
	r.Method = http.MethodPost
	r.URL.Path = "/v1/enterprise/altoc/opportunity-documents:delete"
	i := apfInput{Sales: &enterpriseapf.SalesInput{ID: "1", Payload: map[string]any{"expectedVersion": float64(2), "childId": "3"}}, Authorization: apfPermit{ActorUID: v.ActorUID, Tenant: v.Service.Tenant, Deployment: route.HostDeployment, Resource: "opportunity", Action: "edit", Operation: "opportunity-documents-delete", ObjectID: "1", Allowed: true, ExpiresAt: now.Add(10 * time.Second).UnixMilli(), BundleVersion: "1", BundleHash: "hash", PolicyRevision: &revision, Scope: altoc.BasicReadScope{Access: "self", DepartmentCodes: []string{}}}}
	spec := enterpriseAPFPaths[r.URL.Path]
	sign := func() {
		mac := hmac.New(sha256.New, []byte(runtimeBearerToken(r)))
		mac.Write([]byte(apfPermitCanonical(r, i)))
		r.Header.Set("X-HZY-Enterprise-APF-Permit-Signature", base64.RawURLEncoding.EncodeToString(mac.Sum(nil)))
	}
	sign()
	if e = validateAPFPermit(r, i, spec, v, now); e != nil {
		t.Fatal(e)
	}
	for _, field := range []string{"resource", "action", "object", "expired"} {
		t.Run(field, func(t *testing.T) {
			saved := i.Authorization
			switch field {
			case "resource":
				i.Authorization.Resource = "lead"
			case "action":
				i.Authorization.Action = "view"
			case "object":
				i.Authorization.ObjectID = "2"
			case "expired":
				i.Authorization.ExpiresAt = now.Add(-time.Second).UnixMilli()
			}
			sign()
			if validateAPFPermit(r, i, spec, v, now) == nil {
				t.Fatal("wrong permit reached business dispatch")
			}
			i.Authorization = saved
		})
	}
	i.Sales.Payload["childId"] = "99"
	if validateAPFPermit(r, i, spec, v, now) == nil {
		t.Fatal("changed child bypassed HMAC")
	}
	i.Sales = &enterpriseapf.SalesInput{Payload: map[string]any{"purpose": "lead-convert", "page": float64(1), "pageSize": float64(20)}}
	r.URL.Path = "/v1/enterprise/altoc/opportunity-stages:list"
	spec = enterpriseAPFPaths[r.URL.Path]
	i.Authorization.Resource = "lead"
	i.Authorization.Action = "convert"
	i.Authorization.Operation = spec.operation
	i.Authorization.ObjectID = ""
	sign()
	if e = validateAPFPermit(r, i, spec, v, now); e != nil {
		t.Fatal(e)
	}
	i.Authorization.Action = "view"
	sign()
	if validateAPFPermit(r, i, spec, v, now) == nil {
		t.Fatal("lead view upgraded to conversion config")
	}
}

func TestAPFSalesSupportGoldenCanonical(t *testing.T) {
	raw, e := os.ReadFile("../../../foundation/test/fixtures/enterprise-sales-support-permit.json")
	if e != nil {
		t.Fatal(e)
	}
	var f struct {
		Method, Target, Canonical string
		Body                      apfInput
	}
	if e = json.Unmarshal(raw, &f); e != nil {
		t.Fatal(e)
	}
	r := httptest.NewRequest(f.Method, f.Target, nil)
	if got := apfPermitCanonical(r, f.Body); got != f.Canonical {
		t.Fatalf("canonical mismatch %s", got)
	}
}

func TestAPFTenderGoldenCanonical(t *testing.T) {
	raw, e := os.ReadFile("../../../foundation/test/fixtures/enterprise-tender-permit.json")
	if e != nil {
		t.Fatal(e)
	}
	var f struct {
		Method, Target, Canonical string
		Body                      apfInput
	}
	if e = json.Unmarshal(raw, &f); e != nil {
		t.Fatal(e)
	}
	r := httptest.NewRequest(f.Method, f.Target, nil)
	if got := apfPermitCanonical(r, f.Body); got != f.Canonical {
		t.Fatalf("canonical mismatch %s", got)
	}
}

func TestAPF14CostPermitBindsProjectInputsAndJointScope(t *testing.T) {
	now := time.Now()
	revision := int64(1)
	a, r, route := enterpriseContextFixture(t, func(c jwt.MapClaims) { c["scope"] = "finance:enterprise-host:execute" }, true)
	route.LogicalTarget = "finance"
	v, e := authenticateEnterpriseRequest(r, a, route, func(context.Context, auth.Context, string) (bool, error) { return true, nil })
	if e != nil {
		t.Fatal(e)
	}
	r.Method = http.MethodPost
	r.URL.Path = "/v1/enterprise/finance/project-labor:recalculate"
	i := apfInput{Cost: &enterpriseapf.CostInput{ProjectCode: "P1", PeriodMonth: "2026-10", ExpectedInputHash: string(make([]byte, 0))}}
	// A fixed digest is fixture input only, not a calculation fact.
	i.Cost.ExpectedInputHash = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
	i.Authorization = apfPermit{ActorUID: v.ActorUID, Tenant: v.Service.Tenant, Deployment: route.HostDeployment, Resource: "project_accounting", Action: "admin", Operation: "project-labor-recalculate", ObjectID: "P1|2026-10|", Allowed: true, ExpiresAt: now.Add(10 * time.Second).UnixMilli(), BundleVersion: "1", BundleHash: "hash", PolicyRevision: &revision, Scope: altoc.BasicReadScope{Access: "all", DepartmentCodes: []string{}}, CostScope: &enterpriseapf.CostScope{Access: "projects", ProjectCodes: []string{"P1"}, Salary: altoc.BasicReadScope{Access: "none", DepartmentCodes: []string{}}}}
	sign := func() {
		mac := hmac.New(sha256.New, []byte(runtimeBearerToken(r)))
		mac.Write([]byte(apfPermitCanonical(r, i)))
		r.Header.Set("X-HZY-Enterprise-APF-Permit-Signature", base64.RawURLEncoding.EncodeToString(mac.Sum(nil)))
	}
	spec := enterpriseAPFPaths[r.URL.Path]
	sign()
	if e = validateAPFPermit(r, i, spec, v, now); e != nil {
		t.Fatal(e)
	}
	i.Cost.ExpectedInputHash = "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"
	if validateAPFPermit(r, i, spec, v, now) == nil {
		t.Fatal("unsigned input substitution")
	}
	sign()
	if e = validateAPFPermit(r, i, spec, v, now); e != nil {
		t.Fatal(e)
	}
	i.Authorization.CostScope.ProjectCodes = []string{"P2"}
	sign()
	if validateAPFPermit(r, i, spec, v, now) == nil {
		t.Fatal("foreign project")
	}
	i.Authorization.CostScope.ProjectCodes = []string{"P1"}
	i.Authorization.Action = "view"
	sign()
	if validateAPFPermit(r, i, spec, v, now) == nil {
		t.Fatal("read permission used for recalc")
	}
	i.Authorization.Action = "admin"
	i.Authorization.ExpiresAt = now.Add(-time.Second).UnixMilli()
	sign()
	if validateAPFPermit(r, i, spec, v, now) == nil {
		t.Fatal("expired permit")
	}
	count := 0
	for _, entry := range enterpriseAPFPaths {
		if _, _, ok := enterpriseapf.CostPermission(entry.operation); ok {
			count++
			if entry.domain != "finance" || entry.channel != "user" {
				t.Fatal(entry)
			}
		}
	}
	if count != 13 {
		t.Fatal("exact operation closure", count)
	}
}

func TestAPFFeedbackGoldenCanonical(t *testing.T) {
	raw, e := os.ReadFile("../../../foundation/test/fixtures/enterprise-feedback-permit.json")
	if e != nil {
		t.Fatal(e)
	}
	var f struct {
		Method, Target, Canonical string
		Body                      apfInput
	}
	if e = json.Unmarshal(raw, &f); e != nil {
		t.Fatal(e)
	}
	r := httptest.NewRequest(f.Method, f.Target, nil)
	if got := apfPermitCanonical(r, f.Body); got != f.Canonical {
		t.Fatalf("canonical mismatch %s", got)
	}
}

// Queue commands are part of the signed intent; Go and TypeScript must agree
// byte for byte, including the customer scope carried by the two contact methods.
func TestMigrationQueuePermitCanonicalMatchesHost(t *testing.T) {
	raw, err := os.ReadFile("testdata/enterprise-migration-queue-permit.json")
	if err != nil {
		t.Fatal(err)
	}
	var fixture struct {
		Method string
		Cases  []struct {
			Target, Canonical string
			Body              apfInput
		}
	}
	if err = json.Unmarshal(raw, &fixture); err != nil || len(fixture.Cases) != 5 {
		t.Fatal(err, len(fixture.Cases))
	}
	for _, c := range fixture.Cases {
		r := httptest.NewRequest(fixture.Method, c.Target, nil)
		if actual := apfPermitCanonical(r, c.Body); actual != c.Canonical {
			t.Fatalf("%s canonical mismatch\n%s\n%s", c.Target, actual, c.Canonical)
		}
		// Every command field is covered by the signature.
		changed := c.Body
		if c.Body.MigrationResolve != nil {
			for name, mutate := range map[string]func(*enterpriseapf.MigrationResolveInput){
				"id": func(m *enterpriseapf.MigrationResolveInput) { m.ID = "99" }, "version": func(m *enterpriseapf.MigrationResolveInput) { m.ExpectedVersion++ },
				"method": func(m *enterpriseapf.MigrationResolveInput) { m.Method = "reopen" }, "reason": func(m *enterpriseapf.MigrationResolveInput) { m.Reason += "x" },
				"customer": func(m *enterpriseapf.MigrationResolveInput) { m.CustomerID = "8" }, "contact": func(m *enterpriseapf.MigrationResolveInput) { m.ContactCode = "CN-1" },
				"scope":   func(m *enterpriseapf.MigrationResolveInput) { m.CustomerScope = &altoc.BasicReadScope{Access: "all"} },
				"account": func(m *enterpriseapf.MigrationResolveInput) { m.AccountCode += "X" }, "amount": func(m *enterpriseapf.MigrationResolveInput) { m.Amount += "1" },
			} {
				next := *c.Body.MigrationResolve
				mutate(&next)
				changed.MigrationResolve = &next
				if apfPermitCanonical(r, changed) == c.Canonical {
					t.Fatal("unsigned queue field", name)
				}
			}
		}
		if c.Body.MigrationApply != nil {
			for name, mutate := range map[string]func(*enterpriseapf.MigrationApplyInput){
				"source": func(m *enterpriseapf.MigrationApplyInput) { m.SourceUserID = "employee:8" }, "limit": func(m *enterpriseapf.MigrationApplyInput) { m.Limit = 1 },
				"customer scope": func(m *enterpriseapf.MigrationApplyInput) { m.CustomerScope.Access = "self" }, "contract scope": func(m *enterpriseapf.MigrationApplyInput) { m.ContractScope.DepartmentCodes = []string{"D-9"} },
			} {
				next := *c.Body.MigrationApply
				mutate(&next)
				changed.MigrationApply = &next
				if apfPermitCanonical(r, changed) == c.Canonical {
					t.Fatal("unsigned apply field", name)
				}
			}
		}
		if c.Body.MigrationIdentity != nil {
			for name, mutate := range map[string]func(*enterpriseapf.MigrationIdentityInput){
				"source": func(m *enterpriseapf.MigrationIdentityInput) { m.SourceUserID = "employee:8" }, "status": func(m *enterpriseapf.MigrationIdentityInput) { m.ExpectedStatus = "unmatched" }, "target": func(m *enterpriseapf.MigrationIdentityInput) { m.DirectoryUID = "other" },
			} {
				next := *c.Body.MigrationIdentity
				mutate(&next)
				changed.MigrationIdentity = &next
				if apfPermitCanonical(r, changed) == c.Canonical {
					t.Fatal("unsigned identity field", name)
				}
			}
		}
	}
}

func TestAPFFinanceAccountCountSharedCanonical(t *testing.T) {
	raw, e := os.ReadFile("../../../foundation/test/fixtures/enterprise-finance-account-count-permit.json")
	if e != nil {
		t.Fatal(e)
	}
	var f struct {
		Method, Target, Canonical string
		Body                      apfInput
	}
	if e = json.Unmarshal(raw, &f); e != nil {
		t.Fatal(e)
	}
	r := httptest.NewRequest(f.Method, f.Target, nil)
	if apfPermitCanonical(r, f.Body) != f.Canonical {
		t.Fatal("account count canonical mismatch")
	}
	f.Body.Finance.AccountCountAllowed = false
	if apfPermitCanonical(r, f.Body) == f.Canonical {
		t.Fatal("unsigned count authority")
	}
}

func TestAPFW3FinanceReadSharedVectors(t *testing.T) {
	raw, e := os.ReadFile("../../../foundation/test/fixtures/enterprise-finance-w3-read-permits.json")
	if e != nil {
		t.Fatal(e)
	}
	var fixtures []struct {
		Method, Target, Canonical string
		Body                      apfInput
	}
	if e = json.Unmarshal(raw, &fixtures); e != nil {
		t.Fatal(e)
	}
	for _, f := range fixtures {
		r := httptest.NewRequest(f.Method, f.Target, nil)
		if got := apfPermitCanonical(r, f.Body); got != f.Canonical {
			t.Fatalf("canonical mismatch %s != %s", got, f.Canonical)
		}
		for _, key := range []string{"entity", "type", "complete"} {
			changed := f.Body
			copy := *f.Body.Finance
			changed.Finance = &copy
			switch key {
			case "entity":
				copy.LegalEntityCode = "forged"
			case "type":
				copy.AccountType = "cash"
			case "complete":
				copy.Complete = !copy.Complete
			}
			if apfPermitCanonical(r, changed) == f.Canonical {
				t.Fatal("unsigned read filter", key)
			}
		}
	}
}
func TestB5BFinanceSharedCanonical(t *testing.T) {
	raw, e := os.ReadFile("../../../foundation/test/fixtures/enterprise-finance-b5b-permits.json")
	if e != nil {
		t.Fatal(e)
	}
	var f struct {
		Method string
		Cases  []struct {
			Target, Canonical string
			Body              apfInput
		}
	}
	if e = json.Unmarshal(raw, &f); e != nil {
		t.Fatal(e)
	}
	for _, v := range f.Cases {
		if apfPermitCanonical(httptest.NewRequest(f.Method, v.Target, nil), v.Body) != v.Canonical {
			t.Fatal("B5B canonical mismatch", v.Target)
		}
	}
}

func TestB5BExactPermitsRejectWeakActionsAndChangedIntent(t *testing.T) {
	now := time.Now()
	revision := int64(1)
	a, r, route := enterpriseContextFixture(t, func(c jwt.MapClaims) { c["scope"] = "finance:enterprise-host:execute" }, true)
	route.LogicalTarget = "finance"
	actor, e := authenticateEnterpriseRequest(r, a, route, func(context.Context, auth.Context, string) (bool, error) { return true, nil })
	if e != nil {
		t.Fatal(e)
	}
	count := 0
	for path, spec := range enterpriseAPFPaths {
		if spec.domain != "finance" {
			continue
		}
		resource, action, _ := enterpriseapf.FinanceLedgerPermission(spec.operation)
		write := action != "view"
		if !(resource == "historical_finance" || resource == "receivable_adjustments" || spec.operation == "allocation-candidates" || spec.operation == "allocation-batches-page" || spec.operation == "allocation-batches-detail" || spec.operation == "allocation-batches-reverse" || spec.operation == "reconciliation-allocate-batch") {
			continue
		}
		count++
		request := r.Clone(context.Background())
		request.URL.Path = path
		request.Method = "GET"
		if write {
			request.Method = "POST"
		}
		input := apfInput{Finance: &enterpriseapf.FinanceInput{Code: "SYNTHETIC", Payload: map[string]any{"expectedVersion": float64(1), "receiptVersion": float64(1), "scheduleVersion": float64(1), "reviewHash": strings.Repeat("a", 64), "evidenceSha256": strings.Repeat("b", 64), "contractCode": "CT1", "billingScheduleCode": "BS1", "adjustmentType": "discount", "amount": "1.00", "reason": "Synthetic", "items": []any{map[string]any{"contractCode": "CT1", "billingScheduleCode": "BS1", "scheduleVersion": float64(1), "amount": "1.00"}}}}}
		input.Authorization = apfPermit{ActorUID: actor.ActorUID, Tenant: actor.Service.Tenant, Deployment: route.HostDeployment, Resource: resource, Action: action, Operation: spec.operation, ObjectID: "SYNTHETIC", Allowed: true, ExpiresAt: now.Add(10 * time.Second).UnixMilli(), BundleVersion: "1", BundleHash: "hash", PolicyRevision: &revision, Scope: altoc.BasicReadScope{Access: "all"}}
		sign := func() {
			mac := hmac.New(sha256.New, []byte(runtimeBearerToken(request)))
			mac.Write([]byte(apfPermitCanonical(request, input)))
			request.Header.Set("X-HZY-Enterprise-APF-Permit-Signature", base64.RawURLEncoding.EncodeToString(mac.Sum(nil)))
		}
		sign()
		if e := validateAPFPermit(request, input, spec, actor, now); e != nil {
			t.Fatal(spec.operation, e)
		}
		input.Finance.Payload["expectedVersion"] = float64(2)
		if validateAPFPermit(request, input, spec, actor, now) == nil {
			t.Fatal("changed intent", spec.operation)
		}
		if write {
			input.Authorization.Action = "view"
			sign()
			if validateAPFPermit(request, input, spec, actor, now) == nil {
				t.Fatal("weak action", spec.operation)
			}
			input.Authorization.Action = action
		}
		input.Authorization.ExpiresAt = now.Add(-time.Second).UnixMilli()
		sign()
		if validateAPFPermit(request, input, spec, actor, now) == nil {
			t.Fatal("expired", spec.operation)
		}
	}
	if count != 14 {
		t.Fatal("B5B closed set", count)
	}
}
