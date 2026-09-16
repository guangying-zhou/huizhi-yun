package aims

import (
	"errors"
	"testing"

	"github.com/huizhi-yun/data-runtime/internal/httperror"
)

func TestServiceYearRejectsAmbiguousNonCalendarLabel(t *testing.T) {
	err := validateServiceYearValues("2026-04-01", "2027-03-31", "2026")
	var httpErr httperror.Error
	if !errors.As(err, &httpErr) || httpErr.Code != "ambiguous_service_period_label" {
		t.Fatalf("error = %#v", err)
	}
	if err := validateServiceYearValues("2026-01-01", "2026-12-31", "2026"); err != nil {
		t.Fatalf("calendar year label should pass: %v", err)
	}
	if err := validateServiceYearValues("2026-04-01", "2027-03-31", "2026.04-2027.03"); err != nil {
		t.Fatalf("explicit contract-period label should pass: %v", err)
	}
}

func TestNormalizeServiceYearRequiresCompleteMaintenanceFields(t *testing.T) {
	_, err := normalizeServiceYearInput("maintenance", map[string]any{"serviceLineCode": "CUS-OPS"}, true)
	var httpErr httperror.Error
	if !errors.As(err, &httpErr) || httpErr.Code != "service_year_fields_required" {
		t.Fatalf("error = %#v", err)
	}

	input, err := normalizeServiceYearInput("maintenance", map[string]any{
		"serviceLineCode": "CUS-OPS", "servicePeriodSeq": 2,
		"servicePeriodStart": "2026-04-01", "servicePeriodEnd": "2027-03-31",
		"servicePeriodLabel": "2026.04-2027.03",
	}, true)
	if err != nil || input.LineCode != "CUS-OPS" || input.PeriodSeq != int64(2) {
		t.Fatalf("input=%#v err=%v", input, err)
	}
}

func TestServiceYearFieldsAreMaintenanceOnly(t *testing.T) {
	_, err := normalizeServiceYearInput("delivery", map[string]any{"serviceLineCode": "CUS-OPS"}, false)
	var httpErr httperror.Error
	if !errors.As(err, &httpErr) || httpErr.Code != "service_year_category_required" {
		t.Fatalf("error = %#v", err)
	}
}
