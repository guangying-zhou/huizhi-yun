package enterpriseapf

import (
	"context"
	"crypto/sha256"
	"database/sql"
	"encoding/json"
	"errors"
	"math/big"
	"regexp"
	"sort"
	"strings"

	"github.com/go-sql-driver/mysql"
	"github.com/google/uuid"
	"github.com/huizhi-yun/data-runtime/internal/apps/aims"
	"github.com/huizhi-yun/data-runtime/internal/apps/altoc"
	"github.com/huizhi-yun/data-runtime/internal/apps/finance"
	"github.com/huizhi-yun/data-runtime/internal/apps/people"
	"github.com/huizhi-yun/data-runtime/internal/enterprise"
	"github.com/huizhi-yun/data-runtime/internal/enterprise/domaininstall"
	"github.com/huizhi-yun/data-runtime/internal/httperror"
	"github.com/huizhi-yun/data-runtime/internal/integrationoperation"
	"github.com/huizhi-yun/data-runtime/internal/projectcost"
)

type CostInput struct {
	ProjectCode       string `json:"projectCode"`
	PeriodMonth       string `json:"periodMonth"`
	Code              string `json:"code"`
	Page              int    `json:"page"`
	PageSize          int    `json:"pageSize"`
	Search            string `json:"search"`
	ExpectedVersion   int64  `json:"expectedVersion"`
	ExpectedInputHash string `json:"expectedInputHash"`
}

// Scope is compiled by the Host evaluator and covered by the signed permit.
// It is not an editable browser input or a substitute for personnel permission.
type CostScope struct {
	Access       string               `json:"access"`
	ProjectCodes []string             `json:"projectCodes"`
	Salary       altoc.BasicReadScope `json:"salary"`
}

var costOps = map[string]string{
	"project-accounting-page": "view", "project-accounting-view": "view",
	"project-labor-preview": "admin", "project-labor-recalculate": "admin",
	"project-cost-allocations-page": "view", "project-cost-allocations-view": "view",
	"employee-costs-page": "admin", "employee-costs-view": "admin",
	"project-labor-history-page": "view", "project-labor-history-view": "view",
	"project-cost-period-view": "view", "project-cost-period-confirm-zero": "admin", "project-cost-period-close": "admin",
}

func CostPermission(op string) (string, string, bool) {
	a, ok := costOps[op]
	return "project_accounting", a, ok
}
func CostWrite(op string) bool {
	return op == "project-labor-recalculate" || op == "project-cost-period-confirm-zero" || op == "project-cost-period-close"
}
func CostIntent(i CostInput) []any {
	return []any{i.ProjectCode, i.PeriodMonth, i.Code, i.Page, i.PageSize, i.Search, i.ExpectedVersion, i.ExpectedInputHash}
}
func costErr(status int, code string) error {
	return httperror.New(status, "finance_project_cost_"+code, "Project cost command rejected")
}
func ValidateCostInput(op string, i CostInput) error {
	if _, ok := costOps[op]; !ok {
		return costErr(400, "input_invalid")
	}
	project := i.ProjectCode
	if project == "" && (op == "project-accounting-page" || op == "project-cost-allocations-page" || op == "employee-costs-page" || op == "employee-costs-view") {
		project = "all"
	}
	if _, e := projectcost.NewPeriod(project, i.PeriodMonth); e != nil {
		return costErr(400, "input_invalid")
	}
	if strings.HasSuffix(op, "-page") {
		if i.Page < 1 || i.Page > 1000000 || i.PageSize < 1 || i.PageSize > 100 || len(i.Search) > 200 || strings.ContainsAny(i.Search, "\x00\r\n") {
			return costErr(400, "input_invalid")
		}
	} else if i.Page != 0 || i.PageSize != 0 || i.Search != "" {
		return costErr(400, "input_invalid")
	}
	if CostWrite(op) {
		if i.ExpectedVersion < 0 || !regexp.MustCompile(`^[a-f0-9]{64}$`).MatchString(i.ExpectedInputHash) {
			return costErr(400, "input_invalid")
		}
	} else if i.ExpectedVersion != 0 || i.ExpectedInputHash != "" {
		return costErr(400, "input_invalid")
	}
	needsCode := op == "project-labor-history-view" || op == "project-cost-allocations-view" || op == "employee-costs-view"
	if needsCode != (i.Code != "") || len(i.Code) > 64 || strings.ContainsAny(i.Code, "\x00\r\n") {
		return costErr(400, "input_invalid")
	}
	return nil
}
func (p CostScope) Validate(project, op string) error {
	if (p.Access != "all" && p.Access != "projects") || p.Access == "all" && len(p.ProjectCodes) > 0 || len(p.ProjectCodes) > 1000 {
		return costErr(403, "scope_required")
	}
	found := p.Access == "all" || project == "" && p.Access == "projects" && len(p.ProjectCodes) > 0
	seen := map[string]bool{}
	for _, v := range p.ProjectCodes {
		if seen[v] || !regexp.MustCompile(`^[A-Za-z0-9_-]{1,64}$`).MatchString(v) {
			return costErr(403, "scope_required")
		}
		seen[v] = true
		if v == project {
			found = true
		}
	}
	if !found {
		return costErr(403, "scope_required")
	}
	if err := p.Salary.Validate(); err != nil {
		return err
	}
	if strings.HasPrefix(op, "employee-costs-") && p.Salary.Access == "none" {
		return costErr(403, "salary_scope_required")
	}
	return nil
}
func (s *Service) ConfigureProjectCostCalendar(reader projectcost.CalendarReader) {
	s.costCalendar = reader
}

type costFrozen struct {
	Time          projectcost.TimeInputs
	People        []projectcost.PersonInput
	Parameters    projectcost.ParameterInput
	Plan          projectcost.Plan
	FinancialHash string
}
type costPeriod struct {
	Version                   int64
	Closed, ZeroHash, Current string
}

func (s *Service) ProjectCost(ctx context.Context, op string, i CostInput, who Identity, scope CostScope) (out any, err error) {
	defer func() {
		var m *mysql.MySQLError
		if errors.As(err, &m) && (m.Number == 1213 || m.Number == 1205 || m.Number == 1062) {
			err = costErr(409, "write_conflict")
		}
	}()
	if err = ValidateCostInput(op, i); err != nil {
		return nil, err
	}
	if err = scope.Validate(i.ProjectCode, op); err != nil {
		return nil, err
	}
	if who.Actor == "" || who.Client != "enterprise.runtime" || who.Tenant != s.binding.Key.Tenant || who.Deployment != s.binding.Domains["finance"].OwnerDeployment {
		return nil, costErr(403, "identity_invalid")
	}
	if !domaininstall.IsFinanceCostDomain(s.binding.Domains["finance"]) {
		return nil, costErr(503, "not_installed")
	}
	periodProject := i.ProjectCode
	if periodProject == "" {
		periodProject = "all"
	}
	p, _ := projectcost.NewPeriod(periodProject, i.PeriodMonth)
	live := op == "project-labor-preview" || CostWrite(op)
	calendar := projectcost.CalendarInput{}
	if live && s.costCalendar != nil {
		calendar, err = s.costCalendar.ReadCNMonth(ctx, i.PeriodMonth)
		if errors.Is(err, sql.ErrNoRows) {
			calendar = projectcost.CalendarInput{Code: "CN", Month: i.PeriodMonth}
			err = nil
		} else if err != nil {
			return nil, costErr(503, "calendar_unavailable")
		}
		if calendar.Month != i.PeriodMonth || calendar.Code != "CN" {
			return nil, costErr(503, "calendar_unavailable")
		}
	}
	if live && s.costCalendar == nil {
		return nil, costErr(503, "calendar_unavailable")
	}
	mode := enterprise.Read
	if CostWrite(op) {
		mode = enterprise.Write
		if who.Key == "" {
			return nil, costErr(400, "key_required")
		}
	}
	reqs := []enterprise.ResolveRequest{}
	for _, d := range []string{"people", "aims", "finance"} {
		r, e := s.request(d, mode)
		if e != nil {
			return nil, e
		}
		reqs = append(reqs, r)
	}
	var tx *sql.Tx
	var rs []enterprise.Resolved
	if mode == enterprise.Write {
		tx, rs, err = s.registry.BeginRepeatableWriteTransaction(ctx, reqs...)
	} else {
		tx, rs, err = s.registry.BeginSnapshotReadTransaction(ctx, reqs...)
	}
	if err != nil {
		return nil, err
	}
	defer tx.Rollback()
	pr, ar, fr := rs[0], rs[1], rs[2]
	// Read-only discovery does not acquire out-of-order Aims locks. After People
	// locks, current Aims range is locked and the complete UID set is compared.
	projectTable, e := ar.Table("aims_projects")
	if e != nil {
		return nil, e
	}
	var pid int64
	if i.ProjectCode != "" {
		if err = tx.QueryRowContext(ctx, "SELECT id FROM "+projectTable+" WHERE BINARY project_code=BINARY ?", i.ProjectCode).Scan(&pid); err != nil {
			if errors.Is(err, sql.ErrNoRows) {
				return nil, costErr(404, "project_not_found")
			}
			return nil, err
		}
	}
	if !live {
		out, err = costRead(ctx, tx, pr, ar, fr, op, i, who, scope)
		if err == nil {
			err = tx.Commit()
		}
		return out, err
	}
	entries, e := ar.Table("time_entries")
	if e != nil {
		return nil, e
	}
	rows, e := tx.QueryContext(ctx, "SELECT DISTINCT uid FROM "+entries+" WHERE project_id=? AND entry_date>=? AND entry_date<=? ORDER BY uid", pid, p.Start.Format("2006-01-02"), p.End.Format("2006-01-02"))
	if e != nil {
		return nil, e
	}
	uids := []string{}
	for rows.Next() {
		var uid string
		if e = rows.Scan(&uid); e != nil {
			rows.Close()
			return nil, e
		}
		uids = append(uids, uid)
	}
	e = rows.Err()
	rows.Close()
	if e != nil {
		return nil, e
	}
	persons, e := (people.ProjectCostInputs{Table: pr.Table}).ReadStandardCostInputs(ctx, tx, uids, p.End)
	if e != nil {
		return nil, e
	}
	times, e := (aims.ProjectCostInputs{Table: ar.Table}).ReadProjectTimeInputs(ctx, tx, p)
	if e != nil {
		return nil, e
	}
	currentSet := map[string]bool{}
	for _, v := range times.Entries {
		currentSet[v.EmployeeUID] = true
	}
	current := []string{}
	for v := range currentSet {
		current = append(current, v)
	}
	sort.Strings(current)
	if projectcost.Hash(current) != projectcost.Hash(uids) {
		return nil, costErr(409, "inputs_changed")
	}
	params, e := (finance.ProjectCostInputs{Table: fr.Table}).ReadCostParameterInput(ctx, tx, p.End)
	if e != nil {
		return nil, e
	}
	financial, e := readCostFinancial(ctx, tx, fr, p)
	if e != nil {
		return nil, e
	}
	periodTable, _ := fr.Table("finance_project_cost_period")
	period := costPeriod{}
	if mode == enterprise.Write {
		_, e = tx.ExecContext(ctx, "INSERT INTO "+periodTable+"(project_code,period_month) VALUES (?,?) ON DUPLICATE KEY UPDATE id=id", i.ProjectCode, i.PeriodMonth)
		if e != nil {
			return nil, e
		}
	}
	suffix := ""
	if mode == enterprise.Write {
		suffix = " FOR UPDATE"
	}
	e = tx.QueryRowContext(ctx, "SELECT row_version,COALESCE(CAST(closed_at AS CHAR),''),COALESCE(zero_input_sha256,''),COALESCE(current_batch_code,'') FROM "+periodTable+" WHERE project_code=? AND period_month=?"+suffix, i.ProjectCode, i.PeriodMonth).Scan(&period.Version, &period.Closed, &period.ZeroHash, &period.Current)
	if e != nil && !errors.Is(e, sql.ErrNoRows) {
		return nil, e
	}
	plan := projectcost.Build(times, persons, params, calendar, len(times.Entries) == 0 && period.ZeroHash == times.SHA256)
	plan.InputHash = projectcost.Hash([]any{plan.InputHash, financial.Hash})
	frozen := costFrozen{times, persons, params, plan, financial.Hash}
	if financial.Currency != "" && financial.Currency != plan.Currency {
		plan.Ready = false
		plan.Amount = ""
		plan.Reasons = append(plan.Reasons, "financial_currency_mismatch")
		frozen.Plan = plan
	}
	if mode == enterprise.Write {
		if e = lockCostProjections(ctx, tx, fr, i, plan); e != nil {
			return nil, e
		}
	}
	otherHash, otherCurrency, e := costOtherHash(ctx, tx, fr, i)
	if e != nil {
		return nil, e
	}
	plan.InputHash = projectcost.Hash([]any{plan.InputHash, otherHash})
	if otherCurrency != "" && otherCurrency != plan.Currency {
		plan.Ready = false
		plan.Amount = ""
		plan.Reasons = append(plan.Reasons, "other_cost_currency_mismatch")
	}
	frozen.Plan = plan
	if mode != enterprise.Write {
		out = costPublic(i, period, plan)
		err = tx.Commit()
		return out, err
	}
	// Lock projections and complete old set before the final receipt lock. Reads
	// and salary evidence are not returned in the receipt/audit public snapshot.

	digest, e := integrationoperation.ValidateAndDigestCommand(map[string]any{"operation": op, "intent": CostIntent(i), "actor": who.Actor})
	if e != nil {
		return nil, e
	}
	raw, _ := json.Marshal(map[string]any{"operation": op, "intent": CostIntent(i), "actor": who.Actor})
	oid := uuid.NewHash(sha256.New(), uuid.NameSpaceOID, []byte("finance14|"+who.Tenant+"|"+who.Deployment+"|"+who.Actor+"|"+op+"|"+who.Key), 4).String()
	receipt, _ := fr.Table("service_command_receipt")
	repo, e := integrationoperation.NewReceiptRepository(fr.DB, integrationoperation.WithReceiptTable(receipt))
	if e != nil {
		return nil, e
	}
	in := integrationoperation.ReceiptCommandInput{TrustedContext: integrationoperation.TrustedContext{TenantCode: who.Tenant, DeploymentCode: who.Deployment, SourceApp: "enterprise", ServiceClientID: who.Client, RequestID: who.RequestID}, SourceDeploymentCode: who.Deployment, TargetDeploymentCode: who.Deployment, TargetApp: "finance", OperationID: oid, OperationCode: "finance.14." + op + ".v1", RequiredCapability: "finance:enterprise-host:execute", IdempotencyKey: who.Key, CommandSchemaVersion: "v1", CommandSHA256: digest, Command: raw, OriginalActorUID: who.Actor}
	result, e := repo.ExecuteInTransaction(ctx, tx, in, func(ctx context.Context, tx *sql.Tx, _ json.RawMessage) (integrationoperation.ReceiptBusinessResult, error) {
		if period.Closed != "" {
			return integrationoperation.ReceiptBusinessResult{}, costErr(409, "period_closed")
		}
		// A newly created period has logical initial version zero.
		expected := period.Version
		if period.Current == "" && period.ZeroHash == "" && period.Version == 1 {
			expected = 0
		}
		if i.ExpectedVersion != expected || i.ExpectedInputHash != plan.InputHash {
			return integrationoperation.ReceiptBusinessResult{}, costErr(409, "version_conflict")
		}
		var reply map[string]any
		switch op {
		case "project-cost-period-confirm-zero":
			if len(times.Entries) != 0 {
				return integrationoperation.ReceiptBusinessResult{}, costErr(409, "zero_denied")
			}
			_, e = tx.ExecContext(ctx, "UPDATE "+periodTable+" SET zero_confirmed_at=NOW(6),zero_confirmed_by=?,zero_input_sha256=?,row_version=row_version+1 WHERE project_code=? AND period_month=?", who.Actor, times.SHA256, i.ProjectCode, i.PeriodMonth)
			period.Version++
			period.ZeroHash = times.SHA256
			reply = costPublic(i, period, plan)
		case "project-cost-period-close":
			if period.Current == "" || !plan.Ready {
				return integrationoperation.ReceiptBusinessResult{}, costErr(409, "not_ready")
			}
			batch, _ := fr.Table("finance_project_cost_batch")
			var status, hash string
			if e = tx.QueryRowContext(ctx, "SELECT readiness_status,input_sha256 FROM "+batch+" WHERE code=?", period.Current).Scan(&status, &hash); e != nil {
				return integrationoperation.ReceiptBusinessResult{}, e
			}
			if status != "ready" || hash != plan.InputHash {
				return integrationoperation.ReceiptBusinessResult{}, costErr(409, "inputs_changed")
			}
			_, e = tx.ExecContext(ctx, "UPDATE "+periodTable+" SET closed_at=NOW(6),closed_by=?,row_version=row_version+1 WHERE project_code=? AND period_month=?", who.Actor, i.ProjectCode, i.PeriodMonth)
			period.Version++
			period.Closed = "closed"
			reply = costPublic(i, period, plan)
		default:
			reply, e = replaceCost(ctx, tx, fr, i, who, period, frozen, calendar, financial, oid)
		}
		if e != nil {
			return integrationoperation.ReceiptBusinessResult{}, e
		}
		snapshot, _ := json.Marshal(reply)
		audit, _ := fr.Table("finance_audit_log")
		if _, e = tx.ExecContext(ctx, "INSERT INTO "+audit+"(entity_type,entity_code,action,new_value,operator_uid,channel,request_id) VALUES('finance_project_cost_period',?,?,?,?,'user',?)", i.ProjectCode+"/"+i.PeriodMonth, op, string(snapshot), who.Actor, oid); e != nil {
			return integrationoperation.ReceiptBusinessResult{}, e
		}
		return integrationoperation.ReceiptBusinessResult{TargetBizType: "finance_project_cost_period", TargetBizCode: oid, HTTPStatus: 200, ResponseSummarySHA256: approvalDigest(snapshot)}, nil
	})
	if e != nil {
		return nil, e
	}
	var snapshot string
	audit, _ := fr.Table("finance_audit_log")
	if e = tx.QueryRowContext(ctx, "SELECT new_value FROM "+audit+" WHERE request_id=? AND action=?", result.TargetBizCode, op).Scan(&snapshot); e != nil {
		return nil, e
	}
	var reply map[string]any
	if e = json.Unmarshal([]byte(snapshot), &reply); e != nil {
		return nil, e
	}
	if e = tx.Commit(); e != nil {
		return nil, e
	}
	return reply, nil
}
func costPublic(i CostInput, p costPeriod, plan projectcost.Plan) map[string]any {
	var amount any
	if plan.Ready {
		amount = plan.Amount
	}
	version := p.Version
	if version == 1 && p.Current == "" && p.ZeroHash == "" {
		version = 0
	}
	return map[string]any{"projectCode": i.ProjectCode, "periodMonth": i.PeriodMonth, "expectedVersion": version, "inputHash": plan.InputHash, "currency": plan.Currency, "laborCostAmount": amount, "readiness": map[bool]string{true: "ready", false: "not_ready"}[plan.Ready], "missingInputs": plan.Reasons, "batchCode": p.Current, "closed": p.Closed != ""}
}

type costFinancial struct {
	Receipt, Expense, Currency, Hash string
	Facts                            []any
}

func readCostFinancial(ctx context.Context, tx *sql.Tx, r enterprise.Resolved, p projectcost.Period) (costFinancial, error) {
	out := costFinancial{Receipt: "0.00", Expense: "0.00", Facts: []any{}}
	sumR, sumE := new(big.Rat), new(big.Rat)
	receipt, _ := r.Table("finance_receipt")
	recon, _ := r.Table("finance_reconciliation")
	expense, _ := r.Table("finance_expense")
	// Receipt locks precede reconciliations. Include all receipt parents to protect
	// reassignment of reconciliation.project_code without reversing the M3 order.
	rows, e := tx.QueryContext(ctx, "SELECT id,CAST(row_version AS CHAR),status,CAST(received_at AS CHAR),currency_code,COALESCE(confirmed_by,''),deleted_at IS NOT NULL FROM "+receipt+" ORDER BY id FOR UPDATE")
	if e != nil {
		return out, e
	}
	type parent struct {
		version, status, date, currency, confirmed string
		deleted                                    bool
	}
	parents := map[int64]parent{}
	for rows.Next() {
		var id int64
		var v parent
		if e = rows.Scan(&id, &v.version, &v.status, &v.date, &v.currency, &v.confirmed, &v.deleted); e != nil {
			rows.Close()
			return out, e
		}
		parents[id] = v
	}
	e = rows.Err()
	rows.Close()
	if e != nil {
		return out, e
	}
	addCurrency := func(c string) {
		if out.Currency == "" {
			out.Currency = c
		} else if c != out.Currency {
			out.Currency = "MIXED"
		}
	}
	rows, e = tx.QueryContext(ctx, "SELECT id,receipt_id,CAST(reconciled_amount AS CHAR),currency_code,status,CAST(row_version AS CHAR) FROM "+recon+" WHERE project_code=? ORDER BY id FOR UPDATE", p.ProjectCode)
	if e != nil {
		return out, e
	}
	for rows.Next() {
		var id, rid int64
		var amount, currency, status, version string
		if e = rows.Scan(&id, &rid, &amount, &currency, &status, &version); e != nil {
			rows.Close()
			return out, e
		}
		v, ok := parents[rid]
		if ok && !v.deleted && v.confirmed != "" && (v.status == "confirmed" || v.status == "partially_reconciled" || v.status == "reconciled") && status == "active" && v.date >= p.Start.Format("2006-01-02") && v.date <= p.End.Format("2006-01-02") {
			n, ok := new(big.Rat).SetString(amount)
			if !ok || n.Sign() < 0 {
				rows.Close()
				return out, costErr(503, "financial_input_invalid")
			}
			sumR.Add(sumR, n)
			addCurrency(currency)
			if currency != v.currency {
				out.Currency = "MIXED"
			}
			out.Facts = append(out.Facts, []any{"reconciliation", id, rid, version, v.version, amount, currency, v.date})
		}
	}
	e = rows.Err()
	rows.Close()
	if e != nil {
		return out, e
	}
	rows, e = tx.QueryContext(ctx, "SELECT id,CAST(row_version AS CHAR),CAST(expense_amount AS CHAR),currency_code,status,CAST(expense_date AS CHAR),COALESCE(confirmed_by,''),deleted_at IS NOT NULL FROM "+expense+" WHERE project_code=? ORDER BY id FOR UPDATE", p.ProjectCode)
	if e != nil {
		return out, e
	}
	for rows.Next() {
		var id int64
		var version, amount, currency, status, date, confirmed string
		var deleted bool
		if e = rows.Scan(&id, &version, &amount, &currency, &status, &date, &confirmed, &deleted); e != nil {
			rows.Close()
			return out, e
		}
		if !deleted && status == "confirmed" && confirmed != "" && date >= p.Start.Format("2006-01-02") && date <= p.End.Format("2006-01-02") {
			n, ok := new(big.Rat).SetString(amount)
			if !ok || n.Sign() < 0 {
				rows.Close()
				return out, costErr(503, "financial_input_invalid")
			}
			sumE.Add(sumE, n)
			addCurrency(currency)
			out.Facts = append(out.Facts, []any{"expense", id, version, amount, currency, date})
		}
	}
	e = rows.Err()
	rows.Close()
	if e != nil {
		return out, e
	}
	out.Receipt = projectcost.Round(sumR, 2)
	out.Expense = projectcost.Round(sumE, 2)
	out.Hash = projectcost.Hash(out.Facts)
	return out, nil
}
func lockCostProjections(ctx context.Context, tx *sql.Tx, r enterprise.Resolved, i CostInput, p projectcost.Plan) error {
	summary, _ := r.Table("finance_project_summary")
	_, e := tx.ExecContext(ctx, "INSERT INTO "+summary+"(project_code,period_month,cost_missing_inputs_json) VALUES (?,?,'[]') ON DUPLICATE KEY UPDATE id=id", i.ProjectCode, i.PeriodMonth)
	if e != nil {
		return e
	}
	var id int64
	if e = tx.QueryRowContext(ctx, "SELECT id FROM "+summary+" WHERE project_code=? AND period_month=? FOR UPDATE", i.ProjectCode, i.PeriodMonth).Scan(&id); e != nil {
		return e
	}
	snapshot, _ := r.Table("finance_employee_cost_snapshot")
	for _, item := range p.Items {
		var id int64
		e = tx.QueryRowContext(ctx, "SELECT id FROM "+snapshot+" WHERE employee_uid=? AND period_month=? FOR UPDATE", item.EmployeeUID, i.PeriodMonth).Scan(&id)
		if e != nil && !errors.Is(e, sql.ErrNoRows) {
			return e
		}
	}
	alloc, _ := r.Table("finance_project_cost_allocation")
	rows, e := tx.QueryContext(ctx, "SELECT id FROM "+alloc+" WHERE project_code=? AND period_month=? ORDER BY code FOR UPDATE", i.ProjectCode, i.PeriodMonth)
	if e != nil {
		return e
	}
	for rows.Next() {
		if e = rows.Scan(&id); e != nil {
			rows.Close()
			return e
		}
	}
	e = rows.Err()
	rows.Close()
	return e
}
func replaceCost(ctx context.Context, tx *sql.Tx, r enterprise.Resolved, i CostInput, who Identity, period costPeriod, frozen costFrozen, cal projectcost.CalendarInput, financial costFinancial, oid string) (map[string]any, error) {
	plan := frozen.Plan
	batch, _ := r.Table("finance_project_cost_batch")
	items, _ := r.Table("finance_project_cost_batch_item")
	snapshot, _ := r.Table("finance_employee_cost_snapshot")
	alloc, _ := r.Table("finance_project_cost_allocation")
	summary, _ := r.Table("finance_project_summary")
	pt, _ := r.Table("finance_project_cost_period")
	// A distinct key with identical frozen inputs returns the current immutable
	// revision; the command still gets its own replayable receipt and audit.
	if period.Current != "" {
		var old string
		if e := tx.QueryRowContext(ctx, "SELECT input_sha256 FROM "+batch+" WHERE code=?", period.Current).Scan(&old); e != nil {
			return nil, e
		} else if old == plan.InputHash {
			return costPublic(i, period, plan), nil
		}
	}
	var revision int64
	if e := tx.QueryRowContext(ctx, "SELECT COALESCE(MAX(revision),0)+1 FROM "+batch+" WHERE project_code=? AND period_month=?", i.ProjectCode, i.PeriodMonth).Scan(&revision); e != nil {
		return nil, e
	}
	code := "CB-" + strings.ReplaceAll(oid, "-", "")
	readiness := "not_ready"
	var amount, currency any
	if len(plan.Currency) == 3 {
		currency = plan.Currency
	}
	if plan.Ready {
		readiness = "ready"
		amount = plan.Amount
	}
	reasons, _ := json.Marshal(plan.Reasons)
	fraw, _ := json.Marshal(frozen)
	calendar, _ := json.Marshal(cal)
	// Projected rows are locked already. Old managed sources only; preserve all
	// manual/shared/asset rows including active labor from other rule owners.
	_, e := tx.ExecContext(ctx, "UPDATE "+alloc+" SET status='reversed',row_version=row_version+1 WHERE project_code=? AND period_month=? AND source_table='aims.time_entries' AND rule_code=? AND status='active'", i.ProjectCode, i.PeriodMonth, projectcost.FormulaVersion)
	if e != nil {
		return nil, e
	}
	if plan.Ready {
		for _, item := range plan.Items {
			personHash := projectcost.Hash([]any{item.Person, frozen.Parameters, cal.Code, cal.Month, cal.SHA256, projectcost.FormulaVersion})
			refs, _ := json.Marshal(map[string]any{"person": item.Person, "parameters": frozen.Parameters, "calendarHash": cal.SHA256})
			_, e = tx.ExecContext(ctx, "INSERT INTO "+snapshot+"(employee_uid,period_month,input_sha256,standard_cost_amount,currency_code,people_snapshot_code,source_refs_json) VALUES (?,?,?,?,?,NULL,?) ON DUPLICATE KEY UPDATE row_version=row_version+(input_sha256<>VALUES(input_sha256)),input_sha256=VALUES(input_sha256),standard_cost_amount=VALUES(standard_cost_amount),currency_code=VALUES(currency_code),source_refs_json=VALUES(source_refs_json)", item.EmployeeUID, i.PeriodMonth, personHash, item.StandardCost, item.Currency, string(refs))
			if e != nil {
				return nil, e
			}
			acode := "CA-" + projectcost.Hash([]any{i.ProjectCode, i.PeriodMonth, item.EmployeeUID, projectcost.FormulaVersion})[:48]
			_, e = tx.ExecContext(ctx, "INSERT INTO "+alloc+"(code,project_code,period_month,allocation_type,source_table,employee_uid,amount,currency_code,allocation_basis,basis_value,rule_code,batch_code,source_refs_json,status,created_by) VALUES (?,?,?,'labor','aims.time_entries',?,?,?,'approved_hours',?,?,?,?, 'active',?) ON DUPLICATE KEY UPDATE amount=VALUES(amount),currency_code=VALUES(currency_code),basis_value=VALUES(basis_value),batch_code=VALUES(batch_code),source_refs_json=VALUES(source_refs_json),status='active',row_version=row_version+1", acode, i.ProjectCode, i.PeriodMonth, item.EmployeeUID, item.Amount, item.Currency, item.Hours, projectcost.FormulaVersion, code, string(refs), who.Actor)
			if e != nil {
				return nil, e
			}
		}
	}
	// Freeze immutable evidence only after current projections; history queries
	// never join mutable People/parameter/calendar rows.
	_, e = tx.ExecContext(ctx, "INSERT INTO "+batch+"(code,project_code,period_month,revision,parent_batch_code,input_sha256,formula_version,readiness_status,missing_inputs_json,input_snapshot_json,calendar_snapshot_json,currency_code,labor_cost_amount,calculated_by,receipt_key) VALUES (?,?,?,?,NULLIF(?,''),?,?,?,?,?,?,?,?,?,?)", code, i.ProjectCode, i.PeriodMonth, revision, period.Current, plan.InputHash, projectcost.FormulaVersion, readiness, string(reasons), string(fraw), string(calendar), currency, amount, who.Actor, oid)
	if e != nil {
		return nil, e
	}
	if plan.Ready {
		for _, item := range plan.Items {
			raw, _ := json.Marshal(item)
			_, e = tx.ExecContext(ctx, "INSERT INTO "+items+"(batch_code,employee_uid,project_hours,standard_work_hours,allocation_ratio,standard_cost_amount,allocated_cost_amount,currency_code,source_snapshot_json) VALUES (?,?,?,?,?,?,?,?,?)", code, item.EmployeeUID, item.Hours, item.StandardHours, item.Ratio, item.StandardCost, item.Amount, item.Currency, string(raw))
			if e != nil {
				return nil, e
			}
		}
	}
	other := new(big.Rat)
	rows, e := tx.QueryContext(ctx, "SELECT CAST(amount AS CHAR),currency_code FROM "+alloc+" WHERE project_code=? AND period_month=? AND status='active' AND NOT(source_table='aims.time_entries' AND rule_code=?) ORDER BY code FOR UPDATE", i.ProjectCode, i.PeriodMonth, projectcost.FormulaVersion)
	if e != nil {
		return nil, e
	}
	for rows.Next() {
		var money, c string
		if e = rows.Scan(&money, &c); e != nil {
			rows.Close()
			return nil, e
		}
		n, ok := new(big.Rat).SetString(money)
		if !ok {
			rows.Close()
			return nil, costErr(503, "financial_input_invalid")
		}
		other.Add(other, n)
		if c != plan.Currency {
			rows.Close()
			return nil, costErr(409, "currency_mismatch")
		}
	}
	e = rows.Err()
	rows.Close()
	if e != nil {
		return nil, e
	}
	var profit, margin any
	if plan.Ready {
		income, _ := new(big.Rat).SetString(financial.Receipt)
		expense, _ := new(big.Rat).SetString(financial.Expense)
		labor, _ := new(big.Rat).SetString(plan.Amount)
		gross := new(big.Rat).Sub(new(big.Rat).Sub(new(big.Rat).Sub(income, expense), labor), other)
		profit = projectcost.Round(gross, 2)
		if income.Sign() > 0 {
			margin = projectcost.Round(new(big.Rat).Quo(gross, income), 4)
		}
	}
	_, e = tx.ExecContext(ctx, "UPDATE "+summary+" SET currency_code=?,receipt_amount=?,direct_expense_amount=?,labor_cost_amount=?,other_cost_amount=?,gross_profit_amount=?,gross_margin_rate=?,cost_readiness_status=?,cost_missing_inputs_json=?,cost_input_hash=?,current_batch_code=?,financial_input_sha256=?,row_version=row_version+1,calculated_at=NOW(6) WHERE project_code=? AND period_month=?", currency, financial.Receipt, financial.Expense, amount, projectcost.Round(other, 2), profit, margin, readiness, string(reasons), plan.InputHash, code, financial.Hash, i.ProjectCode, i.PeriodMonth)
	if e != nil {
		return nil, e
	}
	_, e = tx.ExecContext(ctx, "UPDATE "+pt+" SET current_batch_code=?,row_version=row_version+1,zero_confirmed_at=IF(zero_input_sha256=?,zero_confirmed_at,NULL),zero_confirmed_by=IF(zero_input_sha256=?,zero_confirmed_by,NULL),zero_input_sha256=IF(zero_input_sha256=?,zero_input_sha256,NULL) WHERE project_code=? AND period_month=?", code, frozen.Time.SHA256, frozen.Time.SHA256, frozen.Time.SHA256, i.ProjectCode, i.PeriodMonth)
	if e != nil {
		return nil, e
	}
	period.Version++
	period.Current = code
	return costPublic(i, period, plan), nil
}

// Only public projection columns leave this service. No frozen JSON, rank,
// salary components or person identifiers appear in project/history responses.
func costRead(ctx context.Context, tx *sql.Tx, pr, ar, r enterprise.Resolved, op string, i CostInput, who Identity, scope CostScope) (any, error) {
	tableName := "finance_project_summary"
	cols := "project_code,period_month,currency_code,labor_cost_amount,cost_readiness_status,cost_missing_inputs_json,current_batch_code,row_version,receipt_amount,direct_expense_amount,other_cost_amount,gross_profit_amount,gross_margin_rate"
	where := "period_month=?"
	args := []any{i.PeriodMonth}
	if i.ProjectCode != "" {
		where += " AND project_code=?"
		args = append(args, i.ProjectCode)
	} else if scope.Access == "projects" {
		where += " AND project_code IN (" + strings.TrimSuffix(strings.Repeat("?,", len(scope.ProjectCodes)), ",") + ")"
		for _, p := range scope.ProjectCodes {
			args = append(args, p)
		}
	}
	switch {
	case strings.HasPrefix(op, "project-labor-history-"):
		tableName = "finance_project_cost_batch"
		cols = "code,project_code,period_month,revision,input_sha256,formula_version,readiness_status,missing_inputs_json,currency_code,labor_cost_amount,calculated_by,CAST(created_at AS CHAR)"
	case strings.HasPrefix(op, "project-cost-period-"):
		tableName = "finance_project_cost_period"
		cols = "project_code,period_month,row_version,closed_at IS NOT NULL,zero_confirmed_at IS NOT NULL,current_batch_code"
	case strings.HasPrefix(op, "project-cost-allocations-"):
		tableName = "finance_project_cost_allocation"
		cols = "code,project_code,period_month,allocation_type,amount,currency_code,allocation_basis,basis_value,rule_code,batch_code,status,row_version"
	case strings.HasPrefix(op, "employee-costs-"):
		// Employee totals are restricted through project batch membership and the
		// current signed People salary scope. Mutable snapshot details stay private.
		tableName = "finance_employee_cost_snapshot"
		cols = "id,employee_uid,period_month,standard_cost_amount,currency_code,people_snapshot_code,row_version"
		allocation, _ := r.Table("finance_project_cost_allocation")
		membership := where
		where = "period_month=? AND employee_uid IN (SELECT employee_uid FROM " + allocation + " WHERE " + membership + " AND source_table='aims.time_entries' AND rule_code=?)"
		args = append([]any{i.PeriodMonth}, args...)
		args = append(args, projectcost.FormulaVersion)
		if scope.Salary.Access == "self" {
			where += " AND BINARY employee_uid=BINARY ?"
			args = append(args, who.Actor)
		} else if scope.Salary.Access == "dept" || scope.Salary.Access == "self_dept" {
			placeholders := strings.TrimSuffix(strings.Repeat("BINARY ?,", len(scope.Salary.DepartmentCodes)), ",")
			condition := "BINARY pe.dept_code IN (" + placeholders + ")"
			for _, dep := range scope.Salary.DepartmentCodes {
				args = append(args, dep)
			}
			if scope.Salary.Access == "self_dept" {
				condition = "(" + condition + " OR BINARY pe.employee_uid=BINARY ?)"
				args = append(args, who.Actor)
			}
			employees, e := pr.Table("people_employees")
			if e != nil {
				return nil, e
			}
			where += " AND EXISTS (SELECT 1 FROM " + employees + " pe WHERE BINARY pe.employee_uid=BINARY cost_item.employee_uid AND pe.archived_at IS NULL AND " + condition + ")"
		}
	}
	if i.Search != "" {
		column := "project_code"
		if tableName == "finance_employee_cost_snapshot" {
			column = "employee_uid"
		}
		// Literal substring matching avoids treating user input as SQL wildcards.
		where += " AND LOCATE(?," + column + ")>0"
		args = append(args, i.Search)
	}
	if i.Code != "" {
		column := "code"
		if tableName == "finance_employee_cost_snapshot" {
			column = "id"
		}
		where += " AND " + column + "=?"
		args = append(args, i.Code)
	}
	table, e := r.Table(tableName)
	if e != nil {
		return nil, e
	}
	if tableName == "finance_employee_cost_snapshot" {
		table += " AS cost_item"
	}
	if tableName == "finance_project_cost_allocation" {
		// Public labor allocation is a project/rule total, never an employee line.
		// Even an opaque deterministic per-UID code plus known hours could leak
		// monthly salary. Non-labor/manual sources keep their original line identity.
		managed := "source_table='aims.time_entries' AND rule_code='" + projectcost.FormulaVersion + "'"
		publicCode := "IF(" + managed + ",CONCAT('CL-',LEFT(SHA2(CONCAT(project_code,'|',period_month,'|',rule_code,'|',status),256),48)),code)"
		table = "(SELECT MIN(id) AS id," + publicCode + " AS code,project_code,period_month,allocation_type,SUM(amount) AS amount,currency_code,IF(" + managed + ",'project_total',allocation_basis) AS allocation_basis,IF(" + managed + ",NULL,basis_value) AS basis_value,rule_code,MAX(batch_code) AS batch_code,status,MAX(row_version) AS row_version FROM " + table + " GROUP BY " + publicCode + ",project_code,period_month,allocation_type,currency_code,IF(" + managed + ",'project_total',allocation_basis),IF(" + managed + ",NULL,basis_value),rule_code,status) AS public_allocation"
	}
	if tableName == "finance_project_summary" {
		projects, err := ar.Table("aims_projects")
		if err != nil {
			return nil, err
		}
		table = projects + " ap LEFT JOIN " + table + " fs ON BINARY fs.project_code=BINARY ap.project_code AND fs.period_month=?"
		where = "1=1"
		args = []any{i.PeriodMonth, i.PeriodMonth}
		// The first month is the output column; the second binds the JOIN.
		if i.ProjectCode != "" {
			where += " AND ap.project_code=?"
			args = append(args, i.ProjectCode)
		} else if scope.Access == "projects" {
			where += " AND ap.project_code IN (" + strings.TrimSuffix(strings.Repeat("?,", len(scope.ProjectCodes)), ",") + ")"
			for _, code := range scope.ProjectCodes {
				args = append(args, code)
			}
		}
		if i.Search != "" {
			where += " AND (LOCATE(?,ap.project_code)>0 OR LOCATE(?,ap.name)>0)"
			args = append(args, i.Search, i.Search)
		}
		cols = "ap.project_code,? AS period_month,ap.name AS project_name,fs.currency_code,fs.labor_cost_amount,COALESCE(fs.cost_readiness_status,'not_ready') AS cost_readiness_status,COALESCE(fs.cost_missing_inputs_json,JSON_ARRAY('cost_batch_required')) AS cost_missing_inputs_json,fs.current_batch_code,COALESCE(fs.row_version,0) AS row_version,fs.receipt_amount,fs.direct_expense_amount,fs.other_cost_amount,fs.gross_profit_amount,fs.gross_margin_rate"
	}
	var total int64
	if e = tx.QueryRowContext(ctx, "SELECT COUNT(*) FROM "+table+" WHERE "+where, func() []any {
		if tableName == "finance_project_summary" {
			return args[1:]
		}
		return args
	}()...).Scan(&total); e != nil {
		return nil, e
	}
	order := "id DESC"
	if tableName == "finance_project_summary" {
		order = "ap.id DESC"
	}
	query := "SELECT " + cols + " FROM " + table + " WHERE " + where + " ORDER BY " + order
	if strings.HasSuffix(op, "-page") {
		query += " LIMIT ? OFFSET ?"
		args = append(args, i.PageSize, (i.Page-1)*i.PageSize)
	}
	rows, e := tx.QueryContext(ctx, query, args...)
	if e != nil {
		return nil, e
	}
	defer rows.Close()
	names, e := rows.Columns()
	if e != nil {
		return nil, e
	}
	items := []map[string]any{}
	for rows.Next() {
		values := make([]any, len(names))
		ptrs := make([]any, len(names))
		for n := range values {
			ptrs[n] = &values[n]
		}
		if e = rows.Scan(ptrs...); e != nil {
			return nil, e
		}
		v := map[string]any{}
		for n, name := range names {
			if raw, ok := values[n].([]byte); ok {
				v[name] = string(raw)
			} else {
				v[name] = values[n]
			}
		}
		if tableName == "finance_project_summary" {
			missing, _ := v["cost_missing_inputs_json"].(string)
			if strings.Contains(missing, "financial_currency_mismatch") || strings.Contains(missing, "financialCurrency") || strings.Contains(missing, "other_cost_currency_mismatch") {
				// No FX contract exists. Never expose a cross-currency sum as money.
				for _, field := range []string{"currency_code", "receipt_amount", "direct_expense_amount", "other_cost_amount", "gross_profit_amount", "gross_margin_rate"} {
					v[field] = nil
				}
			}
		}
		items = append(items, v)
	}
	if e = rows.Err(); e != nil {
		return nil, e
	}
	if !strings.HasSuffix(op, "-page") {
		if len(items) == 0 {
			return map[string]any{"data": nil}, nil
		}
		return map[string]any{"data": items[0]}, nil
	}
	return map[string]any{"data": items, "total": total, "page": i.Page, "pageSize": i.PageSize}, nil
}

func costOtherHash(ctx context.Context, tx *sql.Tx, r enterprise.Resolved, i CostInput) (string, string, error) {
	table, e := r.Table("finance_project_cost_allocation")
	if e != nil {
		return "", "", e
	}
	rows, e := tx.QueryContext(ctx, "SELECT code,CAST(amount AS CHAR),currency_code,CAST(row_version AS CHAR) FROM "+table+" WHERE project_code=? AND period_month=? AND status='active' AND NOT(source_table='aims.time_entries' AND rule_code=?) ORDER BY code FOR UPDATE", i.ProjectCode, i.PeriodMonth, projectcost.FormulaVersion)
	if e != nil {
		return "", "", e
	}
	defer rows.Close()
	facts := []any{}
	currency := ""
	for rows.Next() {
		var code, amount, c, version string
		if e = rows.Scan(&code, &amount, &c, &version); e != nil {
			return "", "", e
		}
		facts = append(facts, []string{code, amount, c, version})
		if currency == "" {
			currency = c
		} else if currency != c {
			currency = "MIXED"
		}
	}
	return projectcost.Hash(facts), currency, rows.Err()
}
