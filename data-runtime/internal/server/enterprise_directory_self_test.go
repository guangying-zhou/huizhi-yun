package server

import (
	"context"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/golang-jwt/jwt/v5"
	"github.com/huizhi-yun/data-runtime/internal/auth"
)

func TestEnterpriseDirectorySelfSignedActorBoundary(t *testing.T) {
	for _, scenario := range []string{"valid", "wrong-capability", "wrong-source", "wrong-tenant", "wrong-deployment", "expired", "unsigned-actor", "tampered-actor", "revoked", "dependency"} {
		t.Run(scenario, func(t *testing.T) {
			a, r, route := enterpriseContextFixture(t, func(c jwt.MapClaims) {
				c["scope"] = "console:directory-self:read"
				switch scenario {
				case "wrong-capability":
					c["scope"] = "console:directory-user:view"
				case "wrong-source":
					c["source_app"] = "console"
				case "wrong-tenant":
					c["tenant"] = "other"
				case "wrong-deployment":
					c["deployment"] = "other"
				case "expired":
					c["exp"] = time.Now().Add(-time.Minute).Unix()
				}
			}, true)
			r.Method, r.URL.Path, r.URL.RawQuery = http.MethodPost, "/v1/enterprise/console/directory-self:departments", ""
			bearer := strings.TrimPrefix(r.Header.Get("Authorization"), "Bearer ")
			r.Header.Set("X-HZY-Actor-Signature", testActorSignature(t, bearer, r.Method, r.URL.RequestURI(), "person-a", nil, r.Header.Get("X-HZY-Actor-Signed-At")))
			if scenario == "unsigned-actor" {
				r.Header.Del("X-HZY-Actor-Signature")
			}
			if scenario == "tampered-actor" {
				r.Header.Set("X-HZY-Actor-Uid", "other")
			}
			route.LogicalSource, route.LogicalTarget, route.Capability = "console", "console", "console:directory-self:read"
			verified, err := authenticateEnterpriseRequest(r, a, route, func(_ context.Context, identity auth.Context, capability string) (bool, error) {
				if identity.ClientID != "enterprise.runtime" || capability != "console:directory-self:read" {
					t.Fatal("unexpected credential verification")
				}
				if scenario == "revoked" {
					return false, nil
				}
				if scenario == "dependency" {
					return false, errors.New("unavailable")
				}
				return true, nil
			})
			if scenario == "valid" {
				if err != nil || verified.ActorUID != "person-a" {
					t.Fatalf("verified actor rejected: %v", err)
				}
			} else if err == nil {
				t.Fatal("invalid directory-self identity accepted")
			}
		})
	}
}

func TestEnterpriseDirectorySelfProjectProjectionIsMinimal(t *testing.T) {
	got := directorySelfProjects(map[string]any{
		"managed": []map[string]any{{"projectCode": "p1", "name": "Project", "repoUrl": "private", "description": "private"}},
		"joined":  []map[string]any{}, "items": []any{"private"},
	}).(map[string]any)
	if len(got) != 2 {
		t.Fatalf("unexpected projection fields: %#v", got)
	}
	row := got["managed"].([]map[string]any)[0]
	if len(row) != 3 || row["projectCode"] != "p1" || row["name"] != "Project" {
		t.Fatalf("unexpected project fields: %#v", row)
	}
	if directorySelfProjects(map[string]any{"managed": nil, "joined": []map[string]any{}}) != nil {
		t.Fatal("invalid dependency shape accepted")
	}
}

func TestEnterpriseDirectorySelfRejectsCallerSelectedIdentity(t *testing.T) {
	for _, raw := range []string{`{"uid":"other"}`, `{"actorUid":"other"}`, `{"query":{"uid":"other"}}`} {
		r := httptest.NewRequest(http.MethodPost, "/v1/enterprise/console/directory-self:projects", strings.NewReader(raw))
		if err := validateDirectorySelfInput(r); err == nil {
			t.Fatalf("accepted %s", raw)
		}
	}
	r := httptest.NewRequest(http.MethodPost, "/v1/enterprise/console/directory-self:projects?uid=other", strings.NewReader(`{}`))
	if err := validateDirectorySelfInput(r); err == nil {
		t.Fatal("accepted uid query")
	}
	r = httptest.NewRequest(http.MethodPost, "/v1/enterprise/console/directory-self:projects", strings.NewReader(`{}`))
	if err := validateDirectorySelfInput(r); err != nil {
		t.Fatal(err)
	}
}
