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
)

func rehearsalFixture() productionProfile {
	return productionProfile{Schema: "apf-local-rehearsal.v1", Tenant: "C000001", Environment: "test", OwnerDeployment: owner, RuntimeDeployment: "c000001-test-tenant-runtime", RuntimeHost: "127.0.0.1", RuntimePort: 18184, DatabaseAddress: "127.0.0.1:3320", Database: "hzy_enterprise_shadow_review_20260913", InstanceID: "fixture", SchemaVersion: "v1", Generation: 7, StopProof: "launchd-disabled-port"}
}
func TestRehearsalProfileRejectsRealTargets(t *testing.T) {
	p := rehearsalFixture()
	file := filepath.Join(t.TempDir(), "profile.json")
	check := func(v productionProfile) error {
		raw, _ := json.Marshal(v)
		os.WriteFile(file, raw, 0600)
		_, _, err := loadProductionProfile(file)
		return err
	}
	if check(p) != nil {
		t.Fatal("rehearsal rejected")
	}
	for _, change := range []func(*productionProfile){func(p *productionProfile) { p.DatabaseAddress = "127.0.0.1:3306" }, func(p *productionProfile) { p.RuntimePort = 18084 }, func(p *productionProfile) { p.Environment = "prod" }, func(p *productionProfile) { p.Tenant = "other" }, func(p *productionProfile) { p.Generation = 0 }, func(p *productionProfile) { p.StopProof = "none" }} {
		bad := p
		change(&bad)
		if check(bad) == nil {
			t.Fatal("unsafe target accepted")
		}
	}
}
func TestRehearsalRequiresActualStoppedLabelAndPort(t *testing.T) {
	p := rehearsalFixture()
	for _, tc := range []struct {
		disabled         string
		findErr, dialErr error
		ok               bool
	}{
		{`"cn.wiztek.wizbiz-isolated-runtime-20261005" => disabled`, errors.New("missing"), syscall.ECONNREFUSED, true},
		{`"cn.wiztek.hzy-test-runtime" => disabled`, errors.New("missing"), syscall.ECONNREFUSED, false},
		{`"cn.wiztek.wizbiz-isolated-runtime-20261005" => enabled`, errors.New("missing"), syscall.ECONNREFUSED, false},
		{`"cn.wiztek.wizbiz-isolated-runtime-20261005" => disabled`, nil, syscall.ECONNREFUSED, false},
		{`"cn.wiztek.wizbiz-isolated-runtime-20261005" => disabled`, errors.New("missing"), nil, false},
		{`"cn.wiztek.wizbiz-isolated-runtime-20261005" => disabled`, errors.New("missing"), context.DeadlineExceeded, false},
	} {
		err := rehearsalStoppedWith(context.Background(), &p, func(_ context.Context, name string, args ...string) ([]byte, error) {
			if name != "launchctl" {
				t.Fatal(name)
			}
			if args[0] == "print-disabled" {
				return []byte(tc.disabled), nil
			}
			if !strings.HasSuffix(args[1], "/cn.wiztek.wizbiz-isolated-runtime-20261005") {
				t.Fatal(args)
			}
			return []byte("Could not find service"), tc.findErr
		}, func(_ context.Context, _, addr string) (net.Conn, error) {
			if addr != "127.0.0.1:18184" {
				t.Fatal(addr)
			}
			return nil, tc.dialErr
		})
		if (err == nil) != tc.ok {
			t.Fatal(tc, err)
		}
	}
}
