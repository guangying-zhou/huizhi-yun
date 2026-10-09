package server

import (
	"crypto/hmac"
	"crypto/sha256"
	"encoding/base64"
	"net/http"
	"strings"
	"testing"
	"time"

	"github.com/huizhi-yun/data-runtime/internal/auth"
	"github.com/huizhi-yun/data-runtime/internal/httperror"
	"github.com/huizhi-yun/data-runtime/internal/integrationoperation"
)

func TestInjectTrustedServiceCommandContextVerifiesSignedSourceAndTargetIdentity(t *testing.T) {
	restoreNow := timeNow
	timeNow = func() time.Time { return time.UnixMilli(1760000000000) }
	t.Cleanup(func() { timeNow = restoreNow })

	request, body := signedServiceCommandRequest(t, "1760000000000")
	err := injectTrustedServiceCommandContext(request, auth.Context{
		Tenant: "TENANT-A", Deployment: "ALTOC-DEPLOYMENT", AppCode: "altoc",
	}, body)
	if err != nil {
		t.Fatalf("injectTrustedServiceCommandContext: %v", err)
	}
	for key, want := range map[string]string{
		integrationoperation.TrustedServiceCommandTenantKey:           "TENANT-A",
		integrationoperation.TrustedServiceCommandSourceDeploymentKey: "AIMS-DEPLOYMENT",
		integrationoperation.TrustedServiceCommandTargetDeploymentKey: "ALTOC-DEPLOYMENT",
		integrationoperation.TrustedServiceCommandSourceAppKey:        "aims",
		integrationoperation.TrustedServiceCommandTargetAppKey:        "altoc",
		integrationoperation.TrustedServiceCommandSourceClientKey:     "aims.runtime",
	} {
		if got := strings.TrimSpace(body[key].(string)); got != want {
			t.Fatalf("%s = %q, want %q", key, got, want)
		}
	}
}

func TestInjectTrustedServiceCommandContextRejectsTamperAndExpiry(t *testing.T) {
	restoreNow := timeNow
	timeNow = func() time.Time { return time.UnixMilli(1760000000000) }
	t.Cleanup(func() { timeNow = restoreNow })

	tests := []struct {
		name   string
		mutate func(*http.Request, map[string]any)
	}{
		{name: "wrong tenant", mutate: func(request *http.Request, _ map[string]any) {
			request.Header.Set("X-HZY-Service-Command-Tenant", "TENANT-B")
		}},
		{name: "tampered hash", mutate: func(request *http.Request, _ map[string]any) {
			request.Header.Set("X-HZY-Service-Command-SHA256", strings.Repeat("b", 64))
		}},
		{name: "wrong target deployment", mutate: func(request *http.Request, _ map[string]any) {
			request.Header.Set("X-HZY-Service-Command-Target-Deployment", "OTHER")
		}},
		{name: "wrong target app", mutate: func(request *http.Request, _ map[string]any) {
			request.Header.Set("X-HZY-Service-Command-Target-App", "assets")
		}},
		{name: "source equals target", mutate: func(request *http.Request, _ map[string]any) {
			request.Header.Set("X-HZY-Service-Command-Source-App", "altoc")
		}},
		{name: "envelope mismatch", mutate: func(_ *http.Request, body map[string]any) {
			body[integrationoperation.ServiceCommandEnvelopeKey].(map[string]any)["operationCode"] = "evil.v1"
		}},
		{name: "declared source app mismatch", mutate: func(_ *http.Request, body map[string]any) {
			body[integrationoperation.ServiceCommandEnvelopeKey].(map[string]any)["sourceApp"] = "people"
		}},
		{name: "declared source deployment mismatch", mutate: func(_ *http.Request, body map[string]any) {
			body[integrationoperation.ServiceCommandEnvelopeKey].(map[string]any)["sourceDeployment"] = "PEOPLE-DEPLOYMENT"
		}},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			request, body := signedServiceCommandRequest(t, "1760000000000")
			tt.mutate(request, body)
			err := injectTrustedServiceCommandContext(request, auth.Context{
				Tenant: "TENANT-A", Deployment: "ALTOC-DEPLOYMENT", AppCode: "altoc",
			}, body)
			assertServiceCommandForbidden(t, err)
		})
	}

	request, body := signedServiceCommandRequest(t, "1759999900000")
	assertServiceCommandForbidden(t, injectTrustedServiceCommandContext(request, auth.Context{
		Tenant: "TENANT-A", Deployment: "ALTOC-DEPLOYMENT", AppCode: "altoc",
	}, body))
}

func signedServiceCommandRequest(t *testing.T, signedAt string) (*http.Request, map[string]any) {
	t.Helper()
	request, err := http.NewRequest(http.MethodPost, "https://runtime.example/v1/altoc/service/service-tickets/ST-1/delivery-result:sync", nil)
	if err != nil {
		t.Fatalf("NewRequest: %v", err)
	}
	request.Header.Set("Authorization", "Bearer short-lived-runtime-bearer")
	request.Header.Set("X-Request-Id", "REQ-1")
	values := map[string]string{
		"X-HZY-Service-Command-Tenant":            "TENANT-A",
		"X-HZY-Service-Command-Source-Deployment": "AIMS-DEPLOYMENT",
		"X-HZY-Service-Command-Target-Deployment": "ALTOC-DEPLOYMENT",
		"X-HZY-Service-Command-Source-App":        "aims",
		"X-HZY-Service-Command-Target-App":        "altoc",
		"X-HZY-Service-Command-Source-Client":     "aims.runtime",
		"X-HZY-Service-Command-Operation-Id":      "550e8400-e29b-41d4-a716-446655440000",
		"X-HZY-Service-Command-Operation-Code":    "aims.work-item.ticket-result.v1",
		"X-HZY-Service-Command-Capability":        "altoc:service_ticket:delivery-result:sync",
		"X-HZY-Service-Command-Idempotency-Key":   "aims:work-item:WI-1:ticket-result:closed:v1",
		"X-HZY-Service-Command-Schema-Version":    "v1",
		"X-HZY-Service-Command-SHA256":            strings.Repeat("a", 64),
		"X-HZY-Service-Command-Signed-At":         signedAt,
	}
	for name, value := range values {
		request.Header.Set(name, value)
	}
	canonical := strings.Join([]string{
		http.MethodPost,
		request.URL.RequestURI(),
		values["X-HZY-Service-Command-Tenant"],
		values["X-HZY-Service-Command-Source-Deployment"],
		values["X-HZY-Service-Command-Target-Deployment"],
		values["X-HZY-Service-Command-Source-App"],
		values["X-HZY-Service-Command-Source-Client"],
		values["X-HZY-Service-Command-Target-App"],
		values["X-HZY-Service-Command-Operation-Id"],
		values["X-HZY-Service-Command-Operation-Code"],
		values["X-HZY-Service-Command-Capability"],
		values["X-HZY-Service-Command-Idempotency-Key"],
		values["X-HZY-Service-Command-Schema-Version"],
		values["X-HZY-Service-Command-SHA256"],
		"REQ-1",
		signedAt,
	}, "\n")
	mac := hmac.New(sha256.New, []byte("short-lived-runtime-bearer"))
	_, _ = mac.Write([]byte(canonical))
	request.Header.Set("X-HZY-Service-Command-Signature", base64.RawURLEncoding.EncodeToString(mac.Sum(nil)))
	body := map[string]any{
		integrationoperation.ServiceCommandEnvelopeKey: map[string]any{
			"operationId":          values["X-HZY-Service-Command-Operation-Id"],
			"targetApp":            values["X-HZY-Service-Command-Target-App"],
			"operationCode":        values["X-HZY-Service-Command-Operation-Code"],
			"requiredCapability":   values["X-HZY-Service-Command-Capability"],
			"idempotencyKey":       values["X-HZY-Service-Command-Idempotency-Key"],
			"commandSchemaVersion": values["X-HZY-Service-Command-Schema-Version"],
			"commandSha256":        values["X-HZY-Service-Command-SHA256"],
			"sourceApp":            values["X-HZY-Service-Command-Source-App"],
			"sourceDeployment":     values["X-HZY-Service-Command-Source-Deployment"],
			"targetDeployment":     values["X-HZY-Service-Command-Target-Deployment"],
			"command":              map[string]any{"ticketCode": "ST-1"},
		},
	}
	return request, body
}

func assertServiceCommandForbidden(t *testing.T, err error) {
	t.Helper()
	httpErr, ok := err.(httperror.Error)
	if !ok || httpErr.Status != http.StatusForbidden || httpErr.Code != "service_command_context_invalid" {
		t.Fatalf("error = %#v, want 403 service_command_context_invalid", err)
	}
}
