package wizbiztool

import (
	"context"
	"database/sql"
	"encoding/json"
	"github.com/huizhi-yun/data-runtime/internal/migrations/wizbiztool/independentverify"
	"reflect"
	"sort"
	"strconv"
	"strings"
	"time"
)

type AuditDifferenceClass struct {
	Table string `json:"table"`
	Check string `json:"check"`
}
type FollowupAuditProof struct {
	Table          string `json:"table"`
	Field          string `json:"field"`
	AuditID        int64  `json:"auditId"`
	ReceiptID      string `json:"receiptId"`
	Action         string `json:"action"`
	ActorSHA256    string `json:"actorSha256"`
	AuditTime      string `json:"auditTime"`
	PostMigration  bool   `json:"postMigration"`
	FormalReceipt  bool   `json:"formalReceipt"`
	CurrentVersion int64  `json:"currentVersion"`
}
type FollowupAudit struct {
	Version               string                 `json:"version"`
	ApprovedDate          string                 `json:"approvedDate"`
	MainReviewHash        string                 `json:"mainReviewHash"`
	Verified              bool                   `json:"verified"`
	Proofs                []FollowupAuditProof   `json:"proofs"`
	DifferenceClasses     []AuditDifferenceClass `json:"differenceClasses"`
	AdditionalAuditRows   int                    `json:"additionalAuditRows"`
	AdditionalReceiptRows int                    `json:"additionalReceiptRows"`
}

// Caller-supplied attribution is only approval evidence. The tool checks the
// real rows, receipt identities, actor, timestamp and version again, read-only.
func (e *engine) verifyForFollowup(ctx context.Context, vault func(context.Context, string, string, string) error) error {
	result, err := e.verify(ctx, vault)
	if err == nil {
		return nil
	}
	if e.followupAudit == nil || len(result.Differences) == 0 {
		return err
	}
	if proofErr := e.checkFollowupAudit(ctx, result.Differences); proofErr != nil {
		return proofErr
	}
	return nil
}
func (e *engine) checkFollowupAudit(ctx context.Context, diffs []independentverify.Difference) error {
	a := e.followupAudit
	if a == nil || a.Version != "wizbiz-followup-audited-baseline.v1" || !a.Verified || a.MainReviewHash != e.plan.ReviewHash || a.ApprovedDate != "2026-10-06" || len(a.Proofs) != 2 || a.AdditionalAuditRows != 2 || a.AdditionalReceiptRows != 2 {
		return ErrInput
	}
	classes := []AuditDifferenceClass{}
	changes := []independentverify.Difference{}
	for _, d := range diffs {
		classes = append(classes, AuditDifferenceClass{d.Table, d.Check})
		if d.Check == "field:status" && (d.Table == "wb_bank_account" || d.Table == "wb_organization") {
			changes = append(changes, d)
		} else if d.Check != "domain_row_count" || (d.Table != "finance_audit_log" && d.Table != "finance_service_command_receipt") {
			return gateFailure(ErrConflict, "audit_attribution", "followup")
		}
	}
	sortClasses := func(x []AuditDifferenceClass) {
		sort.Slice(x, func(i, j int) bool {
			if x[i].Table == x[j].Table {
				return x[i].Check < x[j].Check
			}
			return x[i].Table < x[j].Table
		})
	}
	want := append([]AuditDifferenceClass{}, a.DifferenceClasses...)
	sortClasses(classes)
	sortClasses(want)
	if len(changes) != 2 || len(classes) != 4 || !reflect.DeepEqual(classes, want) {
		return gateFailure(ErrConflict, "difference_classes", "followup")
	}
	var finished sql.NullString
	if e.target.QueryRowContext(ctx, "SELECT DATE_FORMAT(COALESCE(finished_at,started_at),'%Y-%m-%d %H:%i:%s.%f') FROM mig_batch WHERE BINARY batch_code=BINARY ?", e.profile.BatchCode).Scan(&finished) != nil || !finished.Valid {
		return ErrStep
	}
	seen := map[int64]bool{}
	for _, d := range changes {
		table, entity, operation, prefix := "finance_bank_account", "bank_account", "finance.wp3.accounts-update.v1", "BA-W"
		if d.Table == "wb_organization" {
			table, entity, operation, prefix = "finance_legal_entity", "legal_entity", "finance.wp3.legal-entities-update.v1", "ENT-W"
		}
		code := prefix + strings.Repeat("0", max(0, 6-len(d.SourcePK))) + d.SourcePK
		proof := FollowupAuditProof{}
		for _, p := range a.Proofs {
			if p.Table == table {
				proof = p
			}
		}
		if seen[proof.AuditID] || proof.AuditID < 1 || proof.Field != "status" || proof.Action != operation || !proof.PostMigration || !proof.FormalReceipt || !validHash(proof.ActorSHA256) {
			return ErrInput
		}
		seen[proof.AuditID] = true
		var raw, oldRaw, actor, request, stamp, channel, action, et, ec string
		if e.target.QueryRowContext(ctx, "SELECT new_value,old_value,operator_uid,request_id,DATE_FORMAT(created_at,'%Y-%m-%d %H:%i:%s.%f'),channel,action,entity_type,entity_code FROM finance_audit_log WHERE id=?", proof.AuditID).Scan(&raw, &oldRaw, &actor, &request, &stamp, &channel, &action, &et, &ec) != nil {
			return gateFailure(ErrConflict, "audit_read", "followup")
		}
		if channel != "user" || action != "version" || et != entity || ec != code || Digest([]byte(actor)) != proof.ActorSHA256 {
			return gateFailure(ErrConflict, "audit_identity", "followup")
		}
		if stamp < finished.String {
			return gateFailure(ErrConflict, "audit_time", "followup")
		}
		var n, o struct {
			Status  string `json:"status"`
			Version int64  `json:"row_version"`
		}
		if json.Unmarshal([]byte(raw), &n) != nil || json.Unmarshal([]byte(oldRaw), &o) != nil || n.Version != proof.CurrentVersion || o.Version+1 != n.Version || n.Status == o.Status {
			return gateFailure(ErrConflict, "audit_version", "followup")
		}
		var status string
		var version int64
		if e.target.QueryRowContext(ctx, "SELECT status,row_version FROM "+table+" WHERE BINARY code=BINARY ?", code).Scan(&status, &version) != nil || status != n.Status {
			return gateFailure(ErrConflict, "current_status", "followup")
		}
		// Our own Vault upgrade is the only later row-version change allowed here.
		_, scope, err := e.loadMainScope(ctx, e.target, false)
		if err != nil {
			return err
		}
		delta := int64(0)
		if table == "finance_bank_account" && scope.VaultUpgrade != nil {
			if _, ok := scope.VaultUpgrade.Done[code]; ok {
				delta++
			}
			if _, ok := scope.VaultUpgrade.RollbackDone[code]; ok {
				delta++
			}
		}
		if version != n.Version+delta {
			return gateFailure(ErrConflict, "current_version", "followup")
		}
		var count int
		query := `SELECT COUNT(*) FROM finance_service_command_receipt WHERE BINARY receipt_id=BINARY ? AND BINARY operation_code=BINARY ? AND tenant_code=? AND source_deployment_code=? AND deployment_code=? AND source_app='enterprise' AND target_app='finance' AND required_capability='finance:enterprise-host:execute' AND status='succeeded' AND BINARY original_actor_uid=BINARY ? AND BINARY first_request_id=BINARY ? AND service_client_id='enterprise.runtime' AND target_biz_type=? AND target_biz_code=? AND received_at>=? AND completed_at IS NOT NULL`
		if e.target.QueryRowContext(ctx, query, proof.ReceiptID, operation, e.profile.Tenant, e.profile.EnterpriseDeployment, e.profile.EnterpriseDeployment, actor, request, entity, code+":v"+strconv.FormatInt(n.Version, 10), finished.String).Scan(&count) != nil || count != 1 {
			return gateFailure(ErrConflict, "receipt_or_actor", "followup")
		}
		if e.directory.QueryRowContext(ctx, "SELECT COUNT(*) FROM directory_users WHERE BINARY uid=BINARY ? AND status='active'", actor).Scan(&count) != nil || count != 1 {
			return gateFailure(ErrConflict, "receipt_or_actor", "followup")
		}
	}
	// Extra row counts and immutable pre-migration row hashes were checked by the
	// independent verifier. Exactly these two commands account for the additions.
	for _, table := range []string{"finance_audit_log", "finance_service_command_receipt"} {
		var count int
		if e.target.QueryRowContext(ctx, "SELECT COUNT(*) FROM "+table).Scan(&count) != nil || count != len(e.plan.Baseline[table])+2 {
			return gateFailure(ErrConflict, "audit_count", "followup")
		}
	}
	if _, err := time.Parse("2006-01-02", a.ApprovedDate); err != nil {
		return ErrInput
	}
	return nil
}
