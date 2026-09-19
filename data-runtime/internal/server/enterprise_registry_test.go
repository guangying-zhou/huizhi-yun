package server

import (
	"errors"
	"github.com/huizhi-yun/data-runtime/internal/config"
	"testing"
)

func TestEnterpriseRegistryDisabledPreservesLegacyStartup(t *testing.T) {
	s, err := New(config.Config{})
	if err != nil {
		t.Fatal(err)
	}
	if s.EnterpriseRegistry() != nil {
		t.Fatal("disabled configuration created enterprise registry")
	}
	if err := s.Close(); err != nil {
		t.Fatal(err)
	}
}
func TestEnterpriseRegistryInvalidEnabledConfigurationFailsStartup(t *testing.T) {
	_, err := New(config.Config{Enterprise: config.EnterpriseConfig{Enabled: true}})
	if !errors.Is(err, config.ErrEnterpriseConfig) {
		t.Fatalf("invalid enabled configuration must fail startup, got %v", err)
	}
}
