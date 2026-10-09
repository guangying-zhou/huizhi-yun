package domaininstall

import (
	"context"
	"database/sql"
	_ "embed"
	"encoding/json"
	"github.com/huizhi-yun/data-runtime/internal/enterprise"
	"regexp"
	"strings"
)

//go:embed w1_tables.json
var w1TablesJSON []byte

func W1Tables(name string) []Table {
	var all map[string][]Table
	if json.Unmarshal(w1TablesJSON, &all) != nil {
		panic("invalid W1 manifest")
	}
	return all[name]
}
func W1Domain(name string) string {
	switch name {
	case "w1-migration-ledger":
		return "migration"
	case "w1-finance-legal-entity", "w1-finance-balance-entry", "w1-finance-balance-columns":
		return "finance"
	case "w1-altoc-contract-snapshot", "w1-altoc-customer-snapshot", "w1-altoc-contract-columns", "w1-altoc-customer-columns", "w1-altoc-contact-columns":
		return "altoc"
	}
	return ""
}
func IsColumnSubset(name string) bool {
	return name == "finance-bank-account-columns" || W1Columns(name).Table != ""
}
func contractColumnsW1() ColumnDeclaration { return W1Columns("w1-altoc-contract-columns") }
func W1Columns(name string) ColumnDeclaration {
	switch name {
	case "w1-finance-balance-columns":
		return ColumnDeclaration{Domain: "finance", Table: "finance_account_balance_snapshot", Add: []ColumnDefinition{
			{Name: "entry_count", Type: "int", Nullable: true, Comment: "当日同来源登记条数；本设计之前的既有快照为 NULL"},
			{Name: "latest_tie_count", Type: "int", Nullable: true, Comment: "在最新登记时刻上并列的条数（1 = 唯一）"},
			{Name: "distinct_amounts", Type: "int", Nullable: true, Comment: "当日不同金额的个数（>1 表示当日改过数）"}}}
	case "w1-altoc-contract-columns":
		return ColumnDeclaration{Domain: "altoc", Table: "altoc_contract", Add: []ColumnDefinition{
			{Name: "origin_type", Type: "varchar(30)", Default: strptr("native"), Comment: "native/historical_import"},
			{Name: "signed_amount", Type: "decimal(18,2)", Nullable: true, Comment: "原始签约总额"},
			{Name: "effective_amount", Type: "decimal(18,2)", Nullable: true, Comment: "有效合同额：合同总额去掉第三方等非本公司收入部分；历史值为原系统人工录入"},
			{Name: "contract_category", Type: "varchar(40)", Nullable: true, Comment: "合同业务类别（签约时的经营分类，独立于由合同行推导的 primary_type）"},
			{Name: "amount_basis", Type: "varchar(30)", Default: strptr("lines"), Comment: "lines/header：当前合同额取自合同行还是直接录入"},
			{Name: "receiving_bank_account_code", Type: "varchar(50)", Nullable: true, Comment: "约定收款账户（finance_bank_account.code）"},
			{Name: "signed_at", Type: "datetime(3)", Nullable: true, Comment: "带时间的签订时刻（sign_date 是 DATE）"},
			{Name: "imported_batch_code", Type: "varchar(64)", Nullable: true, Comment: "仅 historical_import 有值"},
			{Name: "imported_at", Type: "datetime(3)", Nullable: true}},
			Indexes: []ColumnIndex{{Name: "idx_altoc_contract_origin", Columns: []string{"origin_type"}}},
			Relax:   []ColumnRelaxation{{Name: "tax_rate", Before: ColumnDefinition{Name: "tax_rate", Type: "decimal(5,2)", Default: strptr("6.00")}.definition(), After: ColumnDefinition{Name: "tax_rate", Type: "decimal(5,2)", Nullable: true, Default: strptr("6.00")}}},
			Checks:  []ColumnCheck{{Name: "ck_altoc_contract_origin", Expression: "(origin_type = 'native' AND imported_batch_code IS NULL) OR (origin_type = 'historical_import' AND imported_batch_code IS NOT NULL AND amount_basis = 'header')", Canonical: "(((`origin_type` = _utf8mb4'native') and (`imported_batch_code` is null)) or ((`origin_type` = _utf8mb4'historical_import') and (`imported_batch_code` is not null) and (`amount_basis` = _utf8mb4'header')))"}}}
	case "w1-altoc-customer-columns":
		return ColumnDeclaration{Domain: "altoc", Table: "altoc_customer", Add: []ColumnDefinition{
			{Name: "primary_contact_id", Type: "bigint unsigned", Nullable: true, Comment: "主联系人"},
			{Name: "contact_name_text", Type: "varchar(50)", Nullable: true, Comment: "自由文本联系人（与正式联系人并存，不合并）"},
			{Name: "sort_no", Type: "int", Default: strptr("0"), Comment: "显示顺序"}},
			Indexes:     []ColumnIndex{{Name: "idx_altoc_customer_primary_contact", Columns: []string{"primary_contact_id"}}},
			ForeignKeys: []ColumnForeignKey{{Name: "fk_altoc_customer_primary_contact", Columns: []string{"primary_contact_id"}, ReferencedTable: "altoc_contact", ReferencedColumns: []string{"id"}}}}
	case "w1-altoc-contact-columns":
		return ColumnDeclaration{Domain: "altoc", Table: "altoc_contact", Add: []ColumnDefinition{{Name: "star_level", Type: "tinyint", Nullable: true, Comment: "联系人星级 1..6（对应 2~5 星半档）；源字典：1=2 星 … 6=5 星"}}}
	}
	return ColumnDeclaration{}
}
func ForW1(name string, e Expectation) (Installer, error) {
	if d := W1Columns(name); d.Table != "" {
		return Installer{x: installer{column: &columnInstaller{d, e}}}, nil
	}
	t := W1Tables(name)
	if len(t) == 0 {
		return Installer{}, ErrBoundary
	}
	raw, _ := json.Marshal(t)
	return Installer{x: installer{domain: name, manifest: raw, expect: e, apf: true}}, nil
}
func WithW1(b enterprise.Binding, name string, owner string) (enterprise.Binding, error) {
	if IsColumnSubset(name) {
		return b, nil
	}
	tables := W1Tables(name)
	domain := W1Domain(name)
	if len(tables) == 0 || b.Generation == 0 || owner == "" {
		return b, ErrBoundary
	}
	d, ok := b.Domains[domain]
	if !ok {
		if domain != "migration" {
			return b, ErrBoundary
		}
		d = enterprise.DomainBinding{OwnerDeployment: owner, Read: enterprise.PathUnified, Write: enterprise.PathDisabled, Scheduler: enterprise.PathDisabled}
	}
	if d.OwnerDeployment != owner || d.Read != enterprise.PathUnified || (domain != "migration" && !IsAPFDomain(domain, d)) {
		return b, ErrBoundary
	}
	out := b
	out.Domains = map[string]enterprise.DomainBinding{}
	for k, v := range b.Domains {
		out.Domains[k] = v
	}
	m := map[string]string{}
	for k, v := range d.Tables {
		m[k] = v
	}
	for _, t := range tables {
		if _, exists := m[t.Logical]; exists {
			return b, ErrBoundary
		}
		m[t.Logical] = t.Physical
	}
	d.Tables = m
	out.Domains[domain] = d
	return out, nil
}
func (x *installer) validateW1(b enterprise.Binding) error {
	domain := W1Domain(x.domain)
	d, ok := b.Domains[domain]
	if !ok || d.OwnerDeployment != x.expect.OwnerDeployment || d.Read != enterprise.PathUnified || (domain != "migration" && !IsAPFDomain(domain, d)) {
		return ErrBoundary
	}
	if domain == "migration" && (d.Write != enterprise.PathDisabled || d.Scheduler != enterprise.PathDisabled || len(d.Tables) != len(x.tables())) {
		return ErrBoundary
	}
	for _, t := range x.tables() {
		if d.Tables[t.Logical] != t.Physical {
			return ErrBoundary
		}
		for other, bd := range b.Domains {
			if other != domain {
				for k, v := range bd.Tables {
					if k == t.Logical || v == t.Physical {
						return ErrBoundary
					}
				}
			}
		}
	}
	return nil
}
func withoutW1(domain string, d enterprise.DomainBinding) (enterprise.DomainBinding, bool) {
	out := d
	out.Tables = map[string]string{}
	for k, v := range d.Tables {
		out.Tables[k] = v
	}
	for _, name := range []string{"w1-finance-legal-entity", "w1-finance-balance-entry", "w1-altoc-contract-snapshot", "w1-altoc-customer-snapshot"} {
		if W1Domain(name) != domain {
			continue
		}
		for _, t := range W1Tables(name) {
			if v, ok := out.Tables[t.Logical]; ok {
				if v != t.Physical {
					return d, false
				}
				delete(out.Tables, t.Logical)
			}
		}
	}
	return out, true
}

// Fresh DDL is derived from the same declaration. Cyclic customer/contact FK
// is applied only after all base tables exist, with checks kept enabled.
func w1Fresh(t Table) Table {
	var d ColumnDeclaration
	for _, name := range []string{"w1-finance-balance-columns", "w1-altoc-contract-columns", "w1-altoc-customer-columns", "w1-altoc-contact-columns"} {
		candidate := W1Columns(name)
		if candidate.Table == t.Logical {
			d = candidate
			break
		}
	}
	if d.Table == "" {
		return t
	}
	for _, r := range d.Relax {
		lines := strings.Split(t.DDL, "\n")
		for n, line := range lines {
			if strings.HasPrefix(strings.TrimSpace(line), r.Name+" ") {
				lines[n] = "    " + r.After.definition() + ","
			}
		}
		t.DDL = strings.Join(lines, "\n")
	}
	at := strings.Index(t.DDL, "    UNIQUE KEY")
	if at < 0 {
		at = strings.Index(t.DDL, "    KEY ")
	}
	if at < 0 {
		at = strings.LastIndex(t.DDL, "\n) ENGINE=") + 1
	}
	var added string
	for _, c := range d.Add {
		added += "    " + c.definition() + ",\n"
		t.Columns = append(t.Columns, c.Name)
	}
	t.DDL = t.DDL[:at] + added + t.DDL[at:]
	for _, idx := range d.Indexes {
		at = strings.LastIndex(t.DDL, "\n) ENGINE=")
		t.DDL = t.DDL[:at] + ",\n    " + idx.definition() + t.DDL[at:]
	}
	for _, check := range d.Checks {
		at = strings.LastIndex(t.DDL, "\n) ENGINE=")
		t.DDL = t.DDL[:at] + ",\n    CONSTRAINT " + q(check.Name) + " CHECK (" + check.Expression + ")" + t.DDL[at:]
	}
	for _, fk := range d.ForeignKeys {
		t.ForeignKeys = append(t.ForeignKeys, fk)
	}
	return t
}

func (x *installer) tableDependencies(ctx context.Context, c *sql.Conn, p Plan) error {
	created := map[string]bool{}
	for _, t := range p.Tables {
		created[t.Physical] = true
	}
	seen := map[string]bool{}
	re := regexp.MustCompile("(?i)REFERENCES\\s+`?([a-z][a-z0-9_]*)`?\\s*\\(")
	for _, t := range p.Tables {
		seen[t.Physical] = true
		for _, match := range re.FindAllStringSubmatch(t.DDL, -1) {
			name := match[1]
			if seen[name] {
				continue
			}
			if created[name] {
				return ErrBoundary
			}
			var engine string
			if err := c.QueryRowContext(ctx, "SELECT ENGINE FROM information_schema.TABLES WHERE TABLE_SCHEMA=? AND TABLE_NAME=? AND TABLE_TYPE='BASE TABLE'", p.Binding.Storage.Database, name).Scan(&engine); err != nil {
				return ErrBoundary
			}
			if engine != "InnoDB" {
				return ErrBoundary
			}
			found := false
			for _, d := range p.Binding.Domains {
				for _, v := range d.Tables {
					if v == name {
						found = true
					}
				}
			}
			if !found {
				return ErrBoundary
			}
		}
	}
	return nil
}
func (x *installer) verifyTableConstraints(ctx context.Context, c *sql.Conn, p Plan) error {
	for _, t := range p.Tables {
		if len(t.ForeignKeys) == 0 {
			continue
		}
		ddl, err := columnDDL(ctx, c, t.Physical)
		if err != nil {
			return err
		}
		for _, fk := range t.ForeignKeys {
			if constraintLine(ddl, fk.Name) != fk.definition() {
				return ErrBoundary
			}
		}
	}
	return nil
}
