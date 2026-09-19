package server

import (
	"context"
	"crypto/ed25519"
	"crypto/rand"
	"encoding/base64"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/golang-jwt/jwt/v5"
	"github.com/huizhi-yun/data-runtime/internal/auth"
	"github.com/huizhi-yun/data-runtime/internal/config"
	"github.com/huizhi-yun/data-runtime/internal/enterprise"
)

func TestEnterpriseMilestoneRolloverInputIsClosed(t *testing.T) {
	limit, carryover, err := enterpriseMilestoneRolloverInput(map[string]any{})
	if err != nil || limit != 100 || carryover != "auto" {
		t.Fatalf("defaults: %d %q %v", limit, carryover, err)
	}
	limit, carryover, err = enterpriseMilestoneRolloverInput(map[string]any{"limit": json.Number("200"), "carryover": "manual"})
	if err != nil || limit != 200 || carryover != "manual" {
		t.Fatalf("valid input rejected: %d %q %v", limit, carryover, err)
	}
	for name, body := range map[string]map[string]any{
		"zero":           {"limit": float64(0)},
		"too large":      {"limit": float64(201)},
		"fraction":       {"limit": 1.5},
		"string limit":   {"limit": "10"},
		"carryover":      {"carryover": "all"},
		"forged actor":   {"operator_uid": "admin"},
		"forged exempt":  {"review_exempted": false},
		"forged tenant":  {"tenant": "other"},
		"idempotencyKey": {"idempotencyKey": "chosen"},
	} {
		if _, _, err := enterpriseMilestoneRolloverInput(body); err == nil {
			t.Fatalf("%s accepted", name)
		}
	}
}

func TestLegacyMilestoneRolloverRefusedOnlyWhenUnifiedOwnsScheduler(t *testing.T) {
	cases := []struct {
		path      string
		enabled   bool
		scheduler enterprise.PathMode
		refused   bool
	}{
		{legacyMilestoneRolloverPath, true, enterprise.PathUnified, true},
		{legacyMilestoneRolloverPath, true, enterprise.PathLegacy, false},
		{legacyMilestoneRolloverPath, true, enterprise.PathDisabled, false},
		{legacyMilestoneRolloverPath, false, enterprise.PathUnified, false},
		{"/v1/aims/service/projects/P1/milestones/7:rollover", true, enterprise.PathUnified, false},
	}
	for _, c := range cases {
		if got := legacyMilestoneRolloverOwnedByUnified(c.path, c.enabled, c.scheduler); got != c.refused {
			t.Fatalf("%s enabled=%v scheduler=%s: got %v", c.path, c.enabled, c.scheduler, got)
		}
	}
}

// The outbox execution grant and the rollover grant are separate exact
// capabilities: neither may stand in for the other.
func TestEnterpriseMilestoneRolloverRequiresItsOwnExactCapability(t *testing.T) {
	pub, private, err := ed25519.GenerateKey(rand.Reader)
	if err != nil {
		t.Fatal(err)
	}
	keys, _ := json.Marshal(map[string]any{"keys": []any{map[string]any{"kty": "OKP", "crv": "Ed25519", "kid": "rollover-test", "x": base64.RawURLEncoding.EncodeToString(pub)}}})
	cfg := config.Config{Tenant: "tenant-a", Deployment: "runtime-test", DeploymentBindings: map[string]string{"aims": "aims-test"}, Auth: config.AuthConfig{Mode: config.AuthJWT, JWT: config.JWTConfig{Issuer: "https://console.test", Audience: "data-runtime", JWKSJSON: string(keys)}}}
	route := enterpriseSchedulerRoute{App: "aims", Binding: enterprise.BindingKey{Tenant: "tenant-a", Environment: "test", RuntimeDeployment: "runtime-test"}, WorkerDeployment: "aims-test", WorkerClient: "aims.runtime"}
	request := func(scope string) *http.Request {
		now := time.Now()
		claims := jwt.MapClaims{"iss": "https://console.test", "aud": "data-runtime", "sub": "client:aims.runtime", "tenant": "tenant-a", "deployment": "aims-test", "source_app": "aims", "target_app": "data-runtime", "client_id": "aims.runtime", "token_use": "service", "scope": scope, "hzy": map[string]any{"credentialId": int64(7), "appCode": "aims"}, "iat": now.Unix(), "exp": now.Add(time.Minute).Unix()}
		token := jwt.NewWithClaims(jwt.SigningMethodEdDSA, claims)
		token.Header["kid"] = "rollover-test"
		bearer, err := token.SignedString(private)
		if err != nil {
			t.Fatal(err)
		}
		req := httptest.NewRequest(http.MethodPost, enterpriseMilestoneRolloverPath, nil)
		req.Header.Set("Authorization", "Bearer "+bearer)
		return req
	}
	var checked string
	verify := func(_ context.Context, _ auth.Context, capability string) (bool, error) {
		checked = capability
		return true, nil
	}
	if _, _, err := authenticateEnterpriseSchedulerCapability(request(enterpriseMilestoneRolloverCapability), auth.New(cfg), route, verify, enterpriseMilestoneRolloverCapability); err != nil || checked != enterpriseMilestoneRolloverCapability {
		t.Fatalf("rollover worker rejected: %v (checked %q)", err, checked)
	}
	for _, scope := range []string{enterpriseSchedulerCapability, "aims.write", "aims:*"} {
		if _, _, err := authenticateEnterpriseSchedulerCapability(request(scope), auth.New(cfg), route, verify, enterpriseMilestoneRolloverCapability); err == nil {
			t.Fatalf("scope %q accepted for rollover", scope)
		}
	}
	if _, _, err := authenticateEnterpriseSchedulerCapability(request(enterpriseMilestoneRolloverCapability), auth.New(cfg), route, verify, enterpriseSchedulerCapability); err == nil {
		t.Fatal("rollover scope accepted for outbox claims")
	}
}
