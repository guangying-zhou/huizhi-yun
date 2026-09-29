package server

import (
	"crypto/hmac"
	"crypto/sha256"
	"encoding/base64"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"
)

func signedWeeklySubmitRequest(target string, p enterpriseWeeklySubmitPermit) *http.Request {
	r := httptest.NewRequest(http.MethodPost, target, nil)
	r.Header.Set("Authorization", "Bearer weekly-test-token")
	mac := hmac.New(sha256.New, []byte("weekly-test-token"))
	mac.Write([]byte(enterpriseWeeklySubmitPermitCanonical(r, p)))
	r.Header.Set("X-HZY-Enterprise-Weekly-Report-Submit-Permit-Signature", base64.RawURLEncoding.EncodeToString(mac.Sum(nil)))
	return r
}

func TestEnterpriseWeeklySubmitPermitBindsActorProjectTargetAndExpiry(t *testing.T) {
	now := time.UnixMilli(1800000000000)
	permit := enterpriseWeeklySubmitPermit{
		ActorUID: "actor-a", Tenant: "tenant-a", Deployment: "enterprise-test",
		Resource: "weekly_reports", Action: "submit", ProjectID: "12",
		ExpiresAt: now.Add(10 * time.Second).UnixMilli(),
	}
	target := "/v1/enterprise/aims/project-weekly-report-period:submit"
	r := signedWeeklySubmitRequest(target, permit)
	valid := func(req *http.Request, p *enterpriseWeeklySubmitPermit, project, actor string, at time.Time) bool {
		return validateEnterpriseWeeklySubmitPermit(req, p, "tenant-a", "enterprise-test", project, actor, at) == nil
	}
	if !valid(r, &permit, "12", "actor-a", now) {
		t.Fatal("valid signed permit rejected")
	}
	if valid(r, &permit, "13", "actor-a", now) || valid(r, &permit, "12", "actor-b", now) ||
		valid(r, &permit, "12", "actor-a", now.Add(11*time.Second)) {
		t.Fatal("cross-project, cross-actor, or expired permit accepted")
	}
	other := signedWeeklySubmitRequest(target, permit)
	other.URL.Path = "/v1/enterprise/aims/project-weekly-report-period:save-draft"
	if valid(other, &permit, "12", "actor-a", now) {
		t.Fatal("cross-operation signature accepted")
	}
	changed := permit
	changed.Action = "view"
	if valid(r, &changed, "12", "actor-a", now) {
		t.Fatal("tampered action accepted")
	}
	if valid(r, nil, "12", "actor-a", now) {
		t.Fatal("missing permit accepted")
	}
}

func TestEnterpriseWeeklySubmitCanonicalMatchesFoundationFixture(t *testing.T) {
	p := enterpriseWeeklySubmitPermit{ActorUID: "actor-a", Tenant: "tenant-a", Deployment: "enterprise-test",
		Resource: "weekly_reports", Action: "submit", ProjectID: "12", ExpiresAt: 1800000001000}
	r := httptest.NewRequest(http.MethodPost, "/v1/enterprise/aims/weekly-reports:view", nil)
	want := `["hzy-enterprise-weekly-report-submit-permit.v1","POST","/v1/enterprise/aims/weekly-reports:view","actor-a","tenant-a","enterprise-test","weekly_reports","submit","12",1800000001000]`
	if got := enterpriseWeeklySubmitPermitCanonical(r, p); got != want {
		t.Fatalf("cross-language canonical mismatch: %s", got)
	}
}
