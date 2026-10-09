package aims

import (
	"context"
	"database/sql"
	"regexp"
	"slices"
	"sort"
	"strings"
	"time"

	"github.com/huizhi-yun/data-runtime/internal/enterprise"
	"github.com/huizhi-yun/data-runtime/internal/httperror"
	"github.com/huizhi-yun/data-runtime/internal/projectscope"
)

// ContractProjectPlan is an owning-domain command, never a SQL/table selector.
// The caller locks every participating Altoc object before invoking this core.
// Neither function starts/commits a transaction or performs an external call.
type ContractProjectPlan struct {
	ProjectCode          string   `json:"projectCode"`
	Name                 string   `json:"name"`
	DeptCode             string   `json:"deptCode"`
	Create               bool     `json:"create"`
	LineCodes            []string `json:"lineCodes"`
	ObligationCodes      []string `json:"obligationCodes"`
	BillingScheduleCodes []string `json:"billingScheduleCodes"`
}
type ContractProjectPermit struct {
	ActorUID       string                   `json:"actorUid"`
	Tenant         string                   `json:"tenant"`
	Deployment     string                   `json:"deployment"`
	ProjectCode    string                   `json:"projectCode"`
	Resource       string                   `json:"resource"`
	Action         string                   `json:"action"`
	Allowed        bool                     `json:"allowed"`
	ExpiresAt      int64                    `json:"expiresAt"`
	BundleVersion  string                   `json:"bundleVersion"`
	BundleHash     string                   `json:"bundleHash"`
	PolicyRevision *int64                   `json:"policyRevision"`
	Scope          *projectscope.Projection `json:"scope"`
}
type ContractProjectIdentity struct {
	ActorUID, Tenant, Deployment, ContractCode, CustomerCode string
	Permits                                                  []ContractProjectPermit
	Descendants                                              map[string][]string
}
type ContractProjectResult struct {
	ID   int64
	Name string
}
type LockedContractProject struct {
	plan      ContractProjectPlan
	projectID int64
	facts     projectscope.Facts
	tables    map[string]string
	// unexported: only this core may produce a checked preflight record.
	checked  bool
	lockedTx *sql.Tx
	identity ContractProjectIdentity
}

var contractProjectCode = regexp.MustCompile(`^[A-Z0-9][A-Z0-9._-]{0,63}$`)

func contractProjectError(status int, code string) error {
	return httperror.New(status, code, "Contract project command rejected")
}
func ValidateContractProjectPlans(plans []ContractProjectPlan) error {
	if len(plans) < 1 || len(plans) > 50 {
		return contractProjectError(400, "contract_projects_invalid")
	}
	seen := map[string]bool{}
	for _, p := range plans {
		if !contractProjectCode.MatchString(p.ProjectCode) || len(p.ProjectCode) > 50 || normalizeProjectCode(p.ProjectCode) != p.ProjectCode || strings.Contains(p.ProjectCode, "..") || seen[p.ProjectCode] || p.Name != strings.TrimSpace(p.Name) || p.Create && (len([]rune(p.Name)) < 1 || len([]rune(p.Name)) > 200) || len(p.DeptCode) > 50 || strings.ContainsAny(p.Name+p.DeptCode, "\x00\r\n") {
			return contractProjectError(400, "contract_projects_invalid")
		}
		seen[p.ProjectCode] = true
		for _, codes := range [][]string{p.LineCodes, p.ObligationCodes, p.BillingScheduleCodes} {
			unique := map[string]bool{}
			if len(codes) > 500 {
				return contractProjectError(400, "contract_projects_invalid")
			}
			for _, code := range codes {
				if code == "" || len(code) > 64 || strings.TrimSpace(code) != code || unique[code] || strings.ContainsAny(code, "\x00\r\n") {
					return contractProjectError(400, "contract_projects_invalid")
				}
				unique[code] = true
			}
		}
	}
	return nil
}
func projectContractPermission(id ContractProjectIdentity, p ContractProjectPlan, resource, action string, f projectscope.Facts) error {
	found := false
	for _, a := range id.Permits {
		if a.ProjectCode != p.ProjectCode || a.Resource != resource || a.Action != action {
			continue
		}
		if found || a.ActorUID != id.ActorUID || a.Tenant != id.Tenant || a.Deployment != id.Deployment || a.Action != action || !a.Allowed || a.BundleVersion == "" || a.BundleHash == "" || a.PolicyRevision == nil || *a.PolicyRevision < 0 || a.Scope == nil || a.ExpiresAt <= time.Now().UnixMilli() || a.ExpiresAt > time.Now().Add(15*time.Second).UnixMilli() {
			return contractProjectError(403, "contract_project_permit_invalid")
		}
		found = true
		for _, root := range a.Scope.DepartmentTreeRoots {
			children, ok := id.Descendants[root]
			if !ok {
				return contractProjectError(503, "contract_project_scope_unavailable")
			}
			if slices.Contains(children, f.DepartmentCode) {
				f.DepartmentTree = append(f.DepartmentTree, root)
			}
		}
		allowed, err := a.Scope.Allows(f)
		if err != nil || !allowed {
			return contractProjectError(403, "contract_project_scope_denied")
		}
	}
	if !found {
		return contractProjectError(403, "contract_project_permit_missing")
	}
	return nil
}
func PrepareContractProjectsTx(ctx context.Context, tx *sql.Tx, r enterprise.Resolved, id ContractProjectIdentity, plans []ContractProjectPlan) ([]LockedContractProject, error) {
	if tx == nil || r.Domain != "aims" || r.Key.Tenant != id.Tenant || id.ActorUID == "" || id.Deployment == "" || id.ContractCode == "" {
		return nil, enterprise.ErrBindingMismatch
	}
	if err := ValidateContractProjectPlans(plans); err != nil {
		return nil, err
	}
	tables := map[string]string{}
	for _, name := range []string{"aims_projects", "aims_project_members", "project_lifecycle_events", "project_counters", "milestones"} {
		v, err := r.Table(name)
		if err != nil {
			return nil, err
		}
		tables[name] = v
	}
	ordered := append([]ContractProjectPlan(nil), plans...)
	sort.Slice(ordered, func(i, j int) bool { return ordered[i].ProjectCode < ordered[j].ProjectCode })
	out := make([]LockedContractProject, 0, len(plans))
	for _, p := range ordered {
		var pid int64
		var dept, leader, creator, contract, status, currentName string
		err := tx.QueryRowContext(ctx, "SELECT id,COALESCE(dept_code,''),COALESCE(leader_uid,''),created_by,COALESCE(contract_code,''),lifecycle_status,name FROM "+tables["aims_projects"]+" WHERE BINARY project_code=BINARY ? FOR UPDATE", p.ProjectCode).Scan(&pid, &dept, &leader, &creator, &contract, &status, &currentName)
		if err != nil && err != sql.ErrNoRows {
			return nil, err
		}
		if err == sql.ErrNoRows && !p.Create {
			return nil, contractProjectError(404, "contract_project_not_found")
		}
		if err == nil && (status == "archived" || contract != "" && contract != id.ContractCode || p.Create && (contract != id.ContractCode || creator != id.ActorUID)) {
			return nil, contractProjectError(409, "contract_project_conflict")
		}
		if err == nil && dept != p.DeptCode {
			return nil, contractProjectError(409, "contract_project_department_changed")
		}
		if err == nil {
			p.Name = currentName
		}
		facts := projectscope.Facts{ProjectCode: p.ProjectCode, DepartmentCode: p.DeptCode}
		if !p.Create {
			var member int
			err = tx.QueryRowContext(ctx, "SELECT COUNT(*) FROM "+tables["aims_project_members"]+" WHERE project_id=? AND BINARY uid=BINARY ? AND status='active' FOR UPDATE", pid, id.ActorUID).Scan(&member)
			if err != nil {
				return nil, err
			}
			facts.Member = member > 0
			facts.Owner = leader == id.ActorUID
			facts.Creator = creator == id.ActorUID
			facts.Participant = facts.Member || facts.Owner || facts.Creator
		}
		action := "edit"
		if p.Create {
			action = "create"
		}
		if err = projectContractPermission(id, p, "projects", action, facts); err != nil {
			return nil, err
		}
		milestoneFacts := facts
		if p.Create {
			milestoneFacts.Member = true
			milestoneFacts.Owner = true
			milestoneFacts.Creator = true
			milestoneFacts.Participant = true
		}
		if len(p.BillingScheduleCodes) > 0 {
			if err = projectContractPermission(id, p, "projects", "edit", milestoneFacts); err != nil {
				return nil, err
			}
		}
		out = append(out, LockedContractProject{plan: p, projectID: pid, facts: facts, tables: tables, checked: true, lockedTx: tx, identity: id})
	}
	// All project/member locks precede milestone locks, even for a multi-project plan.
	for _, p := range out {
		codes := append([]string(nil), p.plan.BillingScheduleCodes...)
		sort.Strings(codes)
		for _, code := range codes {
			rows, err := tx.QueryContext(ctx, "SELECT project_id FROM "+tables["milestones"]+" WHERE billing_schedule_code=? AND BINARY billing_schedule_code=BINARY ? ORDER BY id FOR UPDATE", code, code)
			if err != nil {
				return nil, err
			}
			for rows.Next() {
				var project int64
				if err = rows.Scan(&project); err != nil {
					rows.Close()
					return nil, err
				}
				if project != p.projectID {
					rows.Close()
					return nil, contractProjectError(409, "contract_billing_schedule_project_conflict")
				}
			}
			err = rows.Err()
			rows.Close()
			if err != nil {
				return nil, err
			}
		}
	}
	return out, nil
}

// ApplyContractProjectsTx consumes only this core's preflight records. It creates
// stable projects and milestone keys; replay is still gated by a fresh preflight.
func ApplyContractProjectsTx(ctx context.Context, tx *sql.Tx, id ContractProjectIdentity, checked []LockedContractProject, scheduleNames map[string]string) (map[string]ContractProjectResult, error) {
	result := map[string]ContractProjectResult{}
	for _, p := range checked {
		if !p.checked || tx == nil || p.lockedTx != tx || p.identity.ActorUID != id.ActorUID || p.identity.Tenant != id.Tenant || p.identity.Deployment != id.Deployment || p.identity.ContractCode != id.ContractCode {
			return nil, enterprise.ErrBindingMismatch
		}
		project := p.projectID
		if project == 0 {
			res, err := tx.ExecContext(ctx, "INSERT INTO "+p.tables["aims_projects"]+" (project_code,name,short_name,category,methodology,lifecycle_status,leader_uid,dept_code,security_level,confidentiality_level,contract_code,customer_code,created_by) VALUES (?,?,?,'delivery','PIVR','draft',?,NULLIF(?,''),'project_team','L1',?,?,?)", p.plan.ProjectCode, p.plan.Name, truncateAimsText(p.plan.Name, 50), id.ActorUID, p.plan.DeptCode, id.ContractCode, id.CustomerCode, id.ActorUID)
			if err != nil {
				return nil, err
			}
			project, err = res.LastInsertId()
			if err != nil {
				return nil, err
			}
			if _, err = tx.ExecContext(ctx, "INSERT INTO "+p.tables["aims_project_members"]+" (project_id,uid,role,status) VALUES (?,?,'manager','active')", project, id.ActorUID); err != nil {
				return nil, err
			}
			if _, err = tx.ExecContext(ctx, "INSERT INTO "+p.tables["project_counters"]+" (project_id,counter) VALUES (?,0)", project); err != nil {
				return nil, err
			}
			if _, err = tx.ExecContext(ctx, "INSERT INTO "+p.tables["project_lifecycle_events"]+" (project_id,from_status,to_status,effective_at,actor_uid,source) VALUES (?,NULL,'draft',UTC_TIMESTAMP(6),?,'altoc_contract')", project, id.ActorUID); err != nil {
				return nil, err
			}
		} else {
			if _, err := tx.ExecContext(ctx, "UPDATE "+p.tables["aims_projects"]+" SET contract_code=? WHERE id=? AND (contract_code IS NULL OR contract_code='' OR BINARY contract_code=BINARY ?)", id.ContractCode, project, id.ContractCode); err != nil {
				return nil, err
			}
		}
		codes := append([]string(nil), p.plan.BillingScheduleCodes...)
		sort.Strings(codes)
		for _, code := range codes {
			name, ok := scheduleNames[code]
			if !ok {
				return nil, contractProjectError(403, "contract_billing_schedule_mismatch")
			}
			var milestone int64
			var status string
			err := tx.QueryRowContext(ctx, "SELECT id,status FROM "+p.tables["milestones"]+" WHERE project_id=? AND BINARY billing_schedule_code=BINARY ? ORDER BY id FOR UPDATE", project, code).Scan(&milestone, &status)
			if err == nil {
				continue
			}
			if err != sql.ErrNoRows {
				return nil, err
			}
			if _, err = tx.ExecContext(ctx, "INSERT INTO "+p.tables["milestones"]+" (project_id,name,mode,status,billing_schedule_code,created_by) VALUES (?,?,'rolling_plan','planning',?,?)", project, name, code, id.ActorUID); err != nil {
				return nil, err
			}
		}
		result[p.plan.ProjectCode] = ContractProjectResult{ID: project, Name: p.plan.Name}
	}
	return result, nil
}

// Fixed lock order can be checked without exposing any query or storage API.
func ContractProjectLockOrder(plans []ContractProjectPlan) []string {
	codes := []string{}
	for _, p := range plans {
		codes = append(codes, p.ProjectCode)
	}
	sort.Strings(codes)
	return codes
}
