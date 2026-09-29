package server

import (
	"context"
	"time"

	"github.com/huizhi-yun/data-runtime/internal/config"
	"github.com/huizhi-yun/data-runtime/internal/db"
	"github.com/huizhi-yun/data-runtime/internal/enterprise"
)

func initializeEnterpriseRegistry(cfg config.Config) (*enterprise.Registry, error) {
	if !cfg.Enterprise.Enabled {
		return nil, nil
	}
	binding, err := cfg.EnterpriseBinding()
	if err != nil {
		return nil, err
	}
	registry := enterprise.NewRegistry(db.EnterpriseFactory(cfg.Enterprise.DB, binding))
	ctx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
	defer cancel()
	if err := registry.Register(ctx, binding); err != nil {
		_ = registry.Close()
		return nil, err
	}
	return registry, nil
}

// EnterpriseRegistry returns the opt-in internal registry, never a public API.
func (s *Server) EnterpriseRegistry() *enterprise.Registry { return s.enterpriseRegistry }

// Close only owns enterprise pools; legacy adapters keep their existing lifecycle.
func (s *Server) Close() error {
	if s.enterpriseRegistry == nil {
		return nil
	}
	return s.enterpriseRegistry.Close()
}
