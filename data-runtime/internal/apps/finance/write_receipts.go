package finance

import (
	"context"
	"net/http"

	"github.com/huizhi-yun/data-runtime/internal/httperror"
)

func (a *Adapter) ClassifyReceipt(ctx context.Context, code string, body jsonBody) (DataResult[map[string]any], error) {
	if err := requireCodePath(code); err != nil {
		return DataResult[map[string]any]{}, err
	}
	resolutionStatus, err := allowedString(firstNonEmpty(cleanStringValue(bodyValue(body, "resolutionStatus", "resolution_status")), "classified"), "resolutionStatus", []string{"pending", "linked_to_contract", "classified", "ignored"})
	if err != nil {
		return DataResult[map[string]any]{}, err
	}
	incomeTypeID, err := numberOrNil(bodyValue(body, "incomeTypeId", "income_type_id"), "incomeTypeId")
	if err != nil {
		return DataResult[map[string]any]{}, err
	}
	subjectID, err := numberOrNil(bodyValue(body, "subjectId", "subject_id"), "subjectId")
	if err != nil {
		return DataResult[map[string]any]{}, err
	}
	sourceRefs, err := jsonOrNil(bodyValue(body, "sourceRefs", "source_refs_json"))
	if err != nil {
		return DataResult[map[string]any]{}, err
	}

	tx, err := a.db.BeginTx(ctx, nil)
	if err != nil {
		return DataResult[map[string]any]{}, err
	}
	defer tx.Rollback()

	receipt, err := queryOneMap(ctx, tx, "SELECT * FROM finance_receipt WHERE code = ? AND deleted_at IS NULL FOR UPDATE", code)
	if err != nil {
		return DataResult[map[string]any]{}, err
	}
	if receipt == nil {
		return DataResult[map[string]any]{}, notFound("receipt not found")
	}
	contractCode := cleanStringValue(bodyValue(body, "contractCode", "contract_code"))
	projectCode := cleanStringValue(bodyValue(body, "projectCode", "project_code"))

	if _, err := tx.ExecContext(ctx, `
		UPDATE finance_receipt
		SET contract_code = COALESCE(?, contract_code),
		    project_code = COALESCE(?, project_code),
		    receivable_plan_code = COALESCE(?, receivable_plan_code),
		    income_type_id = COALESCE(?, income_type_id),
		    source_refs_json = COALESCE(?, source_refs_json),
		    note = COALESCE(?, note),
		    updated_by = COALESCE(?, updated_by),
		    updated_at = CURRENT_TIMESTAMP
		WHERE id = ?
	`, nilString(contractCode), nilString(projectCode), nilString(bodyValue(body, "receivablePlanCode", "receivable_plan_code")), incomeTypeID, sourceRefs, nilString(bodyValue(body, "note")), nilString(bodyValue(body, "updatedBy", "updated_by")), receipt["id"]); err != nil {
		return DataResult[map[string]any]{}, err
	}

	if cleanStringValue(resolutionStatus) != "linked_to_contract" {
		existing, err := queryOneMap(ctx, tx, "SELECT id FROM finance_unclassified_income WHERE linked_receipt_id = ? LIMIT 1", receipt["id"])
		if err != nil {
			return DataResult[map[string]any]{}, err
		}
		if existing != nil {
			if _, err := tx.ExecContext(ctx, `
				UPDATE finance_unclassified_income
				SET project_code = COALESCE(?, project_code),
				    income_type_id = COALESCE(?, income_type_id),
				    resolution_status = ?,
				    classified_subject_id = COALESCE(?, classified_subject_id),
				    source_refs_json = COALESCE(?, source_refs_json),
				    updated_by = COALESCE(?, updated_by),
				    updated_at = CURRENT_TIMESTAMP
				WHERE id = ?
			`, firstNonEmpty(projectCode, cleanStringValue(receipt["project_code"])), firstNonEmpty(cleanStringValue(incomeTypeID), cleanStringValue(receipt["income_type_id"])), resolutionStatus, subjectID, sourceRefs, nilString(bodyValue(body, "updatedBy", "updated_by")), existing["id"]); err != nil {
				return DataResult[map[string]any]{}, err
			}
		} else {
			if _, err := tx.ExecContext(ctx, `
				INSERT INTO finance_unclassified_income (
				  code, project_code, bank_account_id, income_type_id, received_at, amount,
				  channel, payer_name, handler_user_id, description, resolution_status,
				  linked_receipt_id, classified_subject_id, source_refs_json, created_by, updated_by
				) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
			`, generateFinanceCode("UCI"), firstNonEmpty(projectCode, cleanStringValue(receipt["project_code"])), receipt["bank_account_id"], firstNonEmpty(cleanStringValue(incomeTypeID), cleanStringValue(receipt["income_type_id"])), receipt["received_at"], receipt["received_amount"], receipt["channel"], receipt["payer_name"], receipt["handler_user_id"], firstNonEmpty(cleanStringValue(bodyValue(body, "description")), cleanStringValue(receipt["customer_name"]), cleanStringValue(receipt["payer_name"])), resolutionStatus, receipt["id"], subjectID, sourceRefs, nilString(bodyValue(body, "createdBy", "created_by")), nilString(bodyValue(body, "updatedBy", "updated_by"))); err != nil {
				return DataResult[map[string]any]{}, err
			}
		}
	}

	if err := a.recalculateContractSummary(ctx, tx, receipt["contract_code"]); err != nil {
		return DataResult[map[string]any]{}, err
	}
	if err := a.recalculateContractSummary(ctx, tx, contractCode); err != nil {
		return DataResult[map[string]any]{}, err
	}
	row, err := queryOneMap(ctx, tx, "SELECT * FROM finance_receipt WHERE code = ? AND deleted_at IS NULL", code)
	if err != nil {
		return DataResult[map[string]any]{}, err
	}
	if err := tx.Commit(); err != nil {
		return DataResult[map[string]any]{}, err
	}
	return resultData(row), nil
}

func unsupportedReceiptCommand() error {
	return httperror.New(http.StatusNotImplemented, "unsupported_command", "receipt command is not supported")
}
