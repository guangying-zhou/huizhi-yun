package console

import (
	"context"
	"io"
	"net/http"
	"strings"
	"testing"

	"github.com/DATA-DOG/go-sqlmock"
)

type integrationRoundTripper func(*http.Request) (*http.Response, error)

func (fn integrationRoundTripper) RoundTrip(request *http.Request) (*http.Response, error) {
	return fn(request)
}

func TestNormalizeIntegrationConfigRejectsNestedSecrets(t *testing.T) {
	_, err := normalizeIntegrationConfig(map[string]any{
		"providers": []any{
			map[string]any{"headers": map[string]any{"apiToken": "must-not-cross"}},
		},
	}, "ai.default")
	if err == nil {
		t.Fatal("nested secret-like integration config must be rejected")
	}
}

func TestNormalizeDingTalkIdentityConfigRejectsAgentAndUnifiedIDs(t *testing.T) {
	for _, clientID := range []string{
		"123456789",
		"550e8400-e29b-41d4-a716-446655440000",
	} {
		_, err := normalizeIntegrationConfig(map[string]any{"oauthClientId": clientID}, "dingtalk.identity")
		if err == nil {
			t.Fatalf("invalid DingTalk OAuth client id accepted: %s", clientID)
		}
	}
	config, err := normalizeIntegrationConfig(
		map[string]any{"oauthClientId": "ding-valid-client", "corpId": "corp-1"},
		"dingtalk.identity",
	)
	if err != nil || config["oauthClientId"] != "ding-valid-client" {
		t.Fatalf("valid DingTalk identity config rejected: %#v %v", config, err)
	}
}

func TestCheckOSSConnectivityUsesFixedSignedListRequest(t *testing.T) {
	original := integrationHTTPClient
	t.Cleanup(func() { integrationHTTPClient = original })
	integrationHTTPClient = &http.Client{
		Transport: integrationRoundTripper(func(request *http.Request) (*http.Response, error) {
			if request.Method != http.MethodGet {
				t.Fatalf("unexpected method: %s", request.Method)
			}
			if request.URL.String() != "https://tenant-assets.oss-cn-hangzhou.aliyuncs.com/?max-keys=1" {
				t.Fatalf("unexpected URL: %s", request.URL)
			}
			if !strings.HasPrefix(request.Header.Get("Authorization"), "OSS access-key-id:") {
				t.Fatalf("missing OSS v1 signature: %s", request.Header.Get("Authorization"))
			}
			if request.Header.Get("Date") == "" {
				t.Fatal("missing signed Date header")
			}
			return &http.Response{
				StatusCode: http.StatusOK,
				Body:       io.NopCloser(strings.NewReader("<ListBucketResult/>")),
				Header:     make(http.Header),
			}, nil
		}),
	}

	if err := checkOSSConnectivity(
		context.Background(),
		"https://oss-cn-hangzhou.aliyuncs.com",
		"tenant-assets",
		"access-key-id",
		"customer-secret",
	); err != nil {
		t.Fatalf("OSS check failed: %v", err)
	}
}

func TestSafeIntegrationBaseURLRejectsCredentialAndQuery(t *testing.T) {
	for _, candidate := range []string{
		"http://provider.example",
		"https://user:pass@provider.example",
		"https://provider.example?redirect=https://attacker.example",
		"https://provider.example#secret",
	} {
		if _, err := safeIntegrationBaseURL(candidate); err == nil {
			t.Fatalf("unsafe URL accepted: %s", candidate)
		}
	}
}

func TestIntegrationListRejectsWildcardAndMalformedGrantValues(t *testing.T) {
	values := integrationList([]any{"oss.default", "*", 42, "bad/value"})
	accepted := map[string]bool{}
	for _, value := range values {
		code, err := normalizeIntegrationCode(value, "integrationCode")
		if err == nil {
			accepted[code] = true
		}
	}
	if !accepted["oss.default"] || accepted["*"] || accepted["bad/value"] {
		t.Fatalf("unexpected grant allowlist: %#v", accepted)
	}
}

func TestServiceIntegrationGrantMatchesCanonicalJWTSubject(t *testing.T) {
	database, mock, err := sqlmock.New()
	if err != nil {
		t.Fatal(err)
	}
	defer database.Close()

	mock.ExpectQuery(`SELECT CAST\(scg\.scope_json AS CHAR\)`).
		WithArgs(
			"codocs.runtime",
			"codocs.runtime",
			"codocs",
			"integration_config",
			"view",
		).
		WillReturnRows(sqlmock.NewRows([]string{"scope_json"}).AddRow(
			`{"integrationCodes":["oss.default"]}`,
		))

	adapter := &Adapter{db: database}
	allowed, err := adapter.authorizedIntegrationCodes(
		context.Background(),
		"client:codocs.runtime",
		"codocs",
		"integration_config",
		"view",
	)
	if err != nil {
		t.Fatal(err)
	}
	if !allowed["oss.default"] {
		t.Fatalf("canonical service JWT subject did not match its grant: %#v", allowed)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}
