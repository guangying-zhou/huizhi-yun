package main

import (
	"bytes"
	"encoding/json"
	"github.com/huizhi-yun/data-runtime/internal/config"
	"github.com/huizhi-yun/data-runtime/internal/enterprise/domaininstall"
	"testing"
)

func TestIncrementalProposalPreservesModesAndUnknownFields(t *testing.T) {
	_, raw, _, e := proposal(sourceFixture("isolated", "fixture", 3306), options{altocWrite: "unified", financeWrite: "unified"})
	if e != nil {
		t.Fatal(e)
	}
	var root, ent, domains, people map[string]json.RawMessage
	json.Unmarshal(raw, &root)
	json.Unmarshal(root["enterprise"], &ent)
	json.Unmarshal(ent["domains"], &domains)
	json.Unmarshal(domains["people"], &people)
	people["futureDomainSetting"] = json.RawMessage(`{"keep":true}`)
	domains["people"], _ = json.Marshal(people)
	ent["domains"], _ = json.Marshal(domains)
	root["enterprise"], _ = json.Marshal(ent)
	raw, _ = json.Marshal(root)
	o := options{subset: "people-private", altocWrite: "unified", financeWrite: "unified"}
	b, next, _, e := proposal(raw, o)
	if e != nil {
		t.Fatal(e)
	}
	var cfg config.Config
	json.Unmarshal(next, &cfg)
	if cfg.Enterprise.Domains["people"].Write != b.Domains["people"].Write || !bytes.Contains(next, []byte("futureDomainSetting")) {
		t.Fatal("mode/unknown field lost")
	}
	if _, _, _, e = proposal(next, o); e == nil {
		t.Fatal("duplicate extension")
	}
	if _, _, _, e = proposal(raw, options{subset: "finance-13b"}); e == nil {
		t.Fatal("missing dependency")
	}
	if _, _, _, e = proposal(raw, options{subset: "people-facts"}); e == nil {
		t.Fatal("private dependency")
	}
	if _, e = subsetInstaller("../finance-cost", domaininstall.Expectation{}); e == nil {
		t.Fatal("arbitrary subset")
	}
}

func TestSubsetFlagsCannotEnableWriteModes(t *testing.T) {
	args := []string{"--config", "source", "--migration-db-config", "migration", "--proposed-config", "candidate", "--plan", "plan", "--subset", "people-private"}
	if _, e := parse(args); e != nil {
		t.Fatal(e)
	}
	for _, flag := range []string{"--altoc-write", "--finance-write"} {
		if _, e := parse(append(append([]string{}, args...), flag, "unified")); e == nil {
			t.Fatal("incremental activation flag accepted", flag)
		}
	}
}

func TestTenderSubsetRequiresSalesAndPreservesBinding(t *testing.T) {
	_, base, _, err := proposal(sourceFixture("isolated", "fixture", 3306), options{altocWrite: "unified", financeWrite: "unified"})
	if err != nil {
		t.Fatal(err)
	}
	if _, _, _, err = proposal(base, options{subset: "altoc-tenders"}); err == nil {
		t.Fatal("tender without sales accepted")
	}
	salesBinding, sales, _, err := proposal(base, options{subset: "altoc-sales-B2"})
	if err != nil {
		t.Fatal(err)
	}
	tenderBinding, tender, _, err := proposal(sales, options{subset: "altoc-tenders"})
	if err != nil {
		t.Fatal(err)
	}
	if tenderBinding.Generation != salesBinding.Generation || tenderBinding.Domains["altoc"].Write != salesBinding.Domains["altoc"].Write || len(tenderBinding.Domains["altoc"].Tables) != len(salesBinding.Domains["altoc"].Tables)+4 {
		t.Fatal("tender binding changed identity/mode or unexpected table set")
	}
	for key, value := range salesBinding.Domains["altoc"].Tables {
		if tenderBinding.Domains["altoc"].Tables[key] != value {
			t.Fatal("existing mapping changed", key)
		}
	}
	if _, _, _, err = proposal(tender, options{subset: "altoc-tenders"}); err == nil {
		t.Fatal("duplicate tender accepted")
	}
	if subsetDomain("altoc-tenders") != "altoc" {
		t.Fatal("wrong domain")
	}
	if _, err = subsetInstaller("altoc-tenders", domaininstall.Expectation{}); err != nil {
		t.Fatal(err)
	}
}

func TestTicketsSubsetRequiresServices(t *testing.T) {
	_, base, _, e := proposal(sourceFixture("isolated", "fixture", 3306), options{altocWrite: "unified", financeWrite: "unified"})
	if e != nil {
		t.Fatal(e)
	}
	if _, _, _, e = proposal(base, options{subset: "altoc-tickets"}); e == nil {
		t.Fatal("missing predecessor accepted")
	}
	_, sales, _, e := proposal(base, options{subset: "altoc-sales-B2"})
	if e != nil {
		t.Fatal(e)
	}
	before, services, _, e := proposal(sales, options{subset: "altoc-services"})
	if e != nil {
		t.Fatal(e)
	}
	after, tickets, _, e := proposal(services, options{subset: "altoc-tickets"})
	if e != nil {
		t.Fatal(e)
	}
	if before.Generation != after.Generation || before.Domains["altoc"].Write != after.Domains["altoc"].Write || len(after.Domains["altoc"].Tables) != len(before.Domains["altoc"].Tables)+1 {
		t.Fatal("binding changed")
	}
	for k, v := range before.Domains["altoc"].Tables {
		if after.Domains["altoc"].Tables[k] != v {
			t.Fatal("mapping changed", k)
		}
	}
	if _, _, _, e = proposal(tickets, options{subset: "altoc-tickets"}); e == nil {
		t.Fatal("duplicate accepted")
	}
}

func TestRenewalSubsetRequiresServicesAndPreservesOtherDomains(t *testing.T) {
	_, base, _, e := proposal(sourceFixture("isolated", "fixture", 3306), options{altocWrite: "unified", financeWrite: "unified"})
	if e != nil {
		t.Fatal(e)
	}
	if _, _, _, e = proposal(base, options{subset: "altoc-renewals"}); e == nil {
		t.Fatal("missing services accepted")
	}
	_, sales, _, e := proposal(base, options{subset: "altoc-sales-B2"})
	if e != nil {
		t.Fatal(e)
	}
	services, raw, _, e := proposal(sales, options{subset: "altoc-services"})
	if e != nil {
		t.Fatal(e)
	}
	next, candidate, _, e := proposal(raw, options{subset: "altoc-renewals"})
	if e != nil {
		t.Fatal(e)
	}
	if domaininstall.IsAltocTicketsDomain(next.Domains["altoc"]) || domaininstall.IsAltocTendersDomain(next.Domains["altoc"]) {
		t.Fatal("renewal must not activate optional ticket/tender tables")
	}
	if next.Generation != services.Generation || next.Domains["altoc"].Write != services.Domains["altoc"].Write || len(next.Domains["altoc"].Tables) != len(services.Domains["altoc"].Tables)+1 {
		t.Fatal("binding changed")
	}
	if _, _, _, e = proposal(candidate, options{subset: "altoc-renewals"}); e == nil {
		t.Fatal("duplicate subset")
	}
}

func TestW1ClosedSubsetsAndBytePreservedColumnProposal(t *testing.T) {
	_, base, _, err := proposal(sourceFixture("isolated", "fixture", 3306), options{altocWrite: "unified", financeWrite: "unified"})
	if err != nil {
		t.Fatal(err)
	}
	for _, name := range []string{"w1-migration-ledger", "w1-finance-legal-entity", "w1-finance-balance-entry", "w1-altoc-contract-snapshot", "w1-altoc-customer-snapshot", "w1-finance-balance-columns", "w1-altoc-contract-columns", "w1-altoc-customer-columns", "w1-altoc-contact-columns"} {
		if _, err := subsetInstaller(name, domaininstall.Expectation{}); err != nil {
			t.Fatal(name, err)
		}
		b, out, _, err := proposal(base, options{subset: name, altocWrite: "disabled", financeWrite: "disabled"})
		if err != nil {
			t.Fatal(name, err)
		}
		if b.Generation != 7 {
			t.Fatal("generation changed")
		}
		if name == "w1-migration-ledger" && b.Domains["migration"].OwnerDeployment != owner {
			t.Fatal("migration namespace owner is not the Enterprise deployment")
		}
		if domaininstall.IsColumnSubset(name) && string(base) != string(out) {
			t.Fatal("column config bytes changed", name)
		}
	}
	source, _, _, err := proposal(base, options{altocWrite: "disabled", financeWrite: "disabled", subset: "w1-altoc-contract-columns"})
	if err != nil {
		t.Fatal(err)
	}
	// The owner is the reviewed Enterprise deployment, never read back from a domain.
	if _, err = extendSubset(source, "w1-finance-legal-entity", "another-deployment"); err == nil {
		t.Fatal("foreign owner accepted")
	}
	if _, err = extendSubset(source, "w1-finance-legal-entity", owner); err != nil {
		t.Fatal(err)
	}
	if _, err := subsetInstaller("w1-arbitrary-table", domaininstall.Expectation{}); err == nil {
		t.Fatal("arbitrary subset accepted")
	}
}
