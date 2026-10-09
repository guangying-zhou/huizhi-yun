package server

import (
	"context"
	"crypto/hmac"
	"crypto/sha256"
	"encoding/base64"
	"github.com/golang-jwt/jwt/v5"
	"github.com/huizhi-yun/data-runtime/internal/apps/altoc"
	"github.com/huizhi-yun/data-runtime/internal/auth"
	"github.com/huizhi-yun/data-runtime/internal/enterpriseapf"
	"testing"
	"time"
)

func TestAPF13bFixedPermitBeforeBusiness(t *testing.T) {
	for _, tc := range []struct {
		op, path, resource, action string
		input                      enterpriseapf.FinanceInput
	}{
		{"payment-requests-create", "payment-requests:create", "expenses", "edit", enterpriseapf.FinanceInput{Payload: map[string]any{"title": "Marked", "currencyCode": "CNY", "paymentType": "supplier", "requestedAmount": "1.01", "payeeName": "Marked"}}},
		{"payment-requests-confirm", "payment-requests:confirm", "expenses", "confirm", enterpriseapf.FinanceInput{Code: "PAY1", Payload: map[string]any{"expectedVersion": float64(1)}}},
		{"subjects-create", "subjects:create", "settings", "admin", enterpriseapf.FinanceInput{Payload: map[string]any{"code": "6001", "name": "Marked", "subjectType": "cost"}}},
		{"audit-logs-page", "audit-logs:page", "settings", "admin", enterpriseapf.FinanceInput{Page: 1, PageSize: 20}},
	} {
		t.Run(tc.op, func(t *testing.T) {
			a, r, route := enterpriseContextFixture(t, func(c jwt.MapClaims) { c["scope"] = "finance:enterprise-host:execute" }, true)
			route.LogicalTarget = "finance"
			v, e := authenticateEnterpriseRequest(r, a, route, func(context.Context, auth.Context, string) (bool, error) { return true, nil })
			if e != nil {
				t.Fatal(e)
			}
			r.Method = "POST"
			r.URL.Path = "/v1/enterprise/finance/" + tc.path
			r.URL.RawQuery = ""
			rev := int64(1)
			now := time.Now()
			i := apfInput{Finance: &tc.input, Authorization: apfPermit{ActorUID: v.ActorUID, Tenant: v.Service.Tenant, Deployment: route.HostDeployment, Resource: tc.resource, Action: tc.action, Operation: tc.op, ObjectID: tc.input.Code, Allowed: true, ExpiresAt: now.Add(10 * time.Second).UnixMilli(), BundleVersion: "1", BundleHash: "hash", PolicyRevision: &rev, Scope: altoc.BasicReadScope{Access: "all"}}}
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
			for _, change := range []func(){func() { i.Authorization.Action = "view" }, func() { i.Authorization.Resource = "bank_accounts" }, func() { i.Authorization.ActorUID = "forged" }, func() { i.Authorization.Tenant = "other" }, func() { i.Authorization.Deployment = "other" }, func() { i.Authorization.ExpiresAt = now.Add(-time.Second).UnixMilli() }, func() { i.Authorization.Operation = "accounts-create" }} {
				saved := i.Authorization
				change()
				sign()
				if validateAPFPermit(r, i, spec, v, now) == nil {
					t.Fatal("changed permit accepted")
				}
				i.Authorization = saved
			}
			if tc.input.Payload != nil {
				tc.input.Payload["actor"] = "forged"
				sign()
				if validateAPFPermit(r, i, spec, v, now) == nil {
					t.Fatal("actor override")
				}
			}
		})
	}
}
