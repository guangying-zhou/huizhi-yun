package finance

import (
	"context"
	"database/sql"
	"encoding/json"
	"net/http"
	"strings"

	"github.com/huizhi-yun/data-runtime/internal/httperror"
)

func (a *Adapter) CreateInvoiceRequest(ctx context.Context, body jsonBody) (DataResult[map[string]any], error) {
	sourceApp := firstNonEmpty(cleanStringValue(bodyValue(body, "sourceApp", "source_app")), "finance")
	sourceBizType := cleanStringValue(bodyValue(body, "sourceBizType", "source_biz_type"))
	sourceBizCode := cleanStringValue(bodyValue(body, "sourceBizCode", "source_biz_code"))

	if sourceBizType != "" && sourceBizCode != "" {
		existing, err := queryOneMap(ctx, a.db, `
			SELECT *
			FROM invoice_request
			WHERE source_app = ?
			  AND source_biz_type = ?
			  AND source_biz_code = ?
			  AND deleted_at IS NULL
			ORDER BY id DESC
			LIMIT 1
		`, sourceApp, sourceBizType, sourceBizCode)
		if err != nil {
			return DataResult[map[string]any]{}, err
		}
		if existing != nil {
			existing["idempotent"] = true
			return resultData(existing), nil
		}
		body["sourceApp"] = sourceApp
	}

	result, err := a.createBySpec(ctx, createSpecs["/v1/finance/invoice-requests"], body)
	if err != nil {
		return result, err
	}
	if result.Data != nil {
		result.Data["idempotent"] = false
	}
	return result, nil
}

func (a *Adapter) IssueInvoiceRequest(ctx context.Context, code string, body jsonBody) (DataResult[map[string]any], error) {
	if err := requireCodePath(code); err != nil {
		return DataResult[map[string]any]{}, err
	}

	tx, err := a.db.BeginTx(ctx, nil)
	if err != nil {
		return DataResult[map[string]any]{}, err
	}
	defer tx.Rollback()

	request, err := queryOneMap(ctx, tx, `
		SELECT *
		FROM invoice_request
		WHERE code = ?
		  AND deleted_at IS NULL
		LIMIT 1
		FOR UPDATE
	`, code)
	if err != nil {
		return DataResult[map[string]any]{}, err
	}
	if request == nil {
		return DataResult[map[string]any]{}, notFound("invoice request not found")
	}

	status := cleanStringValue(request["status"])
	if status == "canceled" || status == "rejected" {
		return DataResult[map[string]any]{}, httperror.New(http.StatusConflict, "invalid_status", "canceled or rejected invoice request cannot be issued")
	}
	if status == "issued" {
		return a.issuedInvoiceRequestResult(ctx, tx, request, true)
	}

	invoiceNo, err := requiredStringValue(bodyValue(body, "invoiceNo", "invoice_no"), "invoiceNo")
	if err != nil {
		return DataResult[map[string]any]{}, err
	}
	invoiceAmount, err := moneyStringValue(firstBodyValue(body, request["requested_amount"], "invoiceAmount", "invoice_amount", "approvedAmount", "approved_amount"), "invoiceAmount", true, true)
	if err != nil {
		return DataResult[map[string]any]{}, err
	}
	invoiceDate, err := optionalDateValue(firstBodyValue(body, todayDate(), "invoiceDate", "invoice_date"))
	if err != nil {
		return DataResult[map[string]any]{}, err
	}
	invoiceMedium := firstNonEmpty(cleanStringValue(bodyValue(body, "invoiceMedium", "invoice_medium")), cleanStringValue(request["invoice_medium"]), "electronic")
	if _, err := allowedString(invoiceMedium, "invoiceMedium", []string{"electronic", "paper"}); err != nil {
		return DataResult[map[string]any]{}, err
	}
	invoiceFileURL := cleanStringValue(bodyValue(body, "invoiceFileUrl", "invoice_file_url"))
	if invoiceFileURL == "" {
		return DataResult[map[string]any]{}, httperror.New(http.StatusBadRequest, "field_required", "invoiceFileUrl is required")
	}

	operator := cleanStringValue(bodyValue(body, "issuedBy", "issued_by", "updatedBy", "updated_by", "current_user"))
	billingInfo := decodeJSONMap(request["billing_info_json"])
	sourceRefs, _ := json.Marshal(map[string]any{
		"source":               "invoice_request_issue",
		"invoice_request_id":   request["id"],
		"invoice_request_code": request["code"],
		"source_app":           request["source_app"],
		"source_biz_type":      request["source_biz_type"],
		"source_biz_code":      request["source_biz_code"],
	})

	result, err := tx.ExecContext(ctx, `
		INSERT INTO finance_invoice (
		  code, invoice_no, invoice_request_id, customer_code, customer_name,
		  contract_code, receivable_plan_code, invoice_type, invoice_medium,
		  invoice_item, invoice_amount, tax_rate, tax_amount, invoice_date,
		  status, taxpayer_name, taxpayer_no, receiver_name,
		  invoice_file_url, invoice_file_name, invoice_file_mime_type, invoice_file_size,
		  source_refs_json, remark, created_by, updated_by
		) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'issued', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
	`, generateFinanceCode("INV"),
		invoiceNo,
		request["id"],
		firstBodyValue(body, request["customer_code"], "customerCode", "customer_code"),
		firstBodyValue(body, request["customer_name"], "customerName", "customer_name"),
		firstBodyValue(body, request["contract_code"], "contractCode", "contract_code"),
		firstBodyValue(body, request["receivable_plan_code"], "receivablePlanCode", "receivable_plan_code"),
		firstBodyValue(body, request["invoice_type"], "invoiceType", "invoice_type"),
		invoiceMedium,
		firstBodyValue(body, request["invoice_item"], "invoiceItem", "invoice_item"),
		invoiceAmount,
		firstBodyValue(body, request["tax_rate"], "taxRate", "tax_rate"),
		bodyValue(body, "taxAmount", "tax_amount"),
		invoiceDate,
		firstBodyValue(body, request["taxpayer_name"], "taxpayerName", "taxpayer_name"),
		firstBodyValue(body, request["taxpayer_no"], "taxpayerNo", "taxpayer_no"),
		firstNonEmpty(cleanStringValue(bodyValue(body, "receiverName", "receiver_name")), cleanStringValue(billingInfo["receiver_name"])),
		invoiceFileURL,
		nilString(bodyValue(body, "invoiceFileName", "invoice_file_name")),
		nilString(bodyValue(body, "invoiceFileMimeType", "invoice_file_mime_type")),
		bodyValue(body, "invoiceFileSize", "invoice_file_size"),
		string(sourceRefs),
		firstBodyValue(body, request["remark"], "remark"),
		nullableStringArg(operator),
		nullableStringArg(operator),
	)
	if err != nil {
		return DataResult[map[string]any]{}, err
	}
	invoiceID, err := insertID(result)
	if err != nil {
		return DataResult[map[string]any]{}, err
	}
	if _, err := tx.ExecContext(ctx, `
		UPDATE invoice_request
		SET issued_invoice_id = ?,
		    status = 'issued',
		    updated_by = COALESCE(?, updated_by),
		    updated_at = CURRENT_TIMESTAMP
		WHERE id = ?
	`, invoiceID, nullableStringArg(operator), request["id"]); err != nil {
		return DataResult[map[string]any]{}, err
	}
	if err := a.recalculateContractSummary(ctx, tx, request["contract_code"]); err != nil {
		return DataResult[map[string]any]{}, err
	}
	if err := insertFinanceAuditLog(ctx, tx, "invoice_request", request["id"], code, "issue", request, map[string]any{
		"issued_invoice_id": invoiceID,
		"invoice_no":        invoiceNo,
		"invoice_amount":    invoiceAmount,
		"invoice_date":      invoiceDate,
		"invoice_medium":    invoiceMedium,
		"invoice_file_url":  invoiceFileURL,
	}, operator); err != nil {
		return DataResult[map[string]any]{}, err
	}

	resultData, err := a.issuedInvoiceRequestResult(ctx, tx, request, false)
	if err != nil {
		return DataResult[map[string]any]{}, err
	}
	if err := tx.Commit(); err != nil {
		return DataResult[map[string]any]{}, err
	}
	return resultData, nil
}

func (a *Adapter) issuedInvoiceRequestResult(ctx context.Context, tx *sql.Tx, request map[string]any, idempotent bool) (DataResult[map[string]any], error) {
	updated, err := queryOneMap(ctx, tx, "SELECT * FROM invoice_request WHERE id = ? LIMIT 1", request["id"])
	if err != nil {
		return DataResult[map[string]any]{}, err
	}
	var invoice map[string]any
	if issuedInvoiceID := valueFrom(updated, "issued_invoice_id"); issuedInvoiceID != nil {
		invoice, err = queryOneMap(ctx, tx, "SELECT * FROM finance_invoice WHERE id = ? AND deleted_at IS NULL LIMIT 1", issuedInvoiceID)
		if err != nil {
			return DataResult[map[string]any]{}, err
		}
	}
	return resultData(map[string]any{
		"invoiceRequest": updated,
		"invoice":        invoice,
		"idempotent":     idempotent,
	}), nil
}

func firstBodyValue(body jsonBody, fallback any, keys ...string) any {
	for _, key := range keys {
		if value, ok := body[key]; ok {
			return value
		}
	}
	return fallback
}

func decodeJSONMap(value any) map[string]any {
	var text string
	if bytes, ok := value.([]byte); ok {
		text = strings.TrimSpace(string(bytes))
	} else {
		text = cleanStringValue(value)
	}
	if text == "" {
		return map[string]any{}
	}
	var decoded map[string]any
	if err := json.Unmarshal([]byte(text), &decoded); err != nil {
		return map[string]any{}
	}
	return decoded
}

func insertFinanceAuditLog(ctx context.Context, tx *sql.Tx, entityType string, entityID any, entityCode string, action string, oldValue any, newValue any, operator string) error {
	oldJSON, _ := json.Marshal(oldValue)
	newJSON, _ := json.Marshal(newValue)
	_, err := tx.ExecContext(ctx, `
		INSERT INTO finance_audit_log (
		  entity_type, entity_id, entity_code, action, old_value, new_value, operator_id, source_app
		) VALUES (?, ?, ?, ?, ?, ?, ?, 'finance')
	`, entityType, entityID, entityCode, action, string(oldJSON), string(newJSON), nullableStringArg(strings.TrimSpace(operator)))
	return err
}
