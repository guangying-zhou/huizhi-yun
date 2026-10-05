package server

import (
	"errors"
	"github.com/DATA-DOG/go-sqlmock"
	"github.com/golang-jwt/jwt/v5"
	consoleapp "github.com/huizhi-yun/data-runtime/internal/apps/console"
	"github.com/huizhi-yun/data-runtime/internal/config"
	"github.com/huizhi-yun/data-runtime/internal/httperror"
	"net/http"
	"strings"
	"testing"
	"time"
)

func TestEnterpriseOrgBrandSignedBoundary(t *testing.T) {
	for _, scenario := range []string{"valid", "anonymous", "wrong-tenant", "wrong-capability", "wrong-source", "wrong-audience", "expired", "wrong-deployment", "unsigned-actor", "revoked", "input"} {
		t.Run(scenario, func(t *testing.T) {
			a, r, route := enterpriseContextFixture(t, func(c jwt.MapClaims) {
				c["scope"] = "console:enterprise-host:execute"
				switch scenario {
				case "wrong-tenant":
					c["tenant"] = "other"
				case "wrong-capability":
					c["scope"] = "aims:enterprise-host:execute"
				case "wrong-source":
					c["source_app"] = "console"
				case "expired":
					c["exp"] = time.Now().Add(-time.Minute).Unix()
				case "wrong-audience":
					c["aud"] = "other"
				case "wrong-deployment":
					c["deployment"] = "other"
				}
			}, true)
			r.Method, r.URL.Path, r.URL.RawQuery = http.MethodPost, enterpriseOrgBrandPath, ""
			bearer := strings.TrimPrefix(r.Header.Get("Authorization"), "Bearer ")
			r.Header.Set("X-HZY-Actor-Signature", testActorSignature(t, bearer, r.Method, r.URL.RequestURI(), "person-a", nil, r.Header.Get("X-HZY-Actor-Signed-At")))
			if scenario == "anonymous" {
				r.Header.Del("Authorization")
			}
			if scenario == "unsigned-actor" {
				r.Header.Del("X-HZY-Actor-Signature")
			}
			db, mock, err := sqlmock.New()
			if err != nil {
				t.Fatal(err)
			}
			defer db.Close()
			if scenario == "valid" || scenario == "revoked" || scenario == "input" {
				status := "active"
				if scenario == "revoked" {
					status = "disabled"
				}
				mock.ExpectQuery(`(?s)SELECT sc.id,sc.status,sc.current_credential_id,scc.status,scc.expires_at`).WithArgs(7, "enterprise.runtime").WillReturnRows(sqlmock.NewRows([]string{"id", "status", "current_credential_id", "credential_status", "expires_at", "client_code", "client_name", "client_type", "app_code"}).AddRow(5, status, 7, "active", nil, "enterprise.runtime", "Enterprise", "runtime", "enterprise"))
				if scenario != "revoked" {
					mock.ExpectQuery(`SELECT resource_code,action,scope_json FROM service_client_grants`).WithArgs(uint64(5)).WillReturnRows(sqlmock.NewRows([]string{"resource_code", "action", "scope_json"}).AddRow("console:enterprise-host", "execute", `{"audience":"data-runtime","semanticScope":"console:enterprise-host:execute"}`))
				}
			}
			if scenario == "input" {
				r.Body = http.NoBody
				r.URL.RawQuery = "tenant=other"
				r.Header.Set("X-HZY-Actor-Signature", testActorSignature(t, bearer, r.Method, r.URL.RequestURI(), "person-a", nil, r.Header.Get("X-HZY-Actor-Signed-At")))
			}
			if scenario == "valid" {
				mock.ExpectQuery("SELECT tenant_code,org_name,org_short_name,display_name FROM org_profiles").WillReturnRows(sqlmock.NewRows([]string{"tenant_code", "org_name", "org_short_name", "display_name"}).AddRow("tenant-a", "Full", "Short", "Display"))
			}
			cfg := config.Config{Tenant: route.Binding.Tenant, Deployment: route.Binding.RuntimeDeployment, DeploymentBindings: map[string]string{"enterprise": route.HostDeployment}}
			cfg.Enterprise.Enabled = true
			cfg.Enterprise.Environment = route.Binding.Environment
			s := &Server{cfg: cfg, auth: a, console: consoleapp.NewWithDB(config.ConsoleConfig{}, "tenant-a", db)}
			result, err := s.route(r)
			if scenario == "valid" {
				if err != nil {
					t.Fatal(err)
				}
				brand := result.Body.(map[string]any)["data"].(map[string]string)
				if len(brand) != 2 || brand["shortName"] != "Short" {
					t.Fatalf("%v", brand)
				}
			} else {
				var denied httperror.Error
				if !errors.As(err, &denied) {
					t.Fatalf("accepted %s: %v", scenario, err)
				}
				if scenario == "anonymous" && denied.Status != 401 {
					t.Fatalf("anonymous status %d", denied.Status)
				}
				if scenario == "wrong-tenant" && denied.Status != 403 {
					t.Fatalf("tenant status %d", denied.Status)
				}
			}
			if err := mock.ExpectationsWereMet(); err != nil {
				t.Fatal(err)
			}
		})
	}
}
