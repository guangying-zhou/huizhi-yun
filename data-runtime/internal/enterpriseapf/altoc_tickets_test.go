package enterpriseapf

import (
	"github.com/huizhi-yun/data-runtime/internal/apps/altoc"
	"testing"
	"time"
)

func TestAPFTicketsClosedInputAndQuota(t *testing.T) {
	if len(ticketOps) != 9 {
		t.Fatal("operation drift")
	}
	for _, p := range []map[string]any{{"status": "closed"}, {"aims_delivery_generation": float64(1)}, {"customer_id": "1"}, {"current_user": "forged"}, {"service_agreement_id": "2"}} {
		p["expectedVersion"] = float64(1)
		if validateTicket("service-tickets-update", SalesInput{ID: "1", Payload: p}) == nil {
			t.Fatal("authority/binding field accepted", p)
		}
	}
	if validateTicket("service-tickets-reopen", SalesInput{ID: "1", Payload: map[string]any{"expectedVersion": float64(1), "reason": "明确重开"}}) != nil {
		t.Fatal("valid reopen denied")
	}
	_, action, ok := SalesPermission("service-tickets-reopen")
	if !ok || action != "reopen" {
		t.Fatal("reopen not independently gated")
	}
	now := time.Now()
	agreement := map[string]any{"status": "active", "included_quota": "2", "consumed_quota": "1", "quota_unit": "ticket"}
	ticket := map[string]any{"quota_consumed": "0"}
	if e := altoc.CheckEnterpriseDispatchQuota(ticket, agreement, "", now); e != nil {
		t.Fatal(e)
	}
	agreement["consumed_quota"] = "2"
	if altoc.CheckEnterpriseDispatchQuota(ticket, agreement, "", now) == nil {
		t.Fatal("over quota accepted")
	}
	agreement["consumed_quota"] = "1.5"
	agreement["quota_unit"] = "hour"
	if altoc.CheckEnterpriseDispatchQuota(ticket, agreement, "1", now) == nil {
		t.Fatal("estimated quota overflow accepted")
	}
	agreement["response_minutes"] = 30
	agreement["resolution_minutes"] = 240
	fields := altoc.EnterpriseServiceTicketSLA(map[string]any{"priority": "urgent"}, agreement, now)
	if fields["response_due_at"] != now.Add(30*time.Minute).UTC().Format("2006-01-02 15:04:05") {
		t.Fatal("SLA changed")
	}
}
