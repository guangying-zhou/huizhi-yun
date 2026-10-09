package enterpriseapf

import (
	"github.com/huizhi-yun/data-runtime/internal/apps/altoc"
	"testing"
	"time"
)

func TestAPFReceivableAgingCalendar(t *testing.T) {
	now := time.Date(2024, 3, 1, 23, 0, 0, 0, time.UTC)
	for due, want := range map[string]string{"": "no_due_date", "2024-03-02": "not_due", "2024-03-01": "not_due", "2024-02-29": "1_30", "2024-01-31": "1_30", "2024-01-30": "31_60", "2024-01-01": "31_60", "2023-12-31": "61_90", "2023-12-02": "61_90", "2023-12-01": "91_180", "2023-09-03": "91_180", "2023-09-02": "over_180"} {
		if got := ReceivableAgingBucket(due, now); got != want {
			t.Errorf("%s=%s want %s", due, got, want)
		}
	}
}
func TestAPFReceivableInputClosed(t *testing.T) {
	for op, action := range map[string]string{"receivables-page": "view", "receivables-detail": "view", "receivables-aging-summary": "view", "receivables-set-collection-owner": "assign", "receivables-set-due-date": "set-due-date", "collection-followup-create": "followup"} {
		r, a, ok := SalesPermission(op)
		if !ok || r != "receivable" || a != action {
			t.Fatal(op)
		}
	}
	page := SalesInput{Payload: map[string]any{"page": float64(1), "pageSize": float64(20)}}
	if e := ValidateSalesInput("receivables-page", page); e != nil {
		t.Fatal(e)
	}
	for key, val := range map[string]any{"pageSize": float64(101), "agingBucket": "bad", "actor": "forged", "legalEntityRead": true, "queryDate": "2026-02-30", "customerId": "01"} {
		p := SalesInput{Payload: map[string]any{"page": float64(1), "pageSize": float64(20)}}
		p.Payload[key] = val
		if ValidateSalesInput("receivables-page", p) == nil {
			t.Fatal(key)
		}
	}
	i := SalesInput{ID: "1", Payload: map[string]any{"expectedVersion": float64(1), "result": "联系结果", "promised_amount": "12.34"}}
	if e := ValidateSalesInput("collection-followup-create", i); e != nil {
		t.Fatal(e)
	}
	i.Payload["promised_amount"] = "-1"
	if ValidateSalesInput("collection-followup-create", i) == nil {
		t.Fatal("negative")
	}
}
func TestAPFReceivableScope(t *testing.T) {
	p := map[string]any{"owner_uid": "other", "owner_dept_code": "D1"}
	row := map[string]any{"collection_responsible_uid": "collector"}
	if !receivableScopeAllows(altoc.BasicReadScope{Access: "self"}, "collector", p, row) {
		t.Fatal("collector denied")
	}
	if receivableScopeAllows(altoc.BasicReadScope{Access: "self"}, "stranger", p, row) {
		t.Fatal("outside exposed")
	}
	if receivableScopeAllows(altoc.BasicReadScope{Access: "none"}, "collector", p, row) {
		t.Fatal("none exposed")
	}
}
