package enterpriseapf

import (
	"context"
	"crypto/sha256"
	"database/sql"
	"encoding/json"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/huizhi-yun/data-runtime/internal/apps/altoc"
	"github.com/huizhi-yun/data-runtime/internal/enterprise"
	"github.com/huizhi-yun/data-runtime/internal/enterprise/domaininstall"
	"github.com/huizhi-yun/data-runtime/internal/integrationoperation"
)

// The secondary permit is freshly produced by BFF, bound inside Finance's
// signed canonical payload, and never accepted from the public request body.
type FinanceAltocPermit struct {
	ActorUID       string               `json:"actorUid"`
	Tenant         string               `json:"tenant"`
	Deployment     string               `json:"deployment"`
	Resource       string               `json:"resource"`
	Action         string               `json:"action"`
	Operation      string               `json:"operation"`
	ObjectID       string               `json:"objectId"`
	Allowed        bool                 `json:"allowed"`
	ExpiresAt      int64                `json:"expiresAt"`
	BundleVersion  string               `json:"bundleVersion"`
	BundleHash     string               `json:"bundleHash"`
	PolicyRevision *int64               `json:"policyRevision"`
	Scope          altoc.BasicReadScope `json:"scope"`
}

func validateFinanceSourceInput(i FinanceInput) error {
	if i.Code != "" {
		return financeInvalid()
	}
	allowed := map[string]bool{}
	for _, k := range strings.Fields("contractId billingScheduleCode expectedContractVersion scheduleVersion requestedAmount invoiceItem invoiceProfileCode altocAuthorization") {
		allowed[k] = true
	}
	for k := range i.Payload {
		if !allowed[k] {
			return financeInvalid()
		}
	}
	if !positiveAltocID(ledgerText(i.Payload["contractId"])) || !financeCode.MatchString(ledgerText(i.Payload["billingScheduleCode"])) || !decimalValid(i.Payload["requestedAmount"], 18, 2) || moneyCents(ledgerText(i.Payload["requestedAmount"])).Sign() <= 0 || !stringValue(i.Payload["invoiceItem"], 500, false) {
		return financeInvalid()
	}
	for _, key := range []string{"expectedContractVersion", "scheduleVersion"} {
		n, ok := i.Payload[key].(float64)
		if !ok || n < 1 || n > 9007199254740991 || n != float64(int64(n)) {
			return financeInvalid()
		}
	}
	if v, ok := i.Payload["invoiceProfileCode"]; ok && !financeCode.MatchString(ledgerText(v)) {
		return financeInvalid()
	}
	if !stringValue(i.Payload["altocAuthorization"], 4000, false) {
		return financeInvalid()
	}
	return nil
}
func (s *Service) FinanceFromAltoc(ctx context.Context, i FinanceInput, who Identity, scope altoc.BasicReadScope) (any, error) {
	if who.Actor == "" || who.Client != "enterprise.runtime" || who.Tenant != s.binding.Key.Tenant || who.Deployment != s.binding.Domains["finance"].OwnerDeployment || who.Key == "" || (scope.Access != "all" && scope.Access != "self") || len(scope.DepartmentCodes) > 0 {
		return nil, ledgerError(403, "source_identity_invalid")
	}
	if !domaininstall.IsFinanceB3Domain(s.binding.Domains["finance"]) {
		return nil, ledgerError(503, "b3_unavailable")
	}
	var authority FinanceAltocPermit
	dec := json.NewDecoder(strings.NewReader(ledgerText(i.Payload["altocAuthorization"])))
	dec.DisallowUnknownFields()
	if dec.Decode(&authority) != nil || !authority.Allowed || authority.ActorUID != who.Actor || authority.Tenant != who.Tenant || authority.Deployment != who.Deployment || authority.Resource != "contract" || authority.Action != "edit" || authority.Operation != "save" || authority.ObjectID != ledgerText(i.Payload["contractId"]) || authority.ExpiresAt <= time.Now().UnixMilli() || authority.ExpiresAt > time.Now().Add(15*time.Second).UnixMilli() || authority.BundleVersion == "" || authority.BundleHash == "" || authority.PolicyRevision == nil || *authority.PolicyRevision < 0 || authority.Scope.Validate() != nil {
		return nil, ledgerError(403, "source_permit_invalid")
	}
	ar, err := s.request("altoc", enterprise.Write)
	if err != nil {
		return nil, err
	}
	fr, err := s.request("finance", enterprise.Write)
	if err != nil {
		return nil, err
	}
	tx, rs, err := s.registry.BeginWriteTransaction(ctx, ar, fr)
	if err != nil {
		return nil, err
	}
	defer tx.Rollback()
	var contract string
	if err = tx.QueryRowContext(ctx, "SELECT code FROM altoc_contract WHERE id=? AND deleted_at IS NULL", i.Payload["contractId"]).Scan(&contract); err != nil {
		return nil, err
	}
	input := FinanceInput{Payload: map[string]any{"contractCode": contract, "billingScheduleCode": i.Payload["billingScheduleCode"], "requestedAmount": i.Payload["requestedAmount"], "invoiceItem": i.Payload["invoiceItem"]}}
	locked, err := ledgerLock(ctx, tx, financeLedgerOps["invoice-requests-create"], input, who, scope, domaininstall.IsFinanceReceivablesDomain(s.binding.Domains["finance"]))
	if err != nil {
		return nil, err
	}
	c := locked["altoc_contract"]
	bs := locked["altoc_billing_schedule"]
	var owner, dept, customerName string
	if err = tx.QueryRowContext(ctx, "SELECT COALESCE(owner_uid,''),COALESCE(owner_dept_code,'') FROM altoc_contract WHERE id=?", c["id"]).Scan(&owner, &dept); err != nil {
		return nil, err
	}
	if !altocScopeAllows(authority.Scope, who.Actor, owner, dept) {
		return nil, ledgerError(403, "source_scope_denied")
	}
	if err = tx.QueryRowContext(ctx, "SELECT name FROM altoc_customer WHERE code=?", c["customer_code"]).Scan(&customerName); err != nil {
		return nil, err
	}
	input.Payload["customerCode"] = c["customer_code"]
	input.Payload["customerName"] = customerName
	input.Payload["currencyCode"] = c["currency_code"]
	if profile := i.Payload["invoiceProfileCode"]; profile != nil {
		input.Payload["invoiceProfileCode"] = profile
	}
	// Ephemeral authorization is checked above, not persisted in the business
	// digest: renewed grants/expiry must not change the original user's intent.
	stable := map[string]any{}
	for k, v := range i.Payload {
		if k != "altocAuthorization" {
			stable[k] = v
		}
	}
	raw, _ := json.Marshal(stable)
	digest, err := integrationoperation.ValidateAndDigestCommand(stable)
	if err != nil {
		return nil, err
	}
	oid := uuid.NewHash(sha256.New(), uuid.NameSpaceOID, []byte("finance11b-source|"+who.Tenant+"|"+who.Deployment+"|"+who.Actor+"|"+who.Key), 4).String()
	r := rs[len(rs)-1]
	table, _ := r.Table("service_command_receipt")
	repo, err := integrationoperation.NewReceiptRepository(r.DB, integrationoperation.WithReceiptTable(table))
	if err != nil {
		return nil, err
	}
	receipt := integrationoperation.ReceiptCommandInput{TrustedContext: integrationoperation.TrustedContext{TenantCode: who.Tenant, DeploymentCode: who.Deployment, SourceApp: "enterprise", ServiceClientID: who.Client, RequestID: who.RequestID}, SourceDeploymentCode: who.Deployment, TargetDeploymentCode: who.Deployment, TargetApp: "finance", OperationID: oid, OperationCode: "finance.invoice-requests.from-altoc.v1", RequiredCapability: "finance:enterprise-host:execute", IdempotencyKey: who.Key, CommandSchemaVersion: "v1", CommandSHA256: digest, Command: raw, OriginalActorUID: who.Actor}
	_, err = repo.ExecuteInTransaction(ctx, tx, receipt, func(context.Context, *sql.Tx, json.RawMessage) (integrationoperation.ReceiptBusinessResult, error) {
		if ledgerVersion(c["row_version"]) != ledgerVersion(i.Payload["expectedContractVersion"]) || ledgerVersion(bs["row_version"]) != ledgerVersion(i.Payload["scheduleVersion"]) {
			return integrationoperation.ReceiptBusinessResult{}, ledgerError(409, "source_version_conflict")
		}
		if c["legal_status"] != "effective" {
			return integrationoperation.ReceiptBusinessResult{}, ledgerError(409, "source_contract_not_effective")
		}
		row, e := ledgerMutate(ctx, tx, "invoice-requests-create", financeLedgerOps["invoice-requests-create"], input, who, locked, oid)
		if e != nil {
			return integrationoperation.ReceiptBusinessResult{}, e
		}
		if _, e = tx.ExecContext(ctx, "UPDATE finance_invoice_request SET source_app='altoc',source_biz_type='billing_schedule',source_biz_code=? WHERE code=?", bs["code"], row["code"]); e != nil {
			return integrationoperation.ReceiptBusinessResult{}, e
		}
		row, e = ledgerRow(ctx, tx, "finance_invoice_request", ledgerText(row["code"]), false)
		if e != nil {
			return integrationoperation.ReceiptBusinessResult{}, e
		}
		if e = ledgerSummaries(ctx, tx, locked); e != nil {
			return integrationoperation.ReceiptBusinessResult{}, e
		}
		if e = financeApprovalAudit(ctx, tx, FrozenFinanceApproval{BizID: ledgerText(row["code"])}, "invoice-source-create", oid, who.Actor, "user", map[string]any{"data": row}); e != nil {
			return integrationoperation.ReceiptBusinessResult{}, e
		}
		return integrationoperation.ReceiptBusinessResult{TargetBizType: "invoice_request", TargetBizCode: ledgerText(row["code"]), HTTPStatus: 200, ResponseSummarySHA256: approvalDigest(row)}, nil
	})
	if err != nil {
		return nil, err
	}
	var snapshot []byte
	if err = tx.QueryRowContext(ctx, "SELECT new_value FROM finance_audit_log WHERE action='invoice-source-create' AND request_id=?", oid).Scan(&snapshot); err != nil {
		return nil, err
	}
	var out map[string]any
	if json.Unmarshal(snapshot, &out) != nil {
		return nil, ledgerError(503, "approval_snapshot_invalid")
	}
	return out, tx.Commit()
}
