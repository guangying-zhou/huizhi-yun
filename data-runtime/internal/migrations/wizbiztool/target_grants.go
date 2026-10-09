package wizbiztool

import (
	"fmt"
	"sort"
)

// Candidate only: no DB connection, account creation or secret generation.
// Derived from the same targetTableSet + registered table union enforced by
// CheckTargetPrivileges. It grants nothing to an unregistered adjacent table.
type TargetGrantPlan struct {
	Account        string   `json:"account"`
	Database       string   `json:"database"`
	DMLTables      []string `json:"dmlTables"`
	ReadOnlyTables []string `json:"readOnlyTables"`
	Grants         []string `json:"grants"`
	Rollback       string   `json:"rollback"`
	ReviewHash     string   `json:"reviewHash"`
}

func BuildTargetGrantPlan(p Profile) (TargetGrantPlan, error) {
	b, _, err := p.RuntimeBinding()
	if err != nil {
		return TargetGrantPlan{}, err
	}
	if !identifier.MatchString(p.Database) {
		return TargetGrantPlan{}, ErrTarget
	}
	targets := targetTableSet()
	all := targetTableSet()
	for _, d := range b.Domains {
		for _, table := range d.Tables {
			if !identifier.MatchString(table) {
				return TargetGrantPlan{}, ErrTarget
			}
			all[table] = true
		}
	}
	plan := TargetGrantPlan{Account: "hzy_wizbiz_migrate@127.0.0.1", Database: p.Database, DMLTables: []string{}, ReadOnlyTables: []string{}, Grants: []string{}, Rollback: "DROP USER 'hzy_wizbiz_migrate'@'127.0.0.1';"}
	tables := []string{}
	for table := range all {
		tables = append(tables, table)
	}
	sort.Strings(tables)
	for _, table := range tables {
		privilege := "SELECT"
		if targets[table] && table != "enterprise_schema_registry" {
			privilege = "SELECT, INSERT, UPDATE, DELETE"
			plan.DMLTables = append(plan.DMLTables, table)
		} else {
			plan.ReadOnlyTables = append(plan.ReadOnlyTables, table)
		}
		plan.Grants = append(plan.Grants, fmt.Sprintf("GRANT %s ON `%s`.`%s` TO 'hzy_wizbiz_migrate'@'127.0.0.1';", privilege, p.Database, table))
	}
	plan.ReviewHash = factsHash(plan)
	return plan, nil
}

// Offline preflight of native SHOW GRANTS exported as a protected JSON array.
// In addition to tool acceptance, require the entire candidate set exactly.
func CheckTargetGrantSnapshot(plan TargetGrantPlan, grants []string) error {
	expected := map[string]bool{}
	for _, sql := range plan.Grants {
		// MySQL SHOW GRANTS uses backticks for the account, no semicolon.
		native := sql[:len(sql)-1]
		native = native[:len(native)-len("'hzy_wizbiz_migrate'@'127.0.0.1'")] + "`hzy_wizbiz_migrate`@`127.0.0.1`"
		expected[native] = true
	}
	seen := map[string]bool{}
	for _, grant := range grants {
		if grant == "GRANT USAGE ON *.* TO `hzy_wizbiz_migrate`@`127.0.0.1`" {
			if seen[grant] {
				return ErrTarget
			}
			seen[grant] = true
			continue
		}
		if !expected[grant] || seen[grant] {
			return ErrTarget
		}
		seen[grant] = true
	}
	for grant := range expected {
		if !seen[grant] {
			return ErrTarget
		}
	}
	return nil
}
