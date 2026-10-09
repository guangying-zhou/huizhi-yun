package wizbiztool

import "testing"

func TestVaultUpgradeMaterialMACIsKeyedAndContextBound(t *testing.T) {
	v := &runtimeVault{upgradeKey: []byte("synthetic-fixture-key")}
	a := v.upgradeMaterialMAC("batch", "account", "synthetic-account")
	if !validHash(a) || a == Digest([]byte("synthetic-account")) {
		t.Fatal("unkeyed material digest")
	}
	for _, b := range []string{v.upgradeMaterialMAC("other", "account", "synthetic-account"), v.upgradeMaterialMAC("batch", "other", "synthetic-account"), v.upgradeMaterialMAC("batch", "account", " synthetic-account "), (&runtimeVault{upgradeKey: []byte("other-fixture-key")}).upgradeMaterialMAC("batch", "account", "synthetic-account")} {
		if a == b {
			t.Fatal("material MAC lost binding")
		}
	}
	if (&runtimeVault{}).upgradeMaterialMAC("batch", "account", "synthetic-account") != "" {
		t.Fatal("missing key accepted")
	}
}
