package altoc

import (
	"net/http"
	"reflect"
	"strings"
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
	want := []string{"CDA-1"}
	if len(got) != len(want) {
		t.Fatalf("asset code count = %d, want %d (%v)", len(got), len(want), got)
	}
	for i := range want {
		if got[i] != want[i] {
			t.Fatalf("asset code[%d] = %q, want %q (%v)", i, got[i], want[i], got)
		}
	}
}

func TestServiceAgreementCoverageTargetRequiresExactEnvironmentForPair(t *testing.T) {
	where, args := serviceAgreementCoverageTargetWhere([]string{"CDA-1"}, "ENV-1")
	if !strings.Contains(where, "sac.target_type = 'delivery_asset_environment'") || !strings.Contains(where, "sac.environment_code = ?") {
		t.Fatalf("where = %q, want formal asset/environment target", where)
	}
	want := []any{"CDA-1", "ENV-1", "CDA-1", "ENV-1"}
	if !reflect.DeepEqual(args, want) {
		t.Fatalf("args = %#v, want %#v", args, want)
	}

	assetOnlyWhere, _ := serviceAgreementCoverageTargetWhere([]string{"CDA-1"}, "")
	if strings.Contains(assetOnlyWhere, "delivery_asset_environment") {
		t.Fatalf("asset-only where = %q, must not match pair without environment", assetOnlyWhere)
	}
}

func TestServiceTicketHourQuotaConsumesOnlyCumulativeDelta(t *testing.T) {
	agreement := map[string]any{"included_quota": "100", "quota_unit": "hour"}
	ticket := map[string]any{"status": "resolved", "quota_consumed": "2.5"}
	if got := serviceTicketQuotaConsumption(ticket, agreement, map[string]any{"actualHours": 3.0}); got != 0.5 {
		t.Fatalf("hour quota delta = %v, want 0.5", got)
	}
	if got := serviceTicketQuotaConsumption(ticket, agreement, map[string]any{"actualHours": 2.5}); got != 0 {
		t.Fatalf("hour quota replay delta = %v, want 0", got)
	}
}

func TestServiceTicketDeliveryStatusNeverRegresses(t *testing.T) {
	if !serviceTicketDeliveryStatusIsStale("resolved", "processing") {
		t.Fatal("resolved ticket must reject processing replay")
	}
	if serviceTicketDeliveryStatusIsStale("processing", "closed") {
		t.Fatal("processing to closed must move forward")
	}
	for _, current := range []string{"resolved", "closed"} {
		if !serviceTicketDeliveryStatusIsStale(current, "cancelled") {
			t.Fatalf("%s ticket must reject cancelled fallback", current)
		}
	}
}

func TestHigherAimsGenerationDoesNotAuthorizeTerminalReopen(t *testing.T) {
	for _, current := range []string{"resolved", "closed", "cancelled"} {
		if !serviceTicketDeliveryStatusIsStale(current, "processing") {
			t.Fatalf("higher Aims generation must not reopen terminal Altoc status %s", current)
		}
	}
}

func TestServiceTicketDispatchProjectionDoesNotReopenPermanentFailure(t *testing.T) {
	cases := map[string]string{
		"pending":          "pending",
		"processing":       "pending",
		"retry_wait":       "pending",
		"partial_unknown":  "pending",
		"succeeded":        "succeeded",
		"failed_permanent": "failed",
		"dead_letter":      "failed",
	}
	for operationStatus, want := range cases {
		if got := altocServiceTicketDispatchProjection(operationStatus); got != want {
			t.Fatalf("altocServiceTicketDispatchProjection(%q) = %q, want %q", operationStatus, got, want)
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
		map[string]any{"status": "resolved", "first_responded_at": "2026-06-22 14:00:00", "resolved_at": "2026-06-23 11:00:00"},
		"in_service",
		"2026-06-22 13:00:00",
		"2026-06-23 12:00:00",
		now,
	); got != "breached" {
		t.Fatalf("late first response after resolution SLA = %q, want breached", got)
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
