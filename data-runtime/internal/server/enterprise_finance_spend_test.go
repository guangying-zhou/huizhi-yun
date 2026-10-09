package server

import (
	"context"
	"crypto/hmac"
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"github.com/golang-jwt/jwt/v5"
	"github.com/huizhi-yun/data-runtime/internal/apps/altoc"
	"github.com/huizhi-yun/data-runtime/internal/auth"
	"github.com/huizhi-yun/data-runtime/internal/enterpriseapf"
	"os"
	"testing"
	"time"
)

func TestAPF13aFinanceSignedNestedIntent(t *testing.T) {
	raw, e := os.ReadFile("../../../foundation/test/fixtures/enterprise-finance-spend-permit.json")
	if e != nil {
		t.Fatal(e)
	}
	var fixture struct {
		Method, Target, Canonical string
		Body                      apfInput
	}
	if e = json.Unmarshal(raw, &fixture); e != nil {
		t.Fatal(e)
	}
	a, r, route := enterpriseContextFixture(t, func(c jwt.MapClaims) { c["scope"] = "finance:enterprise-host:execute" }, true)

	route.LogicalTarget = "finance"
	v, e := authenticateEnterpriseRequest(r, a, route, func(context.Context, auth.Context, string) (bool, error) { return true, nil })
	if e != nil {
		t.Fatal(e)
	}
	r.Method = fixture.Method
	r.URL.Path = fixture.Target
	r.URL.RawQuery = ""
	if apfPermitCanonical(r, fixture.Body) != fixture.Canonical {
		t.Fatal("TS/Go nested mismatch")
	}
	rev := int64(1)
	now := time.Now()
	i := apfInput{Finance: &enterpriseapf.FinanceInput{Payload: map[string]any{"title": "Marked", "currencyCode": "CNY", "items": []any{map[string]any{"description": "Work", "amount": "1.01"}}}}, Authorization: apfPermit{ActorUID: v.ActorUID, Tenant: v.Service.Tenant, Deployment: route.HostDeployment, Resource: "expenses", Action: "edit", Operation: "claims-create", Allowed: true, ExpiresAt: now.Add(10 * time.Second).UnixMilli(), BundleVersion: "1", BundleHash: "hash", PolicyRevision: &rev, Scope: altoc.BasicReadScope{Access: "self"}}}
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
	i.Finance.Payload["items"].([]any)[0].(map[string]any)["amount"] = "2.01"
	if validateAPFPermit(r, i, spec, v, now) == nil {
		t.Fatal("unsigned item")
	}
	sign()
	if e = validateAPFPermit(r, i, spec, v, now); e != nil {
		t.Fatal(e)
	}
	i.Authorization.Action = "view"
	sign()
	if validateAPFPermit(r, i, spec, v, now) == nil {
		t.Fatal("view to write")
	}
	i.Authorization.Action = "edit"
	i.Finance.Payload["handlerUid"] = "forged"
	sign()
	if validateAPFPermit(r, i, spec, v, now) == nil {
		t.Fatal("trusted maker override")
	}
}
