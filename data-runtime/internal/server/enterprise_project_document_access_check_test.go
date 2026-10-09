package server

import (
	"context"
	"github.com/golang-jwt/jwt/v5"
	"github.com/huizhi-yun/data-runtime/internal/auth"
	"net/http"
	"strings"
	"testing"
	"time"
)

func TestProjectDocumentAccessInputClosed(t *testing.T) {
	for _, action := range []string{"view", "download", "edit"} {
		in := enterpriseProjectDocumentContextInput{enterpriseProjectDocumentReadInput: enterpriseProjectDocumentReadInput{DocumentID: "45"}, AccessAction: action}
		if !validProjectDocumentAccessInput(in, true) {
			t.Fatalf("closed action %s rejected", action)
		}
		if validProjectDocumentAccessInput(in, false) {
			t.Fatal("context cannot carry access action")
		}
		in.DocumentUUID = "aaaaaaaa-0000-4000-8000-000000000001"
		if validProjectDocumentAccessInput(in, true) {
			t.Fatal("caller UUID bypass")
		}
		in.DocumentUUID = ""
		in.RepoProjectCode = "other/repo"
		if validProjectDocumentAccessInput(in, true) {
			t.Fatal("repository bypass")
		}
	}
	for _, action := range []string{"", "approve", "VIEW", "view,edit"} {
		in := enterpriseProjectDocumentContextInput{enterpriseProjectDocumentReadInput: enterpriseProjectDocumentReadInput{DocumentID: "45"}, AccessAction: action}
		if validProjectDocumentAccessInput(in, true) {
			t.Fatalf("unknown action %q accepted", action)
		}
	}
	if validProjectDocumentAccessInput(enterpriseProjectDocumentContextInput{AccessAction: "view"}, true) {
		t.Fatal("document relation required")
	}
}

func TestProjectDocumentAccessExactTrustMatrix(t *testing.T) {
	for _, path := range []string{"/v1/enterprise/aims/project-documents:access-check", "/v1/enterprise/aims/project-documents:repository-read"} {
		for _, scenario := range []string{"valid", "missing-cap", "wrong-audience", "wrong-source", "wrong-tenant", "wrong-deployment", "expired-token", "tampered-actor", "tampered-path", "revoked"} {
			t.Run(scenario, func(t *testing.T) {
				a, r, route := enterpriseContextFixture(t, func(c jwt.MapClaims) {
					c["scope"] = "aims:enterprise-host:execute"
					switch scenario {
					case "missing-cap":
						c["scope"] = "aims:read"
					case "wrong-audience":
						c["aud"] = "aims"
					case "wrong-source":
						c["source_app"] = "aims"
					case "wrong-tenant":
						c["tenant"] = "other"
					case "wrong-deployment":
						c["deployment"] = "other"
					case "expired-token":
						c["exp"] = time.Now().Add(-time.Minute).Unix()
					}
				}, true)
				r.Method, r.URL.Path, r.URL.RawQuery = http.MethodPost, path, ""
				token := strings.TrimPrefix(r.Header.Get("Authorization"), "Bearer ")
				r.Header.Set("X-HZY-Actor-Signature", testActorSignature(t, token, r.Method, r.URL.RequestURI(), "person-a", nil, r.Header.Get("X-HZY-Actor-Signed-At")))
				if scenario == "tampered-actor" {
					r.Header.Set("X-HZY-Actor-Uid", "forged")
				}
				if scenario == "tampered-path" {
					r.URL.Path = "/v1/enterprise/aims/forged"
				}
				route.LogicalSource, route.LogicalTarget = "aims", "aims"
				_, err := authenticateEnterpriseRequest(r, a, route, func(_ context.Context, _ auth.Context, cap string) (bool, error) {
					if cap != "aims:enterprise-host:execute" {
						t.Fatal("wrong capability", cap)
					}
					return scenario != "revoked", nil
				})
				if (err == nil) != (scenario == "valid") {
					t.Fatalf("%s err=%v", scenario, err)
				}
			})
		}
	}
}
