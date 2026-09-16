package finance

import (
	"net/http"
	"net/url"
	"strings"

	"github.com/huizhi-yun/data-runtime/internal/httperror"
)

const (
	financeResponsibilityAccessAll      = "all"
	financeResponsibilityAccessRelation = "relation"
	financeResponsibilityAccessNone     = "none"
)

type financeResponsibilityTarget struct {
	accessKeys []string
	column     string
}

var financeInvoiceRequestResponsibilityTarget = financeResponsibilityTarget{
	accessKeys: []string{"current_user_invoice_request_access", "currentUserInvoiceRequestAccess"},
	column:     "issuance_responsible_uid",
}

var financeReceiptResponsibilityTarget = financeResponsibilityTarget{
	accessKeys: []string{"current_user_receipt_access", "currentUserReceiptAccess"},
	column:     "reconciliation_responsible_uid",
}

func financeResponsibilityTargetForTable(table string) (financeResponsibilityTarget, bool) {
	switch strings.TrimSpace(table) {
	case "invoice_request":
		return financeInvoiceRequestResponsibilityTarget, true
	case "finance_receipt":
		return financeReceiptResponsibilityTarget, true
	default:
		return financeResponsibilityTarget{}, false
	}
}

func applyFinanceResponsibilityListAccess(where *[]string, args *[]any, query url.Values, table string) {
	target, ok := financeResponsibilityTargetForTable(table)
	if !ok {
		return
	}
	access, actor := financeResponsibilityQueryContext(query, target)
	switch access {
	case financeResponsibilityAccessAll:
		return
	case financeResponsibilityAccessRelation:
		*where = append(*where, target.column+" = ?")
		*args = append(*args, actor)
	default:
		*where = append(*where, "1 = 0")
	}
}

func financeResponsibilityDetailWhere(query url.Values, table string) (string, []any) {
	target, ok := financeResponsibilityTargetForTable(table)
	if !ok {
		return "", nil
	}
	access, actor := financeResponsibilityQueryContext(query, target)
	switch access {
	case financeResponsibilityAccessAll:
		return "", nil
	case financeResponsibilityAccessRelation:
		return target.column + " = ?", []any{actor}
	default:
		return "1 = 0", nil
	}
}

func financeResponsibilityQueryContext(query url.Values, target financeResponsibilityTarget) (string, string) {
	actor := strings.TrimSpace(financeQueryValue(query, "current_user", "currentUser", "operator_uid", "operatorUid"))
	access := strings.TrimSpace(financeQueryValue(query, target.accessKeys...))
	// Capability-authenticated service reads have no user actor or user scope.
	if actor == "" && access == "" {
		return financeResponsibilityAccessAll, ""
	}
	if access == financeResponsibilityAccessAll {
		return access, actor
	}
	if access == financeResponsibilityAccessRelation && actor != "" {
		return access, actor
	}
	return financeResponsibilityAccessNone, actor
}

func requireFinanceResponsibilityBodyAccess(body jsonBody, record map[string]any, target financeResponsibilityTarget) error {
	actor := cleanStringValue(bodyValue(body, "current_user", "currentUser", "operator_uid", "operatorUid"))
	access := cleanStringValue(bodyValue(body, target.accessKeys...))
	if access == financeResponsibilityAccessAll {
		return nil
	}
	if access == financeResponsibilityAccessRelation && actor != "" && cleanStringValue(record[target.column]) == actor {
		return nil
	}
	return httperror.New(http.StatusForbidden, "finance_responsibility_scope_denied", "current responsibility or trusted global access is required")
}
