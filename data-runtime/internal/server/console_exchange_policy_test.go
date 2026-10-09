package server

import (
	"github.com/huizhi-yun/data-runtime/internal/config"
	"testing"
)

func TestConsoleExchangePolicyUsesLocalExactBindingAndTrust(t *testing.T) {
	for _, environment := range []string{"prod", "test"} {
		t.Run(environment, func(t *testing.T) {
			cfg := config.Config{Tenant: "C000001", DeploymentBindings: map[string]string{"console": "registered-console"}}
			cfg.Control.PlatformURL = "https://platform.example"
			cfg.Control.PlatformSigningKeyID = "fixture-key"
			cfg.Control.PlatformSigningPublicKey = "configured-key"
			cfg.Apps.Console.PolicyEnvelope = config.PolicyEnvelopeConfig{Enabled: true, Environment: environment, MaxAgeMS: 300000}
			s := &Server{cfg: cfg}
			store, err := s.consoleExchangePolicyStore(nil, "C000001", "registered-console")
			if err != nil {
				t.Fatal(err)
			}
			if store.Binding.Environment != environment || store.Binding.Tenant != cfg.Tenant || store.Binding.Deployment != "registered-console" || store.KID != cfg.Control.PlatformSigningKeyID || store.PublicKey != cfg.Control.PlatformSigningPublicKey {
				t.Fatal("local binding/trust not preserved")
			}
			for _, binding := range [][2]string{{"OTHER", "registered-console"}, {"C000001", "other-console"}, {"C000001", ""}} {
				if _, err := s.consoleExchangePolicyStore(nil, binding[0], binding[1]); err == nil {
					t.Fatal("incorrect binding accepted")
				}
			}
			s.cfg.Apps.Console.PolicyEnvelope.Enabled = false
			if _, err := s.consoleExchangePolicyStore(nil, "C000001", "registered-console"); err == nil {
				t.Fatal("disabled verifier must fail closed")
			}
		})
	}
}
