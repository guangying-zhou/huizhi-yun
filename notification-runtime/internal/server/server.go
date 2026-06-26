package server

import (
	"context"
	"encoding/json"
	"errors"
	"log"
	"net/http"
	"strings"
	"time"

	"github.com/huizhi-yun/notification-runtime/internal/auth"
	"github.com/huizhi-yun/notification-runtime/internal/config"
	consoleclient "github.com/huizhi-yun/notification-runtime/internal/console"
	"github.com/huizhi-yun/notification-runtime/internal/httperror"
	"github.com/huizhi-yun/notification-runtime/internal/providers"
	"github.com/huizhi-yun/notification-runtime/internal/version"
)

type Server struct {
	cfg      config.Config
	auth     *auth.Authenticator
	wecom    *providers.WeComProvider
	requests chan struct{}
}

type responseEnvelope struct {
	Code    int    `json:"code"`
	Data    any    `json:"data,omitempty"`
	Message string `json:"message,omitempty"`
}

func New(cfg config.Config) *Server {
	console := consoleclient.New(cfg.Console)
	return &Server{
		cfg:      cfg,
		auth:     auth.New(cfg),
		wecom:    providers.NewWeComProvider(console),
		requests: make(chan struct{}, 128),
	}
}

func (s *Server) Handler() http.Handler {
	mux := http.NewServeMux()
	mux.HandleFunc("GET /runtime/health", s.health)
	mux.HandleFunc("GET /runtime/capabilities", s.capabilities)
	mux.HandleFunc("POST /v1/notifications/send", s.send)
	return s.withMiddleware(mux)
}

func (s *Server) health(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, http.StatusOK, responseEnvelope{
		Code: 0,
		Data: map[string]any{
			"status":     "ok",
			"version":    version.Version,
			"tenant":     s.cfg.Tenant,
			"deployment": s.cfg.Deployment,
			"authMode":   s.cfg.Auth.Mode,
			"providers":  []string{"wecom"},
		},
	})
}

func (s *Server) capabilities(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, http.StatusOK, responseEnvelope{
		Code: 0,
		Data: map[string]any{
			"channels":     []string{"wecom"},
			"messageTypes": []string{"textcard"},
			"scopes":       []string{"notification-runtime:send"},
		},
	})
}

func (s *Server) send(w http.ResponseWriter, r *http.Request) {
	actor, err := s.auth.Authenticate(r, auth.Requirement{Scope: "notification-runtime:send"})
	if err != nil {
		writeError(w, err)
		return
	}

	var input providers.SendRequest
	if err := json.NewDecoder(r.Body).Decode(&input); err != nil {
		writeError(w, httperror.New(http.StatusBadRequest, "invalid_json", "Invalid JSON body"))
		return
	}
	channel := strings.ToLower(strings.TrimSpace(input.Channel))
	if channel == "" {
		channel = "wecom"
	}
	if channel != "wecom" {
		writeError(w, httperror.New(http.StatusBadRequest, "unsupported_channel", "Only channel=wecom is supported"))
		return
	}

	ctx := r.Context()
	if s.cfg.HTTP.RequestTimeout > 0 {
		var cancel context.CancelFunc
		ctx, cancel = context.WithTimeout(ctx, s.cfg.HTTP.RequestTimeout)
		defer cancel()
	}
	result, err := s.wecom.Send(ctx, input)
	if err != nil {
		writeError(w, err)
		return
	}

	log.Printf("notification sent provider=%s integration=%s client=%s subject=%s", result.Provider, result.IntegrationCode, actor.ClientID, actor.Subject)
	writeJSON(w, http.StatusOK, responseEnvelope{Code: 0, Data: result})
}

func (s *Server) withMiddleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("X-Content-Type-Options", "nosniff")
		w.Header().Set("Cache-Control", "no-store")
		if r.Method == http.MethodOptions {
			w.WriteHeader(http.StatusNoContent)
			return
		}
		started := time.Now()
		next.ServeHTTP(w, r)
		log.Printf("%s %s %s", r.Method, r.URL.Path, time.Since(started).Round(time.Millisecond))
	})
}

func writeJSON(w http.ResponseWriter, status int, value any) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(value)
}

func writeError(w http.ResponseWriter, err error) {
	var httpError *httperror.Error
	if errors.As(err, &httpError) {
		writeJSON(w, httpError.Status, responseEnvelope{
			Code:    -1,
			Message: httpError.Message,
			Data: map[string]string{
				"error": httpError.Code,
			},
		})
		return
	}
	writeJSON(w, http.StatusInternalServerError, responseEnvelope{
		Code:    -1,
		Message: err.Error(),
		Data: map[string]string{
			"error": "internal_error",
		},
	})
}
