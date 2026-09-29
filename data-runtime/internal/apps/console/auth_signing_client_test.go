package console

import (
	"context"
	"fmt"
	"testing"

	"github.com/DATA-DOG/go-sqlmock"
)

func TestUserSigningClientAudienceAndAZP(t *testing.T) {
	for _, tokenUse := range []string{"access", "id"} {
		for _, tc := range []struct {
			name           string
			audience       string
			azp            any
			hasAZP, active bool
			code           string
		}{
			{name: "active without azp", audience: "aims", active: true},
			{name: "active equal azp", audience: "aims", azp: "aims", hasAZP: true, active: true},
			{name: "another active SSO client", audience: "enterprise", active: true},
			{name: "unregistered", audience: "unknown", code: "oidc_signing_user_client_not_active"},
			{name: "disabled", audience: "aims", code: "oidc_signing_user_client_not_active"},
			{name: "different azp", audience: "aims", azp: "enterprise", hasAZP: true, code: "oidc_signing_user_azp_mismatch"},
			{name: "empty azp", audience: "aims", azp: "", hasAZP: true, code: "oidc_signing_user_azp_mismatch"},
			{name: "null azp", audience: "aims", hasAZP: true, code: "oidc_signing_user_azp_mismatch"},
			{name: "numeric azp", audience: "aims", azp: 42, hasAZP: true, code: "oidc_signing_user_azp_mismatch"},
		} {
			t.Run(tokenUse+"/"+tc.name, func(t *testing.T) {
				a, mock := signingAdapter(t)
				mock.ExpectQuery(`(?s)SELECT ls.uid.*FROM local_sessions ls`).WithArgs(testSigningSID).WillReturnRows(sqlmock.NewRows([]string{"uid"}).AddRow("u1001"))
				if tc.code != "oidc_signing_user_azp_mismatch" {
					rows := sqlmock.NewRows([]string{"client_id"})
					if tc.active {
						rows.AddRow(tc.audience)
					}
					mock.ExpectQuery(`(?s)SELECT client_id FROM auth_clients`).WithArgs(tc.audience).WillReturnRows(rows)
				}
				body := userSigningBody(testSigningSID, "user:u1001", "u1001")
				claims := body["claims"].(map[string]any)
				claims["token_use"], claims["aud"] = tokenUse, tc.audience
				if tc.hasAZP {
					claims["azp"] = tc.azp
				}
				err := a.authorizeUserSigningClaims(context.Background(), claims, claims["hzy"].(map[string]any))
				if tc.code != "" {
					assertSigningForbidden(t, err, tc.code)
				} else if err != nil {
					t.Fatal(err)
				}
				if err := mock.ExpectationsWereMet(); err != nil {
					t.Fatal(err)
				}
			})
		}
	}
}

func TestUserSigningClientLookupFailureDoesNotAuthorize(t *testing.T) {
	a, mock := signingAdapter(t)
	failure := fmt.Errorf("database unavailable")
	mock.ExpectQuery(`(?s)SELECT client_id FROM auth_clients`).WithArgs("aims").WillReturnError(failure)
	if err := a.authorizeUserSigningClient(context.Background(), map[string]any{"aud": "aims"}); err != failure {
		t.Fatalf("error = %v", err)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}

func TestUserSigningRejectsInactiveClientBeforeKeyUse(t *testing.T) {
	a, mock := signingAdapter(t)
	mock.ExpectQuery(`(?s)SELECT ls.uid.*FROM local_sessions ls`).WithArgs(testSigningSID).WillReturnRows(sqlmock.NewRows([]string{"uid"}).AddRow("u1001"))
	mock.ExpectQuery(`(?s)SELECT client_id FROM auth_clients`).WithArgs("aims").WillReturnRows(sqlmock.NewRows([]string{"client_id"}))
	_, err := a.SignOIDCToken(context.Background(), userSigningBody(testSigningSID, "user:u1001", "u1001"), AuditMutationMeta{ActorID: "console.runtime"})
	assertSigningForbidden(t, err, "oidc_signing_user_client_not_active")
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}
