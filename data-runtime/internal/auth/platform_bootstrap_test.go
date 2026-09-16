package auth

import (
	"crypto/ed25519"
	"crypto/rand"
	"crypto/x509"
	"encoding/pem"
	"net/http"
	"testing"
	"time"

	"github.com/golang-jwt/jwt/v5"
	"github.com/huizhi-yun/data-runtime/internal/config"
)

func TestPlatformBootstrapTokenAuthorizesOnlyConsoleServiceTokenIssuance(t *testing.T) {
	publicKey, privateKey, err := ed25519.GenerateKey(rand.Reader)
	if err != nil {
		t.Fatal(err)
	}
	publicDER, err := x509.MarshalPKIXPublicKey(publicKey)
	if err != nil {
		t.Fatal(err)
	}
	authenticator := New(config.Config{
		Tenant: "C000001",
		DeploymentBindings: map[string]string{
			"console": "C000001-console",
		},
		Control: config.ControlConfig{
			PlatformURL:              "https://huizhi.yun",
			RuntimeCode:              "c000001-prod-tenant-runtime",
			PlatformSigningKeyID:     "psk_test",
			PlatformSigningPublicKey: string(pem.EncodeToMemory(&pem.Block{Type: "PUBLIC KEY", Bytes: publicDER})),
		},
		Auth: config.AuthConfig{
			Mode:        config.AuthStaticToken,
			StaticToken: "unrelated-static-token",
		},
	})
	now := time.Now().UTC()
	token := jwt.NewWithClaims(jwt.SigningMethodEdDSA, jwt.MapClaims{
		"iss":         "https://huizhi.yun",
		"aud":         "data-runtime-bootstrap",
		"sub":         "platform:tenant-gateway",
		"jti":         "6bf76463-8d50-4dca-8938-768bf488c45c",
		"iat":         now.Unix(),
		"nbf":         now.Add(-time.Second).Unix(),
		"exp":         now.Add(90 * time.Second).Unix(),
		"token_use":   "platform_runtime_bootstrap",
		"tenant":      "C000001",
		"deployment":  "C000001-console",
		"appCode":     "console",
		"runtimeCode": "c000001-prod-tenant-runtime",
		"scope":       "console:service-token:issue",
	})
	token.Header["kid"] = "psk_test"
	signed, err := token.SignedString(privateKey)
	if err != nil {
		t.Fatal(err)
	}
	request, err := http.NewRequest(http.MethodPost, "https://runtime.example.test/v1/console/auth/service-tokens/issue", nil)
	if err != nil {
		t.Fatal(err)
	}
	request.Header.Set("Authorization", "Bearer "+signed)
	context, err := authenticator.Authenticate(request, Requirement{
		AppCode:       "console",
		Scope:         "console:service-token:issue",
		SourceAppCode: "console",
	})
	if err != nil {
		t.Fatal(err)
	}
	if context.Mode != "platform_bootstrap" || context.Tenant != "C000001" ||
		context.Deployment != "C000001-console" || context.AppCode != "console" {
		t.Fatalf("unexpected bootstrap context: %#v", context)
	}

	if _, err := authenticator.Authenticate(request, Requirement{
		AppCode:       "console",
		Scope:         "console:service-client:consume",
		SourceAppCode: "console",
	}); err == nil {
		t.Fatal("bootstrap token must not authorize any other Runtime capability")
	}
}

func TestDevelopmentPlatformBootstrapIsolation(t *testing.T) {
	publicKey, privateKey, err := ed25519.GenerateKey(rand.Reader)
	if err != nil {
		t.Fatal(err)
	}
	publicDER, err := x509.MarshalPKIXPublicKey(publicKey)
	if err != nil {
		t.Fatal(err)
	}
	authenticator := New(config.Config{
		Tenant:             "HTEST001",
		DeploymentBindings: map[string]string{"console": "HTEST001-console"},
		Control: config.ControlConfig{
			PlatformURL:              "https://platform-dev.wiztek.cn",
			RuntimeCode:              "htest001-test-tenant-runtime",
			PlatformSigningKeyID:     "psk_dev_fixture",
			PlatformSigningPublicKey: string(pem.EncodeToMemory(&pem.Block{Type: "PUBLIC KEY", Bytes: publicDER})),
		},
		Auth: config.AuthConfig{Mode: config.AuthJWT},
	})
	now := time.Now().UTC()
	for _, tc := range []struct {
		name    string
		claim   string
		value   any
		allowed bool
	}{
		{name: "valid development issuer", allowed: true},
		{name: "production issuer rejected even with trusted key", claim: "iss", value: "https://huizhi.yun"},
		{name: "wrong tenant", claim: "tenant", value: "C000001"},
		{name: "wrong deployment", claim: "deployment", value: "C000001-console"},
		{name: "wrong runtime", claim: "runtimeCode", value: "c000001-prod-tenant-runtime"},
		{name: "wrong audience", claim: "aud", value: "console"},
		{name: "wrong app", claim: "appCode", value: "people"},
		{name: "wrong capability", claim: "scope", value: "console:service-client:consume"},
		{name: "expired", claim: "exp", value: now.Add(-time.Second).Unix()},
	} {
		t.Run(tc.name, func(t *testing.T) {
			claims := jwt.MapClaims{
				"iss": "https://platform-dev.wiztek.cn", "aud": "data-runtime-bootstrap",
				"sub": "platform:tenant-gateway", "jti": "dev-fixture-unique-id",
				"iat": now.Unix(), "nbf": now.Add(-time.Second).Unix(), "exp": now.Add(90 * time.Second).Unix(),
				"token_use": "platform_runtime_bootstrap", "tenant": "HTEST001",
				"deployment": "HTEST001-console", "appCode": "console",
				"runtimeCode": "htest001-test-tenant-runtime", "scope": "console:service-token:issue",
			}
			if tc.claim != "" {
				claims[tc.claim] = tc.value
			}
			token := jwt.NewWithClaims(jwt.SigningMethodEdDSA, claims)
			token.Header["kid"] = "psk_dev_fixture"
			signed, err := token.SignedString(privateKey)
			if err != nil {
				t.Fatal(err)
			}
			request, err := http.NewRequest(http.MethodPost, "http://127.0.0.1/v1/console/auth/service-tokens/issue", nil)
			if err != nil {
				t.Fatal(err)
			}
			request.Header.Set("Authorization", "Bearer "+signed)
			_, err = authenticator.Authenticate(request, Requirement{AppCode: "console", Scope: "console:service-token:issue", SourceAppCode: "console"})
			if (err == nil) != tc.allowed {
				t.Fatalf("allowed=%v, error=%v", tc.allowed, err)
			}
		})
	}
}
