package finance

import (
	"testing"

	"github.com/huizhi-yun/data-runtime/internal/integrationoperation"
)

func TestFinanceInvoiceWorkflowFormDataIsAllowlisted(t *testing.T) {
	got := financeInvoiceWorkflowFormData(map[string]any{
		"code": "IR-42", "requested_amount": "100.00", "deleted_at": "secret", "created_by": "internal", "billing_info_json": "private",
	})
	if got["code"] != "IR-42" || got["requested_amount"] != "100.00" {
		t.Fatalf("allowed fields missing: %#v", got)
	}
	for _, forbidden := range []string{"deleted_at", "created_by", "billing_info_json"} {
		if _, ok := got[forbidden]; ok {
			t.Fatalf("forbidden field %q leaked: %#v", forbidden, got)
		}
	}
}

// 走查 ISSUE-B-025 最后一层：Finance 曾把 bizUrl / callbackUrl 写进发往 Workflow
// 的冻结命令，而 integrationoperation 的安全持久化校验按字段名后缀拒绝一切
// url / uri 结尾的字段。构造命令的下一行就是 ValidateAndDigestCommand，
// 于是这条链路在生产 100% 返回 400 integration_operation_content_unsafe，
// 且因为同事务，invoice_request 也永远插不进去。
//
// 这条测试直接对命令形状跑真实校验函数，任何人再往命令里加 *Url / *Uri /
// *Token / *Secret 字段都会立刻失败。
func TestFinanceInvoiceWorkflowCommandPassesSafePersistenceValidation(t *testing.T) {
	command := financeInvoiceWorkflowCommand(
		"IR-42", "zhouguangying", "finance:invoice-request:IR-42:workflow-submit:v1",
		map[string]any{
			"invoice_item": "【走查诊断】开票申请授权验证", "customer_name": "示例客户",
			"requested_amount": "1000.00", "contract_code": "C-QA0901-CT", "customer_code": "C-QA0901",
			"code": "IR-42",
		},
	)
	if err := integrationoperation.ValidateSafeCommand(command); err != nil {
		t.Fatalf("finance workflow command must satisfy safe-persistence validation: %v", err)
	}
	if _, err := integrationoperation.ValidateAndDigestCommand(command); err != nil {
		t.Fatalf("ValidateAndDigestCommand: %v", err)
	}
	for _, forbidden := range []string{"bizUrl", "callbackUrl"} {
		if _, ok := command[forbidden]; ok {
			t.Fatalf("%q must not travel in the frozen command; Workflow owns the target fields", forbidden)
		}
	}
}
