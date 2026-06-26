package finance

import (
	"net/http"
	"strings"

	"github.com/huizhi-yun/data-runtime/internal/httperror"
)

func isPaymentConfirmationTable(table string) bool {
	return table == "payment_request" || table == "finance_expense"
}

func requirePaymentConfirmationCreateDutySeparation(table string, body jsonBody) error {
	if !isPaymentConfirmationTable(table) {
		return nil
	}
	if _, ok := paymentConfirmationStatusFromBody(body); !ok {
		return nil
	}
	actor := paymentConfirmationActorUID(body)
	if actor == "" {
		return nil
	}
	if paymentConfirmationActorMatchesMaker(table, actor, nil, body) {
		return paymentConfirmationDutySeparationForbidden()
	}
	return nil
}

func requirePaymentConfirmationUpdateDutySeparation(table string, before map[string]any, body jsonBody) error {
	if !isPaymentConfirmationTable(table) {
		return nil
	}
	status, ok := paymentConfirmationStatusFromBody(body)
	if !ok {
		return nil
	}
	if strings.EqualFold(cleanStringValue(before["status"]), status) {
		return nil
	}
	actor := paymentConfirmationActorUID(body)
	if actor == "" {
		return nil
	}
	if paymentConfirmationActorMatchesMaker(table, actor, before, body) {
		return paymentConfirmationDutySeparationForbidden()
	}
	return nil
}

func paymentConfirmationStatusFromBody(body jsonBody) (string, bool) {
	if !bodyHas(body, "status") {
		return "", false
	}
	status := strings.ToLower(cleanStringValue(bodyValue(body, "status")))
	switch status {
	case "paid", "confirmed":
		return status, true
	default:
		return "", false
	}
}

func paymentConfirmationActorUID(body jsonBody) string {
	return firstNonEmpty(
		cleanStringValue(bodyValue(body, "paymentConfirmedBy", "payment_confirmed_by")),
		cleanStringValue(bodyValue(body, "paidBy", "paid_by")),
		cleanStringValue(bodyValue(body, "confirmedBy", "confirmed_by")),
		cleanStringValue(bodyValue(body, "operator_uid", "operatorUid")),
		cleanStringValue(bodyValue(body, "current_user", "currentUser")),
		cleanStringValue(bodyValue(body, "updatedBy", "updated_by")),
	)
}

func paymentConfirmationActorMatchesMaker(table string, actor string, before map[string]any, body jsonBody) bool {
	candidates := paymentConfirmationMakerUIDs(table, before, body)
	for _, candidate := range candidates {
		if candidate == actor {
			return true
		}
	}
	return false
}

func paymentConfirmationMakerUIDs(table string, before map[string]any, body jsonBody) []string {
	switch table {
	case "payment_request":
		return uniqueCleanStrings(
			effectivePaymentConfirmationValue(before, body, "applicant_user_id", "applicantUserId"),
			effectivePaymentConfirmationValue(before, body, "created_by", "createdBy"),
		)
	case "finance_expense":
		return uniqueCleanStrings(
			effectivePaymentConfirmationValue(before, body, "handler_user_id", "handlerUserId"),
			effectivePaymentConfirmationValue(before, body, "created_by", "createdBy"),
		)
	default:
		return nil
	}
}

func effectivePaymentConfirmationValue(before map[string]any, body jsonBody, keys ...string) string {
	for _, key := range keys {
		if !bodyHas(body, key) {
			continue
		}
		if value := cleanStringValue(bodyValue(body, key)); value != "" {
			return value
		}
	}
	if before != nil {
		for _, key := range keys {
			if value := cleanStringValue(before[key]); value != "" {
				return value
			}
		}
	}
	return ""
}

func paymentConfirmationDutySeparationForbidden() error {
	return httperror.New(http.StatusForbidden, "payment_confirmation_duty_separation_required", "payment confirmation requires a non-maker operator")
}
