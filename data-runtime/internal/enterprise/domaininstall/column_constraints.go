package domaininstall

import (
	"context"
	"database/sql"
	"strings"
)

type ColumnForeignKey struct {
	Name              string
	Columns           []string
	ReferencedTable   string
	ReferencedColumns []string
}
type ColumnCheck struct{ Name, Expression, Canonical string }

func (f ColumnForeignKey) definition() string {
	a, b := []string{}, []string{}
	for _, n := range f.Columns {
		a = append(a, q(n))
	}
	for _, n := range f.ReferencedColumns {
		b = append(b, q(n))
	}
	return "CONSTRAINT " + q(f.Name) + " FOREIGN KEY (" + strings.Join(a, ",") + ") REFERENCES " + q(f.ReferencedTable) + " (" + strings.Join(b, ",") + ")"
}
func (c ColumnCheck) definition() string {
	return "CONSTRAINT " + q(c.Name) + " CHECK (" + c.Canonical + ")"
}
func constraintLine(ddl, name string) string {
	for _, line := range schemaLines(ddl) {
		if strings.HasPrefix(line, "CONSTRAINT "+q(name)+" ") {
			return line
		}
	}
	return ""
}
func hasIndex(ddl string, columns []string) bool {
	for _, line := range schemaLines(ddl) {
		if !strings.HasPrefix(line, "PRIMARY KEY ") && !strings.HasPrefix(line, "KEY ") && !strings.HasPrefix(line, "UNIQUE KEY ") {
			continue
		}
		at := strings.Index(line, "(")
		if at < 0 {
			continue
		}
		parts := strings.Split(strings.TrimSuffix(line[at+1:], ")"), ",")
		if len(parts) < len(columns) {
			continue
		}
		match := true
		for i, n := range columns {
			if parts[i] != q(n) {
				match = false
			}
		}
		if match {
			return true
		}
	}
	return false
}
func (x *columnInstaller) constraintSteps(cp *ColumnPlan, add func(string, string, string, string)) error {
	table := q(x.declaration.Table)
	for _, f := range x.declaration.ForeignKeys {
		for _, n := range f.Columns {
			if columnLine(cp.AfterDefinition, n) == "" {
				return ErrBoundary
			}
		}
		if !hasIndex(cp.AfterDefinition, f.Columns) {
			return ErrBoundary
		}
		if line := constraintLine(cp.AfterDefinition, f.Name); line != "" {
			if line != f.definition() {
				return ErrBoundary
			}
			continue
		}
		add("foreign-key:"+f.Name, "ALTER TABLE "+table+" ADD "+f.definition(), "ALTER TABLE "+table+" DROP FOREIGN KEY "+q(f.Name), insertSchemaLine(cp.AfterDefinition, f.definition(), false))
		// With FK checks enabled MySQL requires COPY when adding a foreign key.
		// Never disable checks or silently fall back from an approved algorithm.
		step := &cp.Steps[len(cp.Steps)-1]
		step.DDL = strings.Replace(step.DDL, "ALGORITHM=INPLACE, LOCK=NONE", "ALGORITHM=COPY, LOCK=SHARED", 1)
	}
	for _, check := range x.declaration.Checks {
		if line := constraintLine(cp.AfterDefinition, check.Name); line != "" {
			if line != check.definition() {
				return ErrBoundary
			}
			continue
		}
		add("check:"+check.Name, "ALTER TABLE "+table+" ADD CONSTRAINT "+q(check.Name)+" CHECK ("+check.Expression+")", "ALTER TABLE "+table+" DROP CHECK "+q(check.Name), insertSchemaLine(cp.AfterDefinition, check.definition(), false))
		step := &cp.Steps[len(cp.Steps)-1]
		step.DDL = strings.Replace(step.DDL, "ALGORITHM=INPLACE, LOCK=NONE", "ALGORITHM=COPY, LOCK=SHARED", 1)
	}
	return nil
}
func (x *columnInstaller) projectedSQL(cp *ColumnPlan) string {
	fields := []string{"source.*"}
	for _, col := range x.declaration.Add {
		if columnLine(cp.BeforeDefinition, col.Name) != "" {
			continue
		}
		value := "NULL"
		if col.Default != nil {
			value = literal(*col.Default)
		}
		fields = append(fields, value+" AS "+q(col.Name))
	}
	return "(SELECT " + strings.Join(fields, ",") + " FROM " + q(x.declaration.Table) + " source) projected"
}
func (x *columnInstaller) constraintPreflight(ctx context.Context, c *sql.Conn, bdb string, cp *ColumnPlan) error {
	current, err := columnDDL(ctx, c, x.declaration.Table)
	if err != nil {
		return err
	}
	actual := *cp
	actual.BeforeDefinition = current
	cp = &actual
	for _, f := range x.declaration.ForeignKeys {
		ref, err := columnDDL(ctx, c, f.ReferencedTable)
		if err != nil {
			return err
		}
		if !hasIndex(ref, f.ReferencedColumns) {
			return ErrBoundary
		}
		for i, n := range f.ReferencedColumns {
			if columnLine(ref, n) == "" {
				return ErrBoundary
			}
			local := columnLine(cp.AfterDefinition, f.Columns[i])
			remote := columnLine(ref, n)
			if !strings.HasPrefix(strings.TrimPrefix(local, q(f.Columns[i])+" "), "bigint unsigned ") || !strings.HasPrefix(strings.SplitN(remote, " ", 2)[1], "bigint unsigned ") {
				return ErrBoundary
			}
		}
		joins, nonnull := []string{}, []string{}
		for i, n := range f.Columns {
			joins = append(joins, "projected."+q(n)+"=parent."+q(f.ReferencedColumns[i]))
			nonnull = append(nonnull, "projected."+q(n)+" IS NOT NULL")
		}
		var invalid int
		if err = c.QueryRowContext(ctx, "SELECT COUNT(*) FROM "+x.projectedSQL(cp)+" LEFT JOIN "+q(f.ReferencedTable)+" parent ON "+strings.Join(joins, " AND ")+" WHERE "+strings.Join(nonnull, " AND ")+" AND parent."+q(f.ReferencedColumns[0])+" IS NULL").Scan(&invalid); err != nil {
			return err
		}
		if invalid != 0 {
			return ErrBoundary
		}
	}
	for _, check := range x.declaration.Checks {
		var invalid int
		if err := c.QueryRowContext(ctx, "SELECT COUNT(*) FROM "+x.projectedSQL(cp)+" WHERE ("+check.Expression+") IS FALSE").Scan(&invalid); err != nil {
			return err
		}
		if invalid != 0 {
			return ErrBoundary
		}
	}
	return nil
}
