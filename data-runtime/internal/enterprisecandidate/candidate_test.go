package enterprisecandidate

import (
	"encoding/json"
	"github.com/huizhi-yun/data-runtime/internal/migrations/unified"
	"strings"
	"testing"
)

func fixturePlan() unified.Plan {
	p := unified.Plan{Version: "enterprise-shadow-copy.v1", Config: unified.Config{Tenant: "tenant-a", Environment: "test", RuntimeDeployment: "runtime-test", InstanceID: "instance", SchemaVersion: "v1", Generation: 1, SourceAims: "source_aims", SourceAssets: "source_assets", Target: "target_enterprise"}}
	for _, domain := range []string{"aims", "assets"} {
		names := append(RequiredViews()[domain], "service_command_receipt")
		if domain == "aims" {
			names = append(names, "integration_operation", "integration_operation_attempt", "integration_operation_dead_letter_actionable")
		}
		if domain == "assets" {
			names = append(names, "system_parameters", "assets_product_catalog_state")
		}
		source := p.Config.SourceAims
		if domain == "assets" {
			source = p.Config.SourceAssets
		}
		for _, name := range names {
			p.Tables = append(p.Tables, unified.Table{Domain: domain, Source: source, Name: name, Target: domain + "_" + name, Columns: []string{"id", "actual_source_column"}, DDL: "actual source ddl"})
		}
	}
	p.ReviewHash = unified.ReviewHash(p)
	return p
}
func TestCandidateUsesRealColumnsAndOwningMappings(t *testing.T) {
	p := fixturePlan()
	raw, _ := json.Marshal(p)
	out, sql, err := Build(p, raw)
	if err != nil {
		t.Fatal(err)
	}
	for _, required := range []string{"`product_assets` AS SELECT `id`,`actual_source_column`", "`asset_category_groups`", "`product_requests`", "`company_weekly_summaries`"} {
		if !strings.Contains(sql, required) {
			t.Fatalf("missing %s", required)
		}
	}
	if strings.Contains(sql, "VIEW `target_enterprise`.`system_parameters`") || strings.Contains(sql, "VIEW `target_enterprise`.`service_command_receipt`") {
		t.Fatal("unscoped security table view")
	}
	if out.Installed || out.TargetVerified || out.BusinessMigrationApplied || len(out.Blockers) != 2 {
		t.Fatalf("candidate claims: %+v", out)
	}
	if out.PhysicalMappings["assets"]["system_parameters"] != "assets_system_parameters" || out.PhysicalMappings["aims"]["service_command_receipt"] != "aims_service_command_receipt" {
		t.Fatal("owning mapping missing")
	}
}
func TestCandidateRejectsStalePlanMissingViewAndUnsafeColumn(t *testing.T) {
	for _, mutate := range []func(*unified.Plan){
		func(p *unified.Plan) { p.Config.Generation++ },
		func(p *unified.Plan) { p.Tables = p.Tables[1:]; p.ReviewHash = unified.ReviewHash(*p) },
		func(p *unified.Plan) {
			p.Tables[0].Columns = []string{"id`;DROP TABLE other"}
			p.ReviewHash = unified.ReviewHash(*p)
		},
		func(p *unified.Plan) { p.Tables = append(p.Tables, p.Tables[0]); p.ReviewHash = unified.ReviewHash(*p) },
	} {
		p := fixturePlan()
		mutate(&p)
		raw, _ := json.Marshal(p)
		if _, _, err := Build(p, raw); err == nil {
			t.Fatal("invalid plan accepted")
		}
	}
}

func TestCandidateRequiresAllLinkReceiptOperations(t *testing.T) {
	for _, test := range []struct {
		ddl     string
		blocked bool
	}{
		{"assets-owned-command.v1", true},
		{"assets-owned-command.v1 assets.products.link-base.v1 assets.products.link-asset.v1", true},
		{"assets-owned-command.v1 assets.products.link-base.v1 assets.products.link-asset.v1 assets.products.link-document.v1", false},
		{"assets-owned-command.v1 assets.products.link-base.v1 assets.products.link-asset.v1 assets.products.link-document.v1 NOT ENFORCED", true},
	} {
		p := fixturePlan()
		for i := range p.Tables {
			if p.Tables[i].Domain == "assets" && p.Tables[i].Name == "service_command_receipt" {
				p.Tables[i].DDL = test.ddl
			}
		}
		p.ReviewHash = unified.ReviewHash(p)
		raw, _ := json.Marshal(p)
		out, _, err := Build(p, raw)
		if err != nil {
			t.Fatal(err)
		}
		found := false
		for _, b := range out.Blockers {
			if b == "assets-owned-product-link-receipt-source-migration-required" {
				found = true
			}
		}
		if found != test.blocked {
			t.Fatalf("incorrect link migration observation %+v", out.Blockers)
		}
		if out.TargetVerified || out.BusinessMigrationApplied {
			t.Fatal("metadata is not live acceptance")
		}
	}
}
