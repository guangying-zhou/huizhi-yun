package wizbiztool

import (
	"context"
	"encoding/json"
	"errors"
	"github.com/huizhi-yun/data-runtime/internal/config"
	"github.com/huizhi-yun/data-runtime/internal/enterprise"
	"os"
	"testing"
)

func addRegisteredLegacyIDFixture(t *testing.T, f *toolFixture) {
	t.Helper()
	table := "aims_aims_projects"
	if _, err := f.root.Exec("CREATE TABLE `" + f.profile.Database + "`." + table + "(id BIGINT PRIMARY KEY,contract_id BIGINT,customer_id BIGINT,contact_id BIGINT,bank_account_id BIGINT,legal_entity_id BIGINT)"); err != nil {
		t.Fatal(err)
	}
	if _, err := f.root.Exec("INSERT INTO `" + f.profile.Database + "`." + table + " VALUES(1,97,105,112,118,7)"); err != nil {
		t.Fatal(err)
	}
	d := enterprise.DomainBinding{OwnerDeployment: f.profile.EnterpriseDeployment, Read: enterprise.PathUnified, Write: enterprise.PathUnified, Scheduler: enterprise.PathDisabled, Tables: map[string]string{"projects": table}}
	f.binding.Domains["aims"] = d
	raw, err := os.ReadFile(f.profile.RuntimeConfig)
	if err != nil {
		t.Fatal(err)
	}
	var cfg config.Config
	if json.Unmarshal(raw, &cfg) != nil {
		t.Fatal("config")
	}
	cfg.Enterprise.Domains["aims"] = config.EnterpriseDomainConfig{OwnerDeployment: d.OwnerDeployment, Read: d.Read, Write: d.Write, Scheduler: d.Scheduler, Tables: d.Tables}
	if os.WriteFile(f.profile.RuntimeConfig, mustJSON(cfg), 0o600) != nil {
		t.Fatal("config_write")
	}
	if _, err = f.root.Exec("GRANT SELECT ON `" + f.profile.Database + "`." + table + " TO '" + f.profile.Target.User + "'@'localhost'"); err != nil {
		t.Fatal(err)
	}
}
func mustJSON(v any) []byte { raw, _ := json.Marshal(v); return raw }
func TestToolDeterministicIDAllocationMySQL(t *testing.T) {
	f := newToolFixture(t)
	addRegisteredLegacyIDFixture(t, f)
	e := newFixtureEngine(t, f)
	ctx := context.Background()
	for table, start := range map[string]string{"altoc_contract": "98", "altoc_customer": "106", "altoc_contact": "113", "finance_bank_account": "119", "finance_legal_entity": "8"} {
		if e.plan.IDAllocations[table].Start != start {
			t.Fatal("external numeric reference did not reserve ID range")
		}
	}
	first := factsHash(e.plan.IDAllocations)
	prepared, data, err := e.prepared(ctx)
	if err != nil {
		t.Fatal(err)
	}
	_ = prepared
	_ = data
	if first != factsHash(e.plan.IDAllocations) {
		t.Fatal("reconstruction changed ID plan")
	}
	if _, err = f.root.Exec("UPDATE `" + f.profile.Database + "`.aims_aims_projects SET contract_id=98 WHERE id=1"); err != nil {
		t.Fatal(err)
	}
	if _, err = e.apply(ctx); !errors.Is(err, ErrConflict) {
		t.Fatal("reference drift did not block apply", err)
	}
	var batches int
	f.target.QueryRow("SELECT COUNT(*) FROM mig_batch").Scan(&batches)
	if batches != 0 {
		t.Fatal("blocked apply left batch")
	}
	f.root.Exec("UPDATE `" + f.profile.Database + "`.aims_aims_projects SET contract_id=97 WHERE id=1")
	if _, err = e.apply(ctx); err != nil {
		t.Fatal(err)
	}
	if _, err = e.verify(ctx, func(context.Context, string, string, string) error { return nil }); err != nil {
		t.Fatal(err)
	}
	var id int
	f.target.QueryRow("SELECT id FROM altoc_contract WHERE code='CT-W000001'").Scan(&id)
	if id != 98 {
		t.Fatal("explicit deterministic contract ID not written")
	}
	if _, err = e.apply(ctx); err != nil {
		t.Fatal("replay", err)
	}
	f.root.Exec("UPDATE `" + f.profile.Database + "`.aims_aims_projects SET contract_id=98 WHERE id=1")
	if _, err = e.verify(ctx, func(context.Context, string, string, string) error { return nil }); !errors.Is(err, ErrConflict) {
		t.Fatal("new external reference accepted by verify", err)
	}
	f.root.Exec("UPDATE `" + f.profile.Database + "`.aims_aims_projects SET contract_id=97 WHERE id=1")
	receipt, err := e.rollback(ctx)
	if err != nil || receipt.Status != "rolled_back" || receipt.Retained != 0 {
		t.Fatal("ID collision avoidance failed rollback", receipt.Status, err)
	}
	var n int
	if f.target.QueryRow("SELECT COUNT(*) FROM aims_aims_projects WHERE contract_id=97").Scan(&n) != nil || n != 1 {
		t.Fatal("legacy reference changed")
	}
}
func TestIDAllocationGoldenAndOverflow(t *testing.T) {
	p := Prepared{Objects: []PreparedObject{{Table: "altoc_contract", SourceTable: "wb_contract", SourcePK: "2", Role: "primary", Values: map[string]any{}}, {Table: "altoc_contract", SourceTable: "wb_contract", SourcePK: "1", Role: "primary", Values: map[string]any{}}}}
	a := map[string]IDAllocation{"altoc_contract": {IDType: "bigint unsigned", Start: "98", IDs: map[string]string{}}}
	if allocateObjectIDs(&p, a, true) != nil || p.Objects[0].Values["id"] != "99" || p.Objects[1].Values["id"] != "98" {
		t.Fatal("deterministic ordering")
	}
	a["altoc_contract"] = IDAllocation{IDType: "tinyint unsigned", Start: "255", IDs: map[string]string{}}
	if !errors.Is(allocateObjectIDs(&p, a, true), ErrConflict) {
		t.Fatal("ID range overflow accepted")
	}
}

func TestIDTypeHandlesLegacyDisplayWidth(t *testing.T) {
	if !integerIDType(baseIDType("bigint(20) unsigned")) || idTypeLimit("int(11)").String() != "2147483647" || idTypeLimit("tinyint(3) unsigned").String() != "255" || idTypeLimit("") != nil {
		t.Fatal("legacy integer metadata or type bound rejected")
	}
}
