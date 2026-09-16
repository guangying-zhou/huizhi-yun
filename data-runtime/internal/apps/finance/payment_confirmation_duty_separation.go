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
		// 无用户 actor 只可能是 service 调用：此时授权由入站 capability 与
		// allowedApps 承担，职责分离不适用（见
		// TestPaymentConfirmationCreateKeepsServiceBackfillCapabilityDriven）。
		// 用户态请求一定带 BFF 注入的 current_user/operator_uid，不会走到这里。
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
		// 理由同 create 路径：service 调用按 capability 授权。
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

// paymentConfirmationActorUID 只接受 BFF 由已验证会话注入的受信身份。
//
// 走查 ISSUE-B-004：此前 paymentConfirmedBy / paidBy / confirmedBy 三个
// 客户端可控键排在受信 operator_uid 之前，而它们都不是业务表的列——伪造后
// 既不落库也不报错，唯一作用就是让「制单人 ≠ 付款人」检查取到假 actor 并放行。
// updatedBy 同理由客户端可控，也不能作为职责分离的判定依据。
func paymentConfirmationActorUID(body jsonBody) string {
	return firstNonEmpty(
		cleanStringValue(bodyValue(body, "operator_uid", "operatorUid")),
		cleanStringValue(bodyValue(body, "current_user", "currentUser")),
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

// effectivePaymentConfirmationValue 解析制单人身份。
//
// 已落库记录优先于请求体：更新既有单据时，制单人是既成事实，若让请求体覆盖，
// 调用方只要传一个假的 applicantUserId / createdBy 就能让 maker 集合避开自己，
// 职责分离同样被绕过（走查 ISSUE-B-004）。请求体只在创建路径（before 为 nil）
// 生效，此时记录尚不存在，制单人本就由本次请求确定。
func effectivePaymentConfirmationValue(before map[string]any, body jsonBody, keys ...string) string {
	if before != nil {
		for _, key := range keys {
			if value := cleanStringValue(before[key]); value != "" {
				return value
			}
		}
		return ""
	}
	for _, key := range keys {
		if !bodyHas(body, key) {
			continue
		}
		if value := cleanStringValue(bodyValue(body, key)); value != "" {
			return value
		}
	}
	return ""
}

func paymentConfirmationDutySeparationForbidden() error {
	return httperror.New(http.StatusForbidden, "payment_confirmation_duty_separation_required", "payment confirmation requires a non-maker operator")
}
