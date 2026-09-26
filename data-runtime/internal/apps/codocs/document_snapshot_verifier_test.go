package codocs

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"io"
	"net/http"
	"strings"
	"testing"
)

type snapshotReaderFunc func(context.Context, string, string, string, string) (SnapshotVersionRead, error)

func (f snapshotReaderFunc) OpenSnapshotVersion(ctx context.Context, tenant, deployment, key, version string) (SnapshotVersionRead, error) {
	return f(ctx, tenant, deployment, key, version)
}

type trackedSnapshotBody struct {
	*bytes.Reader
	closed bool
}

func (b *trackedSnapshotBody) Close() error { b.closed = true; return nil }

func snapshotVerifierFixture(t *testing.T, markdown, yjs []byte) (PersonalFolderCreationIdentity, SnapshotCommand, SnapshotObjects) {
	t.Helper()
	id := validSnapshotIdentity()
	cmd := validSnapshotCommand()
	mdHash := sha256.Sum256(markdown)
	cmd.MarkdownSHA256, cmd.MarkdownSize = hex.EncodeToString(mdHash[:]), int64(len(markdown))
	_, _, prefix, err := snapshotFacts(id, cmd)
	if err != nil {
		t.Fatal(err)
	}
	attempt := strings.Repeat("a", 32)
	objects := SnapshotObjects{Markdown: SnapshotObject{Key: prefix + attempt + "/body.md", Version: "md-v1"}}
	if yjs != nil {
		yjsHash := sha256.Sum256(yjs)
		cmd.YjsSHA256, cmd.YjsSize = hex.EncodeToString(yjsHash[:]), int64(len(yjs))
		objects.Yjs = &SnapshotObject{Key: prefix + attempt + "/state.yjs", Version: "yjs-v2"}
	}
	return id, cmd, objects
}

func TestSnapshotByteVerifierReadsExactVersionsAndClosesBodies(t *testing.T) {
	markdown, yjs := []byte("# document\n"), []byte{1, 2, 3}
	id, cmd, objects := snapshotVerifierFixture(t, markdown, yjs)
	bodies := []*trackedSnapshotBody{}
	requested := []string{}
	reader := snapshotReaderFunc(func(_ context.Context, tenant, deployment, key, version string) (SnapshotVersionRead, error) {
		requested = append(requested, key+"@"+version)
		var content []byte
		switch key {
		case objects.Markdown.Key:
			content = markdown
		case objects.Yjs.Key:
			content = yjs
		default:
			t.Fatalf("unexpected key: %s", key)
		}
		body := &trackedSnapshotBody{Reader: bytes.NewReader(content)}
		bodies = append(bodies, body)
		return SnapshotVersionRead{Body: body, Tenant: tenant, Deployment: deployment, Key: key, Version: version}, nil
	})
	if err := NewSnapshotByteVerifier(reader)(context.Background(), id, cmd, objects); err != nil {
		t.Fatal(err)
	}
	if len(requested) != 2 || requested[0] != objects.Markdown.Key+"@md-v1" || requested[1] != objects.Yjs.Key+"@yjs-v2" {
		t.Fatalf("wrong exact version reads: %#v", requested)
	}
	for _, body := range bodies {
		if !body.closed {
			t.Fatal("provider body was not closed")
		}
	}
}

func TestSnapshotByteVerifierRejectsStorageMismatch(t *testing.T) {
	content := []byte("# document\n")
	id, cmd, objects := snapshotVerifierFixture(t, content, nil)
	for _, tc := range []struct {
		name   string
		data   []byte
		mutate func(*SnapshotVersionRead)
		code   string
	}{
		{"short body", content[:len(content)-1], nil, "snapshot_storage_invalid"},
		{"long body", append(bytes.Clone(content), 'x'), nil, "snapshot_storage_invalid"},
		{"wrong digest", []byte("# documenx\n"), nil, "snapshot_storage_invalid"},
		{"wrong tenant", content, func(r *SnapshotVersionRead) { r.Tenant = "other" }, "snapshot_storage_invalid"},
		{"wrong deployment", content, func(r *SnapshotVersionRead) { r.Deployment = "other" }, "snapshot_storage_invalid"},
		{"wrong key", content, func(r *SnapshotVersionRead) { r.Key = "other" }, "snapshot_storage_invalid"},
		{"wrong version", content, func(r *SnapshotVersionRead) { r.Version = "latest" }, "snapshot_storage_invalid"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			body := &trackedSnapshotBody{Reader: bytes.NewReader(tc.data)}
			reader := snapshotReaderFunc(func(_ context.Context, tenant, deployment, key, version string) (SnapshotVersionRead, error) {
				result := SnapshotVersionRead{Body: body, Tenant: tenant, Deployment: deployment, Key: key, Version: version}
				if tc.mutate != nil {
					tc.mutate(&result)
				}
				return result, nil
			})
			snapshotValidationError(t, NewSnapshotByteVerifier(reader)(context.Background(), id, cmd, objects), http.StatusServiceUnavailable, tc.code)
			if !body.closed {
				t.Fatal("provider body was not closed on failure")
			}
		})
	}
}

func TestSnapshotByteVerifierFailsClosed(t *testing.T) {
	id, cmd, objects := snapshotVerifierFixture(t, []byte("a"), nil)
	snapshotValidationError(t, NewSnapshotByteVerifier(nil)(context.Background(), id, cmd, objects), http.StatusServiceUnavailable, "snapshot_verifier_unavailable")
	reader := snapshotReaderFunc(func(_ context.Context, _, _, _, _ string) (SnapshotVersionRead, error) {
		return SnapshotVersionRead{}, errors.New("provider detail must not leak")
	})
	snapshotValidationError(t, NewSnapshotByteVerifier(reader)(context.Background(), id, cmd, objects), http.StatusServiceUnavailable, "snapshot_storage_unavailable")
	reader = snapshotReaderFunc(func(_ context.Context, tenant, deployment, key, version string) (SnapshotVersionRead, error) {
		return SnapshotVersionRead{Tenant: tenant, Deployment: deployment, Key: key, Version: version}, nil
	})
	snapshotValidationError(t, NewSnapshotByteVerifier(reader)(context.Background(), id, cmd, objects), http.StatusServiceUnavailable, "snapshot_storage_invalid")
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	reader = snapshotReaderFunc(func(_ context.Context, tenant, deployment, key, version string) (SnapshotVersionRead, error) {
		return SnapshotVersionRead{Body: io.NopCloser(bytes.NewReader([]byte("a"))), Tenant: tenant, Deployment: deployment, Key: key, Version: version}, nil
	})
	snapshotValidationError(t, NewSnapshotByteVerifier(reader)(ctx, id, cmd, objects), http.StatusServiceUnavailable, "snapshot_storage_unavailable")
}
