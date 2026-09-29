package auth

import (
	"testing"

	"github.com/huizhi-yun/data-runtime/internal/config"
)

func TestTrustedJWTIssuerFollowsAcceptedTrustUpdate(t *testing.T) {
	a := New(config.Config{Auth: config.AuthConfig{JWT: config.JWTConfig{Issuer: "https://configured.test"}}})
	if got := a.TrustedJWTIssuer(); got != "https://configured.test" {
		t.Fatalf("configured issuer=%q", got)
	}
	a.UpdateJWTTrust(config.JWTConfig{Issuer: "https://bootstrap.test"})
	if got := a.TrustedJWTIssuer(); got != "https://bootstrap.test" {
		t.Fatalf("accepted bootstrap issuer=%q", got)
	}
}
