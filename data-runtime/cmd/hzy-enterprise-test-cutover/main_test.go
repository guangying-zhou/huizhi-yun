package main

import (
	"github.com/huizhi-yun/data-runtime/internal/migrations/unified"
	"testing"
)

func TestC000001CutoverGuards(t *testing.T) {
	c := unified.Config{Tenant: "C000001", Environment: "test", RuntimeDeployment: "c000001-test-tenant-runtime", InstanceID: "instance", SchemaVersion: "v1", Generation: 1, SourceAims: "hzy_aims_test_local_20260910", SourceAssets: "hzy_assets_test_local_20260910", Target: "hzy_enterprise_shadow_review_20260913"}
	p := unified.Plan{Version: "test", Config: c}
	p.ReviewHash = unified.ReviewHash(p)
	if err := validateC000001TestPlan(p, c, p.ReviewHash, "plan", false, ""); err != nil {
		t.Fatal(err)
	}
	for name, f := range map[string]func(*unified.Plan, string, bool, string){
		"wrong target":  func(p *unified.Plan, _ string, _ bool, _ string) { p.Config.Target = "hzy_enterprise_rehearsal" },
		"wrong source":  func(p *unified.Plan, _ string, _ bool, _ string) { p.Config.SourceAims = "other" },
		"missing apply": func(_ *unified.Plan, _ string, _ bool, _ string) {},
	} {
		t.Run(name, func(t *testing.T) {
			q := p
			f(&q, "", false, "")
			q.ReviewHash = unified.ReviewHash(q)
			if err := validateC000001TestPlan(q, q.Config, q.ReviewHash, "fence", false, ""); err == nil {
				t.Fatal("accepted")
			}
		})
	}
}
