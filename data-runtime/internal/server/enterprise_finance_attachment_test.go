package server

import (
	"context"
	"crypto/hmac"
	"crypto/sha256"
	"encoding/base64"
	"strings"
	"testing"
	"time"

	"github.com/golang-jwt/jwt/v5"
	"github.com/huizhi-yun/data-runtime/internal/apps/altoc"
	"github.com/huizhi-yun/data-runtime/internal/auth"
	"github.com/huizhi-yun/data-runtime/internal/enterpriseapf"
)

func TestFinanceAttachmentPermitBindsIssuanceActionAndPurpose(t *testing.T) {
	a, r, route := enterpriseContextFixture(t, func(c jwt.MapClaims) { c["scope"] = "finance:enterprise-host:execute" }, true)
	route.LogicalTarget = "finance"
	v, e := authenticateEnterpriseRequest(r, a, route, func(context.Context, auth.Context, string) (bool, error) { return true, nil })
	if e != nil {
		t.Fatal(e)
	}
	r.Method = "POST"
	r.URL.Path = "/v1/enterprise/finance/invoice-files:attach"
	r.URL.RawQuery = ""
	now := time.Now()
	rev := int64(1)
	i := apfInput{Finance: &enterpriseapf.FinanceInput{Payload: map[string]any{"entityType": "finance_invoice_request", "entityCode": "IR1", "attachmentPurpose": "issuance", "fileKey": "finance/invoices/fixture.pdf", "fileName": "fixture.pdf", "mimeType": "application/pdf", "fileSize": float64(10), "fileSha256": strings.Repeat("a", 64)}}, Authorization: apfPermit{ActorUID: v.ActorUID, Tenant: v.Service.Tenant, Deployment: route.HostDeployment, Resource: "invoices", Action: "issue", Operation: "invoice-files-attach", Allowed: true, ExpiresAt: now.Add(10 * time.Second).UnixMilli(), BundleVersion: "1", BundleHash: "hash", PolicyRevision: &rev, Scope: altoc.BasicReadScope{Access: "self"}}}
	sign := func() {
		mac := hmac.New(sha256.New, []byte(runtimeBearerToken(r)))
		mac.Write([]byte(apfPermitCanonical(r, i)))
		r.Header.Set("X-HZY-Enterprise-APF-Permit-Signature", base64.RawURLEncoding.EncodeToString(mac.Sum(nil)))
	}
	spec := apfRoute{"finance", "invoice-files-attach", "user"}
	sign()
	if e := validateAPFPermit(r, i, spec, v, now); e != nil {
		t.Fatal(e)
	}
	for _, action := range []string{"admin", "edit", "view"} {
		i.Authorization.Action = action
		sign()
		if validateAPFPermit(r, i, spec, v, now) == nil {
			t.Fatal("weak issuance action accepted", action)
		}
	}
	i.Authorization.Action = "issue"
	sign()
	delete(i.Finance.Payload, "attachmentPurpose")
	if validateAPFPermit(r, i, spec, v, now) == nil {
		t.Fatal("unsigned purpose change accepted")
	}
	i.Authorization.Action = "edit"
	sign()
	if e := validateAPFPermit(r, i, spec, v, now); e != nil {
		t.Fatal("ordinary edit changed", e)
	}
	i.Finance.Payload["attachmentPurpose"] = "issuance"
	i.Finance.Payload["entityType"] = "finance_invoice"
	i.Authorization.Action = "issue"
	sign()
	if validateAPFPermit(r, i, spec, v, now) == nil {
		t.Fatal("issue used for formal invoice attachment")
	}
}
