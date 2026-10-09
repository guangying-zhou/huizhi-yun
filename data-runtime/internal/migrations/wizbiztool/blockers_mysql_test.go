package wizbiztool

import (
	"context"
	"errors"
	"testing"
)

func TestToolBlockersMySQL(t *testing.T) {
	for _, scenario := range []string{"unknown-table", "unknown-column", "source-write-privilege", "target-index", "target-column", "unknown-enum", "forbidden-vault", "same-name-customer", "same-contract-number", "same-account-short-name"} {
		t.Run(scenario, func(t *testing.T) {
			f := newToolFixture(t)
			ctx := context.Background()
			rootExec := func(schema, query string) {
				t.Helper()
				if _, err := f.root.Exec("USE `" + schema + "`"); err != nil {
					t.Fatal(err)
				}
				if _, err := f.root.Exec(query); err != nil {
					t.Fatal(err)
				}
			}
			// Root is used solely to manufacture a disposable fixture, never by tool.
			switch scenario {
			case "unknown-table":
				rootExec(f.profile.Source.Database, "CREATE TABLE unknown_source (id BIGINT PRIMARY KEY)")
			case "unknown-column":
				rootExec(f.profile.Source.Database, "ALTER TABLE wb_contactman ADD unknown_value INT NULL")
			case "source-write-privilege":
				rootExec(f.profile.Source.Database, "GRANT UPDATE ON `"+f.profile.Source.Database+"`.`wb_contactman` TO '"+f.profile.Source.User+"'@'localhost'")
			case "target-index":
				rootExec(f.profile.Database, "ALTER TABLE altoc_customer DROP INDEX idx_altoc_customer_owner")
			case "target-column":
				rootExec(f.profile.Database, "ALTER TABLE finance_bank_account MODIFY short_name VARCHAR(101) NOT NULL")
			case "unknown-enum":
				rootExec(f.profile.Source.Database, "UPDATE wb_contract SET contract_type='X'")
			case "forbidden-vault":
				f.profile.VaultWrite = "forbidden"
				f.profileHash = factsHash(f.profile)
			}
			source, err := OpenSourceSnapshot(ctx, f.source, f.profile.Source.Database)
			if scenario == "source-write-privilege" {
				if !errors.Is(err, ErrSourcePrivileges) {
					t.Fatal("write grant accepted")
				}
				return
			}
			if err != nil {
				t.Fatal(err)
			}
			defer source.Close()
			if err = source.AttachMetadata(ctx, f.metadata); err != nil {
				t.Fatal(err)
			}
			receipt, err := source.VerifyStage(ctx, f.manifest, f.manifestHash)
			if scenario == "unknown-table" || scenario == "unknown-column" {
				if !errors.Is(err, ErrStructure) {
					t.Fatal("schema drift accepted")
				}
				return
			}
			if err != nil {
				t.Fatal(err)
			}
			if scenario == "same-name-customer" || scenario == "same-contract-number" || scenario == "same-account-short-name" {
				rows, _, err := source.ReadCovered(ctx, f.manifest)
				if err != nil {
					t.Fatal(err)
				}
				p := f.profile
				p.snapshotAt = "2024-02-01 00:15:00.000"
				prepared, err := BuildPrepared(rows, p, map[string]IdentityState{})
				if err != nil {
					t.Fatal(err)
				}
				// Conflict detection is read-only and refuses unmatched existing facts.
				switch scenario {
				case "same-name-customer":
					rootExec(f.profile.Database, "INSERT INTO altoc_customer(code,name,owner_uid) VALUES('CU-OTHER','TEST Customer','TEST-OWNER')")
				case "same-contract-number":
					rootExec(f.profile.Database, "INSERT INTO altoc_customer(id,code,name,owner_uid) VALUES(999,'CU-OTHER','OTHER','TEST-OWNER')")
					rootExec(f.profile.Database, "INSERT INTO altoc_contract(code,name,customer_id,owner_uid,contract_no) VALUES('CT-OTHER','OTHER',999,'TEST-OWNER','TEST-C001')")
				case "same-account-short-name":
					rootExec(f.profile.Database, "INSERT INTO finance_bank_account(code,account_name,bank_name,short_name,account_type) VALUES('BA-OTHER','OTHER','TEST Bank','TEST','bank')")
				}
				if err := CheckConflicts(ctx, f.target, prepared); !errors.Is(err, ErrConflict) {
					t.Fatalf("unmapped collision accepted: %v", err)
				}
				return
			}
			_, err = BuildPlan(ctx, source, f.target, f.directory, f.profile, f.profileHash, f.manifest, f.manifestHash, receipt, map[string]IdentityConfirmation{}, f.identityHash, f.build)
			if err == nil {
				t.Fatal("blocker accepted")
			}
		})
	}
}
