package altoc

import (
	"testing"

	"github.com/huizhi-yun/data-runtime/internal/apps/finance"
)

func TestContractManagementBadDebtAmountFallsBackToContractUnreceived(t *testing.T) {
	got := contractManagementBadDebtAmount(550000, 400000, 0)
	if got != 150000 {
		t.Fatalf("contractManagementBadDebtAmount() = %v, want 150000", got)
	}
}

func TestContractManagementBadDebtAmountKeepsOutstandingReceivable(t *testing.T) {
	got := contractManagementBadDebtAmount(100000, 90000, 25000)
	if got != 25000 {
		t.Fatalf("contractManagementBadDebtAmount() = %v, want 25000", got)
	}
}

func TestContractFinanceReceivedAmountUsesFinanceSummary(t *testing.T) {
	got := contractFinanceReceivedAmount(finance.ContractSummary{ReceivedAmount: "400000.00"})
	if got != 400000 {
		t.Fatalf("contractFinanceReceivedAmount() = %v, want 400000", got)
	}
}
