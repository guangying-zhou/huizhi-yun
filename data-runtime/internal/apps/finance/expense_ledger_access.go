package finance

import (
	"net/http"
	"net/url"
	"strings"

	"github.com/huizhi-yun/data-runtime/internal/httperror"
)

func isExpenseLedgerTable(table string) bool {
	return table == "finance_expense"
}

func applyExpenseLedgerListAccess(where *[]string, args *[]any, query url.Values) {
	switch applicantRequestAccessFromQuery(query) {
	case "", "all":
		return
	case "self":
		uid := applicantRequestCurrentUserFromQuery(query)
		if uid == "" {
			*where = append(*where, "1 = 0")
			return
		}
		*where = append(*where, "handler_user_id = ?")
		*args = append(*args, uid)
	case "dept":
		uid := applicantRequestCurrentUserFromQuery(query)
		deptCodes := applicantRequestDeptCodesFromQuery(query)
		parts := make([]string, 0, 2)
		if uid != "" {
			parts = append(parts, "handler_user_id = ?")
			*args = append(*args, uid)
		}
		if len(deptCodes) > 0 {
			parts = append(parts, "department_code IN ("+placeholders(len(deptCodes))+")")
			for _, code := range deptCodes {
				*args = append(*args, code)
			}
		}
		if len(parts) == 0 {
			*where = append(*where, "1 = 0")
			return
		}
		*where = append(*where, "("+strings.Join(parts, " OR ")+")")
	default:
		*where = append(*where, "1 = 0")
	}
}

func requireExpenseLedgerQueryAccess(query url.Values, row map[string]any) error {
	return requireExpenseLedgerRecordAccess(
		applicantRequestAccessFromQuery(query),
		applicantRequestCurrentUserFromQuery(query),
		applicantRequestDeptCodesFromQuery(query),
		row,
	)
}

func requireExpenseLedgerRecordAccess(access string, uid string, deptCodes []string, row map[string]any) error {
	switch access {
	case "", "all":
		return nil
	case "self":
		if uid == "" || cleanStringValue(row["handler_user_id"]) != uid {
			return expenseLedgerForbidden()
		}
		return nil
	case "dept":
		if uid != "" && cleanStringValue(row["handler_user_id"]) == uid {
			return nil
		}
		if containsApplicantRequestDeptCode(deptCodes, cleanStringValue(row["department_code"])) {
			return nil
		}
		return expenseLedgerForbidden()
	default:
		return expenseLedgerForbidden()
	}
}

func requireExpenseLedgerCreateAccess(body jsonBody) error {
	access := applicantRequestAccessFromBody(body)
	if access == "" || access == "all" {
		return nil
	}
	if access != "self" && access != "dept" {
		return expenseLedgerForbidden()
	}

	uid := applicantRequestCurrentUserFromBody(body)
	if uid == "" {
		return expenseLedgerForbidden()
	}
	handler := cleanStringValue(bodyValue(body, "handlerUserId", "handler_user_id"))
	if handler == "" {
		body["handlerUserId"] = uid
		body["handler_user_id"] = uid
		return nil
	}
	if handler == uid {
		return nil
	}
	if access == "self" {
		return expenseLedgerForbidden()
	}

	deptCode := cleanStringValue(bodyValue(body, "departmentCode", "department_code"))
	if !containsApplicantRequestDeptCode(applicantRequestDeptCodesFromBody(body), deptCode) {
		return expenseLedgerForbidden()
	}
	return nil
}

func requireExpenseLedgerBodyRecordAccess(body jsonBody, row map[string]any) error {
	return requireExpenseLedgerRecordAccess(
		applicantRequestAccessFromBody(body),
		applicantRequestCurrentUserFromBody(body),
		applicantRequestDeptCodesFromBody(body),
		row,
	)
}

func requireExpenseLedgerBodyAccess(body jsonBody, row map[string]any) error {
	if err := requireExpenseLedgerBodyRecordAccess(body, row); err != nil {
		return err
	}

	target := map[string]any{
		"handler_user_id": row["handler_user_id"],
		"department_code": row["department_code"],
	}
	if handler := cleanStringValue(bodyValue(body, "handlerUserId", "handler_user_id")); handler != "" {
		target["handler_user_id"] = handler
	}
	if deptCode := cleanStringValue(bodyValue(body, "departmentCode", "department_code")); deptCode != "" {
		target["department_code"] = deptCode
	}
	return requireExpenseLedgerBodyRecordAccess(body, target)
}

func expenseLedgerForbidden() error {
	return httperror.New(http.StatusForbidden, "finance_expense_access_denied", "only authorized users can access this finance expense")
}
