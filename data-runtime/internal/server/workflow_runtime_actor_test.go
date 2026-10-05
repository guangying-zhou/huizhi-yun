package server

import (
	"context"
	"github.com/DATA-DOG/go-sqlmock"
	"github.com/golang-jwt/jwt/v5"
	"github.com/huizhi-yun/data-runtime/internal/apps/workflow"
	"github.com/huizhi-yun/data-runtime/internal/auth"
	"net/http"
	"net/http/httptest"
	"os"
	"strings"
	"testing"
	"time"
)

func TestWorkflowRuntimeRequiresTrustedActorForUserRelationPaths(t *testing.T) {
	for _, path := range []string{
		"/v1/workflow/actions",
		"/v1/workflow/tasks/pending",
		"/v1/workflow/tasks/42",
		"/v1/workflow/instances",
		"/v1/workflow/instances/42",
		"/v1/workflow/instances/by-biz",
		"/v1/workflow/admin/flow-schemas",
	} {
		if !workflowRuntimeRequiresTrustedActor(path) {
			t.Fatalf("workflow path %q must require a trusted actor", path)
		}
	}
	if workflowRuntimeRequiresTrustedActor("/v1/workflow/actionable-lifecycle-effects/pending") {
		t.Fatal("internal Workflow outbox path must not require a browser actor")
	}
}

func TestWorkflowInstanceMutationsOverwriteBodyActorWithTrustedDelegation(t *testing.T) {
	source, err := os.ReadFile("server.go")
	if err != nil {
		t.Fatal(err)
	}
	text := string(source)
	for _, route := range []string{
		`path == "/v1/workflow/instances/prepare"`,
		`path == "/v1/workflow/instances"`,
	} {
		start := strings.Index(text, route)
		if start < 0 {
			t.Fatalf("Workflow mutation route %q not found", route)
		}
		block := text[start:]
		if end := strings.Index(block[len(route):], "\n\tif "); end >= 0 {
			block = block[:len(route)+end]
		}
		for _, required := range []string{"trustedWorkflowUserActor(r, authCtx)", "injectRuntimeAuthBody(body, authCtx, actorUID, deptCodes)"} {
			if !strings.Contains(block, required) {
				t.Fatalf("Workflow mutation route %q must contain %q", route, required)
			}
		}
	}
	if !strings.Contains(text, `purpose != ""`) {
		t.Fatal("Workflow user mutation actor helper must reject non-user delegation purposes")
	}
}

func TestWorkflowCompletionLaneRetainsExistingSignedNodeBoundary(t *testing.T) {
	raw, err := os.ReadFile("server.go")
	if err != nil {
		t.Fatal(err)
	}
	text := string(raw)
	start := strings.Index(text, "if isWorkflowRuntimePath(path)")
	if start < 0 {
		t.Fatal("Workflow routing missing")
	}
	block := text[start:]
	for _, required := range []string{`s.authenticateWorkflowEffectService(r, scope, "workflow.runtime")`, `runtimeSignedActorContext(r)`, `actorPurpose != ""`, `workflowRuntimeRequiresTrustedActor(path) && !actorDelegated`, `injectRuntimeAuthBody(body, authCtx, actorUID, deptCodes)`} {
		if !strings.Contains(block, required) {
			t.Fatalf("lost existing Node Runtime boundary %s", required)
		}
	}
	for _, forbidden := range []string{"enterpriseWorkflowDecisionPermit", "enterprise_workflow_lane", "HostDecisionBridge"} {
		if strings.Contains(text, forbidden) {
			t.Fatal("unapproved signature bridge", forbidden)
		}
	}
}

// ServeHTTP + real signed service JWT/actor delegation, without a listening
// socket. A 404 from the owning handler proves ordinary Node users pass auth;
// purpose/service subjects must stop at 403 before any domain DB query.
func TestWorkflowLaneNodeDelegationHTTPBoundary(t *testing.T) {
	cfg, key := testRuntimeJWTConfig(t)
	cfg.Enterprise.WorkflowLane.Enabled = true
	cfg.Auth.JWT.Issuer = "https://console.test"
	cfg.DeploymentBindings = map[string]string{"workflow": "workflow-test"}
	for _, path := range []string{"/v1/workflow/tasks/42/approve", "/v1/workflow/tasks/42/reject", "/v1/workflow/tasks/42/delegate", "/v1/workflow/instances/42/cancel", "/v1/workflow/instances/42/resubmit"} {
		for _, scenario := range []string{"ordinary", "purpose", "service", "unsigned", "lane-client"} {
			t.Run(path+"/"+scenario, func(t *testing.T) {
				db, m, _ := sqlmock.New()
				defer db.Close()
				now := time.Now()
				token := jwt.NewWithClaims(jwt.SigningMethodEdDSA, jwt.MapClaims{"iss": "https://console.test", "aud": "data-runtime", "sub": "client:workflow.runtime", "client_id": "workflow.runtime", "source_app": "workflow", "target_app": "data-runtime", "tenant": cfg.Tenant, "deployment": "workflow-test", "token_use": "service", "scope": "workflow.write", "hzy": map[string]any{"credentialId": 7, "appCode": "workflow"}, "exp": now.Add(time.Minute).Unix(), "iat": now.Unix()})
				if scenario == "lane-client" {
					claims := token.Claims.(jwt.MapClaims)
					claims["client_id"] = "workflow.lane"
					claims["sub"] = "client:workflow.lane"
				}
				token.Header["kid"] = "test-key"
				bearer, err := token.SignedString(key)
				if err != nil {
					t.Fatal(err)
				}
				s := &Server{cfg: cfg, auth: auth.New(cfg), workflow: workflow.NewWithDB(db), workflowEffectVerifierCredential: func(_ context.Context, id auth.Context, scope string) (bool, error) {
					if id.ClientID != "workflow.runtime" || scope != "workflow.write" {
						t.Fatal(id, scope)
					}
					return true, nil
				}}
				req := httptest.NewRequest(http.MethodPost, path, strings.NewReader(`{"current_user":"forged","delegate_to":"Delegate","comment":"理由"}`))
				req.Header.Set("Authorization", "Bearer "+bearer)
				req.Header.Set("Idempotency-Key", "http-node-test")
				actor := "Reviewer"
				purpose := ""
				if scenario == "service" {
					actor = "client:workflow.runtime"
				}
				if scenario == "purpose" {
					purpose = "notification-detail-authorization"
				}
				signedAt := "1760000000000"
				req.Header.Set("X-HZY-Actor-Uid", actor)
				req.Header.Set("X-HZY-Actor-Signed-At", signedAt)
				if purpose != "" {
					req.Header.Set("X-HZY-Actor-Purpose", purpose)
				}
				if scenario != "unsigned" {
					if purpose == "" {
						req.Header.Set("X-HZY-Actor-Signature", testActorSignature(t, bearer, req.Method, req.URL.RequestURI(), actor, nil, signedAt))
					} else {
						req.Header.Set("X-HZY-Actor-Signature", testActorSignatureWithPurpose(t, bearer, req.Method, req.URL.RequestURI(), actor, nil, signedAt, purpose))
						old := timeNow
						timeNow = func() time.Time { return time.UnixMilli(1760000000000) }
						t.Cleanup(func() { timeNow = old })
					}
				}
				want := 403
				if scenario == "ordinary" {
					want = 404
					m.ExpectBegin()
					m.ExpectQuery("SELECT").WithArgs("42").WillReturnRows(sqlmock.NewRows([]string{"id"}))
					m.ExpectRollback()
				}
				rec := httptest.NewRecorder()
				s.ServeHTTP(rec, req)
				if rec.Code != want {
					t.Fatalf("HTTP %d want %d: %s", rec.Code, want, rec.Body.String())
				}
				if scenario != "ordinary" {
					wantCode := "trusted_workflow_actor_required"
					if scenario == "lane-client" {
						wantCode = "workflow_effect_identity_mismatch"
					}
					if !strings.Contains(rec.Body.String(), wantCode) {
						t.Fatal("wrong rejection stage", rec.Body.String())
					}
				}
				if err = m.ExpectationsWereMet(); err != nil {
					t.Fatal(err)
				}
			})
		}
	}
}
