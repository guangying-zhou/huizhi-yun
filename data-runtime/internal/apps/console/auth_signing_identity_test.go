package console

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"github.com/DATA-DOG/go-sqlmock"
	"os"
	"strings"
	"testing"
)

func expectActiveSigningGrant(mock sqlmock.Sqlmock) {
	expectServiceCredential(mock, "active")
	mock.ExpectQuery(`(?s)FROM service_client_grants`).WithArgs(uint64(9)).WillReturnRows(sqlmock.NewRows([]string{"resource_code", "action", "scope_json"}).AddRow("assets:product", "read", `{"audience":"assets","semanticScope":"assets:product:read"}`))
}

func TestServiceSigningRejectsEveryForgedCredentialIdentity(t *testing.T) {
	for _, field := range []string{"sub", "source_app", "subjectCode", "clientCode", "clientName", "clientType", "appCode", "paired-sub-and-client-code"} {
		t.Run(field, func(t *testing.T) {
			adapter, mock := signingAdapter(t)
			body := serviceSigningBody("assets:product:read")
			claims := body["claims"].(map[string]any)
			hzy := claims["hzy"].(map[string]any)
			switch field {
			case "sub", "source_app":
				claims[field] = "forged"
			case "paired-sub-and-client-code":
				claims["sub"] = "client:forged"
				hzy["clientCode"] = "forged"
				hzy["subjectCode"] = "forged"
			default:
				hzy[field] = "forged"
			}
			expectActiveSigningGrant(mock)
			_, err := adapter.SignOIDCToken(context.Background(), body, AuditMutationMeta{ActorID: "console.runtime"})
			assertSigningForbidden(t, err, "oidc_signing_service_identity_mismatch")
			if err := mock.ExpectationsWereMet(); err != nil {
				t.Fatal(err)
			}
		})
	}
}

func TestServiceSigningCanonicalIdentityComesFromCredentialRow(t *testing.T) {
	adapter, mock := signingAdapter(t)
	body := serviceSigningBody("assets:product:read")
	claims := body["claims"].(map[string]any)
	hzy := claims["hzy"].(map[string]any)
	delete(hzy, "clientCode")
	delete(hzy, "subjectCode")
	expectActiveSigningGrant(mock)
	var public map[string]any
	if err := json.Unmarshal([]byte(os.Getenv("TEST_TENANT_RUNTIME_OIDC_PRIVATE_JWK")), &public); err != nil {
		t.Fatal(err)
	}
	delete(public, "d")
	publicJSON, _ := json.Marshal(public)
	mock.ExpectQuery(`(?s)FROM auth_signing_keys`).WillReturnRows(sqlmock.NewRows([]string{"id", "kid", "alg", "use_type", "public_jwk_json", "private_key_ref"}).AddRow(7, "csk_authority_test", "EdDSA", "sig", string(publicJSON), "env:TEST_TENANT_RUNTIME_OIDC_PRIVATE_JWK"))
	result, err := adapter.SignOIDCToken(context.Background(), body, AuditMutationMeta{ActorID: "console.runtime"})
	if err != nil {
		t.Fatal(err)
	}
	raw, err := base64.RawURLEncoding.DecodeString(strings.Split(result["token"].(string), ".")[1])
	if err != nil {
		t.Fatal(err)
	}
	var signed map[string]any
	if err = json.Unmarshal(raw, &signed); err != nil {
		t.Fatal(err)
	}
	signedHZY := signed["hzy"].(map[string]any)
	for key, want := range map[string]string{"subjectCode": "aims-runtime", "clientCode": "aims-runtime", "clientName": "Aims Runtime", "clientType": "runtime", "appCode": "aims"} {
		if signedHZY[key] != want {
			t.Fatalf("%s not canonical", key)
		}
	}
	if signed["sub"] != "client:aims-runtime" || signed["source_app"] != "aims" {
		t.Fatal("wrong source identity")
	}
	if _, exists := hzy["clientName"]; exists {
		t.Fatal("signing mutated caller hzy input")
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}

func TestServiceSigningToolClientHasNoApplicationIdentity(t *testing.T) {
	for _, value := range []any{nil, "", "forged", 42} {
		t.Run("source", func(t *testing.T) {
			claims := map[string]any{"sub": "client:tool"}
			hzy := map[string]any{}
			if value != nil {
				claims["source_app"] = value
				hzy["appCode"] = value
			}
			err := bindServiceSigningIdentity(claims, hzy, serviceSigningIdentity{ClientCode: "tool", ClientName: "Tool", ClientType: "tool"})
			if value == nil || value == "" {
				if err != nil {
					t.Fatal(err)
				}
				if claims["source_app"] != "" || hzy["appCode"] != "" {
					t.Fatal("tool source application was invented")
				}
			} else {
				assertSigningForbidden(t, err, "oidc_signing_service_identity_mismatch")
			}
		})
	}
}

func TestServiceSigningRejectsNonStringIdentityAndIncompleteStoredIdentity(t *testing.T) {
	claims := map[string]any{"sub": "client:tool"}
	hzy := map[string]any{"clientName": 42}
	err := bindServiceSigningIdentity(claims, hzy, serviceSigningIdentity{ClientCode: "tool", ClientType: "tool"})
	assertSigningForbidden(t, err, "oidc_signing_service_identity_mismatch")
	if _, exists := hzy["clientCode"]; exists {
		t.Fatal("partial canonicalization on rejection")
	}
	err = bindServiceSigningIdentity(claims, map[string]any{}, serviceSigningIdentity{})
	assertHTTPErrorCode(t, err, 503, "oidc_signing_service_identity_unavailable")
}
