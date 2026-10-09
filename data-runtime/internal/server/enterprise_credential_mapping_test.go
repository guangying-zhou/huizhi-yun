package server

import (
	"errors"
	"testing"

	"github.com/DATA-DOG/go-sqlmock"
	consoleapp "github.com/huizhi-yun/data-runtime/internal/apps/console"
	"github.com/huizhi-yun/data-runtime/internal/config"
	"github.com/huizhi-yun/data-runtime/internal/httperror"
)

func TestEnterpriseCredentialMappingDenialIs403DependencyIs503(t *testing.T) {
	for _, tc := range []struct {
		name, policy        string
		dependency, revoked bool
		legacyOnly          bool
		status              int
	}{
		{name: "registered semantic grant", policy: `{"audience":"data-runtime","semanticScope":"assets:enterprise-host:execute"}`},
		{name: "mismatched grant", policy: `{"audience":"tenant-runtime","semanticScope":"assets:enterprise-host:execute"}`, status: 403},
		{name: "revoked grant", revoked: true, status: 403},
		{name: "policy conflict", policy: `{"audience":"data-runtime","semanticScope":"assets:enterprise-host:execute"}`, status: 403},
		{name: "legacy precise grant only", policy: `{"audience":"data-runtime","semanticScope":"assets:product:read"}`, legacyOnly: true, status: 403},
		{name: "database dependency", dependency: true, status: 503},
	} {
		t.Run(tc.name, func(t *testing.T) {
			database, mock, err := sqlmock.New()
			if err != nil {
				t.Fatal(err)
			}
			defer database.Close()
			s := &Server{console: consoleapp.NewWithDB(config.ConsoleConfig{}, "tenant-a", database)}
			credential := mock.ExpectQuery(`(?s)SELECT sc.id,sc.status,sc.current_credential_id,scc.status,scc.expires_at`).WithArgs(7, "enterprise.runtime")
			if tc.dependency {
				credential.WillReturnError(errors.New("database unavailable"))
			} else {
				credential.WillReturnRows(sqlmock.NewRows([]string{"id", "status", "current_credential_id", "credential_status", "expires_at", "client_code", "client_name", "client_type", "app_code"}).AddRow(5, "active", 7, "active", nil, "enterprise.runtime", "Enterprise Runtime", "runtime", "enterprise"))
				rows := sqlmock.NewRows([]string{"resource_code", "action", "scope_json"})
				if !tc.revoked {
					if tc.legacyOnly {
						rows.AddRow("data-runtime:assets:product", "read", tc.policy)
					} else {
						rows.AddRow("data-runtime:assets:enterprise-host", "execute", tc.policy)
					}
				}
				if tc.name == "policy conflict" {
					rows.AddRow("other:assets:enterprise-host", "execute", tc.policy)
				}
				mock.ExpectQuery(`SELECT resource_code,action,scope_json FROM service_client_grants`).WithArgs(uint64(5)).WillReturnRows(rows)
			}
			a, r, route := enterpriseContextFixture(t, nil, true)
			_, err = authenticateEnterpriseRequest(r, a, route, s.verifyEnterpriseCredential)
			if tc.status == 0 {
				if err != nil {
					t.Fatal(err)
				}
			} else {
				var failure httperror.Error
				if !errors.As(err, &failure) || failure.Status != tc.status {
					t.Fatalf("got %v, want %d", err, tc.status)
				}
			}
			if err := mock.ExpectationsWereMet(); err != nil {
				t.Fatal(err)
			}
		})
	}
}
