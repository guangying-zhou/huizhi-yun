package enterpriseapf

import (
	"context"
	"crypto/sha256"
	"database/sql"
	"github.com/huizhi-yun/data-runtime/internal/apps/aims"
	"sort"
)

func contractHash(s string) [32]byte { return sha256.Sum256([]byte(s)) }
func validateContractProjectTargets(ctx context.Context, tx *sql.Tx, t map[string]string, id string, plans []aims.ContractProjectPlan) (map[string]string, error) {
	names := map[string]string{}
	seen := map[string]bool{}
	for _, p := range plans {
		lines := map[int64]bool{}
		for _, code := range p.LineCodes {
			v, e := childID(ctx, tx, t, "altoc_contract_line", id, code)
			if e != nil {
				return nil, e
			}
			lines[v.(int64)] = true
		}
		for _, code := range p.ObligationCodes {
			var line sql.NullInt64
			e := tx.QueryRowContext(ctx, "SELECT contract_line_id FROM "+t["altoc_contract_obligation"]+" WHERE contract_id=? AND BINARY code=BINARY ? AND deleted_at IS NULL", id, code).Scan(&line)
			if e == sql.ErrNoRows {
				return nil, contractError(403, "altoc_contract_child_mismatch")
			}
			if e != nil {
				return nil, e
			}
			if line.Valid && !lines[line.Int64] {
				return nil, contractError(403, "altoc_contract_project_line_mismatch")
			}
		}
		for _, code := range p.BillingScheduleCodes {
			if seen[code] {
				return nil, contractError(409, "altoc_contract_schedule_multi_project")
			}
			seen[code] = true
			var name string
			var line sql.NullInt64
			e := tx.QueryRowContext(ctx, "SELECT name,contract_line_id FROM "+t["altoc_billing_schedule"]+" WHERE contract_id=? AND BINARY code=BINARY ? AND deleted_at IS NULL AND status<>'cancelled'", id, code).Scan(&name, &line)
			if e == sql.ErrNoRows {
				return nil, contractError(403, "altoc_contract_child_mismatch")
			}
			if e != nil {
				return nil, e
			}
			if line.Valid && !lines[line.Int64] {
				return nil, contractError(403, "altoc_contract_project_line_mismatch")
			}
			names[code] = name
		}
	}
	return names, nil
}
func applyContractProjectLinks(ctx context.Context, tx *sql.Tx, t map[string]string, id string, who Identity, plans []aims.ContractProjectPlan, projects map[string]aims.ContractProjectResult) error {
	ordered := append([]aims.ContractProjectPlan(nil), plans...)
	sort.Slice(ordered, func(i, j int) bool { return ordered[i].ProjectCode < ordered[j].ProjectCode })
	for _, p := range ordered {
		mode := "linked_existing"
		if p.Create {
			mode = "created_from_contract"
		}
		_, e := tx.ExecContext(ctx, "INSERT INTO "+t["altoc_contract_project_link"]+" (contract_id,project_code,project_name_snapshot,link_mode,created_by,updated_by) VALUES (?,?,?,?,?,?) ON DUPLICATE KEY UPDATE deleted_at=NULL,status='active',updated_by=VALUES(updated_by)", id, p.ProjectCode, projects[p.ProjectCode].Name, mode, who.Actor, who.Actor)
		if e != nil {
			return e
		}
		var link int64
		if e = tx.QueryRowContext(ctx, "SELECT id FROM "+t["altoc_contract_project_link"]+" WHERE contract_id=? AND BINARY project_code=BINARY ? AND project_role='delivery'", id, p.ProjectCode).Scan(&link); e != nil {
			return e
		}
		for _, code := range p.LineCodes {
			line, e := childID(ctx, tx, t, "altoc_contract_line", id, code)
			if e != nil {
				return e
			}
			if _, e = tx.ExecContext(ctx, "INSERT INTO "+t["altoc_contract_project_line_rel"]+" (contract_project_link_id,contract_line_id,created_by,updated_by) VALUES (?,?,?,?) ON DUPLICATE KEY UPDATE deleted_at=NULL,updated_by=VALUES(updated_by)", link, line, who.Actor, who.Actor); e != nil {
				return e
			}
		}
		for _, code := range p.ObligationCodes {
			ob, e := childID(ctx, tx, t, "altoc_contract_obligation", id, code)
			if e != nil {
				return e
			}
			if _, e = tx.ExecContext(ctx, "INSERT INTO "+t["altoc_contract_project_obligation_rel"]+" (contract_project_link_id,obligation_id,created_by) VALUES (?,?,?) ON DUPLICATE KEY UPDATE deleted_at=NULL", link, ob, who.Actor); e != nil {
				return e
			}
		}
	}
	return nil
}
func validateContractActivationCoverage(ctx context.Context, tx *sql.Tx, t map[string]string, id string) error {
	var n int
	e := tx.QueryRowContext(ctx, "SELECT COUNT(*) FROM "+t["altoc_contract_line"]+" l WHERE l.contract_id=? AND l.deleted_at IS NULL AND l.project_policy='required' AND NOT EXISTS(SELECT 1 FROM "+t["altoc_contract_project_line_rel"]+" r JOIN "+t["altoc_contract_project_link"]+" p ON p.id=r.contract_project_link_id WHERE r.contract_line_id=l.id AND r.deleted_at IS NULL AND p.deleted_at IS NULL AND p.status='active' AND p.contract_id=l.contract_id)", id).Scan(&n)
	if e != nil {
		return e
	}
	if n > 0 {
		return contractError(409, "altoc_contract_project_coverage_incomplete")
	}
	return nil
}
