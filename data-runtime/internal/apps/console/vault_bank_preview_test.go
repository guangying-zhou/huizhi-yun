package console

import "testing"

func TestBankCustodyPreviewOnlyLastFour(t *testing.T) {
	for _, c := range []struct{ value, want string }{{"6222020200112233445", "***************3445"}, {"123", "***"}, {"1234", "****"}} {
		if bankAccountVaultPreview("bank_account_number", "finance_bank_account", "custody", "db_encrypted", map[string]any{"plaintext": c.value}, "old") != c.want {
			t.Fatal("bank preview exposes prefix")
		}
	}
	for _, c := range []struct{ kind, owner, usage, backend string }{{"token", "finance_bank_account", "custody", "db_encrypted"}, {"bank_account_number", "other", "custody", "db_encrypted"}, {"bank_account_number", "finance_bank_account", "service", "db_encrypted"}, {"bank_account_number", "finance_bank_account", "custody", "external"}} {
		if bankAccountVaultPreview(c.kind, c.owner, c.usage, c.backend, map[string]any{"plaintext": "fixture"}, "unchanged") != "unchanged" {
			t.Fatal("unrelated vault behavior changed")
		}
	}
}
