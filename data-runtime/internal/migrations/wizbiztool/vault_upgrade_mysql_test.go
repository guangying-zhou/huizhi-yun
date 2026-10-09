package wizbiztool

import (
	"context"
	"github.com/google/uuid"
	"testing"
)

func TestToolVaultUpgradeMySQL(t *testing.T) {
	f := newToolFixture(t)
	v, admin := setupUpgradeVault(t, f)
	defer v.Close()
	// Synthetic fixture only. Real account columns are selected only after the
	// environment-specific approval gate and never printed in failure messages.
	if _, err := f.root.Exec("GRANT SELECT(account_number) ON `" + f.profile.Source.Database + "`.wb_bank_account TO '" + f.profile.Source.User + "'@'localhost'"); err != nil {
		t.Fatal("fixture read grant")
	}
	if _, err := f.root.Exec("UPDATE `" + f.profile.Source.Database + "`.wb_bank_account SET account_number=CONCAT(' ',account_number,' ') WHERE ba_id=1"); err != nil {
		t.Fatal("fixture outer whitespace")
	}
	e := newFixtureEngine(t, f)
	e.vault = v
	ctx := context.Background()
	if _, err := e.apply(ctx); err != nil {
		t.Fatal("main apply", err)
	}
	addAuditedFixtureChanges(t, f, e)
	approval := Approval{Approver: "fixture-user", Date: "2026-10-06", Scope: "test/" + f.profile.BatchCode + "/vault-real", Note: "isolated synthetic account fixture"}
	p, err := e.vaultUpgradePlan(ctx, approval, v)
	if err != nil {
		t.Fatal("upgrade plan", err)
	}
	if len(p.Rows) != 1 || p.TrimCount != 1 || !p.Rows[0].TrimApplied {
		t.Fatal("upgrade row count")
	}
	bad := p
	bad.Approval.Scope = "prod/" + f.profile.BatchCode + "/vault-real"
	bad.ReviewHash = VaultUpgradePlanHash(bad)
	if _, err = e.vaultUpgradeApply(ctx, bad, v, false); err == nil {
		t.Fatal("cross environment accepted")
	}
	e.vaultUpgradeAfterRotate = func() error { return ErrWrite }
	if _, err = e.vaultUpgradeApply(ctx, p, v, false); err != ErrWrite {
		t.Fatal("rotation interruption not observed", err)
	}
	e.vaultUpgradeAfterRotate = nil
	for i := 0; i < 2; i++ {
		if _, err = e.vaultUpgradeApply(ctx, p, v, false); err != nil {
			t.Fatal("upgrade/replay", err)
		}
	}
	if _, err = e.vaultUpgradeVerify(ctx, p, v); err != nil {
		t.Fatal("real verify", err)
	}
	c := OpeningConfirmation{BatchCode: "w2-opening-after-upgrade", MainReviewHash: e.plan.ReviewHash, SnapshotSHA256: e.manifestHash, Approver: "fixture", Date: "2026-10-06", Contracts: []OpeningConfirmedRow{{SourcePK: "1", Amount: "20.00"}}}
	ch := factsHash(c)
	op, err := e.openingPlan(ctx, c, ch, v.Check)
	if err != nil {
		t.Fatal("opening after upgrade plan", err)
	}
	if _, err = e.openingApply(ctx, op, c, ch, v.Check); err != nil {
		t.Fatal("opening after upgrade apply", err)
	}
	if _, err = e.openingVerify(ctx, op, c, ch); err != nil {
		t.Fatal("opening after upgrade verify", err)
	}
	if _, err = e.openingRollback(ctx, op); err != nil {
		t.Fatal("opening after upgrade rollback", err)
	}
	var n int
	if admin.QueryRow("SELECT COUNT(*) FROM vault_secret_versions v JOIN vault_secrets s ON s.id=v.secret_id WHERE s.secret_code='finance.bank-account.BA-W000001.account-no'").Scan(&n) != nil || n != 2 {
		t.Fatal("upgrade replay duplicated version")
	}
	if e.plan.ReviewHash != p.MainReviewHash {
		t.Fatal("main review hash changed")
	}
	if _, err = e.apply(ctx); err == nil {
		t.Fatal("legacy apply accepted upgraded batch")
	}
	if _, err = e.rollback(ctx); err != ErrUsed {
		t.Fatal("legacy rollback accepted upgraded batch")
	}
	for i := 0; i < 2; i++ {
		if _, err = e.vaultUpgradeApply(ctx, p, v, true); err != nil {
			t.Fatal("rollback/replay", err)
		}
	}
	if _, err = e.vaultUpgradeVerify(ctx, p, v); err != nil {
		t.Fatal("rollback verify", err)
	}
	if admin.QueryRow("SELECT COUNT(*) FROM vault_secret_versions v JOIN vault_secrets s ON s.id=v.secret_id WHERE s.secret_code='finance.bank-account.BA-W000001.account-no'").Scan(&n) != nil || n != 3 {
		t.Fatal("rollback must retain encrypted real history")
	}
}

func addAuditedFixtureChanges(t *testing.T, f *toolFixture, e *engine) {
	t.Helper()
	ctx := context.Background()
	if _, err := f.root.Exec("INSERT INTO `" + f.profile.ConsoleDatabase + "`.directory_users(uid,status) VALUES('fixture-user','active')"); err != nil {
		t.Fatal("fixture actor")
	}
	a := &FollowupAudit{Version: "wizbiz-followup-audited-baseline.v1", ApprovedDate: "2026-10-06", MainReviewHash: e.plan.ReviewHash, Verified: true, AdditionalAuditRows: 2, AdditionalReceiptRows: 2, DifferenceClasses: []AuditDifferenceClass{{"wb_bank_account", "field:status"}, {"wb_organization", "field:status"}, {"finance_audit_log", "domain_row_count"}, {"finance_service_command_receipt", "domain_row_count"}}}
	for index, table := range []string{"finance_bank_account", "finance_legal_entity"} {
		entity, code, op := "bank_account", "BA-W000001", "finance.wp3.accounts-update.v1"
		if index == 1 {
			entity, code, op = "legal_entity", "ENT-W000001", "finance.wp3.legal-entities-update.v1"
		}
		if _, err := f.target.Exec("UPDATE "+table+" SET status='inactive',row_version=row_version+1 WHERE code=?", code); err != nil {
			t.Fatal("fixture audited update")
		}
		request := "fixture-request-" + code
		r, err := f.root.Exec("INSERT INTO `"+f.profile.Database+"`.finance_audit_log(entity_type,entity_code,action,old_value,new_value,operator_uid,channel,request_id,created_at) VALUES (?,?,'version',?,?,'fixture-user','user',?,UTC_TIMESTAMP(3))", entity, code, `{"status":"active","row_version":1}`, `{"status":"inactive","row_version":2}`, request)
		if err != nil {
			t.Fatal("fixture audit")
		}
		id, _ := r.LastInsertId()
		receipt := uuid.NewString()
		_, err = f.root.Exec(`INSERT INTO `+"`"+f.profile.Database+"`"+`.finance_service_command_receipt(receipt_id,operation_id,operation_code,tenant_code,source_deployment_code,deployment_code,source_app,target_app,required_capability,idempotency_key,command_sha256,status,first_request_id,original_actor_uid,service_client_id,target_biz_type,target_biz_code,received_at,completed_at) VALUES (?,?,?,'C000001',?,?,'enterprise','finance','finance:enterprise-host:execute',?,?,'succeeded',?,'fixture-user','enterprise.runtime',?,?,UTC_TIMESTAMP(3),UTC_TIMESTAMP(3))`, receipt, uuid.NewString(), op, f.profile.EnterpriseDeployment, f.profile.EnterpriseDeployment, request, Digest([]byte(request)), request, entity, code+":v2")
		if err != nil {
			t.Fatal("fixture receipt")
		}
		a.Proofs = append(a.Proofs, FollowupAuditProof{Table: table, Field: "status", AuditID: id, ReceiptID: receipt, Action: op, ActorSHA256: Digest([]byte("fixture-user")), PostMigration: true, FormalReceipt: true, CurrentVersion: 2})
	}
	e.followupAudit = a
	if err := e.verifyForFollowup(ctx, e.vault.(*runtimeVault).Check); err != nil {
		result, _ := e.verify(ctx, e.vault.(*runtimeVault).Check)
		for _, d := range result.Differences {
			t.Log(d.Table, d.Check)
		}
		t.Fatal("audited current baseline", err)
	}
	if _, err := f.root.Exec("UPDATE `"+f.profile.Database+"`.finance_service_command_receipt SET service_client_id='untrusted' WHERE receipt_id=?", a.Proofs[0].ReceiptID); err != nil {
		t.Fatal("fixture tamper")
	}
	if err := e.verifyForFollowup(ctx, e.vault.(*runtimeVault).Check); err == nil {
		t.Fatal("unaudited source accepted")
	}
	if _, err := f.root.Exec("UPDATE `"+f.profile.Database+"`.finance_service_command_receipt SET service_client_id='enterprise.runtime' WHERE receipt_id=?", a.Proofs[0].ReceiptID); err != nil {
		t.Fatal("fixture restore")
	}
}
