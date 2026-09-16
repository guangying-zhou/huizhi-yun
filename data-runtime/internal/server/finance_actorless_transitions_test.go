package server

import "testing"

// 走查 ISSUE-B-025 第十一层：finance 的 integration operation 机器态跃迁
// （claim / succeed / fail / claim-next）由 worker 与 service-command 派发器发起，
// 没有用户会话，却被 financeRuntimeRequiresTrustedActor 的前缀式一刀切挡成
// 403 trusted_finance_actor_required。调用方 tryDispatchFinanceWorkflowOperation
// 把异常吞成 pending，第二跳因此静默停摆。
//
// 边界必须精确：机器态跃迁豁免，:replay 与业务写路径一律不豁免。
func TestFinanceActorRequirementBoundary(t *testing.T) {
	tests := []struct {
		name          string
		path          string
		requiresActor bool
	}{
		// 机器态跃迁：actorless，必须豁免
		{"claim", "/v1/finance/integration-operations/finance%3Ainvoice-request%3AIR-1%3Aworkflow-submit%3Av1:claim", false},
		{"succeed", "/v1/finance/integration-operations/finance%3Ainvoice-request%3AIR-1%3Aworkflow-submit%3Av1:succeed", false},
		{"fail", "/v1/finance/integration-operations/finance%3Ainvoice-request%3AIR-1%3Aworkflow-submit%3Av1:fail", false},
		{"claim-next", "/v1/finance/integration-operations:claim-next", false},

		// 浏览器管理动作：必须继续要求可信委托 actor
		{"replay stays protected", "/v1/finance/integration-operations/op-1:replay", true},

		// 资金业务写路径：finance 比其它应用更严的默认必须保留
		{"invoice request write", "/v1/finance/invoice-requests", true},
		{"payment confirm", "/v1/finance/payment-requests/PR-1:confirm", true},
		{"reconciliation", "/v1/finance/reconciliations", true},

		// 既有豁免不受影响
		{"service command inbound", "/v1/finance/service/invoice-requests:create", false},
		{"workflow callback", "/v1/finance/workflow/callback", false},
		{"workflow actions sync", "/v1/finance/workflow/actions/sync", false},

		// 相邻路径不得被误豁免
		{"diagnostics list is not a transition", "/v1/finance/integration-operations", true},
		{"attempts list is not a transition", "/v1/finance/integration-operations/op-1/attempts", true},
		{"lookalike suffix outside namespace", "/v1/finance/invoices:claim", true},
	}

	for _, tc := range tests {
		if got := financeRuntimeRequiresTrustedActor(tc.path); got != tc.requiresActor {
			t.Errorf("%s: financeRuntimeRequiresTrustedActor(%q) = %v, want %v",
				tc.name, tc.path, got, tc.requiresActor)
		}
	}
}

// 机器态谓词本身不得把命名空间外的路径或 :replay 认成跃迁。
func TestFinanceIntegrationOperationMachineTransitionIsNarrow(t *testing.T) {
	shouldMatch := []string{
		"/v1/finance/integration-operations:claim-next",
		"/v1/finance/integration-operations/op-1:claim",
		"/v1/finance/integration-operations/op-1:succeed",
		"/v1/finance/integration-operations/op-1:fail",
	}
	for _, path := range shouldMatch {
		if !isFinanceIntegrationOperationMachineTransition(path) {
			t.Errorf("%q must be recognised as an actorless machine transition", path)
		}
	}

	shouldNotMatch := []string{
		"/v1/finance/integration-operations/op-1:replay",
		"/v1/finance/integration-operations",
		"/v1/finance/integration-operations/op-1/attempts",
		"/v1/finance/invoices:claim",
		"/v1/altoc/integration-operations/op-1:claim",
		"/v1/finance/integration-operations-evil/op-1:claim",
	}
	for _, path := range shouldNotMatch {
		if isFinanceIntegrationOperationMachineTransition(path) {
			t.Errorf("%q must NOT be treated as an actorless machine transition", path)
		}
	}
}
