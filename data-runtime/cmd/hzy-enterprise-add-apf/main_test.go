package main

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"net"
	"os"
	"path/filepath"
	"reflect"
	"strings"
	"syscall"
	"testing"

	"github.com/huizhi-yun/data-runtime/internal/config"
	"github.com/huizhi-yun/data-runtime/internal/enterprise"
)

func sourceFixture(database, instance string, port int) []byte {
	cfg := config.Config{Tenant: "C000001", Deployment: "c000001-test-tenant-runtime", DeploymentBindings: map[string]string{"enterprise": owner}, Server: config.ServerConfig{Host: "127.0.0.1", Port: 18084}, Enterprise: config.EnterpriseConfig{Enabled: true, Environment: "test", SchemaVersion: "v1", Generation: 7, InstanceID: instance, DB: config.DBConfig{Host: "127.0.0.1", Port: port, Database: database, User: "runtime_read_write", Password: "fixture-runtime-only", ConnectionLimit: 1}, Domains: map[string]config.EnterpriseDomainConfig{
		"aims":   {OwnerDeployment: owner, Tables: map[string]string{"projects": "aims_projects"}, Read: enterprise.PathUnified, Write: enterprise.PathUnified, Scheduler: enterprise.PathUnified},
		"assets": {OwnerDeployment: owner, Tables: map[string]string{"products": "assets_products"}, Read: enterprise.PathUnified, Write: enterprise.PathUnified, Scheduler: enterprise.PathDisabled},
	}}}
	raw, _ := json.Marshal(cfg)
	var fields map[string]json.RawMessage
	_ = json.Unmarshal(raw, &fields)
	fields["futureSetting"] = json.RawMessage(`{"retain":"future-value"}`)
	raw, _ = json.Marshal(fields)
	return raw
}
func TestProposedConfigurationAndReviewBinding(t *testing.T) {
	raw := sourceFixture("isolated", "fixture", 3306)
	o := options{altocWrite: "unified", financeWrite: "unified"}
	b, candidate, _, err := proposal(raw, o)
	if err != nil {
		t.Fatal(err)
	}
	var original, proposed config.Config
	_ = json.Unmarshal(raw, &original)
	_ = json.Unmarshal(candidate, &proposed)
	for _, domain := range []string{"aims", "assets"} {
		if !reflect.DeepEqual(proposed.Enterprise.Domains[domain], original.Enterprise.Domains[domain]) {
			t.Fatal("existing domain changed")
		}
	}
	if proposed.Enterprise.Generation != 7 || proposed.Enterprise.SchemaVersion != "v1" || !bytes.Contains(candidate, []byte("future-value")) {
		t.Fatal("configuration lost frozen fields")
	}
	for _, domain := range []string{"altoc", "finance", "people"} {
		install := b.Domains[domain]
		d := proposed.Enterprise.Domains[domain]
		if install.Write != enterprise.PathDisabled || d.Read != enterprise.PathUnified || d.Scheduler != enterprise.PathDisabled || d.OwnerDeployment != owner {
			t.Fatal("unsafe installation mode")
		}
		if (domain == "people" && d.Write != enterprise.PathDisabled) || (domain != "people" && d.Write != enterprise.PathUnified) {
			t.Fatal("wrong proposed mode")
		}
	}
	p := reviewPlan{Version: planVersion, SourceSHA256: digest(raw), ProposedSHA256: digest(candidate), AltocWrite: enterprise.PathUnified, FinanceWrite: enterprise.PathUnified}
	p.Installation.Binding = b
	p.ReviewHash = reviewHash(p)
	o.review = p.ReviewHash
	if validatePlan(p, b, raw, candidate, o) != nil {
		t.Fatal("review rejected")
	}
	for _, mutate := range []func(*reviewPlan){func(p *reviewPlan) { p.SourceSHA256 = "changed" }, func(p *reviewPlan) { p.ProposedSHA256 = "changed" }, func(p *reviewPlan) { p.Installation.Binding.Generation++ }, func(p *reviewPlan) { p.FinanceWrite = enterprise.PathDisabled }, func(p *reviewPlan) { p.Version = "other" }} {
		changedRaw, _ := json.Marshal(p)
		var changed reviewPlan
		_ = json.Unmarshal(changedRaw, &changed)
		mutate(&changed)
		if validatePlan(changed, b, raw, candidate, o) == nil {
			t.Fatal("review tamper accepted")
		}
	}
	o.financeWrite = "disabled"
	if validatePlan(p, b, raw, candidate, o) == nil {
		t.Fatal("write flag changed without review")
	}
	var fields map[string]json.RawMessage
	_ = json.Unmarshal(candidate, &fields)
	fields["futureSetting"] = json.RawMessage(`{"retain":"changed"}`)
	edited, _ := json.Marshal(fields)
	if validatePlan(p, b, raw, edited, o) == nil {
		t.Fatal("candidate changed without review")
	}
}
func TestConfigurationRejectsOldDomainsAndRemoteIdentity(t *testing.T) {
	raw := sourceFixture("isolated", "fixture", 3306)
	o := options{altocWrite: "unified", financeWrite: "unified"}
	for _, domain := range []string{"altoc", "finance", "people"} {
		var cfg config.Config
		_ = json.Unmarshal(raw, &cfg)
		cfg.Enterprise.Domains[domain] = cfg.Enterprise.Domains["aims"]
		legacy, _ := json.Marshal(cfg)
		if _, _, _, err := proposal(legacy, o); err == nil {
			t.Fatal("registered old/APF domain replaced", domain)
		}
	}
	for _, change := range []func(*config.Config){func(c *config.Config) { c.Tenant = "other" }, func(c *config.Config) { c.Enterprise.Environment = "prod" }, func(c *config.Config) { c.Server.Port = 18085 }, func(c *config.Config) { c.Enterprise.DB.Host = "remote" }, func(c *config.Config) { c.Enterprise.Generation = 0 }, func(c *config.Config) { c.DeploymentBindings["enterprise"] = "other" }} {
		var cfg config.Config
		_ = json.Unmarshal(raw, &cfg)
		change(&cfg)
		bad, _ := json.Marshal(cfg)
		if _, _, _, err := proposal(bad, o); err == nil {
			t.Fatal("identity change accepted")
		}
	}
}
func TestMigrationAccountAndSafeOptions(t *testing.T) {
	r := config.DBConfig{Host: "127.0.0.1", Port: 3306, Database: "unified", User: "runtime"}
	a := r
	a.User = "migration"
	if _, err := migrationConnection(r, a); err != nil {
		t.Fatal(err)
	}
	for _, change := range []func(*config.DBConfig){func(c *config.DBConfig) { c.Host = "remote" }, func(c *config.DBConfig) { c.Port++ }, func(c *config.DBConfig) { c.Database = "other" }, func(c *config.DBConfig) { c.User = "runtime" }, func(c *config.DBConfig) { c.User = "root" }, func(c *config.DBConfig) { c.User = "" }} {
		c := a
		change(&c)
		if _, err := migrationConnection(r, c); err == nil {
			t.Fatal("migration boundary bypass")
		}
	}
	base := []string{"--config", "base", "--migration-db-config", "migration", "--proposed-config", "candidate", "--plan", "plan"}
	o, err := parse(base)
	if err != nil || o.mode != "plan" {
		t.Fatal("not dry-run by default")
	}
	for _, extra := range [][]string{{"--mode", "unknown"}, {"--mode", "apply"}, {"--finance-write", "legacy"}, {"--people-write", "unified"}, {"--proposed-config", "base"}, {"--profile", "other"}, {"extra"}} {
		if _, err := parse(append(append([]string{}, base...), extra...)); err == nil {
			t.Fatal("unsafe flags accepted", extra)
		}
	}
}
func TestPrivateArtifactsAndDurableCheckpoint(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "private.json")
	if err := writeJSON(path, map[string]string{"value": "fixture"}); err != nil {
		t.Fatal(err)
	}
	if _, err := privateRead(path); err != nil {
		t.Fatal(err)
	}
	info, _ := os.Stat(path)
	if info.Mode().Perm() != 0600 {
		t.Fatal("not 0600")
	}
	if writeJSON(path, map[string]string{"overwrite": "no"}) == nil {
		t.Fatal("overwrite accepted")
	}
	link := filepath.Join(dir, "link")
	_ = os.Symlink(path, link)
	if _, err := privateRead(link); err == nil {
		t.Fatal("symlink accepted")
	}
	_ = os.Chmod(path, 0644)
	if _, err := privateRead(path); err == nil {
		t.Fatal("shared input accepted")
	}
	_ = os.Chmod(path, 0600)
	receiptPath := filepath.Join(dir, "receipt.json")
	if err := writeJSON(receiptPath, receipt{}); err != nil {
		t.Fatal(err)
	}
	if err := checkpoint(receiptPath, receipt{Plan: reviewPlan{Version: planVersion}}); err != nil {
		t.Fatal(err)
	}
	var restored receipt
	if readJSON(receiptPath, &restored) != nil || restored.Plan.Version != planVersion {
		t.Fatal("checkpoint not durable")
	}
	before, _ := os.ReadFile(receiptPath)
	_ = os.WriteFile(receiptPath+".next", []byte("unknown"), 0600)
	if checkpoint(receiptPath, receipt{}) == nil {
		t.Fatal("unreviewed .next overwritten")
	}
	after, _ := os.ReadFile(receiptPath)
	if !bytes.Equal(before, after) {
		t.Fatal("failed checkpoint destroyed receipt")
	}
}
func TestStoppedFactsFailClosedWithoutTouchingRuntime(t *testing.T) {
	for _, raw := range []string{`"cn.wiztek.hzy-test-runtime" => disabled`, `"cn.wiztek.hzy-test-runtime" => true`} {
		if !runtimeDisabled(raw) {
			t.Fatal("disabled rejected")
		}
	}
	for _, raw := range []string{"", `"cn.wiztek.hzy-test-runtime" => enabled`, `"cn.wiztek.hzy-test-runtime-other" => disabled`, `"cn.wiztek.hzy-test-runtime" => unknown`, `"cn.wiztek.hzy-test-runtime" => true` + "\n" + `"cn.wiztek.hzy-test-runtime" => false`} {
		if runtimeDisabled(raw) {
			t.Fatal("ambiguous disabled accepted")
		}
	}
	ctx := context.Background()
	for _, tc := range []struct {
		disabled, service   string
		commandErr, dialErr error
		want                bool
	}{
		{`"cn.wiztek.hzy-test-runtime" => disabled`, "Could not find service", nil, syscall.ECONNREFUSED, true},
		{`"cn.wiztek.hzy-test-runtime" => true`, "Could not find service", nil, syscall.ECONNREFUSED, true},
		{`"cn.wiztek.hzy-test-runtime" => enabled`, "Could not find service", nil, syscall.ECONNREFUSED, false},
		{`"cn.wiztek.hzy-test-runtime" => disabled`, "service running", nil, syscall.ECONNREFUSED, false},
		{`"cn.wiztek.hzy-test-runtime" => disabled`, "Could not find service", nil, nil, false},
		{`"cn.wiztek.hzy-test-runtime" => disabled`, "Could not find service", nil, syscall.EPERM, false},
		{`"cn.wiztek.hzy-test-runtime" => disabled`, "Could not find service", nil, context.DeadlineExceeded, false},
		{`"cn.wiztek.hzy-test-runtime" => disabled`, "Could not find service", errors.New("permission"), syscall.ECONNREFUSED, false},
	} {
		command := func(_ context.Context, name string, args ...string) ([]byte, error) {
			if name != "launchctl" {
				t.Fatal("unexpected command")
			}
			if args[0] == "print-disabled" {
				return []byte(tc.disabled), tc.commandErr
			}
			if !strings.HasSuffix(args[1], "/cn.wiztek.hzy-test-runtime") {
				t.Fatal("wrong target")
			}
			return []byte(tc.service), errors.New("not loaded")
		}
		dial := func(_ context.Context, network, address string) (net.Conn, error) {
			if network != "tcp" || address != "127.0.0.1:18084" {
				t.Fatal("wrong port")
			}
			return nil, tc.dialErr
		}
		if got := stoppedWith(ctx, command, dial) == nil; got != tc.want {
			t.Fatal("unproven stopped state accepted", tc)
		}
	}
	if execute(ctx, []string{"--config", "missing", "--migration-db-config", "migration", "--proposed-config", "candidate", "--plan", "plan"}, dependencies{stopped: func(context.Context) error { return errors.New("running") }, open: openMigration, output: &bytes.Buffer{}}) == nil {
		t.Fatal("plan accepted running Runtime")
	}
}
