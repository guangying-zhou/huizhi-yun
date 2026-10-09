// Package domaininstall installs reviewed table or column subsets in an activated
// unified database. It never updates Registry or existing business rows.
package domaininstall

import (
	"context"
	"crypto/sha256"
	"database/sql"
	_ "embed"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"regexp"
	"sort"
	"strings"

	"github.com/huizhi-yun/data-runtime/internal/enterprise"
	"github.com/huizhi-yun/data-runtime/internal/migrationlock"
)

//go:embed altoc.json
var manifest []byte

//go:embed deletion_evidence.json
var deletionEvidenceManifest []byte

type installer struct {
	column           *columnInstaller
	domain           string
	manifest         []byte
	write, scheduler enterprise.PathMode
	exactCount       int
	expect           Expectation
	apf              bool
}

// Expectation is the reviewed identity an installation may target. The legacy
// package functions keep the fixed C000001/test local expectation; the
// profile-driven production path supplies an explicit tenant, environment,
// owner deployment and exact storage address.
type Expectation struct {
	Tenant, Environment, OwnerDeployment string
	// Address is the exact host:port. Empty keeps the legacy loopback rule.
	Address string
}

var c000001Expectation = Expectation{Tenant: "C000001", Environment: "test", OwnerDeployment: "C000001-test-enterprise"}
var altocInstaller = installer{domain: "altoc", manifest: manifest, write: enterprise.PathDisabled, scheduler: enterprise.PathDisabled, exactCount: 13, expect: c000001Expectation}
var deletionInstaller = installer{domain: "aims", manifest: deletionEvidenceManifest, write: enterprise.PathUnified, scheduler: enterprise.PathUnified, expect: c000001Expectation}

var ErrBoundary = errors.New("domain installation boundary rejected")

type Table struct {
	Logical, Physical, DDL string
	Columns                []string
	ForeignKeys            []ColumnForeignKey `json:",omitempty"`
}
type Plan struct {
	Column     *ColumnPlan `json:",omitempty"`
	Binding    enterprise.Binding
	Tables     []Table
	Views      []enterprise.CompatibilityView
	Baseline   string
	ReviewHash string
}
type Stopped func(context.Context) error
type Receipt struct {
	Plan          Plan
	Created       map[string]string
	ColumnTimings []ColumnDDLTiming `json:",omitempty"`
}
type Checkpoint func(Receipt) error

func (x *installer) tables() []Table {
	var v []Table
	if json.Unmarshal(x.manifest, &v) != nil {
		panic("invalid embedded fixed installation manifest")
	}
	return v
}
func q(s string) string { return "`" + strings.ReplaceAll(s, "`", "``") + "`" }
func hash(v any) string {
	raw, _ := json.Marshal(v)
	h := sha256.Sum256(raw)
	return hex.EncodeToString(h[:])
}
func (x *installer) validate(b enterprise.Binding) error {
	if !regexp.MustCompile(`^[A-Za-z0-9_]+$`).MatchString(b.Storage.Database) {
		return ErrBoundary
	}
	e := x.expect
	if e.Tenant == "" || e.OwnerDeployment == "" || (e.Environment != "prod" && e.Environment != "test" && e.Environment != "dev") {
		return ErrBoundary
	}
	if b.Key.Tenant != e.Tenant || b.Key.Environment != e.Environment || b.Generation == 0 || b.SchemaVersion == "" || b.Storage.InstanceID == "" || b.Storage.Database == "" {
		return ErrBoundary
	}
	if e.Address == "" {
		if b.Storage.Address != "127.0.0.1:3306" && !strings.HasPrefix(b.Storage.Address, "127.0.0.1:") {
			return ErrBoundary
		}
	} else if b.Storage.Address != e.Address {
		return ErrBoundary
	}
	if x.apf {
		if x.domain == "altoc-receivables" {
			return x.validateReceivables(b)
		}
		if W1Domain(x.domain) != "" {
			return x.validateW1(b)
		}
		if x.domain == "aims-portfolio-members" {
			return x.validateAimsPortfolioMembers(b)
		}
		if strings.HasSuffix(x.domain, "-due") {
			return x.validateDue(b)
		}
		if x.domain == "altoc-feedback" {
			return x.validateAltocFeedback(b)
		}
		if x.domain == "finance-receivables" {
			return x.validateFinanceReceivables(b)
		}
		if x.domain == "finance-cost" {
			return x.validateFinanceCost(b)
		}
		if x.domain == "finance-13b" {
			return x.validateFinance13b(b)
		}
		if x.domain == "finance-13a" {
			return x.validateFinance13a(b)
		}
		if x.domain == "altoc-renewals" {
			return x.validateAltocRenewals(b)
		}
		if x.domain == "altoc-tickets" {
			return x.validateAltocTickets(b)
		}
		if x.domain == "altoc-services" {
			return x.validateAltocServices(b)
		}
		if x.domain == "altoc-tenders" {
			return x.validateAltocTenders(b)
		}
		if x.domain == "altoc-sales" {
			return x.validateAltocSales(b)
		}
		if x.domain == "finance-b3" {
			return x.validateFinanceB3(b)
		}
		if x.domain == "people-hr-source" {
			return x.validatePeopleHRSource(b)
		}
		if x.domain == "people-offboarding" {
			return x.validatePeopleOffboarding(b)
		}
		if x.domain == "people-facts" {
			return x.validatePeopleFacts(b)
		}
		if x.domain == "people-private" {
			return x.validatePeoplePrivate(b)
		}
		return x.validateAPF(b)
	}
	d, ok := b.Domains[x.domain]
	if !ok || d.OwnerDeployment != e.OwnerDeployment || d.Read != enterprise.PathUnified || d.Write != x.write || d.Scheduler != x.scheduler || (x.exactCount > 0 && len(d.Tables) != x.exactCount) {
		return ErrBoundary
	}
	for _, t := range x.tables() {
		if d.Tables[t.Logical] != t.Physical {
			return ErrBoundary
		}
	}
	// Existing mappings cannot claim any newly introduced logical or physical name.
	for name, other := range b.Domains {
		if name == x.domain {
			continue
		}
		for logical, physical := range other.Tables {
			for _, t := range x.tables() {
				if logical == t.Logical || physical == t.Physical || physical == t.Logical {
					return ErrBoundary
				}
			}
		}
	}
	return nil
}
func identity(ctx context.Context, c *sql.Conn, b enterprise.Binding) error {
	var instance, db, tenant, env, dep, version string
	var generation uint64
	if err := c.QueryRowContext(ctx, "SELECT @@server_uuid,DATABASE()").Scan(&instance, &db); err != nil {
		return err
	}
	if !strings.EqualFold(instance, b.Storage.InstanceID) || db != b.Storage.Database {
		return ErrBoundary
	}
	if err := c.QueryRowContext(ctx, "SELECT tenant_code,environment_code,runtime_deployment,schema_version,generation FROM enterprise_schema_registry WHERE id=1").Scan(&tenant, &env, &dep, &version, &generation); err != nil {
		return err
	}
	if tenant != b.Key.Tenant || env != b.Key.Environment || dep != b.Key.RuntimeDeployment || version != b.SchemaVersion || generation != b.Generation {
		return ErrBoundary
	}
	return nil
}
func (x *installer) names() map[string]bool {
	n := map[string]bool{}
	for _, t := range x.tables() {
		if !x.apf {
			n[t.Logical] = true
		}
		n[t.Physical] = true
	}
	return n
}

// Snapshot includes exact existing definitions and a row multiset digest. Raw
// data stays in memory and is never returned, logged, or written into a plan.
func (x *installer) baseline(ctx context.Context, c *sql.Conn, db string) (string, error) {
	rows, err := c.QueryContext(ctx, "SELECT TABLE_NAME,TABLE_TYPE FROM information_schema.TABLES WHERE TABLE_SCHEMA=? ORDER BY TABLE_NAME", db)
	if err != nil {
		return "", err
	}
	type object struct{ Name, Kind string }
	var objects []object
	for rows.Next() {
		var o object
		if err = rows.Scan(&o.Name, &o.Kind); err != nil {
			rows.Close()
			return "", err
		}
		if !x.names()[o.Name] {
			objects = append(objects, o)
		}
	}
	err = rows.Err()
	rows.Close()
	if err != nil {
		return "", err
	}
	var summaries []any
	for _, o := range objects {
		var name, definition string
		// SHOW CREATE VIEW has additional charset columns, so consume generically.
		rs, e := c.QueryContext(ctx, "SHOW CREATE TABLE "+q(o.Name))
		if e != nil {
			return "", e
		}
		cols, _ := rs.Columns()
		vals := make([]any, len(cols))
		ptr := make([]any, len(cols))
		for i := range vals {
			ptr[i] = &vals[i]
		}
		if !rs.Next() {
			rs.Close()
			return "", ErrBoundary
		}
		if e = rs.Scan(ptr...); e != nil {
			rs.Close()
			return "", e
		}
		name = fmt.Sprint(vals[0])
		if v, ok := vals[1].([]byte); ok {
			definition = string(v)
		} else {
			definition = fmt.Sprint(vals[1])
		}
		rs.Close()
		var digests []string
		if o.Kind == "BASE TABLE" {
			rs, e = c.QueryContext(ctx, "SELECT * FROM "+q(o.Name))
			if e != nil {
				return "", e
			}
			columns, _ := rs.Columns()
			for rs.Next() {
				v := make([]any, len(columns))
				p := make([]any, len(columns))
				for i := range v {
					p[i] = &v[i]
				}
				if e = rs.Scan(p...); e != nil {
					rs.Close()
					return "", e
				}
				digests = append(digests, hash(v))
			}
			e = rs.Err()
			rs.Close()
			if e != nil {
				return "", e
			}
			sort.Strings(digests)
		}
		summaries = append(summaries, []any{name, definition, digests})
	}
	return hash(summaries), nil
}
func (x *installer) expected(b enterprise.Binding) Plan {
	p := Plan{Binding: b, Tables: x.tables()}
	if x.apf {
		return p
	}
	for _, t := range p.Tables {
		var cols []string
		for _, col := range t.Columns {
			cols = append(cols, q(b.Storage.Database)+"."+q(t.Physical)+"."+q(col)+" AS "+q(col))
		}
		def := "SELECT " + strings.Join(cols, ",") + " FROM " + q(b.Storage.Database) + "." + q(t.Physical)
		p.Views = append(p.Views, enterprise.CompatibilityView{Domain: x.domain, Logical: t.Logical, Physical: t.Physical, Definition: def, DDL: "CREATE ALGORITHM=MERGE SQL SECURITY INVOKER VIEW " + q(b.Storage.Database) + "." + q(t.Logical) + " AS " + def})
	}
	return p
}
func (x *installer) absent(ctx context.Context, c *sql.Conn, db string) error {
	names := x.names()
	// APF cannot coexist with the old read-only Altoc closure, even when its
	// config mapping was removed but a compatibility view or old-only table remains.
	if x.apf && x.domain == "apf" {
		for _, t := range altocInstaller.tables() {
			names[t.Logical], names[t.Physical] = true, true
		}
	}
	for name := range names {
		var n int
		if err := c.QueryRowContext(ctx, "SELECT COUNT(*) FROM information_schema.TABLES WHERE TABLE_SCHEMA=? AND TABLE_NAME=?", db, name).Scan(&n); err != nil {
			return err
		}
		if n != 0 {
			return ErrBoundary
		}
	}
	return nil
}
func (x *installer) PlanInstall(ctx context.Context, db *sql.DB, b enterprise.Binding) (Plan, error) {
	if err := x.validate(b); err != nil {
		return Plan{}, err
	}
	c, err := db.Conn(ctx)
	if err != nil {
		return Plan{}, err
	}
	defer c.Close()
	release, err := migrationlock.Acquire(ctx, c, b.Storage.InstanceID, b.Storage.Database)
	if err != nil {
		return Plan{}, err
	}
	defer release()
	if err = identity(ctx, c, b); err != nil {
		return Plan{}, err
	}
	if err = x.absent(ctx, c, b.Storage.Database); err != nil {
		return Plan{}, err
	}
	p := x.expected(b)
	if err = x.tableDependencies(ctx, c, p); err != nil {
		return Plan{}, err
	}
	p.Baseline, err = x.baseline(ctx, c, b.Storage.Database)
	if err != nil {
		return Plan{}, err
	}
	p.ReviewHash = hash(p)
	return p, nil
}
func (x *installer) reviewed(p Plan) error {
	if err := x.validate(p.Binding); err != nil {
		return err
	}
	canonical := x.expected(p.Binding)
	canonical.Baseline = p.Baseline
	canonical.ReviewHash = hash(canonical)
	if p.Baseline == "" || hash(p) != hash(canonical) {
		return ErrBoundary
	}
	return nil
}
func (x *installer) withStopped(ctx context.Context, db *sql.DB, p Plan, stopped Stopped, fn func(*sql.Conn) error) error {
	if err := x.reviewed(p); err != nil {
		return err
	}
	if stopped == nil {
		return ErrBoundary
	}
	if err := stopped(ctx); err != nil {
		return err
	}
	c, err := db.Conn(ctx)
	if err != nil {
		return err
	}
	defer c.Close()
	release, err := migrationlock.Acquire(ctx, c, p.Binding.Storage.InstanceID, p.Binding.Storage.Database)
	if err != nil {
		return err
	}
	defer release()
	if err = identity(ctx, c, p.Binding); err != nil {
		return err
	}
	return fn(c)
}
func (x *installer) Apply(ctx context.Context, db *sql.DB, p Plan, stopped Stopped, save Checkpoint) error {
	if save == nil {
		return ErrBoundary
	}
	receipt := Receipt{Plan: p, Created: map[string]string{}}
	return x.withStopped(ctx, db, p, stopped, func(c *sql.Conn) error {
		if err := x.absent(ctx, c, p.Binding.Storage.Database); err != nil {
			return err
		}
		before, err := x.baseline(ctx, c, p.Binding.Storage.Database)
		if err != nil {
			return err
		}
		if before != p.Baseline {
			return ErrBoundary
		}
		if err = save(receipt); err != nil {
			return err
		}
		for _, t := range p.Tables {
			if err = stopped(ctx); err != nil {
				return err
			}
			if err = identity(ctx, c, p.Binding); err != nil {
				return err
			}
			if _, err = c.ExecContext(ctx, t.DDL); err != nil {
				return err
			}
			digest, e := objectDigest(ctx, c, t.Physical)
			if e != nil {
				return e
			}
			receipt.Created[t.Physical] = digest
			if e = save(receipt); e != nil {
				return e
			}
		}
		// All referenced base tables now exist; install reviewed cyclic FKs last.
		for _, t := range p.Tables {
			for _, fk := range t.ForeignKeys {
				if err = stopped(ctx); err != nil {
					return err
				}
				if err = identity(ctx, c, p.Binding); err != nil {
					return err
				}
				if _, err = c.ExecContext(ctx, "ALTER TABLE "+q(t.Physical)+" ADD "+fk.definition()+", ALGORITHM=COPY, LOCK=SHARED"); err != nil {
					return err
				}
				digest, e := objectDigest(ctx, c, t.Physical)
				if e != nil {
					return e
				}
				receipt.Created[t.Physical] = digest
				if e = save(receipt); e != nil {
					return e
				}
			}
		}
		// Check actual columns using the same Runtime generator before creating views.
		logical := []string{}
		for _, t := range p.Tables {
			logical = append(logical, t.Logical)
		}
		for _, v := range p.Views {
			if err = stopped(ctx); err != nil {
				return err
			}
			if err = identity(ctx, c, p.Binding); err != nil {
				return err
			}
			if _, err = c.ExecContext(ctx, v.DDL); err != nil {
				return err
			}
			digest, e := objectDigest(ctx, c, v.Logical)
			if e != nil {
				return e
			}
			receipt.Created[v.Logical] = digest
			if e = save(receipt); e != nil {
				return e
			}
		}
		if err = x.verifyTables(ctx, c, p.Binding, logical); err != nil {
			return err
		}
		after, err := x.baseline(ctx, c, p.Binding.Storage.Database)
		if err != nil {
			return err
		}
		if after != p.Baseline {
			return ErrBoundary
		}
		return identity(ctx, c, p.Binding)
	})
}
func (x *installer) Verify(ctx context.Context, db *sql.DB, p Plan) error {
	if err := x.reviewed(p); err != nil {
		return err
	}
	c, err := db.Conn(ctx)
	if err != nil {
		return err
	}
	defer c.Close()
	release, err := migrationlock.Acquire(ctx, c, p.Binding.Storage.InstanceID, p.Binding.Storage.Database)
	if err != nil {
		return err
	}
	defer release()
	return x.verifyOnConn(ctx, c, p)
}

// Caller holds the same session migration lock for the entire verification.
func (x *installer) verifyOnConn(ctx context.Context, c *sql.Conn, p Plan) error {
	if err := identity(ctx, c, p.Binding); err != nil {
		return err
	}
	if err := x.verifyTableConstraints(ctx, c, p); err != nil {
		return err
	}
	logical := []string{}
	for _, t := range p.Tables {
		logical = append(logical, t.Logical)
	}
	if err := x.verifyTables(ctx, c, p.Binding, logical); err != nil {
		return err
	}
	after, err := x.baseline(ctx, c, p.Binding.Storage.Database)
	if err != nil {
		return err
	}
	if after != p.Baseline {
		return ErrBoundary
	}
	return nil
}

// Object definitions are persisted as digests only. AUTO_INCREMENT counters may
// advance during fixtures; all other schema facts must remain exact.
func objectDigest(ctx context.Context, c *sql.Conn, name string) (string, error) {
	rs, err := c.QueryContext(ctx, "SHOW CREATE TABLE "+q(name))
	if err != nil {
		return "", err
	}
	defer rs.Close()
	cols, err := rs.Columns()
	if err != nil {
		return "", err
	}
	v := make([]any, len(cols))
	ptr := make([]any, len(cols))
	for i := range v {
		ptr[i] = &v[i]
	}
	if !rs.Next() {
		return "", ErrBoundary
	}
	if err = rs.Scan(ptr...); err != nil {
		return "", err
	}
	var ddl string
	if raw, ok := v[1].([]byte); ok {
		ddl = string(raw)
	} else {
		ddl = fmt.Sprint(v[1])
	}
	ddl = regexp.MustCompile(" AUTO_INCREMENT=[0-9]+").ReplaceAllString(ddl, "")
	return hash(ddl), nil
}

// Rollback is explicit, never automatic. Only checkpointed objects with the
// exact installed definition are removed; an uncheckpointed object freezes
// recovery for manual inspection (DDL cannot roll back transactionally).
func (x *installer) Rollback(ctx context.Context, db *sql.DB, r Receipt, stopped Stopped) error {
	return x.withStopped(ctx, db, r.Plan, stopped, func(c *sql.Conn) error {
		if x.apf {
			for _, t := range r.Plan.Tables {
				if _, ok := r.Created[t.Physical]; !ok {
					continue
				}
				var count uint64
				if err := c.QueryRowContext(ctx, "SELECT COUNT(*) FROM "+q(t.Physical)).Scan(&count); err != nil {
					return err
				}
				if count != 0 {
					return ErrBoundary
				}
			}
		}
		// Frozen deletion evidence must never be discarded by a schema rollback.
		if x.domain == "aims" {
			if _, created := r.Created["aims_work_item_deletion_evidence"]; created {
				var count uint64
				if err := c.QueryRowContext(ctx, "SELECT COUNT(*) FROM aims_work_item_deletion_evidence").Scan(&count); err != nil {
					return err
				}
				if count != 0 {
					return ErrBoundary
				}
			}
		}
		for name, digest := range r.Created {
			if !x.names()[name] {
				return ErrBoundary
			}
			actual, err := objectDigest(ctx, c, name)
			if err != nil || actual != digest {
				return ErrBoundary
			}
		}
		existing, e := x.baseline(ctx, c, r.Plan.Binding.Storage.Database)
		if e != nil {
			return e
		}
		if existing != r.Plan.Baseline {
			return ErrBoundary
		}
		// An external FK must never be implicitly removed or cascaded.
		for _, t := range r.Plan.Tables {
			rows, err := c.QueryContext(ctx, "SELECT TABLE_SCHEMA,TABLE_NAME FROM information_schema.KEY_COLUMN_USAGE WHERE REFERENCED_TABLE_SCHEMA=? AND REFERENCED_TABLE_NAME=?", r.Plan.Binding.Storage.Database, t.Physical)
			if err != nil {
				return err
			}
			for rows.Next() {
				var schema, name string
				if err = rows.Scan(&schema, &name); err != nil {
					rows.Close()
					return err
				}
				if schema != r.Plan.Binding.Storage.Database || !x.names()[name] {
					rows.Close()
					return ErrBoundary
				}
			}
			err = rows.Err()
			rows.Close()
			if err != nil {
				return err
			}
		}
		for i := len(r.Plan.Views) - 1; i >= 0; i-- {
			name := r.Plan.Views[i].Logical
			if _, ok := r.Created[name]; ok {
				if err := stopped(ctx); err != nil {
					return err
				}
				if err := identity(ctx, c, r.Plan.Binding); err != nil {
					return err
				}
				if _, err := c.ExecContext(ctx, "DROP VIEW "+q(name)); err != nil {
					return err
				}
			}
		}
		// Drop only receipt-owned deferred FKs before reversing table creation.
		for _, t := range r.Plan.Tables {
			if _, owned := r.Created[t.Physical]; !owned {
				continue
			}
			for _, fk := range t.ForeignKeys {
				ddl, e := columnDDL(ctx, c, t.Physical)
				if e != nil {
					return e
				}
				line := constraintLine(ddl, fk.Name)
				if line == "" {
					continue
				}
				if line != fk.definition() {
					return ErrBoundary
				}
				if e = stopped(ctx); e != nil {
					return e
				}
				if e = identity(ctx, c, r.Plan.Binding); e != nil {
					return e
				}
				if _, e = c.ExecContext(ctx, "ALTER TABLE "+q(t.Physical)+" DROP FOREIGN KEY "+q(fk.Name)+", ALGORITHM=INPLACE, LOCK=NONE"); e != nil {
					return e
				}
			}
		}
		for i := len(r.Plan.Tables) - 1; i >= 0; i-- {
			name := r.Plan.Tables[i].Physical
			if _, ok := r.Created[name]; ok {
				if err := stopped(ctx); err != nil {
					return err
				}
				if err := identity(ctx, c, r.Plan.Binding); err != nil {
					return err
				}
				if _, err := c.ExecContext(ctx, "DROP TABLE "+q(name)); err != nil {
					return err
				}
			}
		}
		if err := x.absent(ctx, c, r.Plan.Binding.Storage.Database); err != nil {
			return err
		}
		after, err := x.baseline(ctx, c, r.Plan.Binding.Storage.Database)
		if err != nil {
			return err
		}
		if after != r.Plan.Baseline {
			return ErrBoundary
		}
		return identity(ctx, c, r.Plan.Binding)
	})
}

func (x *installer) VerifyReceipt(ctx context.Context, db *sql.DB, r Receipt) error {
	if len(r.Created) != len(r.Plan.Tables)+len(r.Plan.Views) {
		return ErrBoundary
	}
	if err := x.reviewed(r.Plan); err != nil {
		return err
	}
	c, err := db.Conn(ctx)
	if err != nil {
		return err
	}
	defer c.Close()
	release, err := migrationlock.Acquire(ctx, c, r.Plan.Binding.Storage.InstanceID, r.Plan.Binding.Storage.Database)
	if err != nil {
		return err
	}
	defer release()
	if err = identity(ctx, c, r.Plan.Binding); err != nil {
		return err
	}
	for name, digest := range r.Created {
		if !x.names()[name] {
			return ErrBoundary
		}
		actual, e := objectDigest(ctx, c, name)
		if e != nil || actual != digest {
			return ErrBoundary
		}
	}
	return x.verifyOnConn(ctx, c, r.Plan)
}

// Legacy Altoc API remains fixed; the new API selects one embedded evidence table.
func tables() []Table                     { return altocInstaller.tables() }
func validate(b enterprise.Binding) error { return altocInstaller.validate(b) }
func expected(b enterprise.Binding) Plan  { return altocInstaller.expected(b) }
func reviewed(p Plan) error               { return altocInstaller.reviewed(p) }
func PlanInstall(ctx context.Context, db *sql.DB, b enterprise.Binding) (Plan, error) {
	return altocInstaller.PlanInstall(ctx, db, b)
}
func Apply(ctx context.Context, db *sql.DB, p Plan, off Stopped, save Checkpoint) error {
	return altocInstaller.Apply(ctx, db, p, off, save)
}
func Verify(ctx context.Context, db *sql.DB, p Plan) error { return altocInstaller.Verify(ctx, db, p) }
func Rollback(ctx context.Context, db *sql.DB, r Receipt, off Stopped) error {
	return altocInstaller.Rollback(ctx, db, r, off)
}
func PlanDeletionEvidence(ctx context.Context, db *sql.DB, b enterprise.Binding) (Plan, error) {
	return deletionInstaller.PlanInstall(ctx, db, b)
}
func ApplyDeletionEvidence(ctx context.Context, db *sql.DB, p Plan, off Stopped, save Checkpoint) error {
	return deletionInstaller.Apply(ctx, db, p, off, save)
}
func VerifyDeletionEvidence(ctx context.Context, db *sql.DB, p Plan) error {
	return deletionInstaller.Verify(ctx, db, p)
}
func RollbackDeletionEvidence(ctx context.Context, db *sql.DB, r Receipt, off Stopped) error {
	return deletionInstaller.Rollback(ctx, db, r, off)
}

func VerifyReceipt(ctx context.Context, db *sql.DB, r Receipt) error {
	return altocInstaller.VerifyReceipt(ctx, db, r)
}
func VerifyDeletionEvidenceReceipt(ctx context.Context, db *sql.DB, r Receipt) error {
	return deletionInstaller.VerifyReceipt(ctx, db, r)
}

// Installer is the explicit-expectation form used by the profile-driven
// production path. It runs exactly the same plan/apply/verify/rollback code.
type Installer struct{ x installer }

// ForAltoc returns the fixed Altoc read-only installer bound to expectation.
func ForAltoc(e Expectation) Installer {
	x := altocInstaller
	x.expect = e
	return Installer{x}
}

// ForDeletionEvidence returns the fixed Aims deletion-evidence installer bound
// to expectation.
func ForDeletionEvidence(e Expectation) Installer {
	x := deletionInstaller
	x.expect = e
	return Installer{x}
}
func (i Installer) PlanInstall(ctx context.Context, db *sql.DB, b enterprise.Binding) (Plan, error) {
	if i.x.column != nil {
		return i.x.column.plan(ctx, db, b)
	}
	return i.x.PlanInstall(ctx, db, b)
}
func (i Installer) Apply(ctx context.Context, db *sql.DB, p Plan, off Stopped, save Checkpoint) error {
	if i.x.column != nil {
		return i.x.column.apply(ctx, db, Receipt{Plan: p, Created: map[string]string{}}, off, save)
	}
	return i.x.Apply(ctx, db, p, off, save)
}
func (i Installer) Verify(ctx context.Context, db *sql.DB, p Plan) error {
	if i.x.column != nil {
		return i.x.column.verify(ctx, db, p, nil)
	}
	return i.x.Verify(ctx, db, p)
}
func (i Installer) VerifyReceipt(ctx context.Context, db *sql.DB, r Receipt) error {
	if i.x.column != nil {
		return i.x.column.verify(ctx, db, r.Plan, &r)
	}
	return i.x.VerifyReceipt(ctx, db, r)
}
func (i Installer) Rollback(ctx context.Context, db *sql.DB, r Receipt, off Stopped) error {
	if i.x.column != nil {
		return i.x.column.rollback(ctx, db, r, off)
	}
	return i.x.Rollback(ctx, db, r, off)
}

// Resume only accepts the persisted column-subset checkpoint. Unknown DDL
// outcomes are not inferred from the database and require manual review.
func (i Installer) Resume(ctx context.Context, db *sql.DB, r Receipt, off Stopped, save Checkpoint) error {
	if i.x.column == nil {
		return ErrBoundary
	}
	return i.x.column.apply(ctx, db, r, off, save)
}
