package unified

import (
	"context"
	"crypto/sha256"
	"database/sql"
	"encoding/hex"
	"encoding/json"
	"errors"
	"github.com/huizhi-yun/data-runtime/internal/migrationlock"
	"regexp"
	"sort"
	"strings"
)

const sourceFenceTable = "enterprise_source_fence"

type FenceTable struct {
	Domain, Schema, Name, DDLHash string
	Triggers                      []Trigger
}
type FenceSpec struct {
	Config       Config
	Tables       []FenceTable
	ContractHash string
}

var autoIncrementOption = regexp.MustCompile(`(?i)\sAUTO_INCREMENT=\d+`)

func schemaHash(ddl string) string {
	sum := sha256.Sum256([]byte(autoIncrementOption.ReplaceAllString(ddl, "")))
	return hex.EncodeToString(sum[:])
}
func fenceHash(s FenceSpec) string {
	s.ContractHash = ""
	b, _ := json.Marshal(s)
	h := sha256.Sum256(b)
	return hex.EncodeToString(h[:])
}
func BuildFenceSpec(p Plan) (FenceSpec, error) {
	if p.ReviewHash == "" || ReviewHash(p) != p.ReviewHash {
		return FenceSpec{}, errors.New("reviewed source plan required")
	}
	s := FenceSpec{Config: p.Config}
	for _, t := range p.Tables {
		if t.Name == sourceFenceTable {
			continue
		}
		entry := FenceTable{Domain: t.Domain, Schema: t.Source, Name: t.Name, DDLHash: schemaHash(t.DDL)}
		for _, tr := range t.Triggers {
			if !isGuardName(t.Domain, t.Name, tr.Name) {
				entry.Triggers = append(entry.Triggers, tr)
			}
		}
		s.Tables = append(s.Tables, entry)
	}
	if len(s.Tables) == 0 {
		return s, errors.New("empty source fence closure")
	}
	s.ContractHash = fenceHash(s)
	return s, nil
}
func validateFence(s FenceSpec) error {
	if err := validate(s.Config); err != nil {
		return err
	}
	if s.ContractHash == "" || s.ContractHash != fenceHash(s) || len(s.Tables) == 0 {
		return errors.New("fence contract invalid")
	}
	return nil
}
func guardName(domain, table, event string) string {
	h := sha256.Sum256([]byte(domain + "/" + table + "/" + event))
	return "enterprise_guard_" + strings.ToLower(event) + "_" + hex.EncodeToString(h[:12])
}
func isGuardName(domain, table, name string) bool {
	for _, event := range []string{"INSERT", "UPDATE", "DELETE"} {
		if guardName(domain, table, event) == name {
			return true
		}
	}
	return false
}
func guardBody() string {
	return "BEGIN DECLARE guard_state VARCHAR(16); SET guard_state=(SELECT state FROM enterprise_source_fence WHERE id=1 FOR SHARE); IF guard_state IS NULL OR guard_state NOT IN ('legacy','active') THEN SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='enterprise_source_write_fenced'; END IF; END"
}
func sourceSchemas(s FenceSpec) []string { return []string{s.Config.SourceAims, s.Config.SourceAssets} }
func verifyInstance(ctx context.Context, q interface {
	QueryRowContext(context.Context, string, ...any) *sql.Row
}, instance string) error {
	var got string
	if err := q.QueryRowContext(ctx, "SELECT @@server_uuid").Scan(&got); err != nil {
		return err
	}
	if !strings.EqualFold(got, instance) {
		return errors.New("fence instance mismatch")
	}
	return nil
}

// InstallSourceFence is maintenance DDL. Both source writers remain legacy
// throughout installation; no cutover is permitted until coverage is verified.
// Runtime principals must not have DROP/ALTER/TRIGGER rights or DML access to
// the fence control table. Privileged concurrent DDL is outside this protocol.
func InstallSourceFence(ctx context.Context, db *sql.DB, s FenceSpec) error {
	if err := validateFence(s); err != nil {
		return err
	}
	conn, err := db.Conn(ctx)
	if err != nil {
		return err
	}
	defer conn.Close()
	if err := verifyInstance(ctx, conn, s.Config.InstanceID); err != nil {
		return err
	}
	if err := verifyFenceSchema(ctx, conn, s, false); err != nil {
		return err
	}
	for _, schema := range sourceSchemas(s) {
		table := qualified(schema, sourceFenceTable)
		if _, err := conn.ExecContext(ctx, "CREATE TABLE IF NOT EXISTS "+table+"(id TINYINT PRIMARY KEY,tenant_code VARCHAR(100) NOT NULL,contract_hash CHAR(64) NOT NULL,state VARCHAR(16) NOT NULL,transition_key VARCHAR(191) NULL,changed_at DATETIME(3) NOT NULL,CHECK(id=1),CHECK(state IN ('legacy','fenced','active'))) ENGINE=InnoDB"); err != nil {
			return err
		}
		if _, err := conn.ExecContext(ctx, "INSERT IGNORE INTO "+table+" VALUES(1,?,?,'legacy',NULL,UTC_TIMESTAMP(3))", s.Config.Tenant, s.ContractHash); err != nil {
			return err
		}
		var tenant, hash, state string
		if err := conn.QueryRowContext(ctx, "SELECT tenant_code,contract_hash,state FROM "+table+" WHERE id=1").Scan(&tenant, &hash, &state); err != nil {
			return err
		}
		if tenant != s.Config.Tenant || hash != s.ContractHash {
			return errors.New("source fence belongs to another contract")
		}
		if state != "legacy" {
			return verifyFenceSchema(ctx, conn, s, true)
		}
	}
	for _, t := range s.Tables {
		for _, event := range []string{"INSERT", "UPDATE", "DELETE"} {
			name := guardName(t.Domain, t.Name, event)
			var n int
			if err := conn.QueryRowContext(ctx, "SELECT COUNT(*) FROM information_schema.TRIGGERS WHERE TRIGGER_SCHEMA=? AND TRIGGER_NAME=?", t.Schema, name).Scan(&n); err != nil {
				return err
			}
			if n == 0 {
				if _, err := conn.ExecContext(ctx, "CREATE TRIGGER "+qualified(t.Schema, name)+" BEFORE "+event+" ON "+qualified(t.Schema, t.Name)+" FOR EACH ROW "+guardBody()); err != nil {
					return err
				}
			}
		}
	}
	return verifyFenceSchema(ctx, conn, s, true)
}

type fenceReader interface {
	QueryContext(context.Context, string, ...any) (*sql.Rows, error)
	QueryRowContext(context.Context, string, ...any) *sql.Row
}

func verifyFenceSchema(ctx context.Context, q fenceReader, s FenceSpec, guards bool) error {
	expected := map[string]bool{}
	for _, t := range s.Tables {
		expected[t.Schema+"/"+t.Name] = true
	}
	for _, schema := range sourceSchemas(s) {
		rows, err := q.QueryContext(ctx, "SELECT TABLE_NAME,ENGINE FROM information_schema.TABLES WHERE TABLE_SCHEMA=? AND TABLE_NAME<>?", schema, sourceFenceTable)
		if err != nil {
			return err
		}
		var actual int
		for rows.Next() {
			var name, engine string
			if err := rows.Scan(&name, &engine); err != nil {
				rows.Close()
				return err
			}
			if engine != "InnoDB" || !expected[schema+"/"+name] {
				rows.Close()
				return errors.New("source table closure changed")
			}
			actual++
		}
		err = rows.Err()
		rows.Close()
		if err != nil {
			return err
		}
		want := 0
		for _, t := range s.Tables {
			if t.Schema == schema {
				want++
			}
		}
		if actual != want {
			return errors.New("source table closure incomplete")
		}
	}
	for _, t := range s.Tables {
		var name, ddl string
		if err := q.QueryRowContext(ctx, "SHOW CREATE TABLE "+qualified(t.Schema, t.Name)).Scan(&name, &ddl); err != nil {
			return err
		}
		if schemaHash(ddl) != t.DDLHash {
			return errors.New("source schema changed since fence review")
		}
		rows, err := q.QueryContext(ctx, "SELECT TRIGGER_NAME,ACTION_TIMING,EVENT_MANIPULATION,ACTION_STATEMENT FROM information_schema.TRIGGERS WHERE TRIGGER_SCHEMA=? AND EVENT_OBJECT_TABLE=? ORDER BY TRIGGER_NAME", t.Schema, t.Name)
		if err != nil {
			return err
		}
		var business []Trigger
		seen := map[string]bool{}
		for rows.Next() {
			var tr Trigger
			if err := rows.Scan(&tr.Name, &tr.Timing, &tr.Event, &tr.Statement); err != nil {
				rows.Close()
				return err
			}
			if isGuardName(t.Domain, t.Name, tr.Name) {
				if tr.Timing != "BEFORE" || tr.Name != guardName(t.Domain, t.Name, tr.Event) || strings.TrimSpace(tr.Statement) != guardBody() {
					rows.Close()
					return errors.New("source guard definition drift")
				}
				seen[tr.Event] = true
			} else {
				business = append(business, tr)
			}
		}
		err = rows.Err()
		rows.Close()
		if err != nil {
			return err
		}
		a, _ := json.Marshal(business)
		b, _ := json.Marshal(t.Triggers)
		if len(business) == 0 && len(t.Triggers) == 0 {
		} else if string(a) != string(b) {
			return errors.New("source business triggers changed")
		}
		if guards && (!seen["INSERT"] || !seen["UPDATE"] || !seen["DELETE"]) {
			return errors.New("source guard coverage incomplete")
		}
	}
	return nil
}

// FenceSources commits both domains atomically. Existing DML holds a shared row
// lock via its trigger until commit/rollback, so this exclusive lock waits for
// in-flight transactions and rejects every later write, including old pools.
func FenceSources(ctx context.Context, db *sql.DB, s FenceSpec, key string) error {
	if err := validateFence(s); err != nil {
		return err
	}
	if key == "" || len(key) > 191 {
		return errors.New("stable cutover key required")
	}
	tx, err := db.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer tx.Rollback()
	if err := verifyInstance(ctx, tx, s.Config.InstanceID); err != nil {
		return err
	}
	if err := verifyFenceSchema(ctx, tx, s, true); err != nil {
		return err
	}
	states, err := lockFences(ctx, tx, s, key, false)
	if err != nil {
		return err
	}
	if states[0] != states[1] {
		return errors.New("mixed source fence state requires investigation")
	}
	if states[0] == "fenced" {
		return tx.Commit()
	}
	if states[0] != "legacy" {
		return errors.New("source is not a legacy writer")
	}
	// With both fence rows exclusively locked, old DML cannot enqueue another
	// command. Refuse before changing state so a pending ACK/lease can still drain.
	for _, table := range s.Tables {
		if table.Name == "integration_operation" {
			var pending uint64
			if err := tx.QueryRowContext(ctx, "SELECT COUNT(*) FROM "+qualified(table.Schema, table.Name)+" WHERE status NOT IN ('succeeded','cancelled')").Scan(&pending); err != nil {
				return err
			}
			if pending != 0 {
				return errors.New("source outbox not drained")
			}
		}
	}

	for _, schema := range sourceSchemas(s) {
		if _, err := tx.ExecContext(ctx, "UPDATE "+qualified(schema, sourceFenceTable)+" SET state='fenced',transition_key=?,changed_at=UTC_TIMESTAMP(3) WHERE id=1", key); err != nil {
			return err
		}
	}
	return tx.Commit()
}
func lockFences(ctx context.Context, tx *sql.Tx, s FenceSpec, key string, requireFenced bool) ([]string, error) {
	schemas := sourceSchemas(s)
	sort.Strings(schemas)
	states := []string{}
	for _, schema := range schemas {
		var tenant, hash, state string
		var existing sql.NullString
		if err := tx.QueryRowContext(ctx, "SELECT tenant_code,contract_hash,state,transition_key FROM "+qualified(schema, sourceFenceTable)+" WHERE id=1 FOR UPDATE").Scan(&tenant, &hash, &state, &existing); err != nil {
			return nil, err
		}
		if tenant != s.Config.Tenant || hash != s.ContractHash {
			return nil, errors.New("source fence identity mismatch")
		}
		if state == "fenced" && (!existing.Valid || existing.String != key) {
			return nil, errors.New("cutover key conflict")
		}
		if requireFenced && state != "fenced" {
			return nil, errors.New("source must remain fenced")
		}
		states = append(states, state)
	}
	return states, nil
}

// PrepareFinalCopy is a complete final recopy into a new target after fencing,
// not CDC. Prior shadow data is not overwritten; writes remain stopped until a
// separately verified activation. DDL/privilege maintenance must remain frozen.
func PrepareFinalCopy(ctx context.Context, db *sql.DB, s FenceSpec, key string) (Plan, error) {
	if err := validateFence(s); err != nil {
		return Plan{}, err
	}
	tx, err := db.BeginTx(ctx, nil)
	if err != nil {
		return Plan{}, err
	}
	defer tx.Rollback()
	if _, err := lockFences(ctx, tx, s, key, true); err != nil {
		return Plan{}, err
	}
	if err := verifyFenceSchema(ctx, tx, s, true); err != nil {
		return Plan{}, err
	}
	if err := tx.Commit(); err != nil {
		return Plan{}, err
	}
	return Prepare(ctx, db, s.Config)
}

// ExternalDrainVerifier is an operator/runtime adapter, never a boolean supplied
// by HTTP. It must prove leased workers and external side effects are quiescent;
// SQL outbox status alone cannot establish that fact. Return a durable SHA-256
// evidence identifier bound to this fence contract and cutover key.
type ExternalDrainVerifier interface {
	VerifyExternalDrain(context.Context, *sql.Tx, FenceSpec, string) (string, error)
}
type CutoverReceipt struct {
	OperationKey, ReviewHash, EvidenceHash string
	Generation                             uint64
}

func ActivateFinalCopy(ctx context.Context, db *sql.DB, s FenceSpec, key string, p Plan, drains ExternalDrainVerifier) (CutoverReceipt, error) {
	var result CutoverReceipt
	if err := validateFence(s); err != nil {
		return result, err
	}
	if p.Config != s.Config || p.ReviewHash == "" || ReviewHash(p) != p.ReviewHash || drains == nil {
		return result, errors.New("reviewed final copy and live drain verifier required")
	}
	conn, err := db.Conn(ctx)
	if err != nil {
		return result, err
	}
	defer conn.Close()
	release, err := migrationlock.Acquire(ctx, conn, p.Config.InstanceID, p.Config.Target)
	if err != nil {
		return result, err
	}
	defer release()
	if err := verifyInstance(ctx, conn, s.Config.InstanceID); err != nil {
		return result, err
	}
	var ownedHash string
	if err := conn.QueryRowContext(ctx, "SELECT review_hash FROM "+qualified(p.Config.Target, "enterprise_migration_ledger")+" WHERE id=1").Scan(&ownedHash); err != nil || ownedHash != p.ReviewHash {
		return result, errors.New("target is not owned by reviewed final migration")
	}
	receiptTable := qualified(p.Config.Target, "enterprise_cutover_receipt")
	if _, err := conn.ExecContext(ctx, "CREATE TABLE IF NOT EXISTS "+receiptTable+"(operation_key VARCHAR(191) PRIMARY KEY,review_hash CHAR(64) NOT NULL,evidence_hash CHAR(64) NOT NULL,generation BIGINT UNSIGNED NOT NULL,activated_at DATETIME(3) NOT NULL) ENGINE=InnoDB"); err != nil {
		return result, err
	}
	tx, err := conn.BeginTx(ctx, nil)
	if err != nil {
		return result, err
	}
	defer tx.Rollback()
	if err := verifyInstance(ctx, tx, s.Config.InstanceID); err != nil {
		return result, err
	}
	if _, err := lockFences(ctx, tx, s, key, true); err != nil {
		return result, err
	}
	if err := tx.QueryRowContext(ctx, "SELECT operation_key,review_hash,evidence_hash,generation FROM "+receiptTable+" WHERE operation_key=?", key).Scan(&result.OperationKey, &result.ReviewHash, &result.EvidenceHash, &result.Generation); err == nil {
		if result.ReviewHash != p.ReviewHash || result.Generation != s.Config.Generation {
			return result, errors.New("cutover receipt conflict")
		}
		return result, tx.Commit()
	} else if !errors.Is(err, sql.ErrNoRows) {
		return result, err
	}
	if err := verifyFenceSchema(ctx, tx, s, true); err != nil {
		return result, err
	}
	var review, status string
	if err := tx.QueryRowContext(ctx, "SELECT review_hash,status FROM "+qualified(p.Config.Target, "enterprise_migration_ledger")+" WHERE id=1 FOR UPDATE").Scan(&review, &status); err != nil || review != p.ReviewHash || status != "verified-shadow" {
		return result, errors.New("target is not the verified final shadow")
	}
	if err := verifyCopied(ctx, tx, p); err != nil {
		return result, err
	}
	// Detect external jobs not reflected by in-memory worker shutdown. The
	// additional verifier must also cover absent outbox tables/other services.
	for _, t := range p.Tables {
		if t.Name == "integration_operation" {
			var count uint64
			if err := tx.QueryRowContext(ctx, "SELECT COUNT(*) FROM "+qualified(t.Source, t.Name)+" WHERE status NOT IN ('succeeded','cancelled')").Scan(&count); err != nil {
				return result, err
			}
			if count != 0 {
				return result, errors.New("source outbox not drained")
			}
		}
	}
	evidence, err := drains.VerifyExternalDrain(ctx, tx, s, key)
	if err != nil {
		return result, err
	}
	if b, err := hex.DecodeString(evidence); err != nil || len(b) != 32 {
		return result, errors.New("durable external drain evidence required")
	}
	// No network calls belong inside the verifier/transaction; use already
	// collected authenticated worker evidence whose validity is rechecked here.
	for _, domain := range []string{"aims", "assets"} {
		table := qualified(p.Config.Target, domain+"_"+sourceFenceTable)
		var state, contract, storedKey string
		if err := tx.QueryRowContext(ctx, "SELECT state,contract_hash,transition_key FROM "+table+" WHERE id=1 FOR UPDATE").Scan(&state, &contract, &storedKey); err != nil || state != "fenced" || contract != s.ContractHash || storedKey != key {
			return result, errors.New("target copied fence mismatch")
		}
		if _, err := tx.ExecContext(ctx, "UPDATE "+table+" SET state='active',changed_at=UTC_TIMESTAMP(3) WHERE id=1"); err != nil {
			return result, err
		}
	}
	update, err := tx.ExecContext(ctx, "UPDATE "+qualified(p.Config.Target, "enterprise_schema_registry")+" SET generation=? WHERE id=1 AND tenant_code=? AND environment_code=? AND runtime_deployment=? AND schema_version=? AND generation=0", s.Config.Generation, s.Config.Tenant, s.Config.Environment, s.Config.RuntimeDeployment, s.Config.SchemaVersion)
	if err != nil {
		return result, err
	}
	if n, _ := update.RowsAffected(); n != 1 {
		return result, errors.New("target generation activation conflict")
	}
	if _, err := tx.ExecContext(ctx, "UPDATE "+qualified(p.Config.Target, "enterprise_migration_ledger")+" SET status='active' WHERE id=1"); err != nil {
		return result, err
	}
	if _, err := tx.ExecContext(ctx, "INSERT INTO "+receiptTable+" VALUES(?,?,?,?,UTC_TIMESTAMP(3))", key, p.ReviewHash, evidence, s.Config.Generation); err != nil {
		return result, err
	}
	result = CutoverReceipt{OperationKey: key, ReviewHash: p.ReviewHash, EvidenceHash: evidence, Generation: s.Config.Generation}
	return result, tx.Commit()
}
