package server

import (
	"crypto/hmac"
	"crypto/sha256"
	"encoding/base64"
	"github.com/huizhi-yun/data-runtime/internal/enterprise"
	"net/http/httptest"
	"testing"
	"time"
)

func TestEnterpriseDocumentAdminPermitBindingAndSignature(t *testing.T) {
	now := time.Now()
	p := enterpriseProjectDocumentPermit{enterpriseProjectProductPermit: enterpriseProjectProductPermit{ActorUID: "U1", Tenant: "T", Deployment: "E", Resource: "projects", Action: "view", ProjectID: "A", Allowed: true, ExpiresAt: now.Add(time.Second).UnixMilli()}, ProjectAdmin: true}
	r := httptest.NewRequest("POST", "/v1/enterprise/aims/project-documents:accessible", nil)
	r.Header.Set("Authorization", "Bearer fixture-only")
	mac := hmac.New(sha256.New, []byte("fixture-only"))
	mac.Write([]byte(enterpriseProjectDocumentPermitCanonical(r, p)))
	r.Header.Set("X-HZY-Enterprise-Document-Permit-Signature", base64.RawURLEncoding.EncodeToString(mac.Sum(nil)))
	if err := verifyEnterpriseProjectDocumentPermitSignature(r, p); err != nil {
		t.Fatal(err)
	}
	forged := p
	forged.ProjectAdmin = false
	if verifyEnterpriseProjectDocumentPermitSignature(r, forged) == nil {
		t.Fatal("tampered admin accepted")
	}
	unsigned := r.Clone(r.Context())
	unsigned.Header.Del("X-HZY-Enterprise-Document-Permit-Signature")
	if verifyEnterpriseProjectDocumentPermitSignature(unsigned, p) == nil {
		t.Fatal("unsigned permit accepted")
	}
	v := enterpriseRequestContext{ActorUID: "U1", Route: enterpriseRouteContext{Binding: enterprise.BindingKey{Tenant: "T"}, HostDeployment: "E"}}
	in := enterpriseProjectProductInput{Tenant: "T", Deployment: "E", ProjectID: "A"}
	if err := validateEnterpriseProjectProductPermit(in, p.enterpriseProjectProductPermit, "view", v, now); err != nil {
		t.Fatal(err)
	}
	in.ProjectID = "B"
	if validateEnterpriseProjectProductPermit(in, p.enterpriseProjectProductPermit, "view", v, now) == nil {
		t.Fatal("cross-project accepted")
	}
	in.ProjectID = "A"
	expired := p
	expired.ExpiresAt = now.UnixMilli()
	if validateEnterpriseProjectProductPermit(in, expired.enterpriseProjectProductPermit, "view", v, now) == nil {
		t.Fatal("expired accepted")
	}
}
