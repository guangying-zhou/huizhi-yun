package server

import (
	"context"
	"errors"
	"io"
	"strings"

	codocsapp "github.com/huizhi-yun/data-runtime/internal/apps/codocs"
	consoleapp "github.com/huizhi-yun/data-runtime/internal/apps/console"
)

// codocsSnapshotStorage is the Console OSS capability the snapshot reader
// needs; the Console adapter implements it.
type codocsSnapshotStorage interface {
	OpenOSSObjectVersion(context.Context, string, string, string, consoleapp.VaultAccessMeta) (consoleapp.OSSObjectVersion, error)
}

// codocsSnapshotReader binds snapshot byte verification to this Runtime's
// tenant, its Codocs deployment and the snapshot key namespace. It is not yet
// used by a registered route; see docs/Codocs-Document-Write-Coordination.md.
type codocsSnapshotReader struct {
	storage            codocsSnapshotStorage
	tenant, deployment string
}

var _ codocsapp.SnapshotExactVersionReader = codocsSnapshotReader{}

func (s *Server) codocsSnapshotReader() codocsSnapshotReader {
	reader := codocsSnapshotReader{tenant: s.cfg.Tenant, deployment: s.cfg.DeploymentBindings["codocs"]}
	if s.console != nil {
		reader.storage = s.console
	}
	return reader
}

func (r codocsSnapshotReader) OpenSnapshotVersion(ctx context.Context, tenant, deployment, key, version string) (codocsapp.SnapshotVersionRead, error) {
	if r.storage == nil || r.tenant == "" || r.deployment == "" {
		return codocsapp.SnapshotVersionRead{}, errors.New("snapshot storage is not bound")
	}
	if tenant != r.tenant || deployment != r.deployment || !strings.HasPrefix(key, "codocs/snapshots/") {
		return codocsapp.SnapshotVersionRead{}, errors.New("snapshot reference is outside this Runtime binding")
	}
	read, err := r.storage.OpenOSSObjectVersion(ctx, "oss.default", key, version, consoleapp.VaultAccessMeta{
		ActorType: "service", ActorID: "codocs.snapshot-verifier", AppCode: "codocs", Reason: "snapshot byte verification",
	})
	if err != nil {
		return codocsapp.SnapshotVersionRead{}, err
	}
	var body io.ReadCloser = read.Body
	return codocsapp.SnapshotVersionRead{Body: body, Tenant: r.tenant, Deployment: r.deployment, Key: read.Key, Version: read.Version}, nil
}
