// Package unified implements a reviewed, same-instance shadow copy. It never
// changes the source writer, runtime configuration, or active schema generation.
package unified

import (
	"context"
	"crypto/sha256"
	"database/sql"
	"encoding/binary"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"github.com/huizhi-yun/data-runtime/internal/migrationlock"
	"hash"
	"regexp"
	"sort"
	"strings"
	"time"
)

type Config struct {
	Tenant, Environment, RuntimeDeployment, InstanceID, SchemaVersion string
	Generation                                                        uint64
	SourceAims, SourceAssets, Target                                  string
}
type Trigger struct{ Name, Timing, Event, Statement string }
type Table struct {
	Domain, Source, Name, Target, DDL string
	Columns, PrimaryKey               []string
	Count                             uint64
	Hash                              string
	Triggers                          []Trigger
}
type Plan struct {
	Version           string
	Config            Config
	Tables            []Table
	BlockingConflicts []MigrationConflict `json:",omitempty"`
	ReviewHash        string
}

var ident = regexp.MustCompile(`^[a-z][a-z0-9_]{0,63}$`)

func quoted(s string) string                { return "`" + s + "`" }
func qualified(schema, table string) string { return quoted(schema) + "." + quoted(table) }
func validate(c Config) error {
	if c.Tenant == "" || c.Environment == "" || c.RuntimeDeployment == "" || c.InstanceID == "" || c.SchemaVersion == "" || c.Generation == 0 {
		return errors.New("migration identity incomplete")
	}
	if !ident.MatchString(c.SourceAims) || !ident.MatchString(c.SourceAssets) || !ident.MatchString(c.Target) || c.SourceAims == c.SourceAssets || c.Target == c.SourceAims || c.Target == c.SourceAssets {
		return errors.New("separate explicit source/target schemas required")
	}
	return nil
}
func ReviewHash(p Plan) string {
	p.ReviewHash = ""
	b, _ := json.Marshal(p)
	sum := sha256.Sum256(b)
	return hex.EncodeToString(sum[:])
}
func Prepare(ctx context.Context, db *sql.DB, c Config) (Plan, error) {
	if err := validate(c); err != nil {
		return Plan{}, err
	}
	tx, err := db.BeginTx(ctx, &sql.TxOptions{Isolation: sql.LevelRepeatableRead, ReadOnly: true})
	if err != nil {
		return Plan{}, err
	}
	defer tx.Rollback()
	return prepare(ctx, tx, c)
}
func prepare(ctx context.Context, tx *sql.Tx, c Config) (Plan, error) {
	var instance string
	if err := tx.QueryRowContext(ctx, "SELECT @@server_uuid").Scan(&instance); err != nil {
		return Plan{}, err
	}
	if !strings.EqualFold(instance, c.InstanceID) {
		return Plan{}, errors.New("source instance mismatch; cross-instance copy unsupported")
	}
	p := Plan{Version: "enterprise-shadow-copy.v1", Config: c, Tables: []Table{}}
	for _, source := range []struct{ domain, schema string }{{"aims", c.SourceAims}, {"assets", c.SourceAssets}} {
		rows, err := tx.QueryContext(ctx, "SELECT TABLE_NAME,ENGINE,TABLE_TYPE FROM information_schema.TABLES WHERE TABLE_SCHEMA=? ORDER BY TABLE_NAME", source.schema)
		if err != nil {
			return p, err
		}
		var tables []Table
		for rows.Next() {
			var name, engine, kind string
			if err := rows.Scan(&name, &engine, &kind); err != nil {
				rows.Close()
				return p, err
			}
			if !ident.MatchString(name) || engine != "InnoDB" || kind != "BASE TABLE" || len(source.domain+"_"+name) > 64 {
				rows.Close()
				return p, errors.New("unsupported source table identity/engine/type")
			}
			tables = append(tables, Table{Domain: source.domain, Source: source.schema, Name: name, Target: source.domain + "_" + name})
		}
		err = rows.Err()
		rows.Close()
		if err != nil {
			return p, err
		}
		if len(tables) == 0 {
			return p, errors.New("source schema empty or inaccessible")
		}
		for _, t := range tables {
			var name string
			if err := tx.QueryRowContext(ctx, "SHOW CREATE TABLE "+qualified(t.Source, t.Name)).Scan(&name, &t.DDL); err != nil {
				return p, err
			}
			rows, err := tx.QueryContext(ctx, "SELECT COLUMN_NAME,EXTRA FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=? AND TABLE_NAME=? ORDER BY ORDINAL_POSITION", t.Source, t.Name)
			if err != nil {
				return p, err
			}
			for rows.Next() {
				var col, extra string
				if err := rows.Scan(&col, &extra); err != nil {
					rows.Close()
					return p, err
				}
				if !strings.Contains(extra, "VIRTUAL GENERATED") && !strings.Contains(extra, "STORED GENERATED") {
					t.Columns = append(t.Columns, col)
				}
			}
			err = rows.Err()
			rows.Close()
			if err != nil {
				return p, err
			}
			rows, err = tx.QueryContext(ctx, "SELECT COLUMN_NAME FROM information_schema.STATISTICS WHERE TABLE_SCHEMA=? AND TABLE_NAME=? AND INDEX_NAME='PRIMARY' ORDER BY SEQ_IN_INDEX", t.Source, t.Name)
			if err != nil {
				return p, err
			}
			for rows.Next() {
				var col string
				if err := rows.Scan(&col); err != nil {
					rows.Close()
					return p, err
				}
				t.PrimaryKey = append(t.PrimaryKey, col)
			}
			err = rows.Err()
			rows.Close()
			if err != nil {
				return p, err
			}
			if len(t.PrimaryKey) == 0 {
				return p, fmt.Errorf("source table %s.%s has no deterministic primary key", t.Domain, t.Name)
			}
			var external int
			if err := tx.QueryRowContext(ctx, "SELECT COUNT(*) FROM information_schema.KEY_COLUMN_USAGE WHERE TABLE_SCHEMA=? AND TABLE_NAME=? AND REFERENCED_TABLE_SCHEMA IS NOT NULL AND REFERENCED_TABLE_SCHEMA<>?", t.Source, t.Name, t.Source).Scan(&external); err != nil {
				return p, err
			}
			if external != 0 {
				return p, errors.New("external schema FK requires explicit future cross-domain mapping")
			}
			rows, err = tx.QueryContext(ctx, "SELECT TRIGGER_NAME,ACTION_TIMING,EVENT_MANIPULATION,ACTION_STATEMENT FROM information_schema.TRIGGERS WHERE TRIGGER_SCHEMA=? AND EVENT_OBJECT_TABLE=? ORDER BY TRIGGER_NAME", t.Source, t.Name)
			if err != nil {
				return p, err
			}
			for rows.Next() {
				var trigger Trigger
				if err := rows.Scan(&trigger.Name, &trigger.Timing, &trigger.Event, &trigger.Statement); err != nil {
					rows.Close()
					return p, err
				}
				t.Triggers = append(t.Triggers, trigger)
			}
			err = rows.Err()
			rows.Close()
			if err != nil {
				return p, err
			}
			t.Count, t.Hash, err = digest(ctx, tx, qualified(t.Source, t.Name), t.PrimaryKey)
			if err != nil {
				return p, err
			}
			p.Tables = append(p.Tables, t)
		}
	}
	// Validate every DDL/trigger rewrite in dry-run, before any target creation.
	for _, t := range p.Tables {
		if _, err := rewriteDDL(t, p); err != nil {
			return p, err
		}
		for _, tr := range t.Triggers {
			if _, err := rewriteTrigger(t, tr, p); err != nil {
				return p, err
			}
		}
	}
	conflicts, err := inspectProductMasterConflicts(ctx, tx, c)
	if err != nil {
		return p, err
	}
	p.BlockingConflicts = conflicts
	unknownJSON, err := inspectUnregisteredJSON(ctx, tx, p.Tables)
	if err != nil {
		return p, err
	}
	p.BlockingConflicts = append(p.BlockingConflicts, unknownJSON...)
	invalidValueJSON, err := inspectValueOnlyJSON(ctx, tx, p.Tables)
	if err != nil {
		return p, err
	}
	p.BlockingConflicts = append(p.BlockingConflicts, invalidValueJSON...)
	p.ReviewHash = ReviewHash(p)
	return p, nil
}

type querier interface {
	QueryContext(context.Context, string, ...any) (*sql.Rows, error)
}

func digest(ctx context.Context, q querier, table string, pk []string) (uint64, string, error) {
	rows, err := q.QueryContext(ctx, "SELECT * FROM "+table+" ORDER BY "+joinQuoted(pk))
	if err != nil {
		return 0, "", err
	}
	defer rows.Close()
	cols, err := rows.Columns()
	if err != nil {
		return 0, "", err
	}
	h := sha256.New()
	var count uint64
	for rows.Next() {
		raw := make([]sql.RawBytes, len(cols))
		dest := make([]any, len(cols))
		for i := range raw {
			dest[i] = &raw[i]
		}
		if err := rows.Scan(dest...); err != nil {
			return 0, "", err
		}
		hashRow(h, raw)
		count++
	}
	return count, hex.EncodeToString(h.Sum(nil)), rows.Err()
}
func hashRow(h hash.Hash, row []sql.RawBytes) {
	var size [8]byte
	binary.BigEndian.PutUint64(size[:], uint64(len(row)))
	h.Write(size[:])
	for _, v := range row {
		if v == nil {
			h.Write([]byte{0})
			continue
		}
		h.Write([]byte{1})
		binary.BigEndian.PutUint64(size[:], uint64(len(v)))
		h.Write(size[:])
		h.Write(v)
	}
}
func joinQuoted(cols []string) string {
	out := make([]string, len(cols))
	for i, c := range cols {
		out[i] = quoted(c)
	}
	return strings.Join(out, ",")
}

var references = regexp.MustCompile("(?i)REFERENCES\\s+`([^`]+)`(?:\\.`([^`]+)`)?")
var constraints = regexp.MustCompile("(?i)CONSTRAINT\\s+`([^`]+)`")

func stableName(domain, name string) string {
	sum := sha256.Sum256([]byte(name))
	if len(name) > 40 {
		name = name[:40]
	}
	return domain + "_" + name + "_" + hex.EncodeToString(sum[:4])
}
func mapping(p Plan, domain, table string) (string, bool) {
	for _, t := range p.Tables {
		if t.Domain == domain && t.Name == table {
			return t.Target, true
		}
	}
	return "", false
}
func rewriteDDL(t Table, p Plan) (string, error) {
	prefix := "CREATE TABLE " + quoted(t.Name)
	if !strings.HasPrefix(t.DDL, prefix) {
		return "", errors.New("unexpected SHOW CREATE TABLE shape")
	}
	ddl := strings.Replace(t.DDL, prefix, "CREATE TABLE "+qualified(p.Config.Target, t.Target), 1)
	var invalid bool
	ddl = references.ReplaceAllStringFunc(ddl, func(v string) string {
		m := references.FindStringSubmatch(v)
		table := m[1]
		if m[2] != "" {
			if m[1] != t.Source {
				invalid = true
			}
			table = m[2]
		}
		target, ok := mapping(p, t.Domain, table)
		if !ok {
			invalid = true
		}
		return "REFERENCES " + qualified(p.Config.Target, target)
	})
	ddl = constraints.ReplaceAllStringFunc(ddl, func(v string) string {
		m := constraints.FindStringSubmatch(v)
		return "CONSTRAINT " + quoted(stableName(t.Domain, m[1]))
	})
	if invalid {
		return "", errors.New("unmapped foreign-key reference")
	}
	return ddl, nil
}

// Trigger references are accepted only in known table positions. Stored routine
// calls, dynamic SQL and explicit schema references require a reviewed extension.
var triggerTable = regexp.MustCompile("(?i)\\b(INTO|UPDATE|FROM|JOIN)\\s+(`?[A-Za-z_][A-Za-z0-9_]*`?)(?:\\s*\\.\\s*(`?[A-Za-z_][A-Za-z0-9_]*`?))?")
var unsafeTrigger = regexp.MustCompile(`(?i)\b(CALL|PREPARE|EXECUTE|LOAD_FILE|OUTFILE)\b`)

func rewriteTrigger(t Table, tr Trigger, p Plan) (string, error) {
	if unsafeTrigger.MatchString(tr.Statement) {
		return "", errors.New("unsupported trigger routine or dynamic SQL")
	}
	bad := false
	body := triggerTable.ReplaceAllStringFunc(tr.Statement, func(v string) string {
		m := triggerTable.FindStringSubmatch(v)
		name := strings.Trim(m[2], "`")
		if m[3] != "" {
			if name != t.Source {
				bad = true
			}
			name = strings.Trim(m[3], "`")
		}
		target, ok := mapping(p, t.Domain, name)
		if !ok {
			bad = true
		}
		return m[1] + " " + qualified(p.Config.Target, target)
	})
	if bad {
		return "", errors.New("unmapped trigger table reference")
	}
	if tr.Timing != "BEFORE" && tr.Timing != "AFTER" {
		return "", errors.New("invalid trigger timing")
	}
	if tr.Event != "INSERT" && tr.Event != "UPDATE" && tr.Event != "DELETE" {
		return "", errors.New("invalid trigger event")
	}
	return "CREATE TRIGGER " + qualified(p.Config.Target, stableName(t.Domain, tr.Name)) + " " + tr.Timing + " " + tr.Event + " ON " + qualified(p.Config.Target, t.Target) + " FOR EACH ROW " + body, nil
}

// Apply copies a single consistent source snapshot into an exclusively owned
// shadow database. Retry restarts incomplete tables, retaining completed hashes.
func Apply(ctx context.Context, db *sql.DB, p Plan, approvedHash string) error {
	if err := validate(p.Config); err != nil {
		return err
	}
	if approvedHash == "" || p.ReviewHash != approvedHash || ReviewHash(p) != approvedHash {
		return errors.New("explicit matching review hash required")
	}
	if len(p.BlockingConflicts) != 0 {
		return errors.New("migration has unresolved blocking conflicts; inspect the redacted plan report")
	}
	conn, err := db.Conn(ctx)
	if err != nil {
		return err
	}
	defer conn.Close()
	release, err := migrationlock.Acquire(ctx, conn, p.Config.InstanceID, p.Config.Target)
	if err != nil {
		return err
	}
	defer release()
	source, err := db.BeginTx(ctx, &sql.TxOptions{Isolation: sql.LevelRepeatableRead, ReadOnly: true})
	if err != nil {
		return err
	}
	defer source.Rollback()
	current, err := prepare(ctx, source, p.Config)
	if err != nil {
		return err
	}
	if current.ReviewHash != approvedHash {
		return errors.New("source schema/content changed since review; generate a new plan")
	}
	var exists int
	if err := conn.QueryRowContext(ctx, "SELECT COUNT(*) FROM information_schema.SCHEMATA WHERE SCHEMA_NAME=?", p.Config.Target).Scan(&exists); err != nil {
		return err
	}
	ledger := qualified(p.Config.Target, "enterprise_migration_ledger")
	checkpoint := qualified(p.Config.Target, "enterprise_migration_checkpoint")
	if exists != 0 {
		var hash, status string
		if err := conn.QueryRowContext(ctx, "SELECT review_hash,status FROM "+ledger+" WHERE id=1").Scan(&hash, &status); err != nil || hash != approvedHash {
			return errors.New("existing target is not owned by this reviewed migration")
		}
		var registryExists int
		if err := conn.QueryRowContext(ctx, "SELECT COUNT(*) FROM information_schema.TABLES WHERE TABLE_SCHEMA=? AND TABLE_NAME='enterprise_schema_registry'", p.Config.Target).Scan(&registryExists); err != nil {
			return err
		}
		if registryExists > 0 {
			var generation uint64
			if err := conn.QueryRowContext(ctx, "SELECT generation FROM "+qualified(p.Config.Target, "enterprise_schema_registry")+" WHERE id=1").Scan(&generation); err != nil || generation != 0 {
				return errors.New("target is active or registry is incompatible; shadow copy refused")
			}
		}
		if status == "verified-shadow" {
			if err := verifyCopied(ctx, conn, p); err != nil {
				return err
			}
			return verifyForeignKeys(ctx, conn, p)
		}
	} else {
		if _, err := conn.ExecContext(ctx, "CREATE DATABASE "+quoted(p.Config.Target)+" CHARACTER SET utf8mb4 COLLATE utf8mb4_bin"); err != nil {
			return err
		}
		if _, err := conn.ExecContext(ctx, "CREATE TABLE "+ledger+"(id TINYINT PRIMARY KEY,review_hash CHAR(64) NOT NULL,status VARCHAR(32) NOT NULL,created_at DATETIME(3) NOT NULL) ENGINE=InnoDB"); err != nil {
			return err
		}
		if _, err := conn.ExecContext(ctx, "INSERT INTO "+ledger+" VALUES(1,?,'copying',UTC_TIMESTAMP(3))", approvedHash); err != nil {
			return err
		}
		if _, err := conn.ExecContext(ctx, "CREATE TABLE "+checkpoint+"(target_table VARCHAR(64) PRIMARY KEY,copied_rows BIGINT UNSIGNED NOT NULL,source_hash CHAR(64) NOT NULL,status VARCHAR(32) NOT NULL) ENGINE=InnoDB"); err != nil {
			return err
		}
	}
	if _, err := conn.ExecContext(ctx, "SET SESSION foreign_key_checks=0"); err != nil {
		return err
	}
	defer conn.ExecContext(context.Background(), "SET SESSION foreign_key_checks=1")
	for _, t := range p.Tables {
		var done string
		err := conn.QueryRowContext(ctx, "SELECT status FROM "+checkpoint+" WHERE target_table=?", t.Target).Scan(&done)
		if err != nil && !errors.Is(err, sql.ErrNoRows) {
			return err
		}
		if done == "verified" {
			continue
		}
		var exists int
		if err := conn.QueryRowContext(ctx, "SELECT COUNT(*) FROM information_schema.TABLES WHERE TABLE_SCHEMA=? AND TABLE_NAME=?", p.Config.Target, t.Target).Scan(&exists); err != nil {
			return err
		}
		if exists == 0 {
			ddl, err := rewriteDDL(t, p)
			if err != nil {
				return err
			}
			if _, err := conn.ExecContext(ctx, ddl); err != nil {
				return err
			}
		}
		// Only migration-owned target tables are restarted. No source DELETE/UPDATE.
		if _, err := conn.ExecContext(ctx, "DELETE FROM "+qualified(p.Config.Target, t.Target)); err != nil {
			return err
		}
		if err := copyTable(ctx, source, conn, t, p, checkpoint); err != nil {
			return err
		}
	}
	if err := verifyCopied(ctx, conn, p); err != nil {
		return err
	}
	if err := verifyForeignKeys(ctx, conn, p); err != nil {
		return err
	}
	for _, t := range p.Tables {
		for _, tr := range t.Triggers {
			name := stableName(t.Domain, tr.Name)
			var count int
			if err := conn.QueryRowContext(ctx, "SELECT COUNT(*) FROM information_schema.TRIGGERS WHERE TRIGGER_SCHEMA=? AND TRIGGER_NAME=?", p.Config.Target, name).Scan(&count); err != nil {
				return err
			}
			if count == 0 {
				ddl, err := rewriteTrigger(t, tr, p)
				if err != nil {
					return err
				}
				if _, err := conn.ExecContext(ctx, ddl); err != nil {
					return err
				}
			}
		}
	}
	// generation=0 deliberately prevents Runtime from using this shadow snapshot.
	registry := qualified(p.Config.Target, "enterprise_schema_registry")
	if _, err := conn.ExecContext(ctx, "CREATE TABLE IF NOT EXISTS "+registry+"(id TINYINT PRIMARY KEY,tenant_code VARCHAR(100) NOT NULL,environment_code VARCHAR(100) NOT NULL,runtime_deployment VARCHAR(100) NOT NULL,schema_version VARCHAR(100) NOT NULL,generation BIGINT UNSIGNED NOT NULL,CHECK(id=1)) ENGINE=InnoDB"); err != nil {
		return err
	}
	if _, err := conn.ExecContext(ctx, "INSERT INTO "+registry+" VALUES(1,?,?,?,?,0) ON DUPLICATE KEY UPDATE generation=0", p.Config.Tenant, p.Config.Environment, p.Config.RuntimeDeployment, p.Config.SchemaVersion); err != nil {
		return err
	}
	_, err = conn.ExecContext(ctx, "UPDATE "+ledger+" SET status='verified-shadow' WHERE id=1 AND review_hash=?", approvedHash)
	return err
}
func copyTable(ctx context.Context, source *sql.Tx, target *sql.Conn, t Table, p Plan, checkpoint string) error {
	rows, err := source.QueryContext(ctx, "SELECT "+joinQuoted(t.Columns)+" FROM "+qualified(t.Source, t.Name)+" ORDER BY "+joinQuoted(t.PrimaryKey))
	if err != nil {
		return err
	}
	defer rows.Close()
	slots := make([]string, len(t.Columns))
	for i := range slots {
		slots[i] = "?"
	}
	insert := "INSERT INTO " + qualified(p.Config.Target, t.Target) + " (" + joinQuoted(t.Columns) + ") VALUES (" + strings.Join(slots, ",") + ")"
	var copied uint64
	for {
		tx, err := target.BeginTx(ctx, nil)
		if err != nil {
			return err
		}
		batch := 0
		for batch < 250 && rows.Next() {
			raw := make([]sql.RawBytes, len(t.Columns))
			dest := make([]any, len(raw))
			for i := range raw {
				dest[i] = &raw[i]
			}
			if err := rows.Scan(dest...); err != nil {
				tx.Rollback()
				return err
			}
			args := make([]any, len(raw))
			for i, v := range raw {
				if v != nil {
					args[i] = []byte(v)
				}
			}
			if _, err := tx.ExecContext(ctx, insert, args...); err != nil {
				tx.Rollback()
				return err
			}
			batch++
			copied++
		}
		if err := rows.Err(); err != nil {
			tx.Rollback()
			return err
		}
		if _, err := tx.ExecContext(ctx, "INSERT INTO "+checkpoint+" VALUES(?,?,?,'copying') ON DUPLICATE KEY UPDATE copied_rows=VALUES(copied_rows),source_hash=VALUES(source_hash),status='copying'", t.Target, copied, t.Hash); err != nil {
			tx.Rollback()
			return err
		}
		if err := tx.Commit(); err != nil {
			return err
		}
		if batch < 250 {
			break
		}
	}
	count, hash, err := digest(ctx, target, qualified(p.Config.Target, t.Target), t.PrimaryKey)
	if err != nil {
		return err
	}
	if count != t.Count || hash != t.Hash {
		return errors.New("target table count/hash mismatch")
	}
	_, err = target.ExecContext(ctx, "UPDATE "+checkpoint+" SET status='verified' WHERE target_table=?", t.Target)
	return err
}
func verifyCopied(ctx context.Context, q querier, p Plan) error {
	for _, t := range p.Tables {
		count, hash, err := digest(ctx, q, qualified(p.Config.Target, t.Target), t.PrimaryKey)
		if err != nil {
			return err
		}
		if count != t.Count || hash != t.Hash {
			return fmt.Errorf("target count/hash mismatch: %s", t.Target)
		}
	}
	return nil
}
func verifyForeignKeys(ctx context.Context, conn *sql.Conn, p Plan) error {
	type fk struct {
		table, ref string
		cols, refs []string
	}
	rows, err := conn.QueryContext(ctx, "SELECT TABLE_NAME,CONSTRAINT_NAME,COLUMN_NAME,REFERENCED_TABLE_NAME,REFERENCED_COLUMN_NAME FROM information_schema.KEY_COLUMN_USAGE WHERE TABLE_SCHEMA=? AND REFERENCED_TABLE_NAME IS NOT NULL ORDER BY TABLE_NAME,CONSTRAINT_NAME,ORDINAL_POSITION", p.Config.Target)
	if err != nil {
		return err
	}
	groups := map[string]*fk{}
	for rows.Next() {
		var table, key, col, ref, refcol string
		if err := rows.Scan(&table, &key, &col, &ref, &refcol); err != nil {
			rows.Close()
			return err
		}
		id := table + "/" + key
		if groups[id] == nil {
			groups[id] = &fk{table: table, ref: ref}
		}
		groups[id].cols = append(groups[id].cols, col)
		groups[id].refs = append(groups[id].refs, refcol)
	}
	err = rows.Err()
	rows.Close()
	if err != nil {
		return err
	}
	keys := make([]string, 0, len(groups))
	for key := range groups {
		keys = append(keys, key)
	}
	sort.Strings(keys)
	for _, key := range keys {
		f := groups[key]
		var joins, nonnull []string
		for i, col := range f.cols {
			joins = append(joins, "c."+quoted(col)+"=p."+quoted(f.refs[i]))
			nonnull = append(nonnull, "c."+quoted(col)+" IS NOT NULL")
		}
		var n uint64
		if err := conn.QueryRowContext(ctx, "SELECT COUNT(*) FROM "+qualified(p.Config.Target, f.table)+" c LEFT JOIN "+qualified(p.Config.Target, f.ref)+" p ON "+strings.Join(joins, " AND ")+" WHERE "+strings.Join(nonnull, " AND ")+" AND p."+quoted(f.refs[0])+" IS NULL").Scan(&n); err != nil {
			return err
		}
		if n != 0 {
			return errors.New("orphan target foreign-key references")
		}
	}
	return nil
}

// BoundContext bounds standalone migration operations without a hidden wait.
func BoundContext(parent context.Context) (context.Context, context.CancelFunc) {
	return context.WithTimeout(parent, 30*time.Minute)
}
