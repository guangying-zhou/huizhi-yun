package enterpriseapf

import (
	"github.com/huizhi-yun/data-runtime/internal/apps/aims"
	"github.com/huizhi-yun/data-runtime/internal/integrationoperation"
	"testing"
	"time"
)

func TestAPFContractClosedInput(t *testing.T) {
	for _, bad := range []map[string]any{{"status": "approved"}, {"owner_uid": "other"}, {"expectedVersion": 1.5}} {
		if ValidateContractInput("contracts-update", ContractInput{ID: "1", Payload: bad}) == nil {
			t.Fatal("accepted forged", bad)
		}
	}
	if ValidateContractInput("contracts-create", ContractInput{CustomerID: "1", Payload: map[string]any{"name": "合同", "currency_code": "CNY"}}) != nil {
		t.Fatal("create rejected")
	}
	if ValidateContractInput("payment-terms-replace", ContractInput{ID: "1", Payload: map[string]any{"expectedVersion": float64(1)}, Rows: []map[string]any{{"term_name": "首款", "term_type": "one_time", "amount": "10.00", "trigger_type": "manual", "invoice_required": true}}}) != nil {
		t.Fatal("term rejected")
	}
}
func TestAPFContractBusinessReplayDoesNotBindEphemeralPermit(t *testing.T) {
	a := ContractInput{ID: "1", Payload: map[string]any{"expectedVersion": float64(1)}, AimsPermits: []aims.ContractProjectPermit{{ExpiresAt: time.Now().UnixMilli()}}}
	b := a
	b.AimsPermits = []aims.ContractProjectPermit{{ExpiresAt: time.Now().Add(time.Second).UnixMilli()}}
	a.AimsPermits = nil
	b.AimsPermits = nil
	x, _ := integrationoperation.ValidateAndDigestCommand(map[string]any{"intent": ContractIntent(a)})
	y, _ := integrationoperation.ValidateAndDigestCommand(map[string]any{"intent": ContractIntent(b)})
	if x != y {
		t.Fatal("fresh permits conflict")
	}
}
func TestAPFContractRecurrenceBounded(t *testing.T) {
	p, e := termPeriods(map[string]any{"term_type": "recurring", "recurrence_interval": "month", "service_start_date": "2026-01-01", "service_end_date": "2026-03-31"})
	if e != nil || len(p) != 3 {
		t.Fatal(p, e)
	}
	if _, e = termPeriods(map[string]any{"term_type": "recurring", "recurrence_interval": "month", "service_start_date": "2000-01-01", "service_end_date": "2026-01-01"}); e == nil {
		t.Fatal("unbounded recurrence")
	}
}
