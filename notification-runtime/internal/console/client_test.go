package console

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/huizhi-yun/notification-runtime/internal/config"
	"github.com/huizhi-yun/notification-runtime/internal/httperror"
)

func TestResolveSecretUsesTenantRuntimeServiceAPI(t *testing.T) {
	var resolvedBody map[string]any
	var tokenAudience string
	var tokenScope string
	server := httptest.NewServer(http.HandlerFunc(func(response http.ResponseWriter, request *http.Request) {
		response.Header().Set("Content-Type", "application/json")
		switch request.URL.Path {
		case "/oauth/token":
			if err := request.ParseForm(); err != nil {
				t.Fatalf("parse token form: %v", err)
			}
			tokenAudience = request.Form.Get("audience")
			tokenScope = request.Form.Get("scope")
			_ = json.NewEncoder(response).Encode(map[string]any{
				"access_token": "test-token",
				"token_type":   "Bearer",
				"expires_in":   900,
			})
		case "/v1/console/service/integrations/wecom.default/resolve":
			if request.Header.Get("Authorization") != "Bearer test-token" {
				t.Fatalf("Authorization = %q", request.Header.Get("Authorization"))
			}
			if err := json.NewDecoder(request.Body).Decode(&resolvedBody); err != nil {
				t.Fatalf("decode resolve body: %v", err)
			}
			_ = json.NewEncoder(response).Encode(map[string]any{
				"code": 0,
				"data": map[string]any{
					"value":     "resolved-secret",
					"versionNo": 8,
				},
			})
		default:
			http.NotFound(response, request)
		}
	}))
	defer server.Close()

	client := New(config.ConsoleConfig{
		BaseURL:      server.URL,
		ServiceURL:   server.URL,
		TokenURL:     server.URL + "/oauth/token",
		ClientID:     "notification-runtime",
		ClientSecret: "client-secret",
		Timeout:      time.Second,
	})
	secret, err := client.ResolveSecret(context.Background(), "wecom.default")
	if err != nil {
		t.Fatalf("ResolveSecret: %v", err)
	}
	if secret.Value != "resolved-secret" || secret.VersionNo != 8 {
		t.Fatalf("secret = %#v", secret)
	}
	if len(resolvedBody) != 0 {
		t.Fatalf("resolve body must be empty: %#v", resolvedBody)
	}
	if tokenAudience != "data-runtime" {
		t.Fatalf("audience = %q", tokenAudience)
	}
	if tokenScope != "data-runtime:credential_vault:resolve" {
		t.Fatalf("scope = %q", tokenScope)
	}
}

func TestIntegrationUsesTenantRuntimeServiceAPI(t *testing.T) {
	var tokenAudience string
	var tokenScope string
	server := httptest.NewServer(http.HandlerFunc(func(response http.ResponseWriter, request *http.Request) {
		response.Header().Set("Content-Type", "application/json")
		switch request.URL.Path {
		case "/oauth/token":
			if err := request.ParseForm(); err != nil {
				t.Fatalf("parse token form: %v", err)
			}
			tokenAudience = request.Form.Get("audience")
			tokenScope = request.Form.Get("scope")
			_ = json.NewEncoder(response).Encode(map[string]any{
				"access_token": "integration-token",
				"token_type":   "Bearer",
				"expires_in":   900,
			})
		case "/v1/console/service/integrations/dingtalk.default":
			if request.Header.Get("Authorization") != "Bearer integration-token" {
				t.Fatalf("Authorization = %q", request.Header.Get("Authorization"))
			}
			_ = json.NewEncoder(response).Encode(map[string]any{
				"code": 0,
				"data": map[string]any{
					"integrationCode": "dingtalk.default",
					"providerCode":    "dingtalk",
					"baseUrl":         "https://api.dingtalk.com",
					"config":          map[string]any{"agentId": "123"},
				},
			})
		default:
			http.NotFound(response, request)
		}
	}))
	defer server.Close()

	client := New(config.ConsoleConfig{
		BaseURL:      server.URL,
		ServiceURL:   server.URL,
		TokenURL:     server.URL + "/oauth/token",
		ClientID:     "connector-runtime",
		ClientSecret: "client-secret",
		Timeout:      time.Second,
	})
	integration, err := client.Integration(context.Background(), "dingtalk.default")
	if err != nil {
		t.Fatalf("Integration: %v", err)
	}
	if integration.IntegrationCode != "dingtalk.default" || integration.ProviderCode != "dingtalk" {
		t.Fatalf("integration = %#v", integration)
	}
	if tokenAudience != "data-runtime" {
		t.Fatalf("audience = %q", tokenAudience)
	}
	if tokenScope != "data-runtime:integration_config:view" {
		t.Fatalf("scope = %q", tokenScope)
	}
}

func TestConnectorHeartbeatUsesConsoleAudienceScope(t *testing.T) {
	var tokenAudience string
	var tokenScope string
	server := httptest.NewServer(http.HandlerFunc(func(response http.ResponseWriter, request *http.Request) {
		response.Header().Set("Content-Type", "application/json")
		switch request.URL.Path {
		case "/oauth/token":
			if err := request.ParseForm(); err != nil {
				t.Fatalf("parse token form: %v", err)
			}
			tokenAudience = request.Form.Get("audience")
			tokenScope = request.Form.Get("scope")
			_ = json.NewEncoder(response).Encode(map[string]any{
				"access_token": "heartbeat-token",
				"token_type":   "Bearer",
				"expires_in":   900,
			})
		case "/api/v1/console/service/connector-runtime/heartbeat":
			if request.Header.Get("Authorization") != "Bearer heartbeat-token" {
				t.Fatalf("Authorization = %q", request.Header.Get("Authorization"))
			}
			_ = json.NewEncoder(response).Encode(map[string]any{
				"code": 0,
				"data": map[string]any{
					"status":               "active",
					"nextHeartbeatSeconds": 60,
				},
			})
		default:
			http.NotFound(response, request)
		}
	}))
	defer server.Close()

	client := New(config.ConsoleConfig{
		BaseURL:      server.URL,
		TokenURL:     server.URL + "/oauth/token",
		ClientID:     "connector-runtime",
		ClientSecret: "client-secret",
		Timeout:      time.Second,
	})
	if _, err := client.ConnectorHeartbeat(context.Background(), ConnectorHeartbeat{
		ConnectorID: "connector-runtime.C000001-console",
		Version:     "test",
	}); err != nil {
		t.Fatalf("ConnectorHeartbeat: %v", err)
	}
	if tokenAudience != "console" {
		t.Fatalf("audience = %q", tokenAudience)
	}
	if tokenScope != "console:connector-runtime:heartbeat" {
		t.Fatalf("scope = %q", tokenScope)
	}
}

func TestConnectorHeartbeatRefreshesRejectedAccessTokenOnce(t *testing.T) {
	tokenRequests := 0
	heartbeatRequests := 0
	server := httptest.NewServer(http.HandlerFunc(func(response http.ResponseWriter, request *http.Request) {
		response.Header().Set("Content-Type", "application/json")
		switch request.URL.Path {
		case "/oauth/token":
			tokenRequests++
			_ = json.NewEncoder(response).Encode(map[string]any{
				"access_token": fmt.Sprintf("heartbeat-token-%d", tokenRequests),
				"token_type":   "Bearer",
				"expires_in":   900,
			})
		case "/api/v1/console/service/connector-runtime/heartbeat":
			heartbeatRequests++
			if request.Header.Get("Authorization") == "Bearer heartbeat-token-1" {
				response.WriteHeader(http.StatusUnauthorized)
				_ = json.NewEncoder(response).Encode(map[string]any{
					"error":   true,
					"message": "invalid_token",
				})
				return
			}
			if request.Header.Get("Authorization") != "Bearer heartbeat-token-2" {
				t.Fatalf("Authorization = %q", request.Header.Get("Authorization"))
			}
			_ = json.NewEncoder(response).Encode(map[string]any{
				"code": 0,
				"data": map[string]any{
					"status":               "active",
					"nextHeartbeatSeconds": 60,
				},
			})
		default:
			http.NotFound(response, request)
		}
	}))
	defer server.Close()

	client := New(config.ConsoleConfig{
		BaseURL:      server.URL,
		TokenURL:     server.URL + "/oauth/token",
		ClientID:     "connector-runtime",
		ClientSecret: "client-secret",
		Timeout:      time.Second,
	})
	result, err := client.ConnectorHeartbeat(context.Background(), ConnectorHeartbeat{
		ConnectorID: "connector-runtime.C000001-console",
		Version:     "test",
	})
	if err != nil {
		t.Fatalf("ConnectorHeartbeat: %v", err)
	}
	if result.Status != "active" {
		t.Fatalf("status = %q", result.Status)
	}
	if tokenRequests != 2 {
		t.Fatalf("token requests = %d, want 2", tokenRequests)
	}
	if heartbeatRequests != 2 {
		t.Fatalf("heartbeat requests = %d, want 2", heartbeatRequests)
	}
}

func TestConnectorHeartbeatReturnsRejectionAfterFreshTokenFails(t *testing.T) {
	tokenRequests := 0
	heartbeatRequests := 0
	server := httptest.NewServer(http.HandlerFunc(func(response http.ResponseWriter, request *http.Request) {
		response.Header().Set("Content-Type", "application/json")
		switch request.URL.Path {
		case "/oauth/token":
			tokenRequests++
			_ = json.NewEncoder(response).Encode(map[string]any{
				"access_token": fmt.Sprintf("heartbeat-token-%d", tokenRequests),
				"token_type":   "Bearer",
				"expires_in":   900,
			})
		case "/api/v1/console/service/connector-runtime/heartbeat":
			heartbeatRequests++
			response.WriteHeader(http.StatusUnauthorized)
			_ = json.NewEncoder(response).Encode(map[string]any{
				"error":   true,
				"message": "invalid_token",
			})
		default:
			http.NotFound(response, request)
		}
	}))
	defer server.Close()

	client := New(config.ConsoleConfig{
		BaseURL:      server.URL,
		TokenURL:     server.URL + "/oauth/token",
		ClientID:     "connector-runtime",
		ClientSecret: "client-secret",
		Timeout:      time.Second,
	})
	_, err := client.ConnectorHeartbeat(context.Background(), ConnectorHeartbeat{
		ConnectorID: "connector-runtime.C000001-console",
		Version:     "test",
	})
	var httpError *httperror.Error
	if !errors.As(err, &httpError) || httpError.Status != http.StatusUnauthorized {
		t.Fatalf("error = %#v, want HTTP 401", err)
	}
	if tokenRequests != 2 {
		t.Fatalf("token requests = %d, want 2", tokenRequests)
	}
	if heartbeatRequests != 2 {
		t.Fatalf("heartbeat requests = %d, want 2", heartbeatRequests)
	}
}

func TestConnectorHeartbeatDoesNotRetryRejectedClientCredential(t *testing.T) {
	tokenRequests := 0
	heartbeatRequests := 0
	server := httptest.NewServer(http.HandlerFunc(func(response http.ResponseWriter, request *http.Request) {
		response.Header().Set("Content-Type", "application/json")
		switch request.URL.Path {
		case "/oauth/token":
			tokenRequests++
			response.WriteHeader(http.StatusUnauthorized)
			_ = json.NewEncoder(response).Encode(map[string]any{
				"error": "invalid_client",
			})
		case "/api/v1/console/service/connector-runtime/heartbeat":
			heartbeatRequests++
			http.Error(response, "unexpected heartbeat", http.StatusInternalServerError)
		default:
			http.NotFound(response, request)
		}
	}))
	defer server.Close()

	client := New(config.ConsoleConfig{
		BaseURL:      server.URL,
		TokenURL:     server.URL + "/oauth/token",
		ClientID:     "connector-runtime",
		ClientSecret: "client-secret",
		Timeout:      time.Second,
	})
	_, err := client.ConnectorHeartbeat(context.Background(), ConnectorHeartbeat{
		ConnectorID: "connector-runtime.C000001-console",
		Version:     "test",
	})
	var httpError *httperror.Error
	if !errors.As(err, &httpError) || httpError.Status != http.StatusUnauthorized {
		t.Fatalf("error = %#v, want HTTP 401", err)
	}
	if tokenRequests != 1 {
		t.Fatalf("token requests = %d, want 1", tokenRequests)
	}
	if heartbeatRequests != 0 {
		t.Fatalf("heartbeat requests = %d, want 0", heartbeatRequests)
	}
}
