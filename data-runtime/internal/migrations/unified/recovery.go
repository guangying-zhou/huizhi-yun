package unified

import (
	"context"
	"crypto/sha256"
	"database/sql"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"strings"

	"github.com/huizhi-yun/data-runtime/internal/migrationlock"
)

// Recovery never overwrites either old source schema and never activates a writer.
// Final is the immutable forward plan; Counts/Hashes describe the frozen CURRENT
// unified authority, including facts added after activation.
type RecoveryPlan struct {
	Version                                           string
	Final                                             Plan
	Fence                                             FenceSpec
	CutoverKey, RecoveryKey, AimsTarget, AssetsTarget string
	Tables                                            []Table
	ReviewHash                                        string
}

func RecoveryReviewHash(p RecoveryPlan) string {
	p.ReviewHash = ""
	raw, _ := json.Marshal(p)
	sum := sha256.Sum256(raw)
	return hex.EncodeToString(sum[:])
}
func validateRecovery(p RecoveryPlan) error {
	if p.Version != "enterprise-recovery.v1" || validateFence(p.Fence) != nil || p.Final.Config != p.Fence.Config || p.Final.ReviewHash == "" || ReviewHash(p.Final) != p.Final.ReviewHash || p.RecoveryKey == "" || len(p.RecoveryKey) > 191 || p.CutoverKey == "" {
		return errors.New("recovery identity or original contract invalid")
	}
	seen := map[string]bool{p.Final.Config.SourceAims: true, p.Final.Config.SourceAssets: true, p.Final.Config.Target: true}
	for _, name := range []string{p.AimsTarget, p.AssetsTarget} {
		if !ident.MatchString(name) || seen[name] {
			return errors.New("new independent recovery schemas required")
		}
		seen[name] = true
	}
	return nil
}
func recoveryFenceNames(p RecoveryPlan) []string {
	return []string{qualified(p.Final.Config.Target, "aims_"+sourceFenceTable), qualified(p.Final.Config.Target, "assets_"+sourceFenceTable)}
}
func recoveryControl(p RecoveryPlan) string {
	return qualified(p.Final.Config.Target, "enterprise_recovery_freeze")
}
func recoveryIdentity(ctx context.Context, tx *sql.Tx, p RecoveryPlan, frozen bool) error {
	if err := verifyInstance(ctx, tx, p.Final.Config.InstanceID); err != nil {
		return err
	}
	if _, err := lockFences(ctx, tx, p.Fence, p.CutoverKey, true); err != nil {
		return err
	}
	if err := verifyFenceSchema(ctx, tx, p.Fence, true); err != nil {
		return err
	}
	var review, status string
	if err := tx.QueryRowContext(ctx, "SELECT review_hash,status FROM "+qualified(p.Final.Config.Target, "enterprise_migration_ledger")+" WHERE id=1 FOR UPDATE").Scan(&review, &status); err != nil || review != p.Final.ReviewHash || status != "active" {
		return errors.New("unified authority ledger mismatch")
	}
	var activatedReview string
	var activatedGeneration uint64
	if err := tx.QueryRowContext(ctx, "SELECT review_hash,generation FROM "+qualified(p.Final.Config.Target, "enterprise_cutover_receipt")+" WHERE operation_key=?", p.CutoverKey).Scan(&activatedReview, &activatedGeneration); err != nil || activatedReview != p.Final.ReviewHash || activatedGeneration != p.Final.Config.Generation {
		return errors.New("original activation receipt mismatch")
	}
	var tenant, environment, runtime, version string
	var generation uint64
	if err := tx.QueryRowContext(ctx, "SELECT tenant_code,environment_code,runtime_deployment,schema_version,generation FROM "+qualified(p.Final.Config.Target, "enterprise_schema_registry")+" WHERE id=1 FOR UPDATE").Scan(&tenant, &environment, &runtime, &version, &generation); err != nil {
		return err
	}
	expected := p.Final.Config.Generation
	if frozen {
		expected = 0
	}
	if tenant != p.Final.Config.Tenant || environment != p.Final.Config.Environment || runtime != p.Final.Config.RuntimeDeployment || version != p.Final.Config.SchemaVersion || generation != expected {
		return errors.New("recovery generation or registry identity mismatch")
	}
	for _, table := range recoveryFenceNames(p) {
		var state, contract, key string
		if err := tx.QueryRowContext(ctx, "SELECT state,contract_hash,transition_key FROM "+table+" WHERE id=1 FOR UPDATE").Scan(&state, &contract, &key); err != nil {
			return err
		}
		expectedState := "active"
		if frozen {
			expectedState = "fenced"
		}
		if state != expectedState || contract != p.Fence.ContractHash || key != p.CutoverKey {
			return errors.New("unified source fence mismatch")
		}
	}
	return nil
}

// FreezeRecoverySource must be called only after authenticated external drain
// evidence has been collected. Verifier is mandatory, local and transaction-only.
// The guard row locks wait for all in-flight business DML before generation=0.
func FreezeRecoverySource(ctx context.Context, db *sql.DB, p RecoveryPlan, drains ExternalDrainVerifier) error {
	if err := validateRecovery(p); err != nil {
		return err
	}
	if drains == nil {
		return errors.New("external drain verifier required")
	}
	conn, err := db.Conn(ctx)
	if err != nil {
		return err
	}
	defer conn.Close()
	if err := verifyInstance(ctx, conn, p.Final.Config.InstanceID); err != nil {
		return err
	}
	release, err := migrationlock.Acquire(ctx, conn, p.Final.Config.InstanceID, p.Final.Config.Target)
	if err != nil {
		return err
	}
	defer release()
	if _, err = conn.ExecContext(ctx, "CREATE TABLE IF NOT EXISTS "+recoveryControl(p)+"(operation_key VARCHAR(191) PRIMARY KEY,contract_hash CHAR(64) NOT NULL,evidence_hash CHAR(64) NOT NULL,frozen_at DATETIME(3) NOT NULL) ENGINE=InnoDB"); err != nil {
		return err
	}
	tx, err := conn.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer tx.Rollback()
	contract := p
	contract.Tables = nil
	contract.ReviewHash = ""
	hash := RecoveryReviewHash(contract)
	var existing string
	err = tx.QueryRowContext(ctx, "SELECT contract_hash FROM "+recoveryControl(p)+" WHERE operation_key=?", p.RecoveryKey).Scan(&existing)
	if err == nil {
		if existing != hash {
			return errors.New("recovery key conflict")
		}
		if err = recoveryIdentity(ctx, tx, p, true); err != nil {
			return err
		}
		return tx.Commit()
	}
	if !errors.Is(err, sql.ErrNoRows) {
		return err
	}
	if err = recoveryIdentity(ctx, tx, p, false); err != nil {
		return err
	}
	if err = verifyRecoverySourceSchema(ctx, tx, p); err != nil {
		return err
	}
	// Require all local outbox work terminal, not merely expired leases. Receipt
	// data remains copied, so completed external work is never recreated by a retry.
	for _, table := range p.Final.Tables {
		if table.Name == "integration_operation" {
			var count uint64
			if err = tx.QueryRowContext(ctx, "SELECT COUNT(*) FROM "+qualified(p.Final.Config.Target, table.Target)+" WHERE status NOT IN ('succeeded','cancelled')").Scan(&count); err != nil {
				return err
			}
			if count != 0 {
				return errors.New("unified outbox is not drained")
			}
		}
	}
	evidence, err := drains.VerifyExternalDrain(ctx, tx, p.Fence, p.RecoveryKey)
	if err != nil {
		return err
	}
	if raw, err := hex.DecodeString(evidence); err != nil || len(raw) != 32 {
		return errors.New("durable recovery drain evidence required")
	}
	for _, table := range recoveryFenceNames(p) {
		if _, err = tx.ExecContext(ctx, "UPDATE "+table+" SET state='fenced',changed_at=UTC_TIMESTAMP(3) WHERE id=1"); err != nil {
			return err
		}
	}
	if _, err = tx.ExecContext(ctx, "UPDATE "+qualified(p.Final.Config.Target, "enterprise_schema_registry")+" SET generation=0 WHERE id=1"); err != nil {
		return err
	}
	if _, err = tx.ExecContext(ctx, "INSERT INTO "+recoveryControl(p)+" VALUES(?,?,?,UTC_TIMESTAMP(3))", p.RecoveryKey, hash, evidence); err != nil {
		return err
	}
	return tx.Commit()
}
func recoveryTarget(p RecoveryPlan, domain string) string {
	if domain == "aims" {
		return p.AimsTarget
	}
	return p.AssetsTarget
}
func recoveryDDL(p RecoveryPlan, t Table) (string, error) {
	// Use the original captured SHOW CREATE, preserving original constraint names.
	prefix := "CREATE TABLE " + quoted(t.Name)
	if !strings.HasPrefix(t.DDL, prefix) {
		return "", errors.New("original table DDL shape invalid")
	}
	ddl := strings.Replace(t.DDL, prefix, "CREATE TABLE "+qualified(recoveryTarget(p, t.Domain), t.Name), 1)
	bad := false
	ddl = references.ReplaceAllStringFunc(ddl, func(v string) string {
		m := references.FindStringSubmatch(v)
		name := m[1]
		if m[2] != "" {
			if name != t.Source {
				bad = true
			}
			name = m[2]
		}
		if _, ok := mapping(p.Final, t.Domain, name); !ok {
			bad = true
		}
		return "REFERENCES " + qualified(recoveryTarget(p, t.Domain), name)
	})
	if bad {
		return "", errors.New("unmapped original recovery FK")
	}
	return ddl, nil
}
func recoveryTrigger(p RecoveryPlan, t Table, tr Trigger) (string, error) {
	reverse := p.Final
	reverse.Config.Target = recoveryTarget(p, t.Domain)
	reverse.Tables = append([]Table(nil), p.Final.Tables...)
	for i := range reverse.Tables {
		reverse.Tables[i].Target = reverse.Tables[i].Name
	}
	original := t
	original.Target = t.Name
	statement, err := rewriteTrigger(original, tr, reverse)
	if err != nil {
		return "", err
	}
	return strings.Replace(statement, qualified(reverse.Config.Target, stableName(t.Domain, tr.Name)), qualified(reverse.Config.Target, tr.Name), 1), nil
}
func recoveryCanonicalDDL(ddl, schema string) string {
	return autoIncrementOption.ReplaceAllString(strings.ReplaceAll(ddl, quoted(schema)+".", ""), "")
}
func verifyRecoverySourceSchema(ctx context.Context, tx *sql.Tx, p RecoveryPlan) error {
	expected := map[string]bool{"enterprise_migration_ledger": true, "enterprise_migration_checkpoint": true, "enterprise_schema_registry": true, "enterprise_cutover_receipt": true, "enterprise_recovery_freeze": true, "enterprise_recovery_activation": true}
	for _, t := range p.Final.Tables {
		expected[t.Target] = true
		var name, actual string
		if err := tx.QueryRowContext(ctx, "SHOW CREATE TABLE "+qualified(p.Final.Config.Target, t.Target)).Scan(&name, &actual); err != nil {
			return err
		}
		ddl, err := rewriteDDL(t, p.Final)
		if err != nil {
			return err
		}
		if recoveryCanonicalDDL(actual, p.Final.Config.Target) != recoveryCanonicalDDL(ddl, p.Final.Config.Target) {
			return fmt.Errorf("unified schema changed: %s", t.Target)
		}
		for _, tr := range t.Triggers {
			expected, err := rewriteTrigger(t, tr, p.Final)
			if err != nil {
				return err
			}
			if err = verifyRecoveryTrigger(ctx, tx, p.Final.Config.Target, t.Target, stableName(t.Domain, tr.Name), tr.Timing, tr.Event, expected); err != nil {
				return err
			}
		}
		var triggers int
		if err := tx.QueryRowContext(ctx, "SELECT COUNT(*) FROM information_schema.TRIGGERS WHERE TRIGGER_SCHEMA=? AND EVENT_OBJECT_TABLE=?", p.Final.Config.Target, t.Target).Scan(&triggers); err != nil || triggers != len(t.Triggers) {
			return errors.New("unified trigger contract changed")
		}

	}
	rows, err := tx.QueryContext(ctx, "SELECT TABLE_NAME FROM information_schema.TABLES WHERE TABLE_SCHEMA=? AND TABLE_TYPE='BASE TABLE'", p.Final.Config.Target)
	if err != nil {
		return err
	}
	defer rows.Close()
	for rows.Next() {
		var name string
		if err = rows.Scan(&name); err != nil {
			return err
		}
		if !expected[name] {
			return errors.New("unmapped unified table; extend recovery contract")
		}
	}
	return rows.Err()
}

// PrepareRecovery is read-only and refuses an unfrozen authority. Its review
// hash covers all NEW facts, original DDL/triggers, identities and target names.
func PrepareRecovery(ctx context.Context, db *sql.DB, p RecoveryPlan) (RecoveryPlan, error) {
	if err := validateRecovery(p); err != nil {
		return p, err
	}
	tx, err := db.BeginTx(ctx, nil)
	if err != nil {
		return p, err
	}
	defer tx.Rollback()
	if err = recoveryIdentity(ctx, tx, p, true); err != nil {
		return p, err
	}
	contract := p
	contract.Tables = nil
	contract.ReviewHash = ""
	var hash string
	if err = tx.QueryRowContext(ctx, "SELECT contract_hash FROM "+recoveryControl(p)+" WHERE operation_key=?", p.RecoveryKey).Scan(&hash); err != nil || hash != RecoveryReviewHash(contract) {
		return p, errors.New("recovery freeze receipt mismatch")
	}
	if err = verifyRecoverySourceSchema(ctx, tx, p); err != nil {
		return p, err
	}
	p.Tables = append([]Table(nil), p.Final.Tables...)
	for i := range p.Tables {
		table := &p.Tables[i]
		table.Count, table.Hash, err = digest(ctx, tx, qualified(p.Final.Config.Target, table.Target), table.PrimaryKey)
		if err != nil {
			return p, err
		}
	}
	p.ReviewHash = RecoveryReviewHash(p)
	return p, tx.Commit()
}

// ApplyRecovery copies into two NEW application schemas. A partially built
// schema remains fenced and is never silently reset; choose new reviewed targets.
// Completed same-plan replay verifies data and returns without touching rows.
func ApplyRecovery(ctx context.Context, db *sql.DB, p RecoveryPlan, review string) error {
	if review == "" || review != p.ReviewHash || RecoveryReviewHash(p) != review {
		return errors.New("matching recovery review hash required")
	}
	current, err := PrepareRecovery(ctx, db, p)
	if err != nil {
		return err
	}
	if current.ReviewHash != review {
		return errors.New("recovery source changed since review")
	}
	conn, err := db.Conn(ctx)
	if err != nil {
		return err
	}
	defer conn.Close()
	release, err := migrationlock.Acquire(ctx, conn, p.Final.Config.InstanceID, p.Final.Config.Target)
	if err != nil {
		return err
	}
	defer release()
	source, err := db.BeginTx(ctx, &sql.TxOptions{Isolation: sql.LevelRepeatableRead})
	if err != nil {
		return err
	}
	defer source.Rollback()
	if err = recoveryIdentity(ctx, source, p, true); err != nil {
		return err
	}
	for _, domain := range []string{"aims", "assets"} {
		target := recoveryTarget(p, domain)
		ledger := qualified(target, "enterprise_recovery_receipt")
		var exists int
		if err = conn.QueryRowContext(ctx, "SELECT COUNT(*) FROM information_schema.SCHEMATA WHERE SCHEMA_NAME=?", target).Scan(&exists); err != nil {
			return err
		}
		if exists != 0 {
			var hash, state string
			if err = conn.QueryRowContext(ctx, "SELECT review_hash,state FROM "+ledger+" WHERE id=1").Scan(&hash, &state); err != nil || hash != review || (state != "verified-fenced" && state != "copied-fenced") {
				return errors.New("recovery target exists without completed matching receipt; use new target names")
			}
			continue
		}
		if _, err = conn.ExecContext(ctx, "CREATE DATABASE "+quoted(target)+" CHARACTER SET utf8mb4 COLLATE utf8mb4_bin"); err != nil {
			return err
		}
		if _, err = conn.ExecContext(ctx, "CREATE TABLE "+ledger+"(id TINYINT PRIMARY KEY,review_hash CHAR(64) NOT NULL,state VARCHAR(32) NOT NULL,source_schema VARCHAR(64) NOT NULL,generation BIGINT UNSIGNED NOT NULL,recovery_key VARCHAR(191) NOT NULL) ENGINE=InnoDB"); err != nil {
			return err
		}
		if _, err = conn.ExecContext(ctx, "INSERT INTO "+ledger+" VALUES(1,?,'copying',?,?,?)", review, p.Final.Config.Target, p.Final.Config.Generation, p.RecoveryKey); err != nil {
			return err
		}
		checkpoint := qualified(target, "enterprise_recovery_checkpoint")
		if _, err = conn.ExecContext(ctx, "CREATE TABLE "+checkpoint+"(target_table VARCHAR(64) PRIMARY KEY,copied_rows BIGINT UNSIGNED NOT NULL,source_hash CHAR(64) NOT NULL,status VARCHAR(32) NOT NULL) ENGINE=InnoDB"); err != nil {
			return err
		}
		registry := qualified(target, "enterprise_schema_registry")
		if _, err = conn.ExecContext(ctx, "CREATE TABLE "+registry+"(id TINYINT PRIMARY KEY,tenant_code VARCHAR(100) NOT NULL,environment_code VARCHAR(100) NOT NULL,runtime_deployment VARCHAR(100) NOT NULL,schema_version VARCHAR(100) NOT NULL,generation BIGINT UNSIGNED NOT NULL,CHECK(id=1)) ENGINE=InnoDB"); err != nil {
			return err
		}
		if _, err = conn.ExecContext(ctx, "INSERT INTO "+registry+" VALUES(1,?,?,?, ?,0)", p.Final.Config.Tenant, p.Final.Config.Environment, p.Final.Config.RuntimeDeployment, p.Final.Config.SchemaVersion); err != nil {
			return err
		}
		if _, err = conn.ExecContext(ctx, "SET SESSION foreign_key_checks=0"); err != nil {
			return err
		}
		defer conn.ExecContext(context.Background(), "SET SESSION foreign_key_checks=1")
		reverse := p.Final
		reverse.Config.Target = target
		reverse.Tables = nil
		for _, t := range p.Tables {
			if t.Domain != domain {
				continue
			}
			ddl, err := recoveryDDL(p, t)
			if err != nil {
				return err
			}
			if _, err = conn.ExecContext(ctx, ddl); err != nil {
				return err
			}
			copied := t
			copied.Source = p.Final.Config.Target
			copied.Name = t.Target
			copied.Target = t.Name
			if err = copyTable(ctx, source, conn, copied, reverse, checkpoint); err != nil {
				return err
			}
			t.Target = t.Name
			reverse.Tables = append(reverse.Tables, t)
		}
		if err = verifyForeignKeys(ctx, conn, reverse); err != nil {
			return err
		}
		// Install original business triggers only AFTER copy, preventing duplicate side
		// effects. Original guard triggers are restored too; copied fences stay fenced.
		for _, t := range p.Tables {
			if t.Domain != domain {
				continue
			}
			for _, tr := range t.Triggers {
				ddl, err := recoveryTrigger(p, t, tr)
				if err != nil {
					return err
				}
				if _, err = conn.ExecContext(ctx, ddl); err != nil {
					return err
				}
			}
		}
		if _, err = conn.ExecContext(ctx, "UPDATE "+ledger+" SET state='copied-fenced' WHERE id=1"); err != nil {
			return err
		}
		if _, err = conn.ExecContext(ctx, "SET SESSION foreign_key_checks=1"); err != nil {
			return err
		}
	}
	if err = source.Commit(); err != nil {
		return err
	}
	if err := verifyRecovery(ctx, db, p, true); err != nil {
		return err
	}
	verified, err := conn.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer verified.Rollback()
	for _, domain := range []string{"aims", "assets"} {
		if _, err = verified.ExecContext(ctx, "UPDATE "+qualified(recoveryTarget(p, domain), "enterprise_recovery_receipt")+" SET state='verified-fenced' WHERE id=1 AND review_hash=? AND state IN ('copied-fenced','verified-fenced')", p.ReviewHash); err != nil {
			return err
		}
	}
	return verified.Commit()
}

// VerifyRecovery checks both application schemas without modifying any state.
func VerifyRecovery(ctx context.Context, db *sql.DB, p RecoveryPlan) error {
	return verifyRecovery(ctx, db, p, false)
}
func verifyRecovery(ctx context.Context, db *sql.DB, p RecoveryPlan, allowCopied bool) error {
	if p.ReviewHash == "" || RecoveryReviewHash(p) != p.ReviewHash {
		return errors.New("invalid reviewed recovery")
	}
	current, err := PrepareRecovery(ctx, db, p)
	if err != nil {
		return err
	}
	if current.ReviewHash != p.ReviewHash {
		return errors.New("frozen authority content changed")
	}
	conn, err := db.Conn(ctx)
	if err != nil {
		return err
	}
	defer conn.Close()
	for _, domain := range []string{"aims", "assets"} {
		target := recoveryTarget(p, domain)
		var hash, state, source, key string
		var generation uint64
		if err = conn.QueryRowContext(ctx, "SELECT review_hash,state,source_schema,generation,recovery_key FROM "+qualified(target, "enterprise_recovery_receipt")+" WHERE id=1").Scan(&hash, &state, &source, &generation, &key); err != nil {
			return err
		}
		if hash != p.ReviewHash || (state != "verified-fenced" && !(allowCopied && state == "copied-fenced")) || source != p.Final.Config.Target || generation != p.Final.Config.Generation || key != p.RecoveryKey {
			return errors.New("recovery receipt mismatch")
		}
		var rt, env, tenant, version string
		var generationValue uint64
		if err = conn.QueryRowContext(ctx, "SELECT tenant_code,environment_code,runtime_deployment,schema_version,generation FROM "+qualified(target, "enterprise_schema_registry")+" WHERE id=1").Scan(&tenant, &env, &rt, &version, &generationValue); err != nil {
			return err
		}
		if tenant != p.Final.Config.Tenant || env != p.Final.Config.Environment || rt != p.Final.Config.RuntimeDeployment || version != p.Final.Config.SchemaVersion || generationValue != 0 {
			return errors.New("recovery shadow registry mismatch")
		}
		var tableCount int
		if err = conn.QueryRowContext(ctx, "SELECT COUNT(*) FROM information_schema.TABLES WHERE TABLE_SCHEMA=? AND TABLE_TYPE='BASE TABLE'", target).Scan(&tableCount); err != nil {
			return err
		}
		expectedTables := 3 // receipt, copy checkpoints and persistent Runtime generation
		for _, table := range p.Tables {
			if table.Domain == domain {
				expectedTables++
			}
		}
		if tableCount != expectedTables {
			return errors.New("recovery target table closure mismatch")
		}
		reverse := p.Final
		reverse.Config.Target = target
		reverse.Tables = nil
		for _, table := range p.Tables {
			if table.Domain != domain {
				continue
			}
			count, hash, err := digest(ctx, conn, qualified(target, table.Name), table.PrimaryKey)
			if err != nil {
				return err
			}
			if count != table.Count || hash != table.Hash {
				return errors.New("recovery data hash mismatch")
			}
			var name, actual string
			if err = conn.QueryRowContext(ctx, "SHOW CREATE TABLE "+qualified(target, table.Name)).Scan(&name, &actual); err != nil {
				return err
			}
			ddl, err := recoveryDDL(p, table)
			if err != nil {
				return err
			}
			if recoveryCanonicalDDL(ddl, target) != recoveryCanonicalDDL(actual, target) {
				return errors.New("recovery schema mismatch")
			}
			for _, tr := range table.Triggers {
				expected, err := recoveryTrigger(p, table, tr)
				if err != nil {
					return err
				}
				if err = verifyRecoveryTrigger(ctx, conn, target, table.Name, tr.Name, tr.Timing, tr.Event, expected); err != nil {
					return err
				}
			}
			var n int
			if err = conn.QueryRowContext(ctx, "SELECT COUNT(*) FROM information_schema.TRIGGERS WHERE TRIGGER_SCHEMA=? AND EVENT_OBJECT_TABLE=?", target, table.Name).Scan(&n); err != nil || n != len(table.Triggers) {
				return errors.New("unexpected recovery trigger")
			}
			table.Target = table.Name
			reverse.Tables = append(reverse.Tables, table)
		}
		if err = verifyForeignKeys(ctx, conn, reverse); err != nil {
			return err
		}
	}
	return nil
}
func verifyRecoveryTrigger(ctx context.Context, q interface {
	QueryRowContext(context.Context, string, ...any) *sql.Row
}, schema, table, name, timing, event, expected string) error {
	var actualTiming, actualEvent, actualTable, body string
	if err := q.QueryRowContext(ctx, "SELECT ACTION_TIMING,EVENT_MANIPULATION,EVENT_OBJECT_TABLE,ACTION_STATEMENT FROM information_schema.TRIGGERS WHERE TRIGGER_SCHEMA=? AND TRIGGER_NAME=?", schema, name).Scan(&actualTiming, &actualEvent, &actualTable, &body); err != nil {
		return err
	}
	parts := strings.SplitN(expected, " FOR EACH ROW ", 2)
	if len(parts) != 2 || actualTiming != timing || actualEvent != event || actualTable != table || strings.TrimSpace(body) != strings.TrimSpace(parts[1]) {
		return errors.New("recovery trigger body or identity mismatch")
	}
	return nil
}
