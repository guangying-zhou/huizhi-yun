package altoc

import (
	"net/http"
	"testing"
	"time"
)

func TestServiceTicketGenericMutationMatchesOnlyGenericTicketWrites(t *testing.T) {
	cases := []struct {
		method string
		path   string
		want   bool
	}{
		{http.MethodPost, "/v1/altoc/service-tickets", true},
		{http.MethodPatch, "/v1/altoc/service-tickets/ST-1", true},
		{http.MethodPut, "/v1/altoc/service-tickets/1", true},
		{http.MethodGet, "/v1/altoc/service-tickets/1", false},
		{http.MethodPost, "/v1/altoc/service/service-tickets/ST-1/delivery-result:sync", false},
		{http.MethodPatch, "/v1/altoc/service-tickets/1/comments", false},
	}
	for _, tt := range cases {
		if got := serviceTicketGenericMutation(tt.method, tt.path); got != tt.want {
			t.Fatalf("serviceTicketGenericMutation(%q, %q) = %v, want %v", tt.method, tt.path, got, tt.want)
		}
	}
}

func TestServiceTicketAssetCodesDeduplicatesPreferredSources(t *testing.T) {
	got := serviceTicketAssetCodes(
		map[string]any{
			"delivery_asset_code":       "CDA-1",
			"delivery_code":             "DEL-1",
			"maintenance_delivery_code": "DEL-1",
		},
		map[string]any{"deliveryAssetCode": "CDA-1"},
	)
	want := []string{"CDA-1", "DEL-1"}
	if len(got) != len(want) {
		t.Fatalf("asset code count = %d, want %d (%v)", len(got), len(want), got)
	}
	for i := range want {
		if got[i] != want[i] {
			t.Fatalf("asset code[%d] = %q, want %q (%v)", i, got[i], want[i], got)
		}
	}
}

func TestServiceAgreementEntitlementStatusAndQuota(t *testing.T) {
	now := time.Date(2026, 6, 22, 12, 0, 0, 0, time.UTC)
	agreement := map[string]any{
		"status":             "active",
		"service_start_date": "2026-01-01",
		"service_end_date":   "2026-12-31",
		"included_quota":     "10",
		"consumed_quota":     "9",
	}
	if got := serviceAgreementEntitlementStatus(agreement, now); got != "in_service" {
		t.Fatalf("entitlement status = %q, want in_service", got)
	}
	if serviceAgreementQuotaExceeded(agreement) {
		t.Fatal("quota should not be exceeded before consumed reaches included quota")
	}
	agreement["consumed_quota"] = "10"
	if !serviceAgreementQuotaExceeded(agreement) {
		t.Fatal("quota should be exceeded when consumed reaches included quota")
	}
	agreement["service_end_date"] = "2026-01-31"
	if got := serviceAgreementEntitlementStatus(agreement, now); got != "out_of_service" {
		t.Fatalf("expired entitlement status = %q, want out_of_service", got)
	}
}

func TestServiceTicketSLAStatus(t *testing.T) {
	now := time.Date(2026, 6, 22, 12, 0, 0, 0, time.UTC)
	if got := serviceTicketSLAStatus(
		map[string]any{"status": "processing"},
		"in_service",
		"2026-06-22 13:00:00",
		"2026-06-23 12:00:00",
		now,
	); got != "on_track" {
		t.Fatalf("open ticket SLA = %q, want on_track", got)
	}
	if got := serviceTicketSLAStatus(
		map[string]any{"status": "processing"},
		"in_service",
		"2026-06-22 11:00:00",
		"2026-06-23 12:00:00",
		now,
	); got != "breached" {
		t.Fatalf("late response SLA = %q, want breached", got)
	}
	if got := serviceTicketSLAStatus(
		map[string]any{"status": "closed", "resolved_at": "2026-06-23 13:00:00"},
		"in_service",
		"2026-06-22 13:00:00",
		"2026-06-23 12:00:00",
		now,
	); got != "breached" {
		t.Fatalf("late closed SLA = %q, want breached", got)
	}
	if got := serviceTicketSLAStatus(
		map[string]any{"status": "open"},
		"out_of_service",
		nil,
		nil,
		now,
	); got != "warning" {
		t.Fatalf("out of service SLA = %q, want warning", got)
	}
}
