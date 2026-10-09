package main

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net"
	"os"
	"os/exec"
	"regexp"
	"runtime"
	"strconv"
	"strings"
	"syscall"
	"time"

	"github.com/huizhi-yun/data-runtime/internal/config"
	"github.com/huizhi-yun/data-runtime/internal/enterprise/domaininstall"
)

// Profile is a reviewed local installation expectation, not a remote approval
// or a source of credentials/commands. Its original bytes are pinned in reviewHash.
type productionProfile struct {
	Schema            string `json:"schema"`
	Tenant            string `json:"tenant"`
	Environment       string `json:"environment"`
	OwnerDeployment   string `json:"ownerDeployment"`
	RuntimeDeployment string `json:"runtimeDeployment"`
	RuntimeHost       string `json:"runtimeHost"`
	RuntimePort       int    `json:"runtimePort"`
	DatabaseAddress   string `json:"databaseAddress"`
	Database          string `json:"database"`
	InstanceID        string `json:"instanceId"`
	SchemaVersion     string `json:"schemaVersion"`
	Generation        uint64 `json:"generation"`
	StopProof         string `json:"stopProof"`
}

func loadProductionProfile(path string) (*productionProfile, string, error) {
	raw, err := privateRead(path)
	if err != nil {
		return nil, "", rejected
	}
	var p productionProfile
	d := json.NewDecoder(bytes.NewReader(raw))
	d.DisallowUnknownFields()
	if d.Decode(&p) != nil || d.Decode(new(any)) != io.EOF {
		return nil, "", rejected
	}
	id := regexp.MustCompile(`^[A-Za-z0-9][A-Za-z0-9_-]{0,99}$`)
	host, port, err := net.SplitHostPort(p.DatabaseAddress)
	n, numErr := strconv.Atoi(port)
	if p.Schema == "apf-local-rehearsal.v1" {
		if p.Tenant != "C000001" || p.Environment != "test" || p.OwnerDeployment != owner || p.RuntimeDeployment != "c000001-test-tenant-runtime" || p.RuntimeHost != "127.0.0.1" || p.RuntimePort != 18184 || p.DatabaseAddress != "127.0.0.1:3320" || p.Database != "hzy_enterprise_shadow_review_20260913" || p.InstanceID == "" || p.SchemaVersion == "" || p.Generation == 0 || p.StopProof != "launchd-disabled-port" {
			return nil, "", rejected
		}
		return &p, digest(raw), nil
	}
	if p.Schema != "apf-production-install.v1" || p.Environment != "prod" || !id.MatchString(p.Tenant) || !id.MatchString(p.OwnerDeployment) || !id.MatchString(p.RuntimeDeployment) || p.RuntimeHost != "127.0.0.1" || p.RuntimePort != 31080 || p.StopProof != "systemd-inactive-port" || err != nil || numErr != nil || host != "127.0.0.1" || n < 1 || n > 65535 || !regexp.MustCompile(`^[A-Za-z0-9_]+$`).MatchString(p.Database) || p.InstanceID == "" || p.SchemaVersion == "" || p.Generation == 0 {
		return nil, "", rejected
	}
	return &p, digest(raw), nil
}
func (p *productionProfile) matches(c config.Config) bool {
	return p != nil && c.Tenant == p.Tenant && c.Deployment == p.RuntimeDeployment && c.Enterprise.Environment == p.Environment && c.DeploymentBindings["enterprise"] == p.OwnerDeployment && c.Server.Host == p.RuntimeHost && c.Server.Port == p.RuntimePort && c.Enterprise.DB.Host == "127.0.0.1" && net.JoinHostPort(c.Enterprise.DB.Host, strconv.Itoa(c.Enterprise.DB.Port)) == p.DatabaseAddress && c.Enterprise.DB.Database == p.Database && c.Enterprise.InstanceID == p.InstanceID && c.Enterprise.SchemaVersion == p.SchemaVersion && c.Enterprise.Generation == p.Generation
}
func installExpectation(o options) domaininstall.Expectation {
	if p := o.production; p != nil {
		return domaininstall.Expectation{Tenant: p.Tenant, Environment: p.Environment, OwnerDeployment: p.OwnerDeployment, Address: p.DatabaseAddress}
	}
	return domaininstall.Expectation{Tenant: "C000001", Environment: "test", OwnerDeployment: owner}
}

// Only a loaded, inactive, fully exited fixed Runtime unit plus ECONNREFUSED
// proves stop. Failed/missing units, permission/timeout and malformed show output
// are not equivalent to inactive. No mutating systemctl commands are issued.
func productionStoppedWith(ctx context.Context, p *productionProfile, command launchCommand, dial dialPort) error {
	if p == nil {
		return rejected
	}
	raw, err := command(ctx, "systemctl", "show", "hzy-data-runtime.service", "--no-pager", "--property=LoadState,ActiveState,SubState,MainPID")
	if err != nil {
		return rejected
	}
	fields := map[string]string{}
	for _, line := range strings.Split(strings.TrimSpace(string(raw)), "\n") {
		kv := strings.SplitN(line, "=", 2)
		_, duplicate := fields[kv[0]]
		if len(kv) != 2 || duplicate {
			return rejected
		}
		fields[kv[0]] = kv[1]
	}
	if len(fields) != 4 || fields["LoadState"] != "loaded" || fields["ActiveState"] != "inactive" || fields["SubState"] != "dead" || fields["MainPID"] != "0" {
		return rejected
	}
	conn, err := dial(ctx, "tcp", net.JoinHostPort(p.RuntimeHost, strconv.Itoa(p.RuntimePort)))
	if conn != nil {
		conn.Close()
	}
	if !errors.Is(err, syscall.ECONNREFUSED) {
		return rejected
	}
	return nil
}
func productionStopped(ctx context.Context, p *productionProfile) error {
	if p != nil && p.Schema == "apf-local-rehearsal.v1" {
		if runtime.GOOS != "darwin" {
			return rejected
		}
		return rehearsalStoppedWith(ctx, p, func(ctx context.Context, name string, args ...string) ([]byte, error) {
			return exec.CommandContext(ctx, name, args...).CombinedOutput()
		}, (&net.Dialer{Timeout: time.Second}).DialContext)
	}
	if runtime.GOOS != "linux" {
		return rejected
	}
	return productionStoppedWith(ctx, p, func(ctx context.Context, name string, args ...string) ([]byte, error) {
		return exec.CommandContext(ctx, name, args...).CombinedOutput()
	}, (&net.Dialer{Timeout: time.Second}).DialContext)
}

// Rehearsal uses the same binary, but never accepts the real hzy0 ports/label.
func rehearsalStoppedWith(ctx context.Context, p *productionProfile, command launchCommand, dial dialPort) error {
	if p == nil || p.Schema != "apf-local-rehearsal.v1" || p.RuntimePort != 18184 || p.DatabaseAddress != "127.0.0.1:3320" {
		return rejected
	}
	const label = "cn.wiztek.wizbiz-isolated-runtime-20261005"
	domain := fmt.Sprintf("gui/%d", os.Getuid())
	raw, err := command(ctx, "launchctl", "print-disabled", domain)
	if err != nil || !rehearsalDisabled(string(raw)) {
		return rejected
	}
	raw, err = command(ctx, "launchctl", "print", domain+"/"+label)
	if err == nil || !strings.Contains(string(raw), "Could not find service") {
		return rejected
	}
	conn, err := dial(ctx, "tcp", "127.0.0.1:18184")
	if conn != nil {
		conn.Close()
	}
	if !errors.Is(err, syscall.ECONNREFUSED) {
		return rejected
	}
	return nil
}
func rehearsalDisabled(raw string) bool {
	lines := []string{}
	for _, line := range strings.Split(raw, "\n") {
		if strings.HasPrefix(strings.TrimSpace(line), `"cn.wiztek.wizbiz-isolated-runtime-20261005" => `) {
			lines = append(lines, strings.ReplaceAll(line, "cn.wiztek.wizbiz-isolated-runtime-20261005", "cn.wiztek.hzy-test-runtime"))
		}
	}
	return runtimeDisabled(strings.Join(lines, "\n"))
}
