package server

import (
	"bytes"
	"crypto/hmac"
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"net/http"
	"strings"
	"testing"
	"time"

	"github.com/huizhi-yun/data-runtime/internal/auth"
	"github.com/huizhi-yun/data-runtime/internal/integrationoperation"
)

// 走查 ISSUE-B-025 收尾：Finance 的 mutation 路由是唯一一个忘记调用
// injectTrustedServiceCommandContext 的入口。Altoc 的开票申请命令因此在
// ReceiptCommandFromBody 里拿到空 tenant_code / source_app，被判成
// ErrInvalidIdentity 并返回 400 integration_operation_identity_invalid ——
// 认证、scope、目标上下文全部正确，却卡在这里，生产实测。
//
// 这与 2026-08-23 people claim/succeed/fail 漏映射是同一类缺陷：
// 跨应用可靠命令的公共步骤在各应用入口逐个手写，漏一个就静默失效。
func TestFinanceRuntimeMutationRequestInjectsTrustedServiceCommandContext(t *testing.T) {
	restoreNow := timeNow
	timeNow = func() time.Time { return time.UnixMilli(1760000000000) }
	t.Cleanup(func() { timeNow = restoreNow })

	request, wantBody := signedFinanceInvoiceRequestCommand(t, "1760000000000")
	authCtx := auth.Context{Tenant: "C000001", Deployment: "C000001-finance", AppCode: "finance"}

	_, body, err := (&Server{}).financeRuntimeMutationRequest(request, authCtx, "/v1/finance/service/invoice-requests:create")
	if err != nil {
		t.Fatalf("financeRuntimeMutationRequest: %v", err)
	}

	for key, want := range map[string]string{
		integrationoperation.TrustedServiceCommandTenantKey:           "C000001",
		integrationoperation.TrustedServiceCommandSourceDeploymentKey: "C000001-altoc",
		integrationoperation.TrustedServiceCommandTargetDeploymentKey: "C000001-finance",
		integrationoperation.TrustedServiceCommandSourceAppKey:        "altoc",
		integrationoperation.TrustedServiceCommandTargetAppKey:        "finance",
		integrationoperation.TrustedServiceCommandSourceClientKey:     "altoc.runtime",
	} {
		got, _ := body[key].(string)
		if strings.TrimSpace(got) != want {
			t.Fatalf("%s = %q, want %q", key, got, want)
		}
	}

	// 最强断言：直接跑 Finance 接收端实际调用的那一步。修复前这里就是生产上的
	// ErrInvalidIdentity(400)。
	input, _, err := integrationoperation.ReceiptCommandFromBody(
		body, "finance",
		"altoc.receivable.finance-invoice-request.v1",
		"finance:invoice-request:create",
	)
	if err != nil {
		t.Fatalf("ReceiptCommandFromBody must accept the injected context: %v", err)
	}
	if input.TrustedContext.SourceApp != "altoc" {
		t.Fatalf("source app = %q, want altoc", input.TrustedContext.SourceApp)
	}
	if input.TargetDeploymentCode != "C000001-finance" || input.SourceDeploymentCode != "C000001-altoc" {
		t.Fatalf("deployment binding = %q -> %q, want C000001-altoc -> C000001-finance",
			input.SourceDeploymentCode, input.TargetDeploymentCode)
	}
	_ = wantBody
}

// 普通用户态 Finance mutation 不带 service command envelope，注入必须是 no-op，
// 不得因此拒绝请求。
func TestFinanceRuntimeMutationRequestLeavesPlainMutationsUntouched(t *testing.T) {
	payload, err := json.Marshal(map[string]any{"amount": 100})
	if err != nil {
		t.Fatalf("marshal: %v", err)
	}
	request, err := http.NewRequest(http.MethodPost, "https://runtime.example/v1/finance/service/invoice-requests:create", bytes.NewReader(payload))
	if err != nil {
		t.Fatalf("NewRequest: %v", err)
	}
	request.Header.Set("Authorization", "Bearer short-lived-runtime-bearer")

	_, body, err := (&Server{}).financeRuntimeMutationRequest(request, auth.Context{
		Tenant: "C000001", Deployment: "C000001-finance", AppCode: "finance",
	}, "/v1/finance/service/invoice-requests:create")
	if err != nil {
		t.Fatalf("plain mutation must not be rejected: %v", err)
	}
	if _, ok := body[integrationoperation.TrustedServiceCommandTenantKey]; ok {
		t.Fatal("plain mutation must not carry service command trusted context")
	}
}

func signedFinanceInvoiceRequestCommand(t *testing.T, signedAt string) (*http.Request, map[string]any) {
	t.Helper()
	command := map[string]any{
		"receivablePlanCode": "C-QA0901-RP",
		"actorUid":           "zhouguangying",
	}
	commandSha256, err := integrationoperation.ValidateAndDigestCommand(command)
	if err != nil {
		t.Fatalf("ValidateAndDigestCommand: %v", err)
	}
	envelope := map[string]any{
		"targetApp":            "finance",
		"operationId":          "550e8400-e29b-41d4-a716-446655440000",
		"operationCode":        "altoc.receivable.finance-invoice-request.v1",
		"requiredCapability":   "finance:invoice-request:create",
		"idempotencyKey":       "altoc:receivable:C-QA0901-RP:invoice-request:v1",
		"commandSchemaVersion": "v1",
		"commandSha256":        commandSha256,
		"command":              command,
	}
	payload, err := json.Marshal(map[string]any{
		integrationoperation.ServiceCommandEnvelopeKey: envelope,
	})
	if err != nil {
		t.Fatalf("marshal: %v", err)
	}
	request, err := http.NewRequest(http.MethodPost,
		"https://runtime.example/v1/finance/service/invoice-requests:create", bytes.NewReader(payload))
	if err != nil {
		t.Fatalf("NewRequest: %v", err)
	}
	request.Header.Set("Authorization", "Bearer short-lived-runtime-bearer")
	request.Header.Set("X-Request-Id", "REQ-FIN-1")

	values := map[string]string{
		"X-HZY-Service-Command-Tenant":            "C000001",
		"X-HZY-Service-Command-Source-Deployment": "C000001-altoc",
		"X-HZY-Service-Command-Target-Deployment": "C000001-finance",
		"X-HZY-Service-Command-Source-App":        "altoc",
		"X-HZY-Service-Command-Target-App":        "finance",
		"X-HZY-Service-Command-Source-Client":     "altoc.runtime",
		"X-HZY-Service-Command-Operation-Id":      "550e8400-e29b-41d4-a716-446655440000",
		"X-HZY-Service-Command-Operation-Code":    "altoc.receivable.finance-invoice-request.v1",
		"X-HZY-Service-Command-Capability":        "finance:invoice-request:create",
		"X-HZY-Service-Command-Idempotency-Key":   "altoc:receivable:C-QA0901-RP:invoice-request:v1",
		"X-HZY-Service-Command-Schema-Version":    "v1",
		"X-HZY-Service-Command-SHA256":            commandSha256,
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
		"REQ-FIN-1",
		signedAt,
	}, "\n")
	mac := hmac.New(sha256.New, []byte("short-lived-runtime-bearer"))
	_, _ = mac.Write([]byte(canonical))
	request.Header.Set("X-HZY-Service-Command-Signature",
		base64.RawURLEncoding.EncodeToString(mac.Sum(nil)))
	return request, envelope
}
