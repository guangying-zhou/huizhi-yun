package main

import (
	e "github.com/huizhi-yun/data-runtime/internal/enterprise"
	"testing"
)

func TestFinalTestTargetGuards(t *testing.T) {
	c := rehearsalConfig{}
	c.Migration.Tenant = "C000001"
	c.Migration.Environment = "test"
	c.Migration.RuntimeDeployment = "c000001-test-tenant-runtime"
	c.Migration.SourceAims = "hzy_aims_test_local_20260910"
	c.Migration.SourceAssets = "hzy_assets_test_local_20260910"
	b := e.Binding{Key: e.BindingKey{Tenant: "C000001", Environment: "test", RuntimeDeployment: "c000001-test-tenant-runtime"}, Storage: e.Storage{Database: "hzy_enterprise_shadow_review_20260913"}}
	if err := validateFinalTestTarget(c, b, c000001FinalMigrationHash, true, true); err != nil {
		t.Fatal(err)
	}
	if err := validateFinalTestTarget(c, b, c000001FinalMigrationHash, true, false); err == nil {
		t.Fatal("missing apply accepted")
	}
	if err := validateFinalTestTarget(c, b, c000001FinalMigrationHash, false, false); err == nil {
		t.Fatal("final target accepted without explicit final-test-target mode")
	}
	b.Storage.Database = "rehearsal"
	if err := validateFinalTestTarget(c, b, c000001FinalMigrationHash, false, true); err == nil {
		t.Fatal("apply accepted outside final-test-target mode")
	}
	b.Storage.Database = "hzy_enterprise_shadow_review_20260913"
	if err := validateFinalTestTarget(c, b, "bad", true, true); err == nil {
		t.Fatal("wrong hash accepted")
	}
	b.Storage.Database = "rehearsal"
	if err := validateFinalTestTarget(c, b, c000001FinalMigrationHash, true, true); err == nil {
		t.Fatal("wrong target accepted")
	}
	b.Storage.Database = "hzy_enterprise_shadow_review_20260913"
	c.Migration.SourceAims = "wrong_source"
	if err := validateFinalTestTarget(c, b, c000001FinalMigrationHash, true, true); err == nil {
		t.Fatal("wrong source accepted")
	}
	c.Migration.SourceAims = "hzy_aims_test_local_20260910"
	b.Key.RuntimeDeployment = "wrong-runtime"
	if err := validateFinalTestTarget(c, b, c000001FinalMigrationHash, true, true); err == nil {
		t.Fatal("wrong runtime binding accepted")
	}
}
