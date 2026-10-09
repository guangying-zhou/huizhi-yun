package domaininstall

import (
	"context"
	"database/sql"
	_ "embed"
	"encoding/json"
	"reflect"

	"github.com/huizhi-yun/data-runtime/internal/enterprise"
)

//go:embed apf_altoc.json
var apfAltoc []byte

//go:embed apf_finance.json
var apfFinance []byte

//go:embed apf_people.json
var apfPeople []byte

var apfManifests = map[string][]byte{"altoc": apfAltoc, "finance": apfFinance, "people": apfPeople}
var apfShared = map[string]bool{"integration_operation": true, "integration_operation_attempt": true, "integration_operation_dead_letter_actionable": true, "service_command_receipt": true}

// APFTables returns independent snapshots of the closed, reviewed installation
// sets. Shared logical ledger names are resolved per domain, never exposed as views.
func APFTables(domain string) ([]Table, error) {
	raw, ok := apfManifests[domain]
	if !ok {
		return nil, ErrBoundary
	}
	var tables []Table
	if err := json.Unmarshal(raw, &tables); err != nil {
		return nil, err
	}
	if domain == "finance" {
		for n := range tables {
			if tables[n].Logical == "finance_bank_account" {
				tables[n] = bankAccountFresh(tables[n])
			}
		}
	}
	for n := range tables {
		tables[n] = w1Fresh(tables[n])
	}
	return tables, nil
}

// WithAPF adds all three fixed mappings without mutating existing domain maps,
// schema version or generation. It never replaces a previously registered domain.
func WithAPF(b enterprise.Binding, owner string) (enterprise.Binding, error) {
	if owner == "" || b.Generation == 0 {
		return b, ErrBoundary
	}
	out := b
	out.Domains = make(map[string]enterprise.DomainBinding, len(b.Domains)+3)
	for name, d := range b.Domains {
		out.Domains[name] = d
	}
	for _, domain := range []string{"altoc", "finance", "people"} {
		if _, exists := out.Domains[domain]; exists {
			return b, ErrBoundary
		}
		tables, _ := APFTables(domain)
		mapping := map[string]string{}
		for _, t := range tables {
			mapping[t.Logical] = t.Physical
		}
		out.Domains[domain] = enterprise.DomainBinding{OwnerDeployment: owner, Tables: mapping, Read: enterprise.PathUnified, Write: enterprise.PathDisabled, Scheduler: enterprise.PathDisabled}
	}
	return out, nil
}

// ForAPF installs the entire batch under one migration lock and one baseline.
// Generation is unchanged; enabling writes/scheduler is a separate reviewed action.
func ForAPF(e Expectation) Installer {
	var all []Table
	for _, domain := range []string{"altoc", "finance", "people"} {
		tables, _ := APFTables(domain)
		all = append(all, tables...)
	}
	raw, _ := json.Marshal(all)
	return Installer{x: installer{domain: "apf", manifest: raw, expect: e, apf: true}}
}

func (x *installer) validateAPF(b enterprise.Binding) error {
	names := x.names()
	for _, domain := range []string{"altoc", "finance", "people"} {
		tables, _ := APFTables(domain)
		d, ok := b.Domains[domain]
		if !ok || d.OwnerDeployment != x.expect.OwnerDeployment || d.Read != enterprise.PathUnified || d.Write != enterprise.PathDisabled || d.Scheduler != enterprise.PathDisabled || len(d.Tables) != len(tables) {
			return ErrBoundary
		}
		for _, t := range tables {
			if d.Tables[t.Logical] != t.Physical {
				return ErrBoundary
			}
		}
	}
	for domain, d := range b.Domains {
		if _, apf := apfManifests[domain]; apf {
			continue
		}
		for logical, physical := range d.Tables {
			if names[physical] || names[logical] {
				return ErrBoundary
			}
			// Only the already-frozen four ledger aliases may be shared with old domains.
			for _, t := range x.tables() {
				if logical == t.Logical && !apfShared[logical] {
					return ErrBoundary
				}
			}
		}
	}
	return nil
}

func (x *installer) verifyTables(ctx context.Context, c *sql.Conn, b enterprise.Binding, logical []string) error {
	if !x.apf {
		return enterprise.VerifyCompatibilityViewsTx(ctx, c, b, x.domain, logical)
	}
	for _, t := range x.tables() {
		var engine string
		if err := c.QueryRowContext(ctx, "SELECT ENGINE FROM information_schema.TABLES WHERE TABLE_SCHEMA=? AND TABLE_NAME=? AND TABLE_TYPE='BASE TABLE'", b.Storage.Database, t.Physical).Scan(&engine); err != nil {
			return err
		}
		if engine != "InnoDB" {
			return ErrBoundary
		}
		rows, err := c.QueryContext(ctx, "SELECT COLUMN_NAME FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=? AND TABLE_NAME=? ORDER BY ORDINAL_POSITION", b.Storage.Database, t.Physical)
		if err != nil {
			return err
		}
		var columns []string
		for rows.Next() {
			var col string
			if err = rows.Scan(&col); err != nil {
				rows.Close()
				return err
			}
			columns = append(columns, col)
		}
		err = rows.Err()
		rows.Close()
		if err != nil {
			return err
		}
		if !reflect.DeepEqual(columns, t.Columns) {
			return ErrBoundary
		}
	}
	// No schema-level aliases may redirect a shared ledger to one of the domains.
	for logical := range apfShared {
		var n int
		if err := c.QueryRowContext(ctx, "SELECT COUNT(*) FROM information_schema.TABLES WHERE TABLE_SCHEMA=? AND TABLE_NAME=? AND TABLE_TYPE='VIEW'", b.Storage.Database, logical).Scan(&n); err != nil {
			return err
		}
		if n != 0 {
			return ErrBoundary
		}
	}
	return nil
}

// IsAPFDomain distinguishes new prefixed schemas from the frozen legacy Altoc
// reader. Partial/hybrid maps fail closed in APF installation validation.
func IsAPFDomain(domain string, d enterprise.DomainBinding) bool {
	var validDue bool
	d, validDue = withoutDue(domain, d)
	if !validDue {
		return false
	}

	if domain == "altoc" && IsAltocSalesDomain(d) {
		return true
	}
	if domain == "finance" && IsFinanceB3Domain(d) {
		return true
	}
	if domain == "people" && IsPeopleFactsDomain(d) {
		return true
	}
	if _, ok := apfManifests[domain]; !ok {
		return false
	}
	tables, err := APFTables(domain)
	if err != nil {
		return false
	}
	if domain == "people" && len(d.Tables) == len(tables)+1 {
		if d.Tables["people_employee_private_facts"] != "people_employee_private_facts" {
			return false
		}
	} else if len(d.Tables) != len(tables) {
		return false
	}
	for _, table := range tables {
		if d.Tables[table.Logical] != table.Physical {
			return false
		}
	}
	return true
}
