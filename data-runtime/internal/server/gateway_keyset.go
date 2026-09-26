package server

import (
	"context"
	"net/http"
	"time"
)

func (s *Server) SyncGatewayKeyset(ctx context.Context) error {
	if s.gatewayKeys == nil {
		return nil
	}
	return s.gatewayKeys.Fetch(ctx, s.cfg.Control.PlatformURL, s.cfg.Control.Token, &http.Client{Timeout: 15 * time.Second}, time.Now())
}
