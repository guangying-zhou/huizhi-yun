package server

import (
	"context"
	"crypto/ed25519"
	"crypto/rand"
	"encoding/base64"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/DATA-DOG/go-sqlmock"
	"github.com/golang-jwt/jwt/v5"
	"github.com/huizhi-yun/data-runtime/internal/apps/workflow"
	"github.com/huizhi-yun/data-runtime/internal/auth"
	"github.com/huizhi-yun/data-runtime/internal/config"
	"github.com/huizhi-yun/data-runtime/internal/httperror"
)

// The Workflow notification-detail verifier must carry the viewer as a signed
// notification-detail delegation; Runtime never falls back to the service identity.
func TestWorkflowNotificationDetailRouteRequiresSignedViewer(t *testing.T) {
	restoreNow := timeNow
	timeNow = func() time.Time { return time.UnixMilli(1760000000000) }
	t.Cleanup(func() { timeNow = restoreNow })

	pub, private, err := ed25519.GenerateKey(rand.Reader)
	if err != nil {
		t.Fatal(err)
	}
	keys, _ := json.Marshal(map[string]any{"keys": []any{map[string]any{"kty": "OKP", "crv": "Ed25519", "kid": "wf-detail-route", "x": base64.RawURLEncoding.EncodeToString(pub)}}})
	cfg := config.Config{Tenant: "C000001", Deployment: "runtime-test", DeploymentBindings: map[string]string{"workflow": "workflow-test"},
		Auth: config.AuthConfig{Mode: config.AuthJWT, JWT: config.JWTConfig{Issuer: "https://console.test", Audience: "data-runtime", JWKSJSON: string(keys)}}}
	now := time.Now()
	token := jwt.NewWithClaims(jwt.SigningMethodEdDSA, jwt.MapClaims{"iss": "https://console.test", "aud": "data-runtime", "sub": "client:workflow.runtime", "tenant": "C000001", "deployment": "workflow-test",
		"source_app": "workflow", "target_app": "data-runtime", "client_id": "workflow.runtime", "token_use": "service", "scope": "data-runtime:workflow:read",
		"hzy": map[string]any{"credentialId": 7, "appCode": "workflow"}, "iat": now.Unix(), "exp": now.Add(time.Minute).Unix()})
	token.Header["kid"] = "wf-detail-route"
	bearer, err := token.SignedString(private)
	if err != nil {
		t.Fatal(err)
	}

	newServer := func(t *testing.T) (*Server, sqlmock.Sqlmock) {
		db, mock, err := sqlmock.New()
		if err != nil {
			t.Fatal(err)
		}
		t.Cleanup(func() { _ = db.Close() })
		return &Server{cfg: cfg, auth: auth.New(cfg), workflow: workflow.NewWithDB(db),
			workflowNotificationVerifierCredential: func(context.Context, auth.Context, string) (bool, error) { return true, nil }}, mock
	}
	request := func(actor, purpose string) *http.Request {
		req := httptest.NewRequest(http.MethodPost, "/v1/workflow/notification-details/authorize",
			strings.NewReader(`{"descriptor":{"resource":"workflow_task","id":"instance:30:tasks:30"},"current_user":"forged-user"}`))
		req.Header.Set("Authorization", "Bearer "+bearer)
		if actor != "" {
			signedAt := "1760000000000"
			req.Header.Set("X-HZY-Actor-Uid", actor)
			req.Header.Set("X-HZY-Actor-Signed-At", signedAt)
			req.Header.Set("X-HZY-Actor-Purpose", purpose)
			req.Header.Set("X-HZY-Actor-Signature", testActorSignatureWithPurpose(t, bearer, req.Method, req.URL.RequestURI(), actor, nil, signedAt, purpose))
		}
		return req
	}

	for name, item := range map[string]struct{ actor, purpose string }{
		"no signed delegation":         {},
		"wrong purpose":                {actor: "test", purpose: "service-command"},
		"actor equals service subject": {actor: "client:workflow.runtime", purpose: "notification-detail-authorization"},
	} {
		t.Run(name, func(t *testing.T) {
			server, mock := newServer(t)
			_, err := server.route(request(item.actor, item.purpose))
			var httpErr httperror.Error
			if !errors.As(err, &httpErr) || httpErr.Status != http.StatusForbidden || httpErr.Code != "trusted_notification_actor_required" {
				t.Fatalf("got %T %v", err, err)
			}
			if err := mock.ExpectationsWereMet(); err != nil {
				t.Fatalf("adapter must not be reached: %v", err)
			}
		})
	}

	t.Run("signed viewer reaches the adapter as current_user", func(t *testing.T) {
		server, mock := newServer(t)
		// The access query is evaluated for the delegated viewer, not the body value or the service subject.
		mock.ExpectQuery(`SELECT COUNT\(\*\), COALESCE\(SUM\(CASE WHEN status = 'pending' AND assignee_uid = \?`).
			WithArgs("test", int64(30), int64(30)).
			WillReturnRows(sqlmock.NewRows([]string{"count", "pending"}).AddRow(1, 1))
		result, err := server.route(request("test", "notification-detail-authorization"))
		if err != nil {
			t.Fatalf("signed viewer rejected: %v", err)
		}
		if err := mock.ExpectationsWereMet(); err != nil {
			t.Fatalf("adapter not reached with delegated viewer: %v", err)
		}
		body, _ := json.Marshal(result.Body)
		if !strings.Contains(string(body), `"authorized":true`) {
			t.Fatalf("unexpected body %s", body)
		}
	})
}
