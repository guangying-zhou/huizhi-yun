package enterpriseapf

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"strings"
	"testing"

	"github.com/huizhi-yun/data-runtime/internal/enterprise"
	"github.com/huizhi-yun/data-runtime/internal/enterprise/domaininstall"
	"github.com/huizhi-yun/data-runtime/internal/httperror"
)

// W3: legal entity directory and the account fields added by W1, in both the
// installed and the not-installed state.
func TestAPFW3LegalEntityAndAccountFieldsMySQL(t *testing.T) {
	for _, installed := range []bool{false, true} {
		name := "not-installed"
		if installed {
			name = "installed"
		}
		t.Run(name, func(t *testing.T) {
			s, db := financeFixture(t)
			ctx := context.Background()
			if installed {
				for _, table := range domaininstall.W1Tables("w1-finance-legal-entity") {
					if _, e := db.Exec(table.DDL); e != nil {
						t.Fatal(e)
					}
				}
				b, e := domaininstall.WithW1(s.binding, "w1-finance-legal-entity", "host-test")
				if e != nil {
					t.Fatal(e)
				}
				registry := enterprise.NewRegistry(func(context.Context, enterprise.Storage) (*sql.DB, error) { return db, nil })
				if e = registry.Register(ctx, b); e != nil {
					t.Fatal(e)
				}
				if s, e = New(registry, b); e != nil {
					t.Fatal(e)
				}
			} else {
				for _, q := range []string{"ALTER TABLE finance_bank_account DROP INDEX uk_finance_bank_account_short_name", "ALTER TABLE finance_bank_account DROP INDEX idx_finance_bank_account_entity", "ALTER TABLE finance_bank_account DROP COLUMN short_name, DROP COLUMN bank_branch_code, DROP COLUMN legal_entity_code, DROP COLUMN sort_no, DROP COLUMN account_subtype"} {
					if _, e := db.Exec(q); e != nil {
						t.Fatal(e)
					}
				}
			}
			n := 0
			call := func(op string, i FinanceInput) (map[string]any, error) {
				n++
				who := Identity{Actor: "person", Tenant: "C000001", Deployment: "host-test", Client: "enterprise.runtime", Key: "w3-" + op + "-" + string(rune('a'+n)), RequestID: "isolated"}
				out, e := s.Finance(ctx, op, i, who)
				if e != nil {
					return nil, e
				}
				return out.(map[string]any), nil
			}
			must := func(op string, i FinanceInput) map[string]any {
				t.Helper()
				out, e := call(op, i)
				if e != nil {
					t.Fatal(op, e)
				}
				return out
			}
			refused := func(e error, status int, code string) {
				t.Helper()
				var he httperror.Error
				if !errors.As(e, &he) || he.Status != status || he.Code != code {
					t.Fatal("expected", status, code, "got", e)
				}
			}
			account := must("accounts-create", accountInput())["data"].(map[string]any)
			code := account["code"].(string)
			if _, leaked := account["account_no_secret_ref"]; leaked {
				t.Fatal("secret ref returned")
			}

			if !installed {
				// The directory is absent: 503, never a silent empty list or a 403.
				_, e := call("legal-entities-list", FinanceInput{Page: 1, PageSize: 20})
				refused(e, 503, "finance_legal_entity_unavailable")
				_, e = call("legal-entities-create", FinanceInput{Payload: map[string]any{"name": "Marked entity"}})
				refused(e, 503, "finance_legal_entity_unavailable")
				// Accounts keep working exactly as before and expose no new keys.
				for _, k := range bankW1Columns {
					if _, ok := account[k]; ok {
						t.Fatal("uninstalled column returned", k)
					}
				}
				listed := must("accounts-list", FinanceInput{Page: 1, PageSize: 20, Search: "isolated"})
				if listed["total"] != int64(1) {
					t.Fatal("account list", listed["total"])
				}
				must("accounts-update", FinanceInput{Code: code, Payload: map[string]any{"expectedVersion": float64(1), "bankName": "Marked bank"}})
				_, e = call("accounts-update", FinanceInput{Code: code, Payload: map[string]any{"expectedVersion": float64(2), "shortName": "main"}})
				refused(e, 409, "finance_account_fields_unavailable")
				return
			}

			// Legal entities.
			if total := must("legal-entities-list", FinanceInput{Page: 1, PageSize: 20})["total"]; total != int64(0) {
				t.Fatal("empty directory", total)
			}
			entity := must("legal-entities-create", FinanceInput{Payload: map[string]any{"name": "Marked entity", "shortName": "ME", "entityType": "company", "sortNo": float64(2)}})["data"].(map[string]any)
			entityCode := entity["code"].(string)
			if !strings.HasPrefix(entityCode, "ENT-") || strings.HasPrefix(entityCode, "ENT-W") || entity["status"] != "active" || entity["row_version"] != float64(1) {
				t.Fatal("entity", entity)
			}
			_, e := call("legal-entities-create", FinanceInput{Payload: map[string]any{"name": "Marked entity"}})
			refused(e, 409, "finance_legal_entity_name_exists")
			second := must("legal-entities-create", FinanceInput{Payload: map[string]any{"name": "Second entity", "sortNo": float64(1)}})["data"].(map[string]any)
			_, e = call("legal-entities-update", FinanceInput{Code: second["code"].(string), Payload: map[string]any{"expectedVersion": float64(1), "name": "Marked entity"}})
			refused(e, 409, "finance_legal_entity_name_exists")
			listed := must("legal-entities-list", FinanceInput{Page: 1, PageSize: 20})
			if rows := listed["data"].([]map[string]any); listed["total"] != int64(2) || rows[0]["name"] != "Second entity" {
				t.Fatal("entity order by sort_no", listed)
			}
			if found := must("legal-entities-list", FinanceInput{Page: 1, PageSize: 20, Search: "ME"}); found["total"] != int64(1) {
				t.Fatal("search by short name", found["total"])
			}
			if viewed := must("legal-entities-view", FinanceInput{Code: entityCode})["data"].(map[string]any); viewed["short_name"] != "ME" {
				t.Fatal("view", viewed)
			}
			_, e = call("legal-entities-update", FinanceInput{Code: entityCode, Payload: map[string]any{"expectedVersion": float64(9), "remark": "stale"}})
			refused(e, 409, "finance_version_conflict")
			var audits int
			if e = db.QueryRow("SELECT COUNT(*) FROM finance_audit_log WHERE entity_type='legal_entity' AND entity_code=?", entityCode).Scan(&audits); e != nil || audits != 1 {
				t.Fatal("entity audit", audits, e)
			}

			// Account fields.
			updated := must("accounts-update", FinanceInput{Code: code, Payload: map[string]any{"expectedVersion": float64(1), "shortName": "main", "bankBranchCode": "102100099996", "legalEntityCode": entityCode, "sortNo": float64(3), "accountSubtype": "basic"}})["data"].(map[string]any)
			for _, op := range []string{"legal-entities-view", "legal-entities-list"} {
				input := FinanceInput{Code: entityCode, Page: 1, PageSize: 20}
				if op == "legal-entities-list" {
					input.Code = ""
				} else {
					input.Page, input.PageSize = 0, 0
				}
				result := must(op, input)
				var item map[string]any
				if op == "legal-entities-view" {
					item = result["data"].(map[string]any)
				} else {
					item = result["data"].([]map[string]any)[0]
				}
				if _, present := item["account_count"]; present {
					t.Fatal("account count without bank view", item)
				}
			}
			if entity := must("legal-entities-view", FinanceInput{Code: entityCode, AccountCountAllowed: true})["data"].(map[string]any); entity["account_count"] != int64(1) {
				t.Fatal("linked account count", entity)
			}
			if updated["short_name"] != "main" || updated["legal_entity_code"] != entityCode || updated["account_subtype"] != "basic" || updated["bank_branch_code"] != "102100099996" {
				t.Fatal("account fields", updated)
			}
			if _, leaked := updated["account_no_secret_ref"]; leaked {
				t.Fatal("secret ref returned")
			}
			other := accountInput()
			other.Payload["accountName"] = "cash box"
			other.Payload["accountType"] = "cash"
			other.Payload["accountNoMasked"] = nil
			cash := must("accounts-create", other)["data"].(map[string]any)
			cashCode := cash["code"].(string)
			_, e = call("accounts-update", FinanceInput{Code: cashCode, Payload: map[string]any{"expectedVersion": float64(1), "shortName": "main"}})
			refused(e, 409, "finance_account_short_name_exists")
			_, e = call("accounts-update", FinanceInput{Code: cashCode, Payload: map[string]any{"expectedVersion": float64(1), "accountSubtype": "basic"}})
			refused(e, 409, "finance_account_subtype_invalid")
			// Changing a bank account with a subtype into a cash account is refused too.
			_, e = call("accounts-update", FinanceInput{Code: code, Payload: map[string]any{"expectedVersion": float64(2), "accountType": "cash"}})
			refused(e, 409, "finance_account_subtype_invalid")
			_, e = call("accounts-update", FinanceInput{Code: cashCode, Payload: map[string]any{"expectedVersion": float64(1), "legalEntityCode": "ENT-missing"}})
			refused(e, 409, "finance_legal_entity_invalid")
			// A disabled entity keeps its accounts but cannot be chosen for another one.
			must("legal-entities-update", FinanceInput{Code: entityCode, Payload: map[string]any{"expectedVersion": float64(1), "status": "inactive"}})
			_, e = call("accounts-update", FinanceInput{Code: cashCode, Payload: map[string]any{"expectedVersion": float64(1), "legalEntityCode": entityCode}})
			refused(e, 409, "finance_legal_entity_invalid")
			if kept := must("accounts-view", FinanceInput{Code: code})["data"].(map[string]any); kept["legal_entity_code"] != entityCode {
				t.Fatal("existing link lost", kept)
			}
			// Clearing the link and the short name is allowed.
			cleared := must("accounts-update", FinanceInput{Code: code, Payload: map[string]any{"expectedVersion": float64(2), "legalEntityCode": nil, "shortName": nil}})["data"].(map[string]any)
			if cleared["legal_entity_code"] != nil || cleared["short_name"] != nil {
				t.Fatal("not cleared", cleared)
			}
		})
	}
}

// W3: showing a full account number. The vault is a stub here; its own
// owner-bound rules are covered by the Console package test.
func TestAPFW3RevealAccountNoMySQL(t *testing.T) {
	s, db := financeFixture(t)
	ctx := context.Background()
	who := Identity{Actor: "finance-admin", Tenant: "C000001", Deployment: "host-test", Client: "enterprise.runtime", Key: "create", RequestID: "request-1"}
	out, e := s.Finance(ctx, "accounts-create", accountInput(), who)
	if e != nil {
		t.Fatal(e)
	}
	code := out.(map[string]any)["data"].(map[string]any)["code"].(string)
	const synthetic = "TEST-ACCOUNT-0000000000001234"
	type call struct{ code, kind, ownerType, ownerKey, actor, reason, ip string }
	var calls []call
	var vaultErr error
	vault := func(_ context.Context, secretCode, secretType, ownerType, ownerKey, actor, reason string, access AccountNoAccess) (string, error) {
		calls = append(calls, call{secretCode, secretType, ownerType, ownerKey, actor, reason, access.RequestIP})
		if vaultErr != nil {
			return "", vaultErr
		}
		return synthetic, nil
	}
	reveal := func(account string, payload map[string]any) (map[string]any, error) {
		who := who
		who.Key = ""
		signed := map[string]any{"clientIp": "203.0.113.7", "userAgent": "fixture"}
		for k, v := range payload {
			signed[k] = v
		}
		v, e := s.FinanceRevealAccountNo(ctx, FinanceInput{Code: account, Payload: signed}, who)
		if e != nil {
			return nil, e
		}
		return v.(map[string]any)["data"].(map[string]any), nil
	}
	refused := func(e error, status int, code string) {
		t.Helper()
		var he httperror.Error
		if !errors.As(e, &he) || he.Status != status || he.Code != code {
			t.Fatal("expected", status, code, "got", e)
		}
	}
	audits := func() int {
		t.Helper()
		var n int
		if e := db.QueryRow("SELECT COUNT(*) FROM finance_audit_log WHERE entity_type='bank_account' AND action='reveal_account_no'").Scan(&n); e != nil {
			t.Fatal(e)
		}
		return n
	}
	reason := map[string]any{"reason": "monthly reconciliation"}

	// Without the vault dependency: 503, not a permission error, and no audit row.
	_, e = reveal(code, reason)
	refused(e, 503, "finance_account_vault_unavailable")
	s.ConfigureAccountNoVault(vault)

	// No stored reference: nothing to show, vault not asked.
	_, e = reveal(code, reason)
	refused(e, 404, "finance_account_no_absent")
	_, e = reveal("BA-missing", reason)
	refused(e, 404, "finance_object_not_found")

	// A reference pointing anywhere else is refused before the vault is asked.
	for _, ref := range []string{"hzybase://vault/console.oidc.signing-key", "hzybase://vault/" + AccountNoSecretCode("BA-other"), AccountNoSecretCode(code), "hzybase://vault/" + AccountNoSecretCode(code) + "@v1"} {
		if _, e = db.Exec("UPDATE finance_bank_account SET account_no_secret_ref=? WHERE code=?", ref, code); e != nil {
			t.Fatal(e)
		}
		_, e = reveal(code, reason)
		refused(e, 409, "finance_account_no_ref_invalid")
	}
	if len(calls) != 0 || audits() != 0 {
		t.Fatal("vault asked or audit written for a refused reveal", calls, audits())
	}

	// The account's own reference.
	if _, e = db.Exec("UPDATE finance_bank_account SET account_no_secret_ref=? WHERE code=?", "hzybase://vault/"+AccountNoSecretCode(code), code); e != nil {
		t.Fatal(e)
	}
	for name, payload := range map[string]map[string]any{"no reason": {"versionNo": float64(1)}, "short reason": {"reason": "abc"}, "extra field": {"reason": "monthly reconciliation", "versionNo": float64(1)}, "non-string": {"reason": float64(1)}} {
		if _, e = reveal(code, payload); e == nil {
			t.Fatal(name)
		}
	}
	data, e := reveal(code, reason)
	if e != nil || data["accountNo"] != synthetic || data["code"] != code {
		t.Fatal("reveal", data, e)
	}
	want := call{AccountNoSecretCode(code), "bank_account_number", "finance_bank_account", code, "finance-admin", "monthly reconciliation", "203.0.113.7"}
	if len(calls) != 1 || calls[0] != want {
		t.Fatal("vault call", calls)
	}
	var operator, value, request string
	if e = db.QueryRow("SELECT operator_uid,new_value,request_id FROM finance_audit_log WHERE entity_type='bank_account' AND action='reveal_account_no' AND entity_code=?", code).Scan(&operator, &value, &request); e != nil || operator != "finance-admin" || request != "request-1" || !strings.Contains(value, "monthly reconciliation") || strings.Contains(value, synthetic) {
		t.Fatal("business audit", operator, value, request, e)
	}
	// Every view is a new audited access: no replay, no cached plaintext.
	if _, e = reveal(code, reason); e != nil || len(calls) != 2 || audits() != 2 {
		t.Fatal("second reveal", e, len(calls), audits())
	}
	var stored int
	if e = db.QueryRow("SELECT COUNT(*) FROM finance_audit_log WHERE new_value LIKE ? OR old_value LIKE ?", "%"+synthetic+"%", "%"+synthetic+"%").Scan(&stored); e != nil || stored != 0 {
		t.Fatal("plaintext stored in Finance", stored, e)
	}
	// Ordinary reads still never return the reference or the number.
	account, e := s.Finance(ctx, "accounts-view", FinanceInput{Code: code}, who)
	if raw := fmt.Sprint(account); e != nil || strings.Contains(raw, "hzybase://") || strings.Contains(raw, synthetic) {
		t.Fatal("account read leaks", raw, e)
	}

	// Vault outcomes: missing secret is 404; any other failure is 503, never 403.
	vaultErr = httperror.New(404, "console_vault_secret_not_found", "Vault secret was not found")
	_, e = reveal(code, reason)
	refused(e, 404, "finance_account_no_absent")
	vaultErr = errors.New("decrypt failed")
	_, e = reveal(code, reason)
	refused(e, 503, "finance_account_vault_unavailable")
	// Attempts are audited even when the vault then fails.
	if audits() != 4 {
		t.Fatal("attempt audit", audits())
	}
	// Identity binding.
	bad := who
	bad.Client = "other.client"
	full := map[string]any{"reason": "monthly reconciliation", "clientIp": "203.0.113.7", "userAgent": "fixture"}
	if _, e = s.FinanceRevealAccountNo(ctx, FinanceInput{Code: code, Payload: full}, bad); e == nil {
		t.Fatal("foreign client accepted")
	}
	// The client address is part of the signed command and must be a real address.
	for name, ip := range map[string]any{"missing": nil, "hostname": "evil.example", "list": "203.0.113.7, 10.0.0.1", "number": float64(1)} {
		p := map[string]any{"reason": "monthly reconciliation", "userAgent": "fixture"}
		if ip != nil {
			p["clientIp"] = ip
		}
		if _, e = s.FinanceRevealAccountNo(ctx, FinanceInput{Code: code, Payload: p}, who); e == nil {
			t.Fatal("client address", name)
		}
	}
	var ip string
	if e = db.QueryRow("SELECT operator_ip FROM finance_audit_log WHERE action='reveal_account_no' ORDER BY id LIMIT 1").Scan(&ip); e != nil || ip != "203.0.113.7" {
		t.Fatal("business audit address", ip, e)
	}

	// Hourly limit per person: the 21st attempt is refused, audited as such, and
	// the vault is not asked; another person is unaffected; old attempts expire.
	vaultErr = nil
	before := len(calls)
	for n := audits(); n < accountNoRevealHourlyLimit; n++ {
		if _, e = reveal(code, reason); e != nil {
			t.Fatal("within limit", n, e)
		}
	}
	asked := len(calls)
	if asked-before != accountNoRevealHourlyLimit-4 {
		t.Fatal("vault calls within limit", asked-before)
	}
	_, e = reveal(code, reason)
	refused(e, 429, "finance_account_no_reveal_rate_limited")
	var limited int
	if e = db.QueryRow("SELECT COUNT(*) FROM finance_audit_log WHERE action='reveal_account_no_rate_limited' AND operator_uid='finance-admin'").Scan(&limited); e != nil || limited != 1 || len(calls) != asked || audits() != accountNoRevealHourlyLimit {
		t.Fatal("limit audit", limited, len(calls)-asked, audits(), e)
	}
	other := who
	other.Actor = "second-admin"
	if _, e = s.FinanceRevealAccountNo(ctx, FinanceInput{Code: code, Payload: full}, other); e != nil {
		t.Fatal("another person limited", e)
	}
	if _, e = db.Exec("UPDATE finance_audit_log SET created_at=DATE_SUB(created_at,INTERVAL 2 HOUR) WHERE operator_uid='finance-admin'"); e != nil {
		t.Fatal(e)
	}
	if _, e = reveal(code, reason); e != nil {
		t.Fatal("limit did not expire", e)
	}
	// The named lock is released on every path; a held lock would block here.
	var free sql.NullInt64
	if e = db.QueryRow("SELECT COUNT(*) FROM performance_schema.metadata_locks WHERE OBJECT_TYPE='USER LEVEL LOCK'").Scan(&free); e != nil || free.Int64 != 0 {
		t.Fatal("reveal lock still held", free, e)
	}
}
