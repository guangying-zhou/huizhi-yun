package finance

import (
	"fmt"
	"net/http"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/huizhi-yun/data-runtime/internal/httperror"
)

type financeDueResponsibilityFields struct {
	uidKeys      []string
	dueKeys      []string
	canonicalUID string
	canonicalDue string
}

func normalizeFinanceDueResponsibilityMutation(method, path string, body jsonBody) error {
	var fields *financeDueResponsibilityFields
	switch {
	case method == http.MethodPost && path == "/v1/finance/invoice-requests",
		method == http.MethodPost && strings.HasPrefix(path, "/v1/finance/invoice-requests/") && strings.HasSuffix(path, "/assign-issuance"),
		method == http.MethodPatch && strings.HasPrefix(path, "/v1/finance/invoice-requests/"):
		fields = &financeDueResponsibilityFields{
			uidKeys: []string{"issuanceResponsibleUid", "issuance_responsible_uid"}, dueKeys: []string{"issuanceDueAt", "issuance_due_at"},
			canonicalUID: "issuanceResponsibleUid", canonicalDue: "issuanceDueAt",
		}
	case method == http.MethodPost && path == "/v1/finance/receipts",
		method == http.MethodPatch && strings.HasPrefix(path, "/v1/finance/receipts/"):
		fields = &financeDueResponsibilityFields{
			uidKeys: []string{"reconciliationResponsibleUid", "reconciliation_responsible_uid"}, dueKeys: []string{"reconciliationDueAt", "reconciliation_due_at"},
			canonicalUID: "reconciliationResponsibleUid", canonicalDue: "reconciliationDueAt",
		}
	}
	if fields == nil {
		return nil
	}
	uidPresent := bodyHas(body, fields.uidKeys...)
	duePresent := bodyHas(body, fields.dueKeys...)
	if !uidPresent && !duePresent {
		return nil
	}
	if uidPresent != duePresent {
		return invalidFinanceDueResponsibility("responsible UID and due time must be supplied together")
	}
	uidValue := bodyValue(body, fields.uidKeys...)
	dueValue := bodyValue(body, fields.dueKeys...)
	uidEmpty, dueEmpty := uidValue == nil || fmt.Sprint(uidValue) == "", dueValue == nil || fmt.Sprint(dueValue) == ""
	if uidEmpty || dueEmpty {
		if uidEmpty && dueEmpty {
			body[fields.canonicalUID] = nil
			body[fields.canonicalDue] = nil
			return nil
		}
		return invalidFinanceDueResponsibility("responsible UID and due time must both be empty or both be set")
	}
	uid, ok := uidValue.(string)
	if !ok || uid != strings.TrimSpace(uid) || uid == "" || len(uid) > 50 || !utf8.ValidString(uid) || strings.EqualFold(uid, "@all") || hasFinanceControlCharacter(uid) {
		return invalidFinanceDueResponsibility("responsible UID is invalid")
	}
	due, err := normalizeFinanceDueTime(dueValue)
	if err != nil {
		return err
	}
	body[fields.canonicalUID] = uid
	body[fields.canonicalDue] = due
	return nil
}

func normalizeFinanceDueTime(value any) (string, error) {
	raw, ok := value.(string)
	if !ok || raw != strings.TrimSpace(raw) || raw == "" || hasFinanceControlCharacter(raw) {
		return "", invalidFinanceDueResponsibility("due time is invalid")
	}
	for _, layout := range []string{time.RFC3339, "2006-01-02 15:04:05", "2006-01-02T15:04:05"} {
		parsed, err := time.Parse(layout, raw)
		if err != nil {
			continue
		}
		if layout == time.RFC3339 {
			return parsed.UTC().Format("2006-01-02 15:04:05"), nil
		}
		return parsed.Format("2006-01-02 15:04:05"), nil
	}
	return "", invalidFinanceDueResponsibility("due time must be RFC3339 or YYYY-MM-DD HH:MM:SS")
}

func hasFinanceControlCharacter(value string) bool {
	for _, character := range value {
		if character < 32 || character == 127 {
			return true
		}
	}
	return false
}

func invalidFinanceDueResponsibility(message string) error {
	return httperror.New(http.StatusBadRequest, "finance_due_responsibility_invalid", message)
}
