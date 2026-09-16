package finance

import (
	"testing"
)

// 走查 ISSUE-B-004：职责分离检查此前把 paymentConfirmedBy / paidBy / confirmedBy
// 排在受信 operator_uid 之前当作 actor。这三个键都不是业务表的列，伪造后既不落库
// 也不报错，唯一作用就是让「制单人 ≠ 付款人」检查取到假 actor 并放行。
//
// 下面的用例全部是「制单人本人试图确认自己的单据」，必须一律 403。

func TestPaymentConfirmationIgnoresForgedActorKeysOnCreate(t *testing.T) {
	for _, forged := range []string{
		"paymentConfirmedBy", "payment_confirmed_by",
		"paidBy", "paid_by",
		"confirmedBy", "confirmed_by",
		"updatedBy", "updated_by",
	} {
		t.Run(forged, func(t *testing.T) {
			body := jsonBody{
				"current_user":      "u1",
				"operator_uid":      "u1",
				"applicant_user_id": "u1",
				"created_by":        "u1",
				"status":            "paid",
				forged:              "u2", // 伪造成他人
			}

			err := requirePaymentConfirmationCreateDutySeparation("payment_request", body)

			assertPaymentConfirmationDutySeparationForbidden(t, err)
		})
	}
}

func TestPaymentConfirmationIgnoresForgedActorKeysOnUpdate(t *testing.T) {
	for _, forged := range []string{"paidBy", "paymentConfirmedBy", "confirmed_by"} {
		t.Run(forged, func(t *testing.T) {
			before := map[string]any{
				"status":            "approved",
				"applicant_user_id": "u1",
				"created_by":        "u1",
			}
			body := jsonBody{
				"current_user": "u1",
				"operator_uid": "u1",
				"status":       "paid",
				forged:         "u2",
			}

			err := requirePaymentConfirmationUpdateDutySeparation("payment_request", before, body)

			assertPaymentConfirmationDutySeparationForbidden(t, err)
		})
	}
}

// 更新既有单据时，制单人是既成事实，请求体不得覆盖它——否则伪造
// applicantUserId / createdBy 同样能让 maker 集合避开自己。
func TestPaymentConfirmationUpdateTrustsPersistedMakerOverBody(t *testing.T) {
	before := map[string]any{
		"status":            "approved",
		"applicant_user_id": "u1",
		"created_by":        "u1",
	}
	body := jsonBody{
		"current_user":      "u1",
		"operator_uid":      "u1",
		"status":            "paid",
		"applicant_user_id": "someone-else",
		"created_by":        "someone-else",
	}

	err := requirePaymentConfirmationUpdateDutySeparation("payment_request", before, body)

	assertPaymentConfirmationDutySeparationForbidden(t, err)
}

func TestExpenseLedgerConfirmationIgnoresForgedActorKeys(t *testing.T) {
	before := map[string]any{
		"status":          "pending_payment",
		"handler_user_id": "u1",
		"created_by":      "u1",
	}
	body := jsonBody{
		"current_user": "u1",
		"operator_uid": "u1",
		"status":       "confirmed",
		"paidBy":       "u2",
	}

	err := requirePaymentConfirmationUpdateDutySeparation("finance_expense", before, body)

	assertPaymentConfirmationDutySeparationForbidden(t, err)
}

// 真正的非制单人确认必须仍然放行，避免修复把合法流程一起挡掉。
func TestPaymentConfirmationStillAllowsGenuineNonMaker(t *testing.T) {
	before := map[string]any{
		"status":            "approved",
		"applicant_user_id": "u1",
		"created_by":        "u1",
	}
	body := jsonBody{
		"current_user": "u2",
		"operator_uid": "u2",
		"status":       "paid",
	}

	if err := requirePaymentConfirmationUpdateDutySeparation("payment_request", before, body); err != nil {
		t.Fatalf("genuine non-maker confirmation must stay allowed, got %v", err)
	}
}
