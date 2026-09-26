// Package enterprisecandidate generates review artifacts from a frozen source
// plan. It has no database connection and cannot install or activate anything.
package enterprisecandidate

import (
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"github.com/huizhi-yun/data-runtime/internal/enterpriseassets"
	"github.com/huizhi-yun/data-runtime/internal/enterpriseplanning"
	"github.com/huizhi-yun/data-runtime/internal/enterprisescheduler"
	"github.com/huizhi-yun/data-runtime/internal/migrations/unified"
	"regexp"
	"sort"
	"strings"
)

type View struct {
	Domain, Name, Physical string
	Columns                []string
}
type Candidate struct {
	Version                  string                       `json:"version"`
	SourceReviewHash         string                       `json:"sourceReviewHash"`
	SourceArtifactSHA256     string                       `json:"sourceArtifactSha256"`
	Config                   unified.Config               `json:"config"`
	Installed                bool                         `json:"installed"`
	TargetVerified           bool                         `json:"targetVerified"`
	BusinessMigrationApplied bool                         `json:"businessMigrationApplied"`
	Views                    []View                       `json:"views"`
	PhysicalMappings         map[string]map[string]string `json:"physicalMappings"`
	ActivationPrerequisites  []string                     `json:"activationPrerequisites"`
	Blockers                 []string                     `json:"blockers"`
}

var identifier = regexp.MustCompile(`^[A-Za-z_][A-Za-z0-9_]{0,63}$`)

func RequiredViews() map[string][]string {
	aims := append(enterpriseplanning.PilotViewNames(), enterprisescheduler.CompletionViewNames()...)
	seen := map[string]bool{}
	for _, name := range aims {
		seen[name] = true
	}
	aims = aims[:0]
	for name := range seen {
		aims = append(aims, name)
	}
	sort.Strings(aims)
	return map[string][]string{"aims": aims, "assets": enterpriseassets.ProductViewNames()}
}
func Build(plan unified.Plan, source []byte) (Candidate, string, error) {
	out := Candidate{Version: "enterprise-composition-candidate.v1", SourceReviewHash: plan.ReviewHash, Config: plan.Config, PhysicalMappings: map[string]map[string]string{}, Blockers: []string{}, ActivationPrerequisites: []string{"source plan revalidated after required schema migrations", "reviewed fenced final copy completed", "target ownership and registry generation verified", "compatibility views installed and verified", "Runtime and Host release validation", "Gateway read-back and complete pilot acceptance"}}
	fail := func(reason string) (Candidate, string, error) {
		return Candidate{}, "", fmt.Errorf("invalid enterprise candidate source: %s", reason)
	}
	if plan.Version != "enterprise-shadow-copy.v1" || plan.ReviewHash == "" || unified.ReviewHash(plan) != plan.ReviewHash {
		return fail("review hash mismatch")
	}
	if !identifier.MatchString(plan.Config.Target) || plan.Config.Target == plan.Config.SourceAims || plan.Config.Target == plan.Config.SourceAssets {
		return fail("separate target schema required")
	}
	sum := sha256.Sum256(source)
	out.SourceArtifactSHA256 = hex.EncodeToString(sum[:])
	tables := map[string]unified.Table{}
	physical := map[string]bool{}
	for _, table := range plan.Tables {
		if table.Domain != "aims" && table.Domain != "assets" {
			return fail("unknown domain")
		}
		expectedSource := plan.Config.SourceAims
		if table.Domain == "assets" {
			expectedSource = plan.Config.SourceAssets
		}
		if table.Source != expectedSource || !identifier.MatchString(table.Name) || !identifier.MatchString(table.Target) || len(table.Columns) == 0 {
			return fail("invalid table binding")
		}
		key := table.Domain + ":" + table.Name
		if _, ok := tables[key]; ok || physical[table.Target] {
			return fail("duplicate table mapping")
		}
		tables[key] = table
		physical[table.Target] = true
		if out.PhysicalMappings[table.Domain] == nil {
			out.PhysicalMappings[table.Domain] = map[string]string{}
		}
		out.PhysicalMappings[table.Domain][table.Name] = table.Target
		columns := map[string]bool{}
		for _, column := range table.Columns {
			if !identifier.MatchString(column) || columns[column] {
				return fail("invalid or duplicate column")
			}
			columns[column] = true
		}
	}
	for _, domain := range []string{"aims", "assets"} {
		requiredMappings := []string{"service_command_receipt"}
		if domain == "aims" {
			requiredMappings = []string{"integration_operation", "integration_operation_attempt", "service_command_receipt", "integration_operation_dead_letter_actionable"}
		}
		for _, name := range requiredMappings {
			if _, ok := tables[domain+":"+name]; !ok {
				return fail("missing " + domain + " owned mapping " + name)
			}
		}
	}
	for _, name := range []string{"system_parameters", "assets_product_catalog_state"} {
		if _, ok := tables["assets:"+name]; !ok {
			return fail("missing Assets explicit mapping " + name)
		}
	}
	receipt := tables["assets:service_command_receipt"]
	if !strings.Contains(receipt.DDL, "assets-owned-command.v1") {
		out.Blockers = append(out.Blockers, "assets-owned-product-receipt-source-migration-required")
	}
	linksReady := !strings.Contains(strings.ToUpper(receipt.DDL), "NOT ENFORCED")
	for _, operation := range []string{"assets.products.link-base.v1", "assets.products.link-asset.v1", "assets.products.link-document.v1"} {
		linksReady = linksReady && strings.Contains(receipt.DDL, operation)
	}
	if !linksReady {
		out.Blockers = append(out.Blockers, "assets-owned-product-link-receipt-source-migration-required")
	}
	required := RequiredViews()
	logical := map[string]bool{}
	var sql strings.Builder
	fmt.Fprintf(&sql, "-- CANDIDATE ONLY: not installed; target not verified; no migration performed.\n-- Source plan review hash: %s\n-- Source artifact SHA-256: %s\n", plan.ReviewHash, out.SourceArtifactSHA256)
	for _, domain := range []string{"aims", "assets"} {
		names := append([]string(nil), required[domain]...)
		sort.Strings(names)
		for _, name := range names {
			table, ok := tables[domain+":"+name]
			if !ok {
				return fail("missing service view " + domain + ":" + name)
			}
			if logical[name] || physical[name] || name == "system_parameters" || name == "service_command_receipt" {
				return fail("logical view conflicts with owning tables")
			}
			logical[name] = true
			columns := make([]string, len(table.Columns))
			for i, column := range table.Columns {
				columns[i] = "`" + column + "`"
			}
			fmt.Fprintf(&sql, "CREATE ALGORITHM=MERGE SQL SECURITY INVOKER VIEW `%s`.`%s` AS SELECT %s FROM `%s`.`%s`;\n", plan.Config.Target, name, strings.Join(columns, ","), plan.Config.Target, table.Target)
			out.Views = append(out.Views, View{domain, name, table.Target, append([]string(nil), table.Columns...)})
		}
	}
	return out, sql.String(), nil
}
