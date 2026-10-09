package domaininstall

import (
	"context"
	"database/sql"
	"fmt"
	"reflect"
	"regexp"
	"sort"
	"strings"
	"time"

	"github.com/huizhi-yun/data-runtime/internal/enterprise"
	"github.com/huizhi-yun/data-runtime/internal/migrationlock"
)

// Column subsets are compiled declarations, never CLI-supplied SQL. Registry
// and compatibility mapping_hash stay unchanged. Only these schema digests
// belong to the column installation receipt.
type ColumnDefinition struct {
	Name, Type, Comment string
	Nullable            bool
	Default             *string // nil means no default; values are quoted literals, never expressions.
}
type ColumnIndex struct {
	Name    string
	Columns []string
	Unique  bool
}
type ColumnRelaxation struct {
	Name, Before string
	After        ColumnDefinition
}
type ColumnDeclaration struct {
	Domain, Table string
	Add           []ColumnDefinition
	Indexes       []ColumnIndex
	Relax         []ColumnRelaxation
	ForeignKeys   []ColumnForeignKey `json:",omitempty"`
	Checks        []ColumnCheck      `json:",omitempty"`
}
type ColumnStep struct{ Key, DDL, Undo, Before, After string }
type ColumnPlan struct {
	DeclarationSHA256, BeforeSHA256, AfterSHA256 string
	MySQLVersion                                 string
	Declaration                                  ColumnDeclaration
	BeforeDefinition, AfterDefinition            string
	OldColumns                                   []string
	OldRowsSHA256                                string
	Steps                                        []ColumnStep
}
type columnInstaller struct {
	declaration ColumnDeclaration
	expect      Expectation
}

func literal(v string) string {
	return "'" + strings.ReplaceAll(strings.ReplaceAll(v, "\\", "\\\\"), "'", "''") + "'"
}

var columnName = regexp.MustCompile(`^[a-z][a-z0-9_]{0,63}$`)
var columnType = regexp.MustCompile(`^(tinyint|int|datetime\(3\)|bigint unsigned|varchar\([1-9][0-9]{0,3}\)|decimal\([1-9][0-9]?,[0-9]+\))$`)

func (d ColumnDefinition) definition() string {
	s := q(d.Name) + " " + d.Type
	if !d.Nullable {
		s += " NOT NULL"
	}
	if d.Default != nil {
		s += " DEFAULT " + literal(*d.Default)
	} else if d.Nullable {
		s += " DEFAULT NULL"
	}
	if d.Comment != "" {
		s += " COMMENT " + literal(d.Comment)
	}
	return s
}
func (i ColumnIndex) definition() string {
	cols := make([]string, len(i.Columns))
	for n, c := range i.Columns {
		cols[n] = q(c)
	}
	prefix := "KEY "
	if i.Unique {
		prefix = "UNIQUE KEY "
	}
	return prefix + q(i.Name) + " (" + strings.Join(cols, ",") + ")"
}
func strptr(s string) *string { return &s }
func bankColumns() ColumnDeclaration {
	return ColumnDeclaration{Domain: "finance", Table: "finance_bank_account", Add: []ColumnDefinition{
		{Name: "short_name", Type: "varchar(50)", Nullable: true, Comment: "账户简称"},
		{Name: "bank_branch_code", Type: "varchar(30)", Nullable: true, Comment: "银行行号/联行号"},
		{Name: "legal_entity_code", Type: "varchar(64)", Nullable: true, Comment: "finance_legal_entity.code"},
		{Name: "sort_no", Type: "int", Default: strptr("0"), Comment: "显示顺序"},
		{Name: "account_subtype", Type: "varchar(30)", Nullable: true, Comment: "银行账户子类型：basic/general/special/loan；非银行账户为 NULL"},
	}, Indexes: []ColumnIndex{{Name: "uk_finance_bank_account_short_name", Columns: []string{"short_name"}, Unique: true}, {Name: "idx_finance_bank_account_entity", Columns: []string{"legal_entity_code", "sort_no"}}}}
}
func ForFinanceBankAccountColumns(e Expectation) Installer {
	return Installer{x: installer{column: &columnInstaller{bankColumns(), e}}}
}

// Approved relaxation is deliberately separate from arbitrary ALTER/MODIFY.
var nullableColumns = map[string]bool{"altoc.altoc_contract.tax_rate": true}

func (x *columnInstaller) validate(b enterprise.Binding) error {
	// Reuse identity/address/generation validation, without table-create validation.
	base := installer{manifest: []byte("[]"), expect: x.expect, domain: x.declaration.Domain, write: b.Domains[x.declaration.Domain].Write, scheduler: b.Domains[x.declaration.Domain].Scheduler}
	if err := base.validate(b); err != nil {
		return err
	}
	d := x.declaration
	if (d.Domain != "altoc" && d.Domain != "finance" && d.Domain != "people") || !columnName.MatchString(d.Table) || !strings.HasPrefix(d.Table, d.Domain+"_") || b.Domains[d.Domain].Tables[d.Table] != d.Table {
		return ErrBoundary
	}
	for domain, binding := range b.Domains {
		for logical, physical := range binding.Tables {
			if domain != d.Domain && (logical == d.Table || physical == d.Table) {
				return ErrBoundary
			}
		}
	}
	seen := map[string]bool{}
	valid := func(c ColumnDefinition) bool {
		if !columnName.MatchString(c.Name) || !columnType.MatchString(c.Type) || seen[c.Name] {
			return false
		}
		seen[c.Name] = true
		return c.Nullable || c.Default != nil
	}
	for _, c := range d.Add {
		if !valid(c) {
			return ErrBoundary
		}
	}
	for _, r := range d.Relax {
		if !nullableColumns[d.Domain+"."+d.Table+"."+r.Name] || r.Name != r.After.Name || !valid(r.After) || !r.After.Nullable {
			return ErrBoundary
		}
		// Whitelist binds the exact before-definition, not merely its name.
		// The reviewed tax_rate relaxation may retain 6.00 or remove it.
		before := ColumnDefinition{Name: "tax_rate", Type: "decimal(5,2)", Default: strptr("6.00")}
		if r.Before != before.definition() || r.After.Type != before.Type || r.After.Comment != before.Comment || (r.After.Default != nil && *r.After.Default != *before.Default) {
			return ErrBoundary
		}
	}
	for _, i := range d.Indexes {
		if !columnName.MatchString(i.Name) || seen[i.Name] || len(i.Columns) == 0 {
			return ErrBoundary
		}
		seen[i.Name] = true
		for _, n := range i.Columns {
			if !columnName.MatchString(n) {
				return ErrBoundary
			}
		}
	}
	for _, f := range d.ForeignKeys {
		if d.Table != "altoc_customer" || !reflect.DeepEqual(f, W1Columns("w1-altoc-customer-columns").ForeignKeys[0]) || b.Domains[d.Domain].Tables[f.ReferencedTable] != f.ReferencedTable {
			return ErrBoundary
		}
		if !columnName.MatchString(f.Name) || seen[f.Name] || !columnName.MatchString(f.ReferencedTable) || !strings.HasPrefix(f.ReferencedTable, d.Domain+"_") || len(f.Columns) == 0 || len(f.Columns) != len(f.ReferencedColumns) {
			return ErrBoundary
		}
		seen[f.Name] = true
		for _, n := range append(append([]string{}, f.Columns...), f.ReferencedColumns...) {
			if !columnName.MatchString(n) {
				return ErrBoundary
			}
		}
	}
	for _, check := range d.Checks {
		if check.Name != "ck_altoc_contract_origin" || d.Table != "altoc_contract" || check.Expression != contractColumnsW1().Checks[0].Expression || check.Canonical != contractColumnsW1().Checks[0].Canonical || seen[check.Name] {
			return ErrBoundary
		}
		seen[check.Name] = true
	}
	if len(d.Add)+len(d.Relax)+len(d.ForeignKeys)+len(d.Checks) == 0 {
		return ErrBoundary
	}
	return nil
}
func (x *columnInstaller) baseline(ctx context.Context, c *sql.Conn, b enterprise.Binding) (string, error) {
	// Everything outside the one reviewed table, including every Registry field,
	// mapping_hash, views, triggers and non-target data, remains frozen.
	raw := []byte(fmt.Sprintf(`[{"Physical":%q}]`, x.declaration.Table))
	i := installer{apf: true, manifest: raw}
	v, err := i.baseline(ctx, c, b.Storage.Database)
	if err != nil {
		return "", err
	}
	rows, err := c.QueryContext(ctx, "SELECT TRIGGER_NAME,ACTION_TIMING,EVENT_MANIPULATION,EVENT_OBJECT_TABLE,ACTION_STATEMENT FROM information_schema.TRIGGERS WHERE TRIGGER_SCHEMA=? ORDER BY TRIGGER_NAME", b.Storage.Database)
	if err != nil {
		return "", err
	}
	defer rows.Close()
	var triggers [][5]string
	for rows.Next() {
		var t [5]string
		if err = rows.Scan(&t[0], &t[1], &t[2], &t[3], &t[4]); err != nil {
			return "", err
		}
		triggers = append(triggers, t)
	}
	if err = rows.Err(); err != nil {
		return "", err
	}
	return hash([]any{v, triggers}), nil
}
func columnDDL(ctx context.Context, c *sql.Conn, table string) (string, error) {
	var name, ddl string
	err := c.QueryRowContext(ctx, "SHOW CREATE TABLE "+q(table)).Scan(&name, &ddl)
	return regexp.MustCompile(" AUTO_INCREMENT=[0-9]+").ReplaceAllString(ddl, ""), err
}
func schemaLines(ddl string) []string {
	lines := strings.Split(ddl, "\n")
	for i := range lines {
		lines[i] = strings.TrimSuffix(strings.TrimSpace(lines[i]), ",")
	}
	return lines
}
func columnLine(ddl, name string) string {
	for _, line := range schemaLines(ddl) {
		if strings.HasPrefix(line, q(name)+" ") {
			return line
		}
	}
	return ""
}
func indexLine(ddl, name string) string {
	for _, line := range schemaLines(ddl) {
		if strings.HasPrefix(line, "KEY "+q(name)+" ") || strings.HasPrefix(line, "UNIQUE KEY "+q(name)+" ") {
			return line
		}
	}
	return ""
}
func rebuild(lines []string) string {
	s := lines[0] + "\n"
	for i := 1; i < len(lines)-1; i++ {
		s += "  " + lines[i]
		if i < len(lines)-2 {
			s += ","
		}
		s += "\n"
	}
	return s + lines[len(lines)-1]
}
func insertSchemaLine(ddl, line string, column bool) string {
	lines := schemaLines(ddl)
	at := len(lines) - 1
	if column {
		for i := 1; i < len(lines)-1; i++ {
			if !strings.HasPrefix(lines[i], "`") {
				at = i
				break
			}
		}
	}
	if !column {
		for i := 1; i < len(lines)-1; i++ {
			if strings.HasPrefix(line, "UNIQUE KEY ") && (strings.HasPrefix(lines[i], "KEY ") || strings.HasPrefix(lines[i], "CONSTRAINT ")) {
				at = i
				break
			}
			if strings.HasPrefix(line, "KEY ") && strings.HasPrefix(lines[i], "CONSTRAINT ") {
				at = i
				break
			}
		}
	}
	if strings.HasPrefix(line, "CONSTRAINT ") {
		for i := 1; i < len(lines)-1; i++ {
			if strings.HasPrefix(lines[i], "CONSTRAINT ") {
				oldCheck := strings.Contains(lines[i], " CHECK ")
				newCheck := strings.Contains(line, " CHECK ")
				if (!newCheck && oldCheck) || (newCheck == oldCheck && line < lines[i]) {
					at = i
					break
				}
			}
		}
	}
	lines = append(lines, nilString)
	copy(lines[at+1:], lines[at:])
	lines[at] = line
	return rebuild(lines)
}

const nilString = ""

func replaceSchemaLine(ddl, before, after string) string {
	lines := schemaLines(ddl)
	for i, line := range lines {
		if line == before {
			lines[i] = after
		}
	}
	return rebuild(lines)
}
func projection(ctx context.Context, c *sql.Conn, table string, cols []string) (string, error) {
	if len(cols) == 0 {
		return "", ErrBoundary
	}
	names := make([]string, len(cols))
	for i, n := range cols {
		if !columnName.MatchString(n) {
			return "", ErrBoundary
		}
		names[i] = q(n)
	}
	rows, err := c.QueryContext(ctx, "SELECT "+strings.Join(names, ",")+" FROM "+q(table))
	if err != nil {
		return "", err
	}
	defer rows.Close()
	var digests []string
	for rows.Next() {
		v := make([]any, len(cols))
		p := make([]any, len(cols))
		for i := range v {
			p[i] = &v[i]
		}
		if err = rows.Scan(p...); err != nil {
			return "", err
		}
		digests = append(digests, hash(v))
	}
	if err = rows.Err(); err != nil {
		return "", err
	}
	sort.Strings(digests)
	return hash(digests), nil
}
func (x *columnInstaller) plan(ctx context.Context, db *sql.DB, b enterprise.Binding) (Plan, error) {
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
	var engine string
	if err = c.QueryRowContext(ctx, "SELECT ENGINE FROM information_schema.TABLES WHERE TABLE_SCHEMA=? AND TABLE_NAME=? AND TABLE_TYPE='BASE TABLE'", b.Storage.Database, x.declaration.Table).Scan(&engine); err != nil {
		return Plan{}, err
	}
	if engine != "InnoDB" {
		return Plan{}, ErrBoundary
	}
	// An APF mapping cannot hide a compatibility view depending on this table.
	var views int
	if err = c.QueryRowContext(ctx, "SELECT COUNT(*) FROM information_schema.VIEW_TABLE_USAGE WHERE TABLE_SCHEMA=? AND TABLE_NAME=?", b.Storage.Database, x.declaration.Table).Scan(&views); err != nil {
		return Plan{}, err
	}
	if views != 0 {
		return Plan{}, ErrBoundary
	}
	before, err := columnDDL(ctx, c, x.declaration.Table)
	if err != nil {
		return Plan{}, err
	}
	cp := &ColumnPlan{Declaration: x.declaration, BeforeDefinition: before, AfterDefinition: before}
	if err = c.QueryRowContext(ctx, "SELECT VERSION()").Scan(&cp.MySQLVersion); err != nil {
		return Plan{}, err
	}
	// Every column that exists at plan time is protected, including a
	// same-definition column left by a previously completed installation.
	for _, line := range schemaLines(before) {
		if strings.HasPrefix(line, "`") {
			cp.OldColumns = append(cp.OldColumns, strings.SplitN(line, "`", 3)[1])
		}
	}
	if err = x.makeSteps(cp); err != nil {
		return Plan{}, err
	}
	if err = x.constraintPreflight(ctx, c, b.Storage.Database, cp); err != nil {
		return Plan{}, err
	}
	cp.OldRowsSHA256, err = projection(ctx, c, x.declaration.Table, cp.OldColumns)
	if err != nil {
		return Plan{}, err
	}
	p := Plan{Binding: b, Column: cp}
	p.Baseline, err = x.baseline(ctx, c, b)
	if err != nil {
		return Plan{}, err
	}
	p.ReviewHash = hash(p)
	return p, nil
}

// SHOW CREATE repeats nondefault text collations on every character column.
// Derive that rendering from the reviewed table, not from a server default.
func canonicalColumn(ddl string, c ColumnDefinition) string {
	definition := c.definition()
	if strings.HasPrefix(c.Type, "varchar(") {
		match := regexp.MustCompile(" COLLATE ([a-z0-9_]+)").FindStringSubmatch(ddl)
		if len(match) == 2 {
			definition = strings.Replace(definition, q(c.Name)+" "+c.Type, q(c.Name)+" "+c.Type+" COLLATE "+match[1], 1)
		}
	}
	return definition
}
func (x *columnInstaller) makeSteps(cp *ColumnPlan) error {
	cp.AfterDefinition = cp.BeforeDefinition
	cp.Steps = nil
	cp.DeclarationSHA256 = hash(x.declaration)
	cp.BeforeSHA256 = hash(cp.BeforeDefinition)
	table := q(x.declaration.Table)
	add := func(key, ddl, undo, after string) {
		cp.Steps = append(cp.Steps, ColumnStep{key, ddl + ", ALGORITHM=INPLACE, LOCK=NONE", undo + ", ALGORITHM=INPLACE, LOCK=NONE", hash(cp.AfterDefinition), hash(after)})
		cp.AfterDefinition = after
	}
	for _, col := range x.declaration.Add {
		existing := columnLine(cp.AfterDefinition, col.Name)
		if existing != "" {
			if existing != canonicalColumn(cp.AfterDefinition, col) {
				return ErrBoundary
			}
			continue
		}
		add("column:"+col.Name, "ALTER TABLE "+table+" ADD COLUMN "+col.definition(), "ALTER TABLE "+table+" DROP COLUMN "+q(col.Name), insertSchemaLine(cp.AfterDefinition, canonicalColumn(cp.AfterDefinition, col), true))
	}
	for _, r := range x.declaration.Relax {
		line := columnLine(cp.AfterDefinition, r.Name)
		if line == r.After.definition() {
			continue
		}
		if line != r.Before {
			return ErrBoundary
		}
		add("nullable:"+r.Name, "ALTER TABLE "+table+" MODIFY COLUMN "+r.After.definition(), "ALTER TABLE "+table+" MODIFY COLUMN "+r.Before, replaceSchemaLine(cp.AfterDefinition, r.Before, r.After.definition()))
	}
	for _, idx := range x.declaration.Indexes {
		for _, n := range idx.Columns {
			if columnLine(cp.AfterDefinition, n) == "" {
				return ErrBoundary
			}
		}
		existing := indexLine(cp.AfterDefinition, idx.Name)
		if existing != "" {
			if existing != idx.definition() {
				return ErrBoundary
			}
			continue
		}
		add("index:"+idx.Name, "ALTER TABLE "+table+" ADD "+idx.definition(), "ALTER TABLE "+table+" DROP INDEX "+q(idx.Name), insertSchemaLine(cp.AfterDefinition, idx.definition(), false))
	}
	if err := x.constraintSteps(cp, add); err != nil {
		return err
	}
	cp.AfterSHA256 = hash(cp.AfterDefinition)
	return nil
}
func (x *columnInstaller) reviewed(p Plan) error {
	if err := x.validate(p.Binding); err != nil {
		return err
	}
	if p.Column == nil || p.Baseline == "" || p.Column.OldRowsSHA256 == "" || p.Column.MySQLVersion == "" || !reflect.DeepEqual(p.Column.Declaration, x.declaration) {
		return ErrBoundary
	}
	cp := *p.Column
	if err := x.makeSteps(&cp); err != nil {
		return err
	}
	if !reflect.DeepEqual(cp, *p.Column) {
		return fmt.Errorf("%w: column plan canonical steps", ErrBoundary)
	}
	// Old-column projection cannot be shortened by a forged plan.
	var old []string
	for _, line := range schemaLines(cp.BeforeDefinition) {
		if strings.HasPrefix(line, "`") {
			old = append(old, strings.SplitN(line, "`", 3)[1])
		}
	}
	if !reflect.DeepEqual(old, cp.OldColumns) {
		return ErrBoundary
	}
	reviewed := p
	reviewed.ReviewHash = ""
	if p.ReviewHash != hash(reviewed) {
		return ErrBoundary
	}
	return nil
}
func (x *columnInstaller) locked(ctx context.Context, db *sql.DB, p Plan, off Stopped, fn func(*sql.Conn) error) error {
	if err := x.reviewed(p); err != nil {
		return err
	}
	if off != nil {
		if err := off(ctx); err != nil {
			return err
		}
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
func (x *columnInstaller) unchanged(ctx context.Context, c *sql.Conn, p Plan) error {
	var version string
	if err := c.QueryRowContext(ctx, "SELECT VERSION()").Scan(&version); err != nil {
		return err
	}
	if version != p.Column.MySQLVersion {
		return ErrBoundary
	}
	baseline, err := x.baseline(ctx, c, p.Binding)
	if err != nil {
		return err
	}
	if baseline != p.Baseline {
		return ErrBoundary
	}
	rows, err := projection(ctx, c, x.declaration.Table, p.Column.OldColumns)
	if err != nil {
		return err
	}
	if rows != p.Column.OldRowsSHA256 {
		return ErrBoundary
	}
	return nil
}
func checkpointPrefix(r Receipt) (int, error) {
	n := len(r.Created)
	if r.Created == nil || n > len(r.Plan.Column.Steps) || len(r.ColumnTimings) != n {
		return 0, ErrBoundary
	}
	for i, timing := range r.ColumnTimings {
		if timing.Key != r.Plan.Column.Steps[i].Key || timing.Algorithm != stepAlgorithm(r.Plan.Column.Steps[i]) || timing.ElapsedMilliseconds < 0 {
			return 0, ErrBoundary
		}
	}
	if n > len(r.Plan.Column.Steps) {
		return 0, ErrBoundary
	}
	for i, s := range r.Plan.Column.Steps {
		v, ok := r.Created[s.Key]
		if i < n {
			if !ok || v != s.After {
				return 0, ErrBoundary
			}
		} else if ok {
			return 0, ErrBoundary
		}
	}
	return n, nil
}
func (x *columnInstaller) apply(ctx context.Context, db *sql.DB, r Receipt, off Stopped, save Checkpoint) error {
	if off == nil || save == nil {
		return ErrBoundary
	}
	return x.locked(ctx, db, r.Plan, off, func(c *sql.Conn) error {
		n, err := checkpointPrefix(r)
		if err != nil {
			return err
		}
		cp := r.Plan.Column
		expected := hash(cp.BeforeDefinition)
		if n > 0 {
			expected = cp.Steps[n-1].After
		}
		actual, err := columnDDL(ctx, c, x.declaration.Table)
		if err != nil {
			return err
		}
		if hash(actual) != expected {
			return fmt.Errorf("%w: column before definition", ErrBoundary)
		}
		if err = x.unchanged(ctx, c, r.Plan); err != nil {
			return err
		}
		if err = x.constraintPreflight(ctx, c, r.Plan.Binding.Storage.Database, cp); err != nil {
			return err
		}
		if err = save(r); err != nil {
			return err
		}
		for _, s := range cp.Steps[n:] {
			if err = off(ctx); err != nil {
				return err
			}
			if err = identity(ctx, c, r.Plan.Binding); err != nil {
				return err
			}
			started := time.Now()
			if _, err = c.ExecContext(ctx, s.DDL); err != nil {
				return err
			}
			r.ColumnTimings = append(r.ColumnTimings, ColumnDDLTiming{Key: s.Key, ElapsedMilliseconds: time.Since(started).Milliseconds(), Algorithm: stepAlgorithm(s)})
			actual, err = columnDDL(ctx, c, x.declaration.Table)
			if err != nil {
				return err
			}
			if hash(actual) != s.After {
				return fmt.Errorf("%w: column after definition", ErrBoundary)
			}
			r.Created[s.Key] = s.After
			if err = save(r); err != nil {
				return err
			}
		}
		return x.unchanged(ctx, c, r.Plan)
	})
}
func (x *columnInstaller) verify(ctx context.Context, db *sql.DB, p Plan, r *Receipt) error {
	return x.locked(ctx, db, p, nil, func(c *sql.Conn) error {
		if r != nil {
			n, err := checkpointPrefix(*r)
			if err != nil || n != len(p.Column.Steps) {
				return ErrBoundary
			}
		}
		ddl, err := columnDDL(ctx, c, x.declaration.Table)
		if err != nil {
			return err
		}
		if ddl != p.Column.AfterDefinition {
			return ErrBoundary
		}
		return x.unchanged(ctx, c, p)
	})
}
func (x *columnInstaller) rollback(ctx context.Context, db *sql.DB, r Receipt, off Stopped) error {
	if off == nil {
		return ErrBoundary
	}
	return x.locked(ctx, db, r.Plan, off, func(c *sql.Conn) error {
		n, err := checkpointPrefix(r)
		if err != nil {
			return err
		}
		cp := r.Plan.Column
		ddl, err := columnDDL(ctx, c, x.declaration.Table)
		if err != nil {
			return err
		}
		expected := hash(cp.BeforeDefinition)
		if n > 0 {
			expected = cp.Steps[n-1].After
		}
		if hash(ddl) != expected {
			return ErrBoundary
		}
		if err = x.unchanged(ctx, c, r.Plan); err != nil {
			return err
		}
		// Preflight every reversal before any DDL. Only observable untouched defaults
		// are accepted; restoring a written value does not prove no historical write.
		for _, s := range cp.Steps[:n] {
			name := strings.SplitN(s.Key, ":", 2)[1]
			var count uint64
			if strings.HasPrefix(s.Key, "column:") {
				var def *string
				for _, col := range x.declaration.Add {
					if col.Name == name {
						def = col.Default
					}
				}
				if err = c.QueryRowContext(ctx, "SELECT COUNT(*) FROM "+q(x.declaration.Table)+" WHERE NOT ("+q(name)+" <=> ?)", def).Scan(&count); err != nil {
					return err
				}
				if count != 0 {
					return ErrBoundary
				}
				if err = x.rollbackColumnFKs(ctx, c, r, name); err != nil {
					return err
				}
			} else if strings.HasPrefix(s.Key, "nullable:") {
				if err = c.QueryRowContext(ctx, "SELECT COUNT(*) FROM "+q(x.declaration.Table)+" WHERE "+q(name)+" IS NULL").Scan(&count); err != nil {
					return err
				}
				if count != 0 {
					return ErrBoundary
				}
			}
		}
		for i := n - 1; i >= 0; i-- {
			s := cp.Steps[i]
			if err = off(ctx); err != nil {
				return err
			}
			if err = identity(ctx, c, r.Plan.Binding); err != nil {
				return err
			}
			if _, err = c.ExecContext(ctx, s.Undo); err != nil {
				return err
			}
			actual, err := columnDDL(ctx, c, x.declaration.Table)
			if err != nil {
				return err
			}
			if hash(actual) != s.Before {
				return ErrBoundary
			}
		}
		return x.unchanged(ctx, c, r.Plan)
	})
}

// Keep timing in the owner-private receipt, never driver errors or row values.
type ColumnDDLTiming struct {
	Key, Algorithm      string
	ElapsedMilliseconds int64
}

// The same declaration feeds new installations and increments; no duplicated
// fresh-only column definitions can drift from the reviewed subset.
func bankAccountFresh(t Table) Table {
	d := bankColumns()
	at := strings.Index(t.DDL, "    UNIQUE KEY")
	var columns string
	for _, c := range d.Add {
		columns += "    " + c.definition() + ",\n"
		t.Columns = append(t.Columns, c.Name)
	}
	t.DDL = t.DDL[:at] + columns + t.DDL[at:]
	at = strings.LastIndex(t.DDL, "\n) ENGINE=")
	for _, idx := range d.Indexes {
		t.DDL = t.DDL[:at] + ",\n    " + idx.definition() + t.DDL[at:]
		at = strings.LastIndex(t.DDL, "\n) ENGINE=")
	}
	return t
}

func stepAlgorithm(s ColumnStep) string {
	if strings.Contains(s.DDL, "ALGORITHM=COPY") {
		return "COPY"
	}
	return "INPLACE"
}
func (x *columnInstaller) rollbackColumnFKs(ctx context.Context, c *sql.Conn, r Receipt, name string) error {
	rows, err := c.QueryContext(ctx, "SELECT TABLE_SCHEMA,TABLE_NAME,CONSTRAINT_NAME FROM information_schema.KEY_COLUMN_USAGE WHERE (TABLE_SCHEMA=? AND TABLE_NAME=? AND COLUMN_NAME=? AND REFERENCED_TABLE_NAME IS NOT NULL) OR (REFERENCED_TABLE_SCHEMA=? AND REFERENCED_TABLE_NAME=? AND REFERENCED_COLUMN_NAME=?)", r.Plan.Binding.Storage.Database, x.declaration.Table, name, r.Plan.Binding.Storage.Database, x.declaration.Table, name)
	if err != nil {
		return err
	}
	defer rows.Close()
	for rows.Next() {
		var schema, table, constraint string
		if err = rows.Scan(&schema, &table, &constraint); err != nil {
			return err
		}
		if schema != r.Plan.Binding.Storage.Database || table != x.declaration.Table || r.Created["foreign-key:"+constraint] == "" {
			return ErrBoundary
		}
	}
	return rows.Err()
}
