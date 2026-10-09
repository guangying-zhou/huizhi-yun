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

func TestLegacyAssetsDueNotificationsRefusedOnlyWhenUnifiedOwnsScheduler(t *testing.T) {
	for path := range legacyAssetsDueNotificationPaths {
		if !legacyAssetsDueNotificationOwnedByUnified(path, true, enterprise.PathUnified) {
			t.Fatalf("%s not refused under unified scheduler", path)
		}
		for _, mode := range []enterprise.PathMode{enterprise.PathLegacy, enterprise.PathDisabled} {
			if legacyAssetsDueNotificationOwnedByUnified(path, true, mode) {
				t.Fatalf("%s refused under %s", path, mode)
			}
		}
		if legacyAssetsDueNotificationOwnedByUnified(path, false, enterprise.PathUnified) {
			t.Fatalf("%s refused with enterprise disabled", path)
		}
		if legacyAimsDueNotificationPaths[path] {
			t.Fatalf("%s is shared with the Aims owner rule", path)
		}
	}
	for path, action := range enterpriseAssetsDueNotificationActions {
		if enterpriseDueNotificationActions[path] != "" || legacyAssetsDueNotificationPaths[path] {
			t.Fatalf("unified Assets route %s collides", path)
		}
		if err := validateDueNotificationWorkerBody("/v1/assets/service/notifications:"+action, map[string]any{"forged_actor": "admin"}); err == nil {
			t.Fatalf("%s accepted an unsupported field", action)
		}
	}
}

// The Assets worker authenticates only as assets.runtime with its own exact
// capability; the Aims scheduler identity or grants never pass for Assets.
func TestEnterpriseAssetsSchedulerRequiresAssetsWorkerAndExactCapability(t *testing.T) {
	pub, private, err := ed25519.GenerateKey(rand.Reader)
	if err != nil {
		t.Fatal(err)
	}
	keys, _ := json.Marshal(map[string]any{"keys": []any{map[string]any{"kty": "OKP", "crv": "Ed25519", "kid": "assets-due-test", "x": base64.RawURLEncoding.EncodeToString(pub)}}})
	cfg := config.Config{Tenant: "tenant-a", Deployment: "runtime-test", DeploymentBindings: map[string]string{"aims": "aims-test", "assets": "assets-test"}, Auth: config.AuthConfig{Mode: config.AuthJWT, JWT: config.JWTConfig{Issuer: "https://console.test", Audience: "data-runtime", JWKSJSON: string(keys)}}}
	assetsRoute := enterpriseSchedulerRoute{App: "assets", Binding: enterprise.BindingKey{Tenant: "tenant-a", Environment: "test", RuntimeDeployment: "runtime-test"}, WorkerDeployment: "assets-test", WorkerClient: "assets.runtime"}
	request := func(app, scope string) *http.Request {
		now := time.Now()
		claims := jwt.MapClaims{"iss": "https://console.test", "aud": "data-runtime", "sub": "client:" + app + ".runtime", "tenant": "tenant-a", "deployment": app + "-test", "source_app": app, "target_app": "data-runtime", "client_id": app + ".runtime", "token_use": "service", "scope": scope, "hzy": map[string]any{"credentialId": int64(7), "appCode": app}, "iat": now.Unix(), "exp": now.Add(time.Minute).Unix()}
		token := jwt.NewWithClaims(jwt.SigningMethodEdDSA, claims)
		token.Header["kid"] = "assets-due-test"
		bearer, err := token.SignedString(private)
		if err != nil {
			t.Fatal(err)
		}
		req := httptest.NewRequest(http.MethodPost, "/v1/enterprise/assets/notifications:scan-due", nil)
		req.Header.Set("Authorization", "Bearer "+bearer)
		return req
	}
	verify := func(_ context.Context, _ auth.Context, capability string) (bool, error) {
		return capability == enterpriseAssetsDueNotificationCapability, nil
	}
	_, identity, err := authenticateEnterpriseSchedulerCapability(request("assets", enterpriseAssetsDueNotificationCapability), auth.New(cfg), assetsRoute, verify, enterpriseAssetsDueNotificationCapability)
	if err != nil || identity.SourceApp != "assets" || identity.ClientID != "assets.runtime" || identity.Deployment != "assets-test" {
		t.Fatalf("assets worker rejected: %v %+v", err, identity)
	}
	for name, req := range map[string]*http.Request{
		"aims worker with aims due scope":   request("aims", enterpriseDueNotificationCapability),
		"aims worker with assets due scope": request("aims", enterpriseAssetsDueNotificationCapability),
		"assets worker with aims due scope": request("assets", enterpriseDueNotificationCapability),
		"assets worker with legacy scope":   request("assets", "assets.notifications_due.execute"),
	} {
		if _, _, err := authenticateEnterpriseSchedulerCapability(req, auth.New(cfg), assetsRoute, verify, enterpriseAssetsDueNotificationCapability); err == nil {
			t.Fatalf("%s accepted", name)
		}
	}
	// A route without an app, or with a client outside <app>.runtime, is unavailable.
	for _, broken := range []enterpriseSchedulerRoute{
		{Binding: assetsRoute.Binding, WorkerDeployment: "assets-test", WorkerClient: "assets.runtime"},
		{App: "assets", Binding: assetsRoute.Binding, WorkerDeployment: "assets-test", WorkerClient: "aims.runtime"},
	} {
		if _, _, err := authenticateEnterpriseSchedulerCapability(request("assets", enterpriseAssetsDueNotificationCapability), auth.New(cfg), broken, verify, enterpriseAssetsDueNotificationCapability); err == nil {
			t.Fatalf("broken route accepted: %+v", broken)
		}
	}
}
