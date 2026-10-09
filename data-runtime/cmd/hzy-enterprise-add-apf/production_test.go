package main

import (
	"context"
	"encoding/json"
	"errors"
	"net"
	"os"
	"path/filepath"
	"strings"
	"syscall"
	"testing"

	"github.com/huizhi-yun/data-runtime/internal/config"
)

func prodFixture() productionProfile {
	return productionProfile{Schema: "apf-production-install.v1", Tenant: "C000001", Environment: "prod", OwnerDeployment: "C000001-prod-enterprise", RuntimeDeployment: "c000001-prod-tenant-runtime", RuntimeHost: "127.0.0.1", RuntimePort: 31080, DatabaseAddress: "127.0.0.1:3306", Database: "hzy_enterprise", InstanceID: "fixture", SchemaVersion: "v1", Generation: 7, StopProof: "systemd-inactive-port"}
}
func TestProductionProfileAndReviewBinding(t *testing.T) {
	p := prodFixture()
	path := filepath.Join(t.TempDir(), "profile.json")
	write := func(p productionProfile) {
		t.Helper()
		raw, _ := json.Marshal(p)
		if err := os.WriteFile(path, raw, 0600); err != nil {
			t.Fatal(err)
		}
	}
	write(p)
	loaded, sha, err := loadProductionProfile(path)
	if err != nil || loaded == nil || sha == "" {
		t.Fatal("valid protected profile rejected", err)
	}
	for _, change := range []func(*productionProfile){func(p *productionProfile) { p.Environment = "test" }, func(p *productionProfile) { p.RuntimePort = 18084 }, func(p *productionProfile) { p.RuntimeHost = "0.0.0.0" }, func(p *productionProfile) { p.DatabaseAddress = "remote:3306" }, func(p *productionProfile) { p.Generation = 0 }, func(p *productionProfile) { p.StopProof = "anything" }} {
		bad := p
		change(&bad)
		write(bad)
		if _, _, err := loadProductionProfile(path); err == nil {
			t.Fatal("unsafe profile accepted")
		}
	}
	write(p)
	raw, _ := os.ReadFile(path)
	os.WriteFile(path, append(raw, []byte(` {}`)...), 0600)
	if _, _, err := loadProductionProfile(path); err == nil {
		t.Fatal("trailing JSON accepted")
	}
	write(p)
	os.Chmod(path, 0644)
	if _, _, err := loadProductionProfile(path); err == nil {
		t.Fatal("public profile accepted")
	}
	os.Chmod(path, 0600)
	var cfg config.Config
	json.Unmarshal(sourceFixture(p.Database, p.InstanceID, 3306), &cfg)
	cfg.Deployment = p.RuntimeDeployment
	cfg.DeploymentBindings["enterprise"] = p.OwnerDeployment
	cfg.Server.Port = p.RuntimePort
	cfg.Enterprise.Environment = "prod"
	for name, d := range cfg.Enterprise.Domains {
		d.OwnerDeployment = p.OwnerDeployment
		cfg.Enterprise.Domains[name] = d
	}
	source, _ := json.Marshal(cfg)
	o := options{production: &p, profileSHA: sha, altocWrite: "unified", financeWrite: "unified"}
	b, candidate, _, err := proposal(source, o)
	if err != nil {
		t.Fatal(err)
	}
	plan := reviewPlan{Version: planVersion, SourceSHA256: digest(source), ProposedSHA256: digest(candidate), AltocWrite: "unified", FinanceWrite: "unified", ProductionProfileSHA256: sha}
	plan.Installation.Binding = b
	plan.ReviewHash = reviewHash(plan)
	o.review = plan.ReviewHash
	if err := validatePlan(plan, b, source, candidate, o); err != nil {
		t.Fatal(err)
	}
	o.profileSHA = "changed"
	if validatePlan(plan, b, source, candidate, o) == nil {
		t.Fatal("changed profile accepted")
	}
	cfg.Enterprise.Generation++
	if p.matches(cfg) {
		t.Fatal("generation change accepted")
	}
}
func TestProductionStopProof(t *testing.T) {
	p := prodFixture()
	good := "LoadState=loaded\nActiveState=inactive\nSubState=dead\nMainPID=0\n"
	for _, tc := range []struct {
		name, raw           string
		commandErr, dialErr error
		ok                  bool
	}{
		{"inactive", good, nil, syscall.ECONNREFUSED, true},
		{"active", strings.Replace(good, "inactive", "active", 1), nil, syscall.ECONNREFUSED, false},
		{"missing", strings.Replace(good, "loaded", "not-found", 1), nil, syscall.ECONNREFUSED, false},
		{"failed", strings.Replace(good, "inactive", "failed", 1), nil, syscall.ECONNREFUSED, false},
		{"pid", strings.Replace(good, "MainPID=0", "MainPID=1", 1), nil, syscall.ECONNREFUSED, false},
		{"duplicate", good + "MainPID=0\n", nil, syscall.ECONNREFUSED, false},
		{"permission", good, errors.New("denied"), syscall.ECONNREFUSED, false},
		{"listening", good, nil, nil, false}, {"timeout", good, nil, context.DeadlineExceeded, false},
	} {
		t.Run(tc.name, func(t *testing.T) {
			err := productionStoppedWith(context.Background(), &p, func(_ context.Context, name string, args ...string) ([]byte, error) {
				if name != "systemctl" || strings.Join(args, " ") != "show hzy-data-runtime.service --no-pager --property=LoadState,ActiveState,SubState,MainPID" {
					t.Fatal("unexpected command")
				}
				return []byte(tc.raw), tc.commandErr
			}, func(_ context.Context, network, address string) (net.Conn, error) {
				if network != "tcp" || address != "127.0.0.1:31080" {
					t.Fatal("unexpected dial")
				}
				return nil, tc.dialErr
			})
			if (err == nil) != tc.ok {
				t.Fatal(err)
			}
		})
	}
}

func TestLegacyPlanOmitsProductionProfileFact(t *testing.T) {
	raw, err := json.Marshal(reviewPlan{Version: planVersion})
	if err != nil || strings.Contains(string(raw), "ProductionProfileSHA256") {
		t.Fatal("legacy serialization changed", err)
	}
}
