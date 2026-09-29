package main

import (
	"crypto/ed25519"
	"crypto/rand"
	"encoding/base64"
	"testing"

	"github.com/huizhi-yun/data-runtime/internal/migrations/cutoverprofile"
	"github.com/huizhi-yun/data-runtime/internal/migrations/unified"
)

func syntheticProfile() cutoverprofile.Profile {
	public, _, _ := ed25519.GenerateKey(rand.Reader)
	return cutoverprofile.Profile{Version: cutoverprofile.Version, Tenant: "T900001", Environment: "prod", RuntimeDeployment: "t900001-prod-tenant-runtime", EnterpriseDeployment: "T900001-prod-enterprise", SourceDeployments: map[string]string{"aims": "T900001-prod-aims", "assets": "T900001-prod-assets"}, InstanceID: "instance", SchemaVersion: "v1", Generation: 1, SourceAims: "hzy_aims_restore", SourceAssets: "hzy_assets_restore", Target: "hzy_enterprise_prod", CutoverKey: "cutover-1", Connection: cutoverprofile.Connection{Host: "127.0.0.1", Port: 3306, User: "hzy_cutover"}, Platform: cutoverprofile.Platform{KeyID: "kid", PublicKey: base64.RawURLEncoding.EncodeToString(public)}}
}

// The legacy fixed C000001 guard is unchanged: a profile tenant plan is still
// refused without --profile, and a C000001 plan is refused by a profile for
// another tenant.
func TestProfileModeKeepsLegacyGuardAndBindsTenant(t *testing.T) {
	prof := syntheticProfile()
	p := unified.Plan{Version: "test", Config: prof.Migration()}
	p.ReviewHash = unified.ReviewHash(p)
	if err := validateC000001TestPlan(p, p.Config, p.ReviewHash, "fence", true, "cutover-1"); err == nil {
		t.Fatal("legacy path accepted a non-C000001 plan")
	}
	if err := validateProfilePlan(prof, p, p.ReviewHash, "fence", true, ""); err != nil {
		t.Fatal(err)
	}
	if err := validateProfilePlan(prof, p, p.ReviewHash, "plan", false, ""); err != nil {
		t.Fatal(err)
	}
	for name, err := range map[string]error{
		"missing apply":    validateProfilePlan(prof, p, p.ReviewHash, "install-fence", false, ""),
		"missing review":   validateProfilePlan(prof, p, "", "fence", true, ""),
		"incorrect review": validateProfilePlan(prof, p, "0000", "fence", true, ""),
		"other key":        validateProfilePlan(prof, p, p.ReviewHash, "fence", true, "other-key"),
	} {
		if err == nil {
			t.Fatal(name, "accepted")
		}
	}
	legacy := unified.Plan{Version: "test", Config: unified.Config{Tenant: "C000001", Environment: "test", RuntimeDeployment: "c000001-test-tenant-runtime", InstanceID: "instance", SchemaVersion: "v1", Generation: 1, SourceAims: "hzy_aims_test_local_20260910", SourceAssets: "hzy_assets_test_local_20260910", Target: "hzy_enterprise_shadow_review_20260913"}}
	legacy.ReviewHash = unified.ReviewHash(legacy)
	if err := validateC000001TestPlan(legacy, legacy.Config, legacy.ReviewHash, "fence", true, "cutover-1"); err != nil {
		t.Fatal("legacy C000001 plan rejected", err)
	}
	if err := validateProfilePlan(prof, legacy, legacy.ReviewHash, "fence", true, ""); err == nil {
		t.Fatal("cross-tenant plan accepted by profile")
	}
}
