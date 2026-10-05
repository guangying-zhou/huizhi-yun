package main

import (
	"testing"

	e "github.com/huizhi-yun/data-runtime/internal/enterprise"
)

func TestViewsReviewHashBindsEveryInput(t *testing.T) {
	b := e.Binding{Key: e.BindingKey{Tenant: "T900001", Environment: "prod", RuntimeDeployment: "t900001-prod-tenant-runtime"}, Storage: e.Storage{Database: "hzy_enterprise_prod"}, Generation: 1}
	plans := map[string]e.CompatibilityViewPlan{"aims": {ReviewHash: "a"}, "assets": {ReviewHash: "b"}}
	base := viewsReviewHash("m", b, plans)
	if base != viewsReviewHash("m", b, map[string]e.CompatibilityViewPlan{"assets": {ReviewHash: "b"}, "aims": {ReviewHash: "a"}}) {
		t.Fatal("hash depends on map order")
	}
	other := b
	other.Key.Tenant = "C000001"
	for name, hash := range map[string]string{
		"migration": viewsReviewHash("x", b, plans),
		"binding":   viewsReviewHash("m", other, plans),
		"plan":      viewsReviewHash("m", b, map[string]e.CompatibilityViewPlan{"aims": {ReviewHash: "c"}, "assets": {ReviewHash: "b"}}),
	} {
		if hash == base {
			t.Fatal(name, "not bound")
		}
	}
	// The fixed C000001 final-test gate is unchanged.
	if c000001FinalMigrationHash != "f835241cf6ab0ea311b43b120cc88cdb73760e0295df05153510777200dea866" {
		t.Fatal("legacy C000001 final hash changed")
	}
}
