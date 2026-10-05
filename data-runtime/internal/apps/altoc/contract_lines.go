package altoc

import (
	"context"
	"database/sql"
	"encoding/json"
	"fmt"
	"math"
	"net/http"
	"sort"
	"strings"

	"github.com/huizhi-yun/data-runtime/internal/httperror"
)

const contractLineAmountEpsilon = 0.01

func (a *Adapter) createContractDraft(ctx context.Context, body map[string]any) (map[string]any, error) {
	if err := altocRequireActionScope(body, "contract", "create"); err != nil {
		return nil, err
	}
	if strings.TrimSpace(firstBodyText(body, "name")) == "" {
		return nil, httperror.New(http.StatusBadRequest, "missing_contract_name", "contract name is required")
	}
	if altocPositiveID(bodyValueAny(body, "customer_id", "customerId")) <= 0 {
		return nil, httperror.New(http.StatusBadRequest, "missing_contract_customer", "contract customer is required")
	}
	lines := contractLineBodies(body)
	if len(lines) == 0 {
		return nil, httperror.New(http.StatusBadRequest, "missing_contract_lines", "at least one contract line is required")
	}

	tx, err := a.DB().BeginTx(ctx, nil)
	if err != nil {
		return nil, err
	}
	defer tx.Rollback()

	operator := altocActor(body)
	code, err := nextAltocCode(ctx, tx, "CT", "contract")
	if err != nil {
		return nil, err
	}
	if err := validateContractParentReferenceTx(ctx, tx, 0, body, nil); err != nil {
		return nil, err
	}
	fields := contractDraftFields(body, code, operator)
	contractID, err := altocInsertRecordTx(ctx, tx, "contract", fields)
	if err != nil {
		return nil, err
	}

	contract, err := a.lockContractTx(ctx, tx, contractID)
	if err != nil {
		return nil, err
	}
	if err := a.upsertPrimaryContractPartyTx(ctx, tx, contract, body, operator); err != nil {
		return nil, err
	}

	for index, lineBody := range lines {
		if _, err := a.insertContractLineTx(ctx, tx, contract, lineBody, index+1, operator, "manual"); err != nil {
			return nil, err
		}
	}
	if err := a.recalculateContractLineTotalsTx(ctx, tx, contractID, operator); err != nil {
		return nil, err
	}
	if err := insertAltocAuditTx(ctx, tx, "contract", contractID, "create", nil, map[string]any{
		"code":      code,
		"p0a_lines": len(lines),
	}, operator); err != nil {
		return nil, err
	}
	if err := tx.Commit(); err != nil {
		return nil, err
	}
	created, err := a.getContract(ctx, fmt.Sprint(contractID))
	if err != nil {
		return nil, err
	}
	return map[string]any{"contract": created, "id": contractID, "code": code}, nil
}

func (a *Adapter) createContractFromQuotation(ctx context.Context, body map[string]any) (map[string]any, error) {
	if err := altocRequireActionScope(body, "contract", "create"); err != nil {
		return nil, err
	}
	quotationID, err := altocIdentifierID(firstBodyText(body, "quotation_id", "quotationId", "id"), "quotation_id")
	if err != nil {
		return nil, err
	}

	tx, err := a.DB().BeginTx(ctx, nil)
	if err != nil {
		return nil, err
	}
	defer tx.Rollback()

	quotation, err := a.lockQuotationTx(ctx, tx, quotationID)
	if err != nil {
		return nil, err
	}
	if quotation == nil {
		return nil, httperror.New(http.StatusNotFound, "record_not_found", "quotation not found")
	}
	if err := altocRequireRecordWrite(body, "quotation", quotation, "owner_user_id", "owner_dept_code"); err != nil {
		return nil, err
	}
	if err := ensureQuotationConvertible(quotation); err != nil {
		return nil, err
	}
	items, err := quotationLineItemsTx(ctx, tx, quotationID)
	if err != nil {
		return nil, err
	}
	if len(items) == 0 {
		return nil, httperror.New(http.StatusBadRequest, "quotation_has_no_items", "quotation has no items to convert")
	}

	operator := altocActor(body)
	code, err := nextAltocCode(ctx, tx, "CT", "contract")
	if err != nil {
		return nil, err
	}
	contractBody := contractBodyFromQuotation(body, quotation, code)
	if err := validateContractParentReferenceTx(ctx, tx, 0, contractBody, nil); err != nil {
		return nil, err
	}
	fields := contractDraftFields(contractBody, code, operator)
	contractID, err := altocInsertRecordTx(ctx, tx, "contract", fields)
	if err != nil {
		return nil, err
	}
	contract, err := a.lockContractTx(ctx, tx, contractID)
	if err != nil {
		return nil, err
	}
	if err := a.upsertPrimaryContractPartyTx(ctx, tx, contract, body, operator); err != nil {
		return nil, err
	}

	lineTypes := make([]string, 0, len(items))
	for index, item := range items {
		lineBody := contractLineBodyFromQuotationItem(item, quotation)
		lineTypes = append(lineTypes, firstBodyText(lineBody, "line_type"))
		if _, err := a.insertContractLineTx(ctx, tx, contract, lineBody, index+1, operator, "quotation"); err != nil {
			return nil, err
		}
	}
	primaryType := inferContractPrimaryType(lineTypes)
	if _, err := tx.ExecContext(ctx, `
		UPDATE contract
		SET primary_type = ?,
		    updated_by = ?,
		    updated_at = CURRENT_TIMESTAMP
		WHERE id = ?
	`, primaryType, operator, contractID); err != nil {
		return nil, err
	}
	if err := a.recalculateContractLineTotalsTx(ctx, tx, contractID, operator); err != nil {
		return nil, err
	}
	if err := insertAltocAuditTx(ctx, tx, "contract", contractID, "create_from_quotation", nil, map[string]any{
		"quotation_id":   quotationID,
		"quotation_code": quotation["code"],
		"line_count":     len(items),
	}, operator); err != nil {
		return nil, err
	}
	if err := tx.Commit(); err != nil {
		return nil, err
	}

	created, err := a.getContract(ctx, fmt.Sprint(contractID))
	if err != nil {
		return nil, err
	}
	return map[string]any{"contract": created, "id": contractID, "code": code}, nil
}

func (a *Adapter) updateContractDraft(ctx context.Context, identifier string, body map[string]any) (map[string]any, error) {
	contractID, err := altocIdentifierID(identifier, "contract_id")
	if err != nil {
		return nil, err
	}
	if err := altocRequireActionScope(body, "contract", "edit"); err != nil {
		return nil, err
	}

	tx, err := a.DB().BeginTx(ctx, nil)
	if err != nil {
		return nil, err
	}
	defer tx.Rollback()

	contract, err := a.lockContractTx(ctx, tx, contractID)
	if err != nil {
		return nil, err
	}
	if contract == nil {
		return nil, httperror.New(http.StatusNotFound, "record_not_found", "contract not found")
	}
	if err := altocRequireRecordWrite(body, "contract", contract, "owner_user_id", "owner_dept_code"); err != nil {
		return nil, err
	}
	contractColumns, err := altocTableColumns(ctx, tx, "contract")
	if err != nil {
		return nil, err
	}
	allowed := []string{
		"name", "contract_no", "customer_id", "contact_id", "parent_contract_id", "opportunity_id", "quotation_id",
		"direction", "primary_type", "agreement_form", "template_code", "source_type", "source_code",
		"sign_date", "effective_date", "end_date", "amount_tax_inclusive", "amount_tax_exclusive",
		"gross_margin_rate", "currency_code", "tax_rate", "payment_term_summary", "retention_rate",
		"owner_user_id", "owner_dept_code", "remark", "service_period_months", "contract_period_months",
	}
	if contractColumns["is_master_contract"] {
		allowed = append(allowed, "is_master_contract")
	}
	allowed = existingContractColumns(allowed, contractColumns)
	if err := validateContractParentReferenceTx(ctx, tx, contractID, body, contractColumns); err != nil {
		return nil, err
	}
	if value, ok := contractMasterFlagUpdate(body); ok {
		body["is_master_contract"] = value
	}
	if err := validateContractMasterFlagUpdateTx(ctx, tx, contractID, contract, body, contractColumns); err != nil {
		return nil, err
	}
	set, args := updateSetFromBody(body, allowed)
	operator := altocActor(body)
	if operator != "" {
		set = append(set, "updated_by = ?")
		args = append(args, operator)
	}
	if len(set) > 0 {
		args = append(args, contractID)
		if _, err := tx.ExecContext(ctx, "UPDATE contract SET "+strings.Join(set, ", ")+", lock_version = lock_version + 1, updated_at = CURRENT_TIMESTAMP WHERE id = ?", args...); err != nil {
			return nil, err
		}
	}
	updatedContract, err := a.lockContractTx(ctx, tx, contractID)
	if err != nil {
		return nil, err
	}
	if err := a.upsertPrimaryContractPartyTx(ctx, tx, updatedContract, body, operator); err != nil {
		return nil, err
	}
	if err := insertAltocAuditTx(ctx, tx, "contract", contractID, "update", map[string]any{
		"lock_version": contract["lock_version"],
	}, map[string]any{
		"changed_fields": changedFieldNames(body, allowed),
	}, operator); err != nil {
		return nil, err
	}
	if err := tx.Commit(); err != nil {
		return nil, err
	}
	updated, err := a.getContract(ctx, fmt.Sprint(contractID))
	if err != nil {
		return nil, err
	}
	return map[string]any{"contract": updated}, nil
}

func (a *Adapter) validateContractDraft(ctx context.Context, identifier string, body map[string]any) (map[string]any, error) {
	contractID, err := altocIdentifierID(identifier, "contract_id")
	if err != nil {
		return nil, err
	}
	where, args := altocIdentityWhere("ct", fmt.Sprint(contractID))
	filters := []string{where, "ct.deleted_at IS NULL"}
	scopeWhere, scopeArgs, err := altocReadScopeWhereFromBody(body, "contract", "ct", "owner_user_id", "owner_dept_code")
	if err != nil {
		return nil, err
	}
	filters = append(filters, scopeWhere...)
	args = append(args, scopeArgs...)
	contract, err := a.getContractWithFilters(ctx, filters, args)
	if err != nil {
		return nil, err
	}
	issues := contractDraftValidationIssues(contract)
	return map[string]any{
		"valid":   len(issues) == 0,
		"issues":  issues,
		"summary": contract["line_summary"],
	}, nil
}

func (a *Adapter) createContractLine(ctx context.Context, rawContractID string, body map[string]any) (map[string]any, error) {
	contractID, err := altocIdentifierID(rawContractID, "contract_id")
	if err != nil {
		return nil, err
	}
	if err := altocRequireActionScope(body, "contract", "edit"); err != nil {
		return nil, err
	}

	tx, err := a.DB().BeginTx(ctx, nil)
	if err != nil {
		return nil, err
	}
	defer tx.Rollback()

	contract, err := a.lockContractTx(ctx, tx, contractID)
	if err != nil {
		return nil, err
	}
	if contract == nil {
		return nil, httperror.New(http.StatusNotFound, "record_not_found", "contract not found")
	}
	if err := ensureContractDraftEditable(contract); err != nil {
		return nil, err
	}
	if err := altocRequireRecordWrite(body, "contract", contract, "owner_user_id", "owner_dept_code"); err != nil {
		return nil, err
	}

	operator := altocActor(body)
	lineNo, err := a.nextContractLineNoTx(ctx, tx, contractID)
	if err != nil {
		return nil, err
	}
	lineID, err := a.insertContractLineTx(ctx, tx, contract, body, lineNo, operator, "manual")
	if err != nil {
		return nil, err
	}
	if err := a.recalculateContractLineTotalsTx(ctx, tx, contractID, operator); err != nil {
		return nil, err
	}
	if err := insertAltocAuditTx(ctx, tx, "contract_line", lineID, "create", nil, map[string]any{
		"contract_id": contractID,
	}, operator); err != nil {
		return nil, err
	}
	if err := tx.Commit(); err != nil {
		return nil, err
	}
	updated, err := a.getContract(ctx, fmt.Sprint(contractID))
	if err != nil {
		return nil, err
	}
	return map[string]any{"contract": updated, "lineId": lineID}, nil
}

func (a *Adapter) updateContractLine(ctx context.Context, rawContractID string, rawLineID string, body map[string]any) (map[string]any, error) {
	contractID, err := altocIdentifierID(rawContractID, "contract_id")
	if err != nil {
		return nil, err
	}
	lineID, err := altocIdentifierID(rawLineID, "contract_line_id")
	if err != nil {
		return nil, err
	}
	if err := altocRequireActionScope(body, "contract", "edit"); err != nil {
		return nil, err
	}

	tx, err := a.DB().BeginTx(ctx, nil)
	if err != nil {
		return nil, err
	}
	defer tx.Rollback()

	contract, line, err := a.lockContractAndLineTx(ctx, tx, contractID, lineID)
	if err != nil {
		return nil, err
	}
	if contract == nil || line == nil {
		return nil, httperror.New(http.StatusNotFound, "record_not_found", "contract line not found")
	}
	if err := ensureContractDraftEditable(contract); err != nil {
		return nil, err
	}
	if err := altocRequireRecordWrite(body, "contract", contract, "owner_user_id", "owner_dept_code"); err != nil {
		return nil, err
	}

	mergedBody := mergeContractLineBody(line, body)
	fields, err := contractLineFields(mergedBody, contract, altocPositiveID(line["line_no"]), altocActor(body), "manual")
	if err != nil {
		return nil, err
	}
	delete(fields, "code")
	delete(fields, "contract_id")
	delete(fields, "line_no")
	delete(fields, "created_by")
	set := make([]string, 0, len(fields)+1)
	args := make([]any, 0, len(fields)+2)
	for _, name := range sortedFieldNames(fields) {
		set = append(set, altocQuoteID(name)+" = ?")
		args = append(args, altocNormalizeInsertValue(fields[name]))
	}
	if len(set) == 0 {
		return a.getContract(ctx, fmt.Sprint(contractID))
	}
	args = append(args, lineID)
	if _, err := tx.ExecContext(ctx, "UPDATE contract_line SET "+strings.Join(set, ", ")+", updated_at = CURRENT_TIMESTAMP WHERE id = ?", args...); err != nil {
		return nil, err
	}
	if err := a.recalculateContractLineTotalsTx(ctx, tx, contractID, altocActor(body)); err != nil {
		return nil, err
	}
	if err := insertAltocAuditTx(ctx, tx, "contract_line", lineID, "update", line, map[string]any{
		"changed_fields": changedFieldNames(body, contractLineWritableColumns()),
	}, altocActor(body)); err != nil {
		return nil, err
	}
	if err := tx.Commit(); err != nil {
		return nil, err
	}
	updated, err := a.getContract(ctx, fmt.Sprint(contractID))
	if err != nil {
		return nil, err
	}
	return map[string]any{"contract": updated, "lineId": lineID}, nil
}

func (a *Adapter) deleteContractLine(ctx context.Context, rawContractID string, rawLineID string, body map[string]any) (map[string]any, error) {
	contractID, err := altocIdentifierID(rawContractID, "contract_id")
	if err != nil {
		return nil, err
	}
	lineID, err := altocIdentifierID(rawLineID, "contract_line_id")
	if err != nil {
		return nil, err
	}
	if err := altocRequireActionScope(body, "contract", "edit"); err != nil {
		return nil, err
	}

	tx, err := a.DB().BeginTx(ctx, nil)
	if err != nil {
		return nil, err
	}
	defer tx.Rollback()

	contract, line, err := a.lockContractAndLineTx(ctx, tx, contractID, lineID)
	if err != nil {
		return nil, err
	}
	if contract == nil || line == nil {
		return nil, httperror.New(http.StatusNotFound, "record_not_found", "contract line not found")
	}
	if err := ensureContractDraftEditable(contract); err != nil {
		return nil, err
	}
	if err := altocRequireRecordWrite(body, "contract", contract, "owner_user_id", "owner_dept_code"); err != nil {
		return nil, err
	}

	operator := altocActor(body)
	if _, err := tx.ExecContext(ctx, `
		UPDATE contract_line
		SET deleted_at = CURRENT_TIMESTAMP,
		    updated_by = ?,
		    updated_at = CURRENT_TIMESTAMP
		WHERE id = ?
	`, operator, lineID); err != nil {
		return nil, err
	}
	if err := a.recalculateContractLineTotalsTx(ctx, tx, contractID, operator); err != nil {
		return nil, err
	}
	if err := insertAltocAuditTx(ctx, tx, "contract_line", lineID, "delete", line, map[string]any{
		"deleted": true,
	}, operator); err != nil {
		return nil, err
	}
	if err := tx.Commit(); err != nil {
		return nil, err
	}
	updated, err := a.getContract(ctx, fmt.Sprint(contractID))
	if err != nil {
		return nil, err
	}
	return map[string]any{"contract": updated, "lineId": lineID}, nil
}

func (a *Adapter) contractLines(ctx context.Context, conn altocQueryer, contractID any) ([]map[string]any, error) {
	rows, err := conn.QueryContext(ctx, `
		SELECT *
		FROM contract_line
		WHERE contract_id = ?
		  AND deleted_at IS NULL
		ORDER BY sort_no ASC, line_no ASC, id ASC
	`, contractID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	return altocRowsToMaps(rows)
}

func contractLineSummary(lines []map[string]any, contractAmount any) map[string]any {
	taxInclusive := 0.0
	taxExclusive := 0.0
	plannedCost := 0.0
	for _, line := range lines {
		taxInclusive += moneyValue(line["amount_tax_inclusive"])
		taxExclusive += moneyValue(line["amount_tax_exclusive"])
		plannedCost += moneyValue(line["planned_cost"])
	}
	contractAmountValue := moneyValue(contractAmount)
	return map[string]any{
		"line_count":              len(lines),
		"amount_tax_inclusive":    moneyText(taxInclusive),
		"amount_tax_exclusive":    moneyText(taxExclusive),
		"planned_cost":            moneyText(plannedCost),
		"amount_difference":       moneyText(contractAmountValue - taxInclusive),
		"amount_matches_contract": math.Abs(contractAmountValue-taxInclusive) <= contractLineAmountEpsilon,
	}
}

func (a *Adapter) insertContractLineTx(ctx context.Context, tx *sql.Tx, contract map[string]any, body map[string]any, lineNo int, operator string, source string) (int64, error) {
	fields, err := contractLineFields(body, contract, int64(lineNo), operator, source)
	if err != nil {
		return 0, err
	}
	code, err := nextAltocCode(ctx, tx, "CL", "contract_line")
	if err != nil {
		return 0, err
	}
	fields["code"] = code
	return altocInsertRecordTx(ctx, tx, "contract_line", fields)
}

func contractLineFields(body map[string]any, contract map[string]any, lineNo int64, operator string, source string) (map[string]any, error) {
	name := firstBodyText(body, "name", "item_name", "itemName")
	if name == "" {
		return nil, httperror.New(http.StatusBadRequest, "missing_contract_line_name", "contract line name is required")
	}
	taxRate := moneyValue(firstNonEmptyText(firstBodyText(body, "tax_rate", "taxRate"), fmt.Sprint(contract["tax_rate"])))
	if taxRate == 0 {
		taxRate = 6
	}
	quantity := moneyValue(firstNonEmptyText(firstBodyText(body, "quantity"), "1"))
	if quantity <= 0 {
		quantity = 1
	}
	unitPrice := moneyValue(bodyValueAny(body, "unit_price", "unitPrice"))
	amountInclusive := moneyValue(bodyValueAny(body, "amount_tax_inclusive", "amountTaxInclusive", "amount"))
	if amountInclusive == 0 && unitPrice > 0 {
		amountInclusive = quantity * unitPrice
	}
	amountExclusive := moneyValue(bodyValueAny(body, "amount_tax_exclusive", "amountTaxExclusive"))
	if amountExclusive == 0 && amountInclusive > 0 {
		amountExclusive = amountInclusive / (1 + taxRate/100)
	}
	if unitPrice == 0 && quantity > 0 && amountInclusive > 0 {
		unitPrice = amountInclusive / quantity
	}
	plannedCost := moneyValue(bodyValueAny(body, "planned_cost", "plannedCost", "cost_price", "costPrice"))
	plannedMargin := moneyValue(bodyValueAny(body, "planned_margin", "plannedMargin"))
	if plannedMargin == 0 && amountInclusive > 0 && plannedCost > 0 {
		plannedMargin = amountInclusive - plannedCost
	}

	lineType := normalizeContractLineType(firstNonEmptyText(
		firstBodyText(body, "line_type", "lineType"),
		inferContractLineType(firstBodyText(body, "product_type", "productType"), name),
	))
	fields := map[string]any{
		"contract_id":              contract["id"],
		"line_no":                  lineNo,
		"line_type":                lineType,
		"name":                     name,
		"description":              nullableText(firstBodyText(body, "description", "specification")),
		"catalog_item_id":          nullableBodyValue(bodyValueAny(body, "catalog_item_id", "catalogItemId", "product_id", "productId")),
		"catalog_item_code":        nullableText(firstBodyText(body, "catalog_item_code", "catalogItemCode")),
		"product_code":             nullableText(firstBodyText(body, "product_code", "productCode")),
		"product_version":          nullableText(firstBodyText(body, "product_version", "productVersion")),
		"product_origin":           firstNonEmptyText(firstBodyText(body, "product_origin", "productOrigin"), "own"),
		"supplier_code":            nullableText(firstBodyText(body, "supplier_code", "supplierCode")),
		"source_quotation_item_id": nullableBodyValue(bodyValueAny(body, "source_quotation_item_id", "sourceQuotationItemId")),
		"quantity":                 moneyText(quantity),
		"unit":                     nullableText(firstBodyText(body, "unit")),
		"unit_price":               nullableMoney(unitPrice),
		"amount_tax_exclusive":     nullableMoney(amountExclusive),
		"amount_tax_inclusive":     nullableMoney(amountInclusive),
		"tax_rate":                 moneyText(taxRate),
		"planned_cost":             nullableMoney(plannedCost),
		"planned_margin":           nullableMoney(plannedMargin),
		"currency_code":            firstNonEmptyText(firstBodyText(body, "currency_code", "currencyCode"), altocMapText(contract, "currency_code"), "CNY"),
		"billing_method":           firstNonEmptyText(firstBodyText(body, "billing_method", "billingMethod"), defaultBillingMethod(lineType)),
		"fulfillment_method":       firstNonEmptyText(firstBodyText(body, "fulfillment_method", "fulfillmentMethod"), defaultFulfillmentMethod(lineType)),
		"service_start_date":       altocDateText(firstBodyText(body, "service_start_date", "serviceStartDate")),
		"service_end_date":         altocDateText(firstBodyText(body, "service_end_date", "serviceEndDate")),
		"project_policy":           firstNonEmptyText(firstBodyText(body, "project_policy", "projectPolicy"), defaultProjectPolicy(lineType)),
		"project_template_code":    nullableText(firstBodyText(body, "project_template_code", "projectTemplateCode")),
		"asset_policy":             firstNonEmptyText(firstBodyText(body, "asset_policy", "assetPolicy"), defaultAssetPolicy(lineType)),
		"service_policy":           firstNonEmptyText(firstBodyText(body, "service_policy", "servicePolicy"), defaultServicePolicy(lineType)),
		"procurement_policy":       firstNonEmptyText(firstBodyText(body, "procurement_policy", "procurementPolicy"), defaultProcurementPolicy(lineType, body)),
		"acceptance_required":      boolInt(altocBool(firstNonEmptyText(firstBodyText(body, "acceptance_required", "acceptanceRequired"), fmt.Sprint(defaultAcceptanceRequired(lineType))))),
		"acceptance_criteria":      nullableText(firstBodyText(body, "acceptance_criteria", "acceptanceCriteria")),
		"status":                   firstNonEmptyText(firstBodyText(body, "status"), "active"),
		"sort_no":                  lineNo,
		"snapshot_json":            contractLineSnapshot(body, lineType, source),
		"created_by":               nullableText(operator),
		"updated_by":               nullableText(operator),
	}
	return fields, nil
}

func contractDraftFields(body map[string]any, code string, operator string) map[string]any {
	customerID := nullableBodyValue(bodyValueAny(body, "customer_id", "customerId"))
	parentContractID := nullableBodyValue(bodyValueAny(body, "parent_contract_id", "parentContractId"))
	direction := firstNonEmptyText(firstBodyText(body, "direction"), "sales")
	sourceType := firstNonEmptyText(firstBodyText(body, "source_type", "sourceType"), "manual")
	fields := map[string]any{
		"code":                   code,
		"contract_no":            nullableText(firstBodyText(body, "contract_no", "contractNo")),
		"name":                   firstBodyText(body, "name"),
		"customer_id":            customerID,
		"contact_id":             nullableBodyValue(bodyValueAny(body, "contact_id", "contactId")),
		"parent_contract_id":     parentContractID,
		"is_master_contract":     boolInt(altocPositiveID(parentContractID) <= 0),
		"opportunity_id":         nullableBodyValue(bodyValueAny(body, "opportunity_id", "opportunityId")),
		"quotation_id":           nullableBodyValue(bodyValueAny(body, "quotation_id", "quotationId")),
		"status":                 "draft",
		"direction":              direction,
		"primary_type":           firstNonEmptyText(firstBodyText(body, "primary_type", "primaryType"), "legacy_contract"),
		"agreement_form":         firstNonEmptyText(firstBodyText(body, "agreement_form", "agreementForm"), "standard_contract"),
		"template_code":          nullableText(firstBodyText(body, "template_code", "templateCode")),
		"source_type":            sourceType,
		"source_code":            nullableText(firstBodyText(body, "source_code", "sourceCode")),
		"sign_date":              altocDateText(firstBodyText(body, "sign_date", "signDate")),
		"effective_date":         altocDateText(firstBodyText(body, "effective_date", "effectiveDate")),
		"end_date":               altocDateText(firstBodyText(body, "end_date", "endDate")),
		"amount_tax_inclusive":   nullableBodyValue(bodyValueAny(body, "amount_tax_inclusive", "amountTaxInclusive")),
		"amount_tax_exclusive":   nullableBodyValue(bodyValueAny(body, "amount_tax_exclusive", "amountTaxExclusive")),
		"gross_margin_rate":      nullableBodyValue(bodyValueAny(body, "gross_margin_rate", "grossMarginRate")),
		"currency_code":          firstNonEmptyText(firstBodyText(body, "currency_code", "currencyCode"), "CNY"),
		"tax_rate":               firstNonEmptyText(firstBodyText(body, "tax_rate", "taxRate"), "6"),
		"invoice_type":           firstNonEmptyText(firstBodyText(body, "invoice_type", "invoiceType"), "special_vat"),
		"payment_term_summary":   nullableText(firstBodyText(body, "payment_term_summary", "paymentTermSummary")),
		"retention_rate":         nullableBodyValue(bodyValueAny(body, "retention_rate", "retentionRate")),
		"service_period_months":  nullableBodyValue(bodyValueAny(body, "service_period_months", "servicePeriodMonths")),
		"contract_period_months": nullableBodyValue(bodyValueAny(body, "contract_period_months", "contractPeriodMonths")),
		"owner_user_id":          firstNonEmptyText(firstBodyText(body, "owner_user_id", "ownerUserId"), operator),
		"owner_dept_code":        nullableText(firstBodyText(body, "owner_dept_code", "ownerDeptCode", "current_user_dept_code", "currentUserDeptCode")),
		"remark":                 nullableText(firstBodyText(body, "remark")),
		"created_by":             nullableText(operator),
		"updated_by":             nullableText(operator),
	}
	return fields
}

func derivedContractMasterFlag(body map[string]any) int {
	parentID := altocPositiveID(bodyValueAny(body, "parent_contract_id", "parentContractId"))
	return boolInt(parentID <= 0)
}

func contractMasterFlagUpdate(body map[string]any) (int, bool) {
	if value, ok := altocBodyValue(body, "is_master_contract"); ok {
		return boolInt(altocBool(value)), true
	}
	if _, ok := altocBodyValue(body, "parent_contract_id"); ok {
		return derivedContractMasterFlag(body), true
	}
	return 0, false
}

func validateContractParentReferenceTx(ctx context.Context, tx *sql.Tx, contractID int64, body map[string]any, columns map[string]bool) error {
	value, ok := altocBodyValue(body, "parent_contract_id")
	if !ok {
		return nil
	}
	parentID := altocPositiveID(value)
	if parentID <= 0 {
		return nil
	}
	if contractID > 0 && parentID == contractID {
		return httperror.New(http.StatusBadRequest, "invalid_parent_contract", "contract cannot reference itself as parent")
	}
	if columns == nil {
		var err error
		columns, err = altocTableColumns(ctx, tx, "contract")
		if err != nil {
			return err
		}
	}
	masterSelect := "1 AS is_master_contract"
	if columns["is_master_contract"] {
		masterSelect = "is_master_contract"
	}
	parent, err := altocQueryOneMap(ctx, tx, `
		SELECT id, parent_contract_id, `+masterSelect+`
		FROM contract
		WHERE id = ?
		  AND deleted_at IS NULL
		LIMIT 1
	`, parentID)
	if err != nil {
		return err
	}
	if parent == nil {
		return httperror.New(http.StatusBadRequest, "parent_contract_not_found", "parent contract not found")
	}
	parentIsMaster := altocBool(parent["is_master_contract"])
	if !columns["is_master_contract"] {
		parentIsMaster = altocPositiveID(parent["parent_contract_id"]) <= 0
	}
	if !parentIsMaster {
		return httperror.New(http.StatusBadRequest, "parent_contract_not_master", "selected parent contract is not marked as master")
	}
	if contractID > 0 {
		childCount, err := altocQueryOneMap(ctx, tx, `
			SELECT COUNT(*) AS count
			FROM contract
			WHERE parent_contract_id = ?
			  AND deleted_at IS NULL
		`, contractID)
		if err != nil {
			return err
		}
		if moneyValue(childCount["count"]) > 0 {
			return httperror.New(http.StatusConflict, "contract_has_child_contracts", "contract with child contracts cannot select another parent contract")
		}
	}
	if err := validateContractParentNoCycleTx(ctx, tx, contractID, parentID); err != nil {
		return err
	}
	return nil
}

func validateContractMasterFlagUpdateTx(ctx context.Context, tx *sql.Tx, contractID int64, contract map[string]any, body map[string]any, columns map[string]bool) error {
	if !columns["is_master_contract"] {
		return nil
	}
	value, ok := altocBodyValue(body, "is_master_contract")
	if !ok {
		return nil
	}
	isMaster := altocBool(value)
	parentID := altocPositiveID(contract["parent_contract_id"])
	if parentValue, ok := altocBodyValue(body, "parent_contract_id"); ok {
		parentID = altocPositiveID(parentValue)
	}
	if isMaster && parentID > 0 {
		return httperror.New(http.StatusBadRequest, "invalid_master_contract", "contract with parent cannot be marked as master")
	}
	if isMaster || contractID <= 0 {
		return nil
	}
	childCount, err := altocQueryOneMap(ctx, tx, `
		SELECT COUNT(*) AS count
		FROM contract
		WHERE parent_contract_id = ?
		  AND deleted_at IS NULL
	`, contractID)
	if err != nil {
		return err
	}
	if moneyValue(childCount["count"]) > 0 {
		return httperror.New(http.StatusConflict, "contract_has_child_contracts", "contract with child contracts cannot be unmarked as master")
	}
	return nil
}

func validateContractParentNoCycleTx(ctx context.Context, tx *sql.Tx, contractID int64, parentID int64) error {
	if contractID <= 0 || parentID <= 0 {
		return nil
	}
	seen := map[int64]bool{}
	nextID := parentID
	for nextID > 0 {
		if nextID == contractID {
			return httperror.New(http.StatusBadRequest, "contract_parent_cycle", "parent contract relation cannot form a cycle")
		}
		if seen[nextID] {
			return httperror.New(http.StatusBadRequest, "contract_parent_cycle", "parent contract relation cannot form a cycle")
		}
		seen[nextID] = true
		row, err := altocQueryOneMap(ctx, tx, `
			SELECT parent_contract_id
			FROM contract
			WHERE id = ?
			  AND deleted_at IS NULL
			LIMIT 1
		`, nextID)
		if err != nil {
			return err
		}
		if row == nil {
			return nil
		}
		nextID = altocPositiveID(row["parent_contract_id"])
	}
	return nil
}

func contractBodyFromQuotation(body map[string]any, quotation map[string]any, code string) map[string]any {
	next := make(map[string]any, len(body)+16)
	for key, value := range body {
		next[key] = value
	}
	next["name"] = firstNonEmptyText(firstBodyText(body, "name"), fmt.Sprintf("%s 合同", altocMapText(quotation, "code")))
	next["customer_id"] = quotation["customer_id"]
	next["opportunity_id"] = quotation["opportunity_id"]
	next["quotation_id"] = quotation["id"]
	next["amount_tax_inclusive"] = quotation["amount_tax_inclusive"]
	next["amount_tax_exclusive"] = quotation["amount_tax_exclusive"]
	next["currency_code"] = quotation["currency_code"]
	next["tax_rate"] = quotation["tax_rate"]
	next["source_type"] = "quotation"
	next["source_code"] = quotation["code"]
	next["direction"] = "sales"
	next["primary_type"] = firstNonEmptyText(firstBodyText(body, "primary_type", "primaryType"), "mixed_solution")
	if firstBodyText(next, "contract_no", "contractNo") == "" {
		next["contract_no"] = code
	}
	return next
}

func quotationLineItemsTx(ctx context.Context, tx *sql.Tx, quotationID int64) ([]map[string]any, error) {
	return altocQueryMaps(ctx, tx, `
		SELECT
		  qi.*,
		  p.code AS product_code,
		  p.name AS product_name,
		  p.product_type,
		  p.unit AS product_unit,
		  p.cost_price AS product_cost_price
		FROM quotation_item qi
		LEFT JOIN product p ON p.id = qi.product_id
		WHERE qi.quotation_id = ?
		ORDER BY qi.sort_no ASC, qi.id ASC
	`, quotationID)
}

func contractLineBodyFromQuotationItem(item map[string]any, quotation map[string]any) map[string]any {
	productType := altocMapText(item, "product_type")
	lineType := inferContractLineType(productType, firstNonEmptyText(altocMapText(item, "item_name"), altocMapText(item, "product_name")))
	return map[string]any{
		"name":                     firstNonEmptyText(altocMapText(item, "item_name"), altocMapText(item, "product_name")),
		"description":              altocMapText(item, "specification"),
		"catalog_item_id":          item["product_id"],
		"product_code":             nullableText(altocMapText(item, "product_code")),
		"source_quotation_item_id": item["id"],
		"quantity":                 item["quantity"],
		"unit":                     firstNonEmptyText(altocMapText(item, "unit"), altocMapText(item, "product_unit")),
		"unit_price":               item["unit_price"],
		"amount_tax_inclusive":     item["amount_tax_inclusive"],
		"amount_tax_exclusive":     item["amount_tax_exclusive"],
		"tax_rate":                 firstNonEmptyText(altocMapText(item, "tax_rate"), altocMapText(quotation, "tax_rate"), "6"),
		"planned_cost":             firstNonEmptyText(altocMapText(item, "cost_price"), altocMapText(item, "product_cost_price")),
		"currency_code":            firstNonEmptyText(altocMapText(quotation, "currency_code"), "CNY"),
		"line_type":                lineType,
		"product_origin":           defaultProductOrigin(lineType),
	}
}

func (a *Adapter) upsertPrimaryContractPartyTx(ctx context.Context, tx *sql.Tx, contract map[string]any, body map[string]any, operator string) error {
	customerID := altocPositiveID(contract["customer_id"])
	if customerID <= 0 {
		return nil
	}
	customer, err := altocQueryOneMap(ctx, tx, `
		SELECT code, name
		FROM customer
		WHERE id = ?
		  AND deleted_at IS NULL
		LIMIT 1
	`, customerID)
	if err != nil || customer == nil {
		return err
	}
	var contact map[string]any
	contactID := altocPositiveID(contract["contact_id"])
	if contactID > 0 {
		contact, err = altocQueryOneMap(ctx, tx, `
			SELECT name, mobile, phone, email
			FROM contact
			WHERE id = ?
			LIMIT 1
		`, contactID)
		if err != nil {
			return err
		}
	}
	_, err = tx.ExecContext(ctx, `
		INSERT INTO contract_party (
		  contract_id, party_type, party_ref_code, party_name_snapshot, role_code, is_primary,
		  contact_name, contact_mobile, contact_email, sort_no, created_by, updated_by
		) VALUES (?, 'customer', ?, ?, 'buyer', 1, ?, ?, ?, 0, ?, ?)
		ON DUPLICATE KEY UPDATE
		  party_name_snapshot = VALUES(party_name_snapshot),
		  is_primary = 1,
		  contact_name = VALUES(contact_name),
		  contact_mobile = VALUES(contact_mobile),
		  contact_email = VALUES(contact_email),
		  updated_by = VALUES(updated_by),
		  updated_at = CURRENT_TIMESTAMP,
		  deleted_at = NULL
	`, contract["id"], customer["code"], customer["name"], altocMapText(contact, "name"), firstNonEmptyText(altocMapText(contact, "mobile"), altocMapText(contact, "phone")), altocMapText(contact, "email"), operator, operator)
	return err
}

func (a *Adapter) recalculateContractLineTotalsTx(ctx context.Context, tx *sql.Tx, contractID int64, operator string) error {
	summary, err := altocQueryOneMap(ctx, tx, `
		SELECT
		  COALESCE(SUM(amount_tax_inclusive), 0) AS amount_tax_inclusive,
		  COALESCE(SUM(amount_tax_exclusive), 0) AS amount_tax_exclusive
		FROM contract_line
		WHERE contract_id = ?
		  AND deleted_at IS NULL
	`, contractID)
	if err != nil {
		return err
	}
	_, err = tx.ExecContext(ctx, `
		UPDATE contract
		SET amount_tax_inclusive = ?,
		    amount_tax_exclusive = ?,
		    updated_by = ?,
		    lock_version = lock_version + 1,
		    updated_at = CURRENT_TIMESTAMP
		WHERE id = ?
	`, moneyText(moneyValue(summary["amount_tax_inclusive"])), moneyText(moneyValue(summary["amount_tax_exclusive"])), operator, contractID)
	return err
}

func (a *Adapter) nextContractLineNoTx(ctx context.Context, tx *sql.Tx, contractID int64) (int, error) {
	row, err := altocQueryOneMap(ctx, tx, `
		SELECT COALESCE(MAX(line_no), 0) + 1 AS next_line_no
		FROM contract_line
		WHERE contract_id = ?
	`, contractID)
	if err != nil {
		return 0, err
	}
	return numberValue(row["next_line_no"], 1), nil
}

func (a *Adapter) lockContractAndLineTx(ctx context.Context, tx *sql.Tx, contractID int64, lineID int64) (map[string]any, map[string]any, error) {
	contract, err := a.lockContractTx(ctx, tx, contractID)
	if err != nil || contract == nil {
		return contract, nil, err
	}
	line, err := altocQueryOneMap(ctx, tx, `
		SELECT *
		FROM contract_line
		WHERE id = ?
		  AND contract_id = ?
		  AND deleted_at IS NULL
		LIMIT 1
		FOR UPDATE
	`, lineID, contractID)
	return contract, line, err
}

func contractDraftValidationIssues(contract map[string]any) []string {
	issues := make([]string, 0)
	if strings.TrimSpace(altocMapText(contract, "name")) == "" {
		issues = append(issues, "请填写合同名称")
	}
	if altocPositiveID(contract["customer_id"]) <= 0 {
		issues = append(issues, "请选择合同客户/相对方")
	}
	lines, _ := contract["lines"].([]map[string]any)
	if len(lines) == 0 {
		if raw, ok := contract["lines"].([]any); ok && len(raw) > 0 {
			return issues
		}
		issues = append(issues, "请至少添加一条产品或服务行")
		return issues
	}
	lineAmount := moneyValue(contract["line_amount_tax_inclusive"])
	if summary, ok := contract["line_summary"].(map[string]any); ok {
		lineAmount = moneyValue(summary["amount_tax_inclusive"])
	}
	if lineAmount <= 0 {
		issues = append(issues, "合同行金额必须大于 0")
	}
	if amount := moneyValue(contract["amount_tax_inclusive"]); amount > 0 && math.Abs(amount-lineAmount) > contractLineAmountEpsilon {
		issues = append(issues, "合同头金额与合同行汇总不一致")
	}
	return issues
}

func ensureContractDraftEditable(contract map[string]any) error {
	switch altocNormalizeContractStatus(contract["status"]) {
	case "", "draft", "rejected":
		return nil
	default:
		return httperror.New(http.StatusConflict, "contract_not_editable", "only draft contracts can be changed by P0A line commands")
	}
}

func ensureQuotationConvertible(quotation map[string]any) error {
	switch strings.TrimSpace(altocMapText(quotation, "status")) {
	case "approved", "sent", "accepted":
		return nil
	default:
		return httperror.New(http.StatusConflict, "quotation_not_convertible", "only approved, sent, or accepted quotations can be converted")
	}
}

func updateSetFromBody(body map[string]any, allowed []string) ([]string, []any) {
	set := make([]string, 0, len(allowed))
	args := make([]any, 0, len(allowed))
	for _, column := range allowed {
		value, ok := altocBodyValue(body, column)
		if !ok {
			continue
		}
		set = append(set, altocQuoteID(column)+" = ?")
		args = append(args, nullableBodyValue(value))
	}
	return set, args
}

func existingContractColumns(allowed []string, columns map[string]bool) []string {
	if len(columns) == 0 {
		return allowed
	}
	result := make([]string, 0, len(allowed))
	for _, column := range allowed {
		if columns[column] {
			result = append(result, column)
		}
	}
	return result
}

func contractLineBodies(body map[string]any) []map[string]any {
	value, ok := altocBodyValue(body, "lines")
	if !ok || value == nil {
		return nil
	}
	switch typed := value.(type) {
	case []map[string]any:
		return typed
	case []any:
		result := make([]map[string]any, 0, len(typed))
		for _, item := range typed {
			if line, ok := item.(map[string]any); ok {
				result = append(result, line)
			}
		}
		return result
	default:
		return nil
	}
}

func changedFieldNames(body map[string]any, allowed []string) []string {
	result := make([]string, 0)
	for _, column := range allowed {
		if _, ok := altocBodyValue(body, column); ok {
			result = append(result, column)
		}
	}
	return result
}

func sortedFieldNames(fields map[string]any) []string {
	names := make([]string, 0, len(fields))
	for name := range fields {
		names = append(names, name)
	}
	sort.Strings(names)
	return names
}

func bodyValueAny(body map[string]any, keys ...string) any {
	for _, key := range keys {
		if value, ok := altocBodyValue(body, key); ok {
			return value
		}
	}
	return nil
}

func mergeContractLineBody(existing map[string]any, patch map[string]any) map[string]any {
	merged := make(map[string]any, len(existing)+len(patch))
	for key, value := range existing {
		merged[key] = value
	}
	for key, value := range patch {
		merged[key] = value
	}
	return merged
}

func nullableMoney(value float64) any {
	if value == 0 {
		return nil
	}
	return moneyText(value)
}

func boolInt(value bool) int {
	if value {
		return 1
	}
	return 0
}

func contractLineSnapshot(body map[string]any, lineType string, source string) map[string]any {
	return map[string]any{
		"source":              source,
		"line_type":           lineType,
		"future_policies":     map[string]any{"project": firstBodyText(body, "project_policy", "projectPolicy"), "asset": firstBodyText(body, "asset_policy", "assetPolicy"), "service": firstBodyText(body, "service_policy", "servicePolicy"), "procurement": firstBodyText(body, "procurement_policy", "procurementPolicy")},
		"source_payload_json": compactJSON(body),
	}
}

func compactJSON(value any) string {
	encoded, err := json.Marshal(value)
	if err != nil {
		return "{}"
	}
	return string(encoded)
}

func contractLineWritableColumns() []string {
	return []string{
		"line_type", "name", "description", "catalog_item_id", "catalog_item_code", "product_code",
		"product_version", "product_origin", "supplier_code", "quantity", "unit", "unit_price",
		"amount_tax_exclusive", "amount_tax_inclusive", "tax_rate", "planned_cost", "planned_margin",
		"currency_code", "billing_method", "fulfillment_method", "service_start_date", "service_end_date",
		"project_policy", "project_template_code", "asset_policy", "service_policy", "procurement_policy",
		"acceptance_required", "acceptance_criteria", "status", "sort_no",
	}
}

func normalizeContractLineType(value string) string {
	value = strings.TrimSpace(value)
	if value == "" {
		return "other_fee"
	}
	return value
}

func inferContractLineType(productType string, name string) string {
	productType = strings.ToLower(strings.TrimSpace(productType))
	name = strings.ToLower(strings.TrimSpace(name))
	switch productType {
	case "software":
		return "own_software_license"
	case "maintenance":
		return "maintenance_support"
	case "implementation":
		return "implementation"
	case "hardware":
		return "hardware"
	case "service":
		return "consulting_training"
	}
	if strings.Contains(name, "维保") || strings.Contains(name, "maintenance") {
		return "maintenance_support"
	}
	if strings.Contains(name, "实施") {
		return "implementation"
	}
	if strings.Contains(name, "开发") {
		return "custom_development"
	}
	if strings.Contains(name, "硬件") || strings.Contains(name, "服务器") || strings.Contains(name, "交换机") {
		return "hardware"
	}
	if strings.Contains(name, "订阅") || strings.Contains(name, "saas") {
		return "own_saas_subscription"
	}
	return "other_fee"
}

func inferContractPrimaryType(lineTypes []string) string {
	seen := map[string]bool{}
	for _, item := range lineTypes {
		seen[item] = true
	}
	if len(seen) != 1 {
		return "mixed_solution"
	}
	for lineType := range seen {
		switch lineType {
		case "own_software_license":
			return "software_license"
		case "own_saas_subscription":
			return "saas_subscription"
		case "custom_development":
			return "custom_development"
		case "implementation":
			return "implementation_service"
		case "maintenance_support":
			return "maintenance_service"
		case "system_integration":
			return "system_integration"
		case "managed_service":
			return "managed_service"
		case "third_party_software", "hardware":
			return "third_party_resale"
		default:
			return "mixed_solution"
		}
	}
	return "mixed_solution"
}

func defaultBillingMethod(lineType string) string {
	switch lineType {
	case "own_saas_subscription", "maintenance_support", "managed_service":
		return "subscription"
	case "custom_development", "implementation", "system_integration":
		return "milestone"
	default:
		return "fixed_price"
	}
}

func defaultFulfillmentMethod(lineType string) string {
	switch lineType {
	case "custom_development", "implementation", "system_integration", "own_saas_subscription", "maintenance_support", "managed_service":
		return "over_time"
	default:
		return "point_in_time"
	}
}

func defaultProjectPolicy(lineType string) string {
	switch lineType {
	case "custom_development", "implementation", "system_integration":
		return "required"
	default:
		return "none"
	}
}

func defaultAssetPolicy(lineType string) string {
	switch lineType {
	case "own_software_license", "own_saas_subscription", "third_party_software", "hardware", "cloud_resource":
		return "planned_on_effective"
	default:
		return "none"
	}
}

func defaultServicePolicy(lineType string) string {
	switch lineType {
	case "maintenance_support":
		return "maintenance"
	case "managed_service":
		return "managed_service"
	default:
		return "none"
	}
}

func defaultProcurementPolicy(lineType string, body map[string]any) string {
	if firstBodyText(body, "product_origin", "productOrigin") == "third_party" {
		return "optional"
	}
	switch lineType {
	case "third_party_software", "hardware", "cloud_resource":
		return "optional"
	default:
		return "none"
	}
}

func defaultAcceptanceRequired(lineType string) bool {
	switch lineType {
	case "custom_development", "implementation", "system_integration", "hardware":
		return true
	default:
		return false
	}
}

func defaultProductOrigin(lineType string) string {
	switch lineType {
	case "third_party_software", "hardware", "cloud_resource":
		return "third_party"
	default:
		return "own"
	}
}
