package wizbiztool

import (
	"context"
	"encoding/json"
	"errors"
	"regexp"
	"sort"
	"strings"

	"github.com/huizhi-yun/data-runtime/internal/enterprise"
	"github.com/huizhi-yun/data-runtime/internal/enterprise/domaininstall"
)

var ErrDependency = errors.New("migration_dependency_definition_mismatch")
var migrationTargets = map[string]bool{"altoc_customer": true, "altoc_contact": true, "altoc_contract": true, "altoc_contract_party": true, "altoc_billing_schedule": true, "finance_bank_account": true, "finance_account_balance_snapshot": true}
var w1TableSubsets = []string{"w1-migration-ledger", "w1-finance-legal-entity", "w1-finance-balance-entry", "w1-altoc-contract-snapshot", "w1-altoc-customer-snapshot"}

func DependencyTables() []domaininstall.Table {
	result := []domaininstall.Table{}
	for _, domain := range []string{"altoc", "finance"} {
		tables, _ := domaininstall.APFTables(domain)
		for _, table := range tables {
			if migrationTargets[table.Logical] {
				result = append(result, table)
			}
		}
	}
	for _, name := range w1TableSubsets {
		result = append(result, domaininstall.W1Tables(name)...)
	}
	sort.Slice(result, func(i, j int) bool { return result[i].Physical < result[j].Physical })
	return result
}
func targetTableSet() map[string]bool {
	result := map[string]bool{"enterprise_schema_registry": true}
	for _, table := range DependencyTables() {
		result[table.Physical] = true
	}
	return result
}

type ColumnFact struct {
	Name          string
	Type          string
	Nullable      bool
	Default       *string
	AutoIncrement bool
	Generated     string
	Stored        bool
	Comment       string
}
type IndexFact struct {
	Name    string
	Columns []string
	Unique  bool
}
type FKFact struct {
	Name       string
	Columns    []string
	Table      string
	References []string
	Delete     string
	Update     string
}
type TableFacts struct {
	Columns   []ColumnFact
	Indexes   []IndexFact
	FKs       []FKFact
	Checks    map[string]string
	Engine    string
	Collation string
}

func factsHash(value any) string { raw, _ := json.Marshal(value); return Digest(raw) }
func sqlPieces(value string) []string {
	out := []string{}
	start, depth := 0, 0
	var quote byte
	for i := 0; i < len(value); i++ {
		ch := value[i]
		if quote != 0 {
			if ch == '\\' {
				i++
				continue
			}
			if ch == quote {
				if i+1 < len(value) && value[i+1] == quote {
					i++
					continue
				}
				quote = 0
			}
			continue
		}
		if ch == '\'' || ch == '"' || ch == '`' {
			quote = ch
			continue
		}
		switch ch {
		case '(':
			depth++
		case ')':
			depth--
		case ',':
			if depth == 0 {
				out = append(out, strings.TrimSpace(value[start:i]))
				start = i + 1
			}
		}
	}
	out = append(out, strings.TrimSpace(value[start:]))
	return out
}
func sqlNames(value string) []string {
	names := []string{}
	for _, part := range sqlPieces(value) {
		names = append(names, strings.Trim(strings.TrimSpace(part), "`"))
	}
	return names
}
func sqlText(value string) string {
	value = strings.Trim(value, "'")
	return strings.NewReplacer("''", "'", "\\'", "'", "\\\\", "\\").Replace(value)
}

var sqlLiteral = regexp.MustCompile(`'(?:[^'\\]|\\.|'')*'`)

func normalizedType(value string) string {
	v := strings.ToLower(value)
	v = regexp.MustCompile(`\b(tinyint|smallint|mediumint|int|bigint)\([0-9]+\)`).ReplaceAllString(v, "$1")
	return v
}
func normalizedCheck(value string) string {
	v := strings.ToLower(value)
	v = strings.ReplaceAll(v, "_utf8mb4", "")
	v = strings.ReplaceAll(v, "\\'", "'")
	v = strings.ReplaceAll(v, "`", "")
	v = regexp.MustCompile(`([a-z][a-z0-9_]*)\s+not\s+regexp\s+('(?:[^']|'')*')`).ReplaceAllString(v, "not regexp_like($1,$2)")
	v = regexp.MustCompile(`([a-z][a-z0-9_]*)\s+regexp\s+('(?:[^']|'')*')`).ReplaceAllString(v, "regexp_like($1,$2)")
	v = regexp.MustCompile(`[\s()]`).ReplaceAllString(v, "")
	return v
}
func expectedFacts(table domaininstall.Table) (TableFacts, error) {
	text := regexp.MustCompile(`(?m)--[^\n]*`).ReplaceAllString(table.DDL, "")
	start := strings.Index(text, "(")
	end := strings.LastIndex(text, ") ENGINE=")
	if start < 0 || end < start {
		return TableFacts{}, ErrDependency
	}
	f := TableFacts{Columns: []ColumnFact{}, Indexes: []IndexFact{}, FKs: []FKFact{}, Checks: map[string]string{}, Engine: "InnoDB", Collation: "utf8mb4_unicode_ci"}
	pk := []string{}
	column := regexp.MustCompile("^`?([a-zA-Z][a-zA-Z0-9_]*)`?\\s+([a-zA-Z]+(?:\\([0-9,]+\\))?(?:\\s+(?i:UNSIGNED))?)\\s*(.*)$")
	index := regexp.MustCompile("^(UNIQUE KEY|KEY|PRIMARY KEY)\\s*(?:`?([a-zA-Z][a-zA-Z0-9_]*)`?\\s*)?\\(([^)]+)\\)")
	foreign := regexp.MustCompile("^CONSTRAINT\\s+`?([a-zA-Z][a-zA-Z0-9_]*)`?\\s+FOREIGN KEY\\s*\\(([^)]+)\\)\\s+REFERENCES\\s+`?([a-zA-Z][a-zA-Z0-9_]*)`?\\s*\\(([^)]+)\\)(.*)$")
	check := regexp.MustCompile("(?s)^CONSTRAINT\\s+`?([a-zA-Z][a-zA-Z0-9_]*)`?\\s+CHECK\\s*\\((.*)\\)$")
	for _, line := range sqlPieces(text[start+1 : end]) {
		if match := foreign.FindStringSubmatch(line); len(match) > 0 {
			fk := FKFact{Name: match[1], Columns: sqlNames(match[2]), Table: match[3], References: sqlNames(match[4]), Delete: "RESTRICT", Update: "RESTRICT"}
			if strings.Contains(match[5], "ON DELETE CASCADE") {
				fk.Delete = "CASCADE"
			}
			if strings.Contains(match[5], "ON DELETE SET NULL") {
				fk.Delete = "SET NULL"
			}
			f.FKs = append(f.FKs, fk)
			continue
		}
		if match := check.FindStringSubmatch(line); len(match) > 0 {
			f.Checks[match[1]] = normalizedCheck(match[2])
			continue
		}
		if match := index.FindStringSubmatch(line); len(match) > 0 {
			name := match[2]
			if match[1] == "PRIMARY KEY" {
				name = "PRIMARY"
				pk = sqlNames(match[3])
			}
			f.Indexes = append(f.Indexes, IndexFact{Name: name, Columns: sqlNames(match[3]), Unique: match[1] != "KEY"})
			continue
		}
		match := column.FindStringSubmatch(line)
		if len(match) != 4 {
			return TableFacts{}, ErrDependency
		}
		suffix := match[3]
		c := ColumnFact{Name: match[1], Type: normalizedType(match[2]), Nullable: !strings.Contains(suffix, "NOT NULL") && !strings.Contains(suffix, "PRIMARY KEY"), AutoIncrement: strings.Contains(suffix, "AUTO_INCREMENT")}
		if generated := regexp.MustCompile(`(?s)GENERATED ALWAYS AS\s*\((.*)\)\s+(STORED|VIRTUAL)`).FindStringSubmatch(suffix); len(generated) > 0 {
			c.Generated = normalizedCheck(generated[1])
			c.Stored = generated[2] == "STORED"
		}
		if strings.Contains(suffix, "PRIMARY KEY") {
			pk = append(pk, c.Name)
			f.Indexes = append(f.Indexes, IndexFact{Name: "PRIMARY", Columns: []string{c.Name}, Unique: true})
		}
		if pos := strings.Index(suffix, "DEFAULT "); pos >= 0 {
			value := suffix[pos+8:]
			if strings.HasPrefix(value, "'") {
				literal := sqlLiteral.FindString(value)
				v := sqlText(literal)
				c.Default = &v
			} else {
				v := strings.Fields(value)[0]
				if v != "NULL" {
					v = strings.ToLower(v)
					c.Default = &v
				}
			}
		}
		if pos := strings.Index(suffix, "COMMENT "); pos >= 0 {
			c.Comment = sqlText(sqlLiteral.FindString(suffix[pos+8:]))
		}
		f.Columns = append(f.Columns, c)
	}
	for i := range f.Columns {
		for _, name := range pk {
			if f.Columns[i].Name == name {
				f.Columns[i].Nullable = false
			}
		}
	}
	for _, fk := range table.ForeignKeys {
		f.FKs = append(f.FKs, FKFact{Name: fk.Name, Columns: fk.Columns, Table: fk.ReferencedTable, References: fk.ReferencedColumns, Delete: "RESTRICT", Update: "RESTRICT"})
	}
	// InnoDB creates a supporting index when no declared index begins with
	// the FK columns. Include that deterministic part of the installed schema.
	for _, fk := range f.FKs {
		supported := false
		for _, index := range f.Indexes {
			if len(index.Columns) >= len(fk.Columns) && strings.Join(index.Columns[:len(fk.Columns)], ",") == strings.Join(fk.Columns, ",") {
				supported = true
			}
		}
		if !supported {
			f.Indexes = append(f.Indexes, IndexFact{Name: fk.Name, Columns: fk.Columns})
		}
	}
	sortFacts(&f)
	return f, nil
}
func sortFacts(f *TableFacts) {
	for i := range f.FKs {
		if f.FKs[i].Delete == "NO ACTION" {
			f.FKs[i].Delete = "RESTRICT"
		}
		if f.FKs[i].Update == "NO ACTION" {
			f.FKs[i].Update = "RESTRICT"
		}
	}
	sort.Slice(f.Indexes, func(i, j int) bool { return f.Indexes[i].Name < f.Indexes[j].Name })
	sort.Slice(f.FKs, func(i, j int) bool { return f.FKs[i].Name < f.FKs[j].Name })
}
func actualFacts(ctx context.Context, q targetQuery, database, table string) (TableFacts, error) {
	f := TableFacts{Columns: []ColumnFact{}, Indexes: []IndexFact{}, FKs: []FKFact{}, Checks: map[string]string{}}
	if q.QueryRowContext(ctx, "SELECT ENGINE,TABLE_COLLATION FROM information_schema.TABLES WHERE TABLE_SCHEMA=? AND TABLE_NAME=? AND TABLE_TYPE='BASE TABLE'", database, table).Scan(&f.Engine, &f.Collation) != nil {
		return f, ErrDependency
	}
	rows, err := q.QueryContext(ctx, "SELECT COLUMN_NAME,COLUMN_TYPE,IS_NULLABLE,COLUMN_DEFAULT,EXTRA,COLUMN_COMMENT,GENERATION_EXPRESSION FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=? AND TABLE_NAME=? ORDER BY ORDINAL_POSITION", database, table)
	if err != nil {
		return f, ErrDependency
	}
	for rows.Next() {
		var c ColumnFact
		var nullable, extra string
		if rows.Scan(&c.Name, &c.Type, &nullable, &c.Default, &extra, &c.Comment, &c.Generated) != nil {
			rows.Close()
			return f, ErrDependency
		}
		c.Type = normalizedType(c.Type)
		c.Nullable = nullable == "YES"
		c.AutoIncrement = strings.Contains(extra, "auto_increment")
		c.Generated = normalizedCheck(c.Generated)
		c.Stored = strings.Contains(extra, "STORED GENERATED")
		if c.Default != nil {
			if strings.Contains(extra, "DEFAULT_GENERATED") {
				v := strings.ToLower(*c.Default)
				c.Default = &v
			}
		}
		f.Columns = append(f.Columns, c)
	}
	err = rows.Err()
	rows.Close()
	if err != nil {
		return f, ErrDependency
	}
	rows, err = q.QueryContext(ctx, "SELECT INDEX_NAME,COLUMN_NAME,NON_UNIQUE FROM information_schema.STATISTICS WHERE TABLE_SCHEMA=? AND TABLE_NAME=? ORDER BY INDEX_NAME,SEQ_IN_INDEX", database, table)
	if err != nil {
		return f, ErrDependency
	}
	for rows.Next() {
		var name, col string
		var nonunique int
		if rows.Scan(&name, &col, &nonunique) != nil {
			rows.Close()
			return f, ErrDependency
		}
		if len(f.Indexes) == 0 || f.Indexes[len(f.Indexes)-1].Name != name {
			f.Indexes = append(f.Indexes, IndexFact{Name: name, Unique: nonunique == 0})
		}
		i := len(f.Indexes) - 1
		f.Indexes[i].Columns = append(f.Indexes[i].Columns, col)
	}
	err = rows.Err()
	rows.Close()
	if err != nil {
		return f, ErrDependency
	}
	rows, err = q.QueryContext(ctx, "SELECT k.CONSTRAINT_NAME,k.COLUMN_NAME,k.REFERENCED_TABLE_NAME,k.REFERENCED_COLUMN_NAME,r.DELETE_RULE,r.UPDATE_RULE,k.REFERENCED_TABLE_SCHEMA FROM information_schema.KEY_COLUMN_USAGE k JOIN information_schema.REFERENTIAL_CONSTRAINTS r ON r.CONSTRAINT_SCHEMA=k.CONSTRAINT_SCHEMA AND r.CONSTRAINT_NAME=k.CONSTRAINT_NAME AND r.TABLE_NAME=k.TABLE_NAME WHERE k.TABLE_SCHEMA=? AND k.TABLE_NAME=? ORDER BY k.CONSTRAINT_NAME,k.ORDINAL_POSITION", database, table)
	if err != nil {
		return f, ErrDependency
	}
	for rows.Next() {
		var name, col, ref, refCol, del, upd, refSchema string
		if rows.Scan(&name, &col, &ref, &refCol, &del, &upd, &refSchema) != nil || refSchema != database {
			rows.Close()
			return f, ErrDependency
		}
		if len(f.FKs) == 0 || f.FKs[len(f.FKs)-1].Name != name {
			f.FKs = append(f.FKs, FKFact{Name: name, Table: ref, Delete: del, Update: upd})
		}
		i := len(f.FKs) - 1
		f.FKs[i].Columns = append(f.FKs[i].Columns, col)
		f.FKs[i].References = append(f.FKs[i].References, refCol)
	}
	err = rows.Err()
	rows.Close()
	if err != nil {
		return f, ErrDependency
	}
	rows, err = q.QueryContext(ctx, "SELECT c.CONSTRAINT_NAME,c.CHECK_CLAUSE FROM information_schema.CHECK_CONSTRAINTS c JOIN information_schema.TABLE_CONSTRAINTS t ON t.CONSTRAINT_SCHEMA=c.CONSTRAINT_SCHEMA AND t.CONSTRAINT_NAME=c.CONSTRAINT_NAME WHERE t.TABLE_SCHEMA=? AND t.TABLE_NAME=? AND t.ENFORCED='YES' ORDER BY c.CONSTRAINT_NAME", database, table)
	if err != nil {
		return f, ErrDependency
	}
	for rows.Next() {
		var name, clause string
		if rows.Scan(&name, &clause) != nil {
			rows.Close()
			return f, ErrDependency
		}
		f.Checks[name] = normalizedCheck(clause)
	}
	err = rows.Err()
	rows.Close()
	if err != nil {
		return f, ErrDependency
	}
	sortFacts(&f)
	return f, nil
}
func CheckDependencies(ctx context.Context, q targetQuery, p Profile, b enterprise.Binding) (map[string]string, error) {
	result := map[string]string{}
	for _, table := range DependencyTables() {
		domain := strings.SplitN(table.Physical, "_", 2)[0]
		if domain == "mig" {
			domain = "migration"
		}
		if b.Domains[domain].Tables[table.Logical] != table.Physical {
			return nil, ErrDependency
		}
		expected, err := expectedFacts(table)
		if err != nil {
			return nil, err
		}
		actual, err := actualFacts(ctx, q, p.Database, table.Physical)
		if err != nil || factsHash(expected) != factsHash(actual) {
			return nil, ErrDependency
		}
		result[table.Physical] = factsHash(expected)
	}
	return result, nil
}
