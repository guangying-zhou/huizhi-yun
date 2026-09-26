package server

import (
	"context"
	"errors"
	"io"
	"strings"
	"testing"

	consoleapp "github.com/huizhi-yun/data-runtime/internal/apps/console"
)

type fakeSnapshotStorage struct {
	calls   int
	version string
	err     error
}

func (f *fakeSnapshotStorage) OpenOSSObjectVersion(_ context.Context, integration, key, version string, _ consoleapp.VaultAccessMeta) (consoleapp.OSSObjectVersion, error) {
	f.calls++
	if f.err != nil {
		return consoleapp.OSSObjectVersion{}, f.err
	}
	if integration != "oss.default" {
		return consoleapp.OSSObjectVersion{}, errors.New("unexpected integration")
	}
	returned := version
	if f.version != "" {
		returned = f.version
	}
	return consoleapp.OSSObjectVersion{Body: io.NopCloser(strings.NewReader("x")), Key: key, Version: returned}, nil
}

func TestCodocsSnapshotReaderBindsTenantDeploymentAndNamespace(t *testing.T) {
	storage := &fakeSnapshotStorage{}
	reader := codocsSnapshotReader{storage: storage, tenant: "C000001", deployment: "c000001-codocs"}
	key := "codocs/snapshots/h/uuid/k/body.md"
	read, err := reader.OpenSnapshotVersion(context.Background(), "C000001", "c000001-codocs", key, "V1")
	if err != nil || read.Tenant != "C000001" || read.Deployment != "c000001-codocs" || read.Key != key || read.Version != "V1" {
		t.Fatalf("unexpected %+v %v", read, err)
	}
	_ = read.Body.Close()
	for name, args := range map[string][3]string{
		"other tenant":     {"C000002", "c000001-codocs", key},
		"other deployment": {"C000001", "other", key},
		"legacy key":       {"C000001", "c000001-codocs", "codocs/docs/uuid.md"},
	} {
		if _, err := reader.OpenSnapshotVersion(context.Background(), args[0], args[1], args[2], "V1"); err == nil {
			t.Fatalf("%s accepted", name)
		}
	}
	if storage.calls != 1 {
		t.Fatalf("storage must not be called for rejected references, calls=%d", storage.calls)
	}
	for name, unbound := range map[string]codocsSnapshotReader{
		"no storage":    {tenant: "C000001", deployment: "c000001-codocs"},
		"no deployment": {storage: storage, tenant: "C000001"},
	} {
		if _, err := unbound.OpenSnapshotVersion(context.Background(), "C000001", "", key, "V1"); err == nil {
			t.Fatalf("%s accepted", name)
		}
	}
	storage.err = errors.New("oss down")
	if _, err := reader.OpenSnapshotVersion(context.Background(), "C000001", "c000001-codocs", key, "V1"); err == nil {
		t.Fatal("storage failure must propagate")
	}
}
