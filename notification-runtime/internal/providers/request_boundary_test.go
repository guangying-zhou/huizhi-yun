package providers

import (
	"errors"
	"reflect"
	"testing"

	"github.com/huizhi-yun/notification-runtime/internal/httperror"
)

func TestNormalizeRecipientUIDsCanonicalizesAndDeduplicates(t *testing.T) {
	recipients, err := NormalizeRecipientUIDs([]any{" alice | bob ", "alice,carol", "bob"})
	if err != nil {
		t.Fatalf("NormalizeRecipientUIDs returned error: %v", err)
	}
	want := []string{"alice", "bob", "carol"}
	if !reflect.DeepEqual(recipients, want) {
		t.Fatalf("recipients = %#v, want %#v", recipients, want)
	}
}

func TestNormalizeRecipientUIDsRejectsUnsafeRecipientSets(t *testing.T) {
	cases := []struct {
		name  string
		value any
		code  string
	}{
		{name: "empty", value: " | , \n ", code: "invalid_touser"},
		{name: "broadcast lower", value: "alice|@all", code: "broadcast_recipient_forbidden"},
		{name: "broadcast case", value: []any{"@ALL"}, code: "broadcast_recipient_forbidden"},
		{name: "non string", value: []any{"alice", 42}, code: "invalid_touser"},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			_, err := NormalizeRecipientUIDs(tc.value)
			assertHTTPErrorCode(t, err, tc.code)
		})
	}
}

func TestBindTrustedSourceApp(t *testing.T) {
	bound, err := BindTrustedSourceApp(" AIMS ", "aims")
	if err != nil || bound != "aims" {
		t.Fatalf("BindTrustedSourceApp = %q, %v; want aims", bound, err)
	}

	cases := []struct {
		name      string
		requested string
		trusted   string
		code      string
	}{
		{name: "missing request source", trusted: "aims", code: "invalid_source_app"},
		{name: "invalid request source", requested: "aims/../../console", trusted: "aims", code: "invalid_source_app"},
		{name: "missing trusted source", requested: "aims", code: "missing_trusted_source_app"},
		{name: "mismatch", requested: "workflow", trusted: "aims", code: "source_app_mismatch"},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			_, err := BindTrustedSourceApp(tc.requested, tc.trusted)
			assertHTTPErrorCode(t, err, tc.code)
		})
	}
}

func TestValidateSendBoundaryNormalizesTrustedRequest(t *testing.T) {
	input := SendRequest{
		Channel:         " WECOM ",
		IntegrationCode: " wecom.default ",
		SourceAppCode:   " AIMS ",
		ToUser:          []any{"alice|bob", "alice"},
		Title:           " Notice ",
		Description:     " Description ",
		URL:             " https://example.test/action ",
		IdempotencyKey:  " aims:notice:123 ",
	}
	normalized, err := ValidateSendBoundary(input, "aims")
	if err != nil {
		t.Fatalf("ValidateSendBoundary returned error: %v", err)
	}
	if normalized.ToUser != "alice|bob" || normalized.IdempotencyKey != "aims:notice:123" || normalized.SourceAppCode != "aims" {
		t.Fatalf("normalized request = %#v", normalized)
	}
}

func TestValidateSendBoundaryRejectsNonStringRecipient(t *testing.T) {
	input := SendRequest{
		Channel:         "wecom",
		IntegrationCode: "wecom.default",
		SourceAppCode:   "aims",
		ToUser:          []any{"alice", 42},
		Title:           "Notice",
		Description:     "Description",
		URL:             "https://example.test/action",
		IdempotencyKey:  "aims:notice:123",
	}
	_, err := ValidateSendBoundary(input, "aims")
	assertHTTPErrorCode(t, err, "invalid_touser")
}

func assertHTTPErrorCode(t *testing.T, err error, code string) {
	t.Helper()
	var httpError *httperror.Error
	if !errors.As(err, &httpError) || httpError.Code != code {
		t.Fatalf("error = %#v, want httperror code %q", err, code)
	}
}
