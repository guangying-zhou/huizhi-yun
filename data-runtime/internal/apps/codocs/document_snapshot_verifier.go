package codocs

// This verifier is an internal building block, not a registered write route.
// The concrete reader must bind its credentials/bucket to the authenticated
// tenant and deployment and perform an exact provider-version read.

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"io"
)

type SnapshotVersionRead struct {
	Body               io.ReadCloser
	Tenant, Deployment string
	Key, Version       string
}

type SnapshotExactVersionReader interface {
	OpenSnapshotVersion(context.Context, string, string, string, string) (SnapshotVersionRead, error)
}

// NewSnapshotByteVerifier checks the provider's returned identity and hashes
// bounded bytes. It does not itself provision storage credentials or assert
// that a provider retains versions; activation still needs a real OSS reader.
func NewSnapshotByteVerifier(reader SnapshotExactVersionReader) SnapshotVerifier {
	return func(ctx context.Context, id PersonalFolderCreationIdentity, cmd SnapshotCommand, objects SnapshotObjects) error {
		if reader == nil {
			return snapshotError(503, "snapshot_verifier_unavailable")
		}
		_, _, prefix, err := snapshotFacts(id, cmd)
		if err != nil {
			return err
		}
		if err := validateSnapshotObjects(prefix, cmd, objects); err != nil {
			return err
		}
		if err := verifySnapshotVersion(ctx, reader, id, objects.Markdown, cmd.MarkdownSize, cmd.MarkdownSHA256); err != nil {
			return err
		}
		if objects.Yjs != nil {
			return verifySnapshotVersion(ctx, reader, id, *objects.Yjs, cmd.YjsSize, cmd.YjsSHA256)
		}
		return nil
	}
}

func verifySnapshotVersion(ctx context.Context, reader SnapshotExactVersionReader, id PersonalFolderCreationIdentity, object SnapshotObject, size int64, digest string) error {
	read, err := reader.OpenSnapshotVersion(ctx, id.Tenant, id.Deployment, object.Key, object.Version)
	if err != nil {
		return snapshotError(503, "snapshot_storage_unavailable")
	}
	if read.Body == nil {
		return snapshotError(503, "snapshot_storage_invalid")
	}
	defer read.Body.Close()
	if read.Tenant != id.Tenant || read.Deployment != id.Deployment || read.Key != object.Key || read.Version != object.Version {
		return snapshotError(503, "snapshot_storage_invalid")
	}
	hash := sha256.New()
	buffer := make([]byte, 32*1024)
	var copied int64
	for {
		if err := ctx.Err(); err != nil {
			return snapshotError(503, "snapshot_storage_unavailable")
		}
		limit := len(buffer)
		if remaining := size + 1 - copied; remaining < int64(limit) {
			limit = int(remaining)
		}
		if limit <= 0 {
			return snapshotError(503, "snapshot_storage_invalid")
		}
		n, err := read.Body.Read(buffer[:limit])
		if n > 0 {
			copied += int64(n)
			if copied > size {
				return snapshotError(503, "snapshot_storage_invalid")
			}
			_, _ = hash.Write(buffer[:n])
		}
		if err == io.EOF {
			break
		}
		if err != nil || n == 0 {
			return snapshotError(503, "snapshot_storage_unavailable")
		}
	}
	if copied != size || hex.EncodeToString(hash.Sum(nil)) != digest {
		return snapshotError(503, "snapshot_storage_invalid")
	}
	return nil
}
