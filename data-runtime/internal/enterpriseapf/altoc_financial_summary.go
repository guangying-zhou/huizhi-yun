package enterpriseapf

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"github.com/huizhi-yun/data-runtime/internal/apps/altoc"
	"github.com/huizhi-yun/data-runtime/internal/apps/finance"
	"github.com/huizhi-yun/data-runtime/internal/enterprise"
	"github.com/huizhi-yun/data-runtime/internal/httperror"
	"io"
	"regexp"
	"strings"
	"time"
)

var serviceSummaryOps = map[string][2]string{"customer-service-finance-summary": {"customer", "view"}, "service-cost-summary-view": {"contract", "view"}}

func IsServiceSummary(op string) bool { _, ok := serviceSummaryOps[op]; return ok }

type ServiceSummaryAuthorization struct {
	ActorUID       string   `json:"actorUid"`
	Tenant         string   `json:"tenant"`
	Deployment     string   `json:"deployment"`
	ExpiresAt      int64    `json:"expiresAt"`
	Invoices       string   `json:"invoices"`
	Receipts       string   `json:"receipts"`
	Reconciliation string   `json:"reconciliation"`
	CostAccess     string   `json:"costAccess"`
	ProjectCodes   []string `json:"projectCodes"`
}

func validateServiceSummary(op string, i SalesInput) error {
	if !IsServiceSummary(op) || !validCustomerID(i.ID) {
		return salesInvalid()
	}
	for k, v := range i.Payload {
		if k == "financeAuthorization" {
			if !stringValue(v, 20000, false) {
				return salesInvalid()
			}
		} else if k == "periodMonth" && op == "service-cost-summary-view" {
			if !regexp.MustCompile(`^(20|21)\d{2}-(0[1-9]|1[0-2])$`).MatchString(salesText(i.Payload, k)) {
				return salesInvalid()
			}
		} else {
			return salesInvalid()
		}
	}
	if salesText(i.Payload, "financeAuthorization") == "" || op == "service-cost-summary-view" && salesText(i.Payload, "periodMonth") == "" {
		return salesInvalid()
	}
	return nil
}
func decodeSummaryAuthorization(raw string, who Identity) (ServiceSummaryAuthorization, error) {
	var p ServiceSummaryAuthorization
	dec := json.NewDecoder(strings.NewReader(raw))
	dec.DisallowUnknownFields()
	if e := dec.Decode(&p); e != nil {
		return p, salesInvalid()
	}
	if e := dec.Decode(&struct{}{}); e != io.EOF {
		return p, salesInvalid()
	}
	now := time.Now().UnixMilli()
	if p.ActorUID != who.Actor || p.Tenant != who.Tenant || p.Deployment != who.Deployment || p.ExpiresAt <= now || p.ExpiresAt > now+15000 {
		return p, httperror.New(403, "service_summary_permit_invalid", "摘要许可无效或过期")
	}
	if e := (finance.ServiceSummaryDisclosure{Invoices: p.Invoices, Receipts: p.Receipts, Reconciliation: p.Reconciliation}).Validate(); e != nil {
		return p, e
	}
	if p.CostAccess != "none" {
		if e := (CostScope{Access: p.CostAccess, ProjectCodes: p.ProjectCodes, Salary: altoc.BasicReadScope{Access: "none"}}).Validate("", "project-accounting-view"); e != nil {
			return p, e
		}
	} else if len(p.ProjectCodes) > 0 {
		return p, salesInvalid()
	}
	return p, nil
}

// Read-only owning orchestration: Altoc parent scopes are checked before any
// Finance metadata. Secondary scope is an opaque scalar in the signed U intent.
func (s *Service) ServiceSummary(ctx context.Context, op string, i SalesInput, who Identity, scope altoc.BasicReadScope) (any, error) {
	if e := validateServiceSummary(op, i); e != nil {
		return nil, e
	}
	if who.Client != "enterprise.runtime" || who.Actor == "" || who.Tenant != s.binding.Key.Tenant || who.Deployment != s.binding.Domains["altoc"].OwnerDeployment {
		return nil, httperror.New(403, "service_summary_identity_invalid", "用户委托无效")
	}
	if e := scope.Validate(); e != nil {
		return nil, e
	}
	p, e := decodeSummaryAuthorization(salesText(i.Payload, "financeAuthorization"), who)
	if e != nil {
		return nil, e
	}
	denied := p.CostAccess == "none"
	if op == "customer-service-finance-summary" {
		denied = (finance.ServiceSummaryDisclosure{Invoices: p.Invoices, Receipts: p.Receipts, Reconciliation: p.Reconciliation}).Denied()
	}
	ar, e := s.request("altoc", enterprise.Read)
	if e != nil {
		return nil, e
	}
	reqs := []enterprise.ResolveRequest{ar}
	if !denied {
		fr, e := s.request("finance", enterprise.Read)
		if e != nil {
			return nil, e
		}
		reqs = append(reqs, fr)
	}
	tx, rs, e := s.registry.BeginSnapshotReadTransaction(ctx, reqs...)
	if e != nil {
		return nil, e
	}
	defer tx.Rollback()
	at := rs[0].Table
	customerTable, e := at("altoc_customer")
	if e != nil {
		return nil, e
	}
	var customer map[string]any
	var agreement map[string]any
	if op == "customer-service-finance-summary" {
		customer, e = knowledgeReadParent(ctx, tx, customerTable, i.ID)
		if e != nil {
			return nil, e
		}
		if e = salesScope(scope, who.Actor, customer); e != nil {
			return nil, e
		}
	} else {
		agreementTable, e := at("altoc_service_agreement")
		if e != nil {
			return nil, e
		}
		contractTable, e := at("altoc_contract")
		if e != nil {
			return nil, e
		}
		agreement, e = knowledgeReadParent(ctx, tx, agreementTable, i.ID)
		if e != nil {
			return nil, e
		}
		contract, e := knowledgeReadParent(ctx, tx, contractTable, salesText(agreement, "contract_id"))
		if e != nil {
			return nil, e
		}
		customer, e = knowledgeReadParent(ctx, tx, customerTable, salesText(contract, "customer_id"))
		if e != nil {
			return nil, e
		}
		for _, row := range []map[string]any{customer, contract} {
			if e = salesScope(scope, who.Actor, row); e != nil {
				return nil, e
			}
		}
	}
	if denied {
		if e = tx.Commit(); e != nil {
			return nil, e
		}
		return map[string]any{"access": "denied"}, nil
	}
	var out map[string]any
	if op == "customer-service-finance-summary" {
		ct, e := at("altoc_contract")
		if e != nil {
			return nil, e
		}
		ag, e := at("altoc_service_agreement")
		if e != nil {
			return nil, e
		}
		rows, e := tx.QueryContext(ctx, "SELECT DISTINCT c.code FROM "+ct+" c JOIN "+ag+" a ON a.contract_id=c.id AND a.deleted_at IS NULL WHERE c.customer_id=? AND c.deleted_at IS NULL ORDER BY c.code LIMIT 1001", i.ID)
		if e != nil {
			return nil, e
		}
		codes := []string{}
		for rows.Next() {
			var code string
			if e = rows.Scan(&code); e != nil {
				rows.Close()
				return nil, e
			}
			codes = append(codes, code)
		}
		e = rows.Err()
		rows.Close()
		if e != nil {
			return nil, e
		}
		if len(codes) > 1000 {
			return nil, httperror.New(503, "service_summary_limit", "摘要范围超过上限")
		}
		out, e = finance.ReadCustomerServiceSummaryTx(ctx, tx, rs[1].Table, salesText(customer, "code"), who.Actor, codes, finance.ServiceSummaryDisclosure{Invoices: p.Invoices, Receipts: p.Receipts, Reconciliation: p.Reconciliation})
	} else {
		pt, e := at("altoc_service_agreement_project_rel")
		if e != nil {
			return nil, e
		}
		where := "service_agreement_id=? AND deleted_at IS NULL AND status IN ('planned','active','ended')"
		where += " AND (effective_from IS NULL OR effective_from<=LAST_DAY(?)) AND (effective_to IS NULL OR effective_to>=?)"
		month := salesText(i.Payload, "periodMonth") + "-01"
		args := []any{i.ID, month, month}
		if p.CostAccess == "projects" {
			where += " AND BINARY project_code IN ("
			for n, c := range p.ProjectCodes {
				if n > 0 {
					where += ","
				}
				where += "BINARY ?"
				args = append(args, c)
			}
			where += ")"
		}
		rows, e := tx.QueryContext(ctx, "SELECT DISTINCT project_code FROM "+pt+" WHERE "+where+" ORDER BY project_code LIMIT 1001", args...)
		if e != nil {
			return nil, e
		}
		projects := []string{}
		for rows.Next() {
			var code string
			if e = rows.Scan(&code); e != nil {
				rows.Close()
				return nil, e
			}
			projects = append(projects, code)
		}
		e = rows.Err()
		rows.Close()
		if e != nil {
			return nil, e
		}
		if len(projects) > 1000 {
			return nil, httperror.New(503, "service_summary_limit", "摘要范围超过上限")
		}
		items := []map[string]any{}
		for _, code := range projects {
			row, e := finance.ReadServiceProjectCostTx(ctx, tx, rs[1].Table, code, salesText(i.Payload, "periodMonth"))
			if e != nil {
				return nil, e
			}
			items = append(items, row)
		}
		out = map[string]any{"access": "allowed", "items": items}
	}
	if e != nil {
		if errors.Is(e, sql.ErrNoRows) {
			return nil, httperror.New(404, "service_summary_not_found", "摘要对象不存在")
		}
		return nil, e
	}
	if e = tx.Commit(); e != nil {
		return nil, e
	}
	return out, nil
}
