package server

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"errors"
	"io"
	"strings"
	"testing"

	codocsapp "github.com/huizhi-yun/data-runtime/internal/apps/codocs"
	consoleapp "github.com/huizhi-yun/data-runtime/internal/apps/console"
	"github.com/huizhi-yun/data-runtime/internal/httperror"
)

const collabDoc = "11111111-2222-4333-8444-555555555555"

func digestOf(b []byte) string { sum := sha256.Sum256(b); return hex.EncodeToString(sum[:]) }

func uploadBody(part string, content []byte, markdown, yjs []byte) map[string]any {
	return map[string]any{
		"generation": float64(2), "epoch": float64(1),
		"markdownSha256": digestOf(markdown), "markdownSize": float64(len(markdown)),
		"yjsSha256": digestOf(yjs), "yjsSize": float64(len(yjs)),
		"attempt": strings.Repeat("a", 32), "part": part, "contentBase64": base64.StdEncoding.EncodeToString(content),
	}
}

func errorCode(err error) string {
	var he httperror.Error
	if errors.As(err, &he) {
		return he.Code
	}
	return ""
}

func TestCollaborationUploadAcceptsOnlyBytesOfThePreparedCommand(t *testing.T) {
	markdown, yjs := []byte("# hi"), []byte{1, 2, 3}
	upload, err := decodeCollaborationUpload(collabDoc, uploadBody("yjs", yjs, markdown, yjs))
	if err != nil || upload.part != "yjs" || !bytes.Equal(upload.content, yjs) || upload.cmd.UUID != collabDoc || upload.cmd.MarkdownSize != 4 {
		t.Fatalf("valid upload: %+v %v", upload, err)
	}
	for name, mutate := range map[string]func(map[string]any){
		"other bytes":       func(b map[string]any) { b["contentBase64"] = base64.StdEncoding.EncodeToString([]byte("# ho")) },
		"yjs as markdown":   func(b map[string]any) { b["contentBase64"] = base64.StdEncoding.EncodeToString(yjs) },
		"bad attempt":       func(b map[string]any) { b["attempt"] = "../../x" },
		"upper attempt":     func(b map[string]any) { b["attempt"] = strings.Repeat("A", 32) },
		"unknown part":      func(b map[string]any) { b["part"] = "meta" },
		"not base64":        func(b map[string]any) { b["contentBase64"] = "%%%" },
		"extra field":       func(b map[string]any) { b["key"] = "codocs/snapshots/other/body.md" },
		"unpaired":          func(b map[string]any) { delete(b, "yjsSha256"); delete(b, "yjsSize") },
		"missing attempt":   func(b map[string]any) { delete(b, "attempt") },
		"missing command":   func(b map[string]any) { delete(b, "generation") },
		"oversized payload": func(b map[string]any) { b["contentBase64"] = strings.Repeat("A", int(collaborationUploadBodyLimit)) },
	} {
		body := uploadBody("markdown", markdown, markdown, yjs)
		mutate(body)
		if _, err := decodeCollaborationUpload(collabDoc, body); err == nil {
			t.Fatalf("%s accepted", name)
		}
	}
}

type fakeCollaborationStorage struct {
	key, contentType string
	content          []byte
	meta             consoleapp.VaultAccessMeta
	integration      string
}

func (f *fakeCollaborationStorage) PutOSSObjectWriteOnce(_ context.Context, integration, key, contentType string, content []byte, meta consoleapp.VaultAccessMeta) (consoleapp.OSSObjectVersion, error) {
	f.integration, f.key, f.contentType, f.content, f.meta = integration, key, contentType, content, meta
	return consoleapp.OSSObjectVersion{Key: key, Version: "V9"}, nil
}

func TestCollaborationUploadWritesUnderThePreparedPrefixOnly(t *testing.T) {
	markdown, yjs := []byte("# hi"), []byte{1, 2, 3}
	upload, err := decodeCollaborationUpload(collabDoc, uploadBody("markdown", markdown, markdown, yjs))
	if err != nil {
		t.Fatal(err)
	}
	if _, err := putCollaborationObject(context.Background(), nil, "codocs/snapshots/h/d/k/", upload); errorCode(err) != "collaboration_storage_unavailable" {
		t.Fatalf("unbound storage: %v", err)
	}
	storage := &fakeCollaborationStorage{}
	value, err := putCollaborationObject(context.Background(), storage, "codocs/snapshots/h/d/k/", upload)
	want := "codocs/snapshots/h/d/k/" + strings.Repeat("a", 32) + "/body.md"
	if err != nil || storage.key != want || storage.integration != "oss.default" || storage.contentType != "text/markdown; charset=utf-8" || !bytes.Equal(storage.content, markdown) || storage.meta.AppCode != "codocs" {
		t.Fatalf("upload: %+v %v", storage, err)
	}
	if got := value.(map[string]any); got["key"] != want || got["version"] != "V9" {
		t.Fatalf("result: %v", got)
	}
}

type fakeSnapshotReader struct {
	content      []byte
	key, version string
	err          error
	calls        int
}

func (f *fakeSnapshotReader) OpenSnapshotVersion(_ context.Context, _, _, key, version string) (codocsapp.SnapshotVersionRead, error) {
	f.calls++
	if f.err != nil {
		return codocsapp.SnapshotVersionRead{}, f.err
	}
	if f.key != "" {
		key = f.key
	}
	if f.version != "" {
		version = f.version
	}
	return codocsapp.SnapshotVersionRead{Body: io.NopCloser(bytes.NewReader(f.content)), Key: key, Version: version}, nil
}

func TestCollaborationDownloadReturnsOnlyVerifiedPublishedBytes(t *testing.T) {
	markdown, yjs := []byte("# hi"), []byte{1, 2, 3}
	id := codocsapp.PersonalFolderCreationIdentity{Tenant: "T", Deployment: "D"}
	read := codocsapp.SnapshotRead{
		Objects:      &codocsapp.SnapshotObjects{Markdown: codocsapp.SnapshotObject{Key: "codocs/snapshots/h/d/k/a/body.md", Version: "M1"}, Yjs: &codocsapp.SnapshotObject{Key: "codocs/snapshots/h/d/k/a/state.yjs", Version: "Y1"}},
		MarkdownSize: 4, MarkdownSHA256: digestOf(markdown), YjsSize: 3, YjsSHA256: digestOf(yjs),
	}
	value, err := readCollaborationObject(context.Background(), &fakeSnapshotReader{content: yjs}, id, read, "yjs")
	got, _ := value.(map[string]any)
	if err != nil || got["version"] != "Y1" || got["contentBase64"] != base64.StdEncoding.EncodeToString(yjs) {
		t.Fatalf("download: %v %v", got, err)
	}
	for name, reader := range map[string]*fakeSnapshotReader{
		"tampered bytes":  {content: []byte{9, 9, 9}},
		"other version":   {content: yjs, version: "LATEST"},
		"other key":       {content: yjs, key: "codocs/snapshots/x/state.yjs"},
		"storage failure": {err: errors.New("down")},
	} {
		if _, err := readCollaborationObject(context.Background(), reader, id, read, "yjs"); err == nil {
			t.Fatalf("%s accepted", name)
		}
	}
	markdownOnly := read
	markdownOnly.Objects = &codocsapp.SnapshotObjects{Markdown: read.Objects.Markdown}
	markdownOnly.YjsSHA256, markdownOnly.YjsSize = "", 0
	if _, err := readCollaborationObject(context.Background(), &fakeSnapshotReader{content: yjs}, id, markdownOnly, "yjs"); errorCode(err) != "collaboration_object_not_published" {
		t.Fatalf("missing yjs: %v", err)
	}
	if _, err := readCollaborationObject(context.Background(), &fakeSnapshotReader{}, id, codocsapp.SnapshotRead{}, "markdown"); errorCode(err) != "document_not_on_snapshot_v2" {
		t.Fatalf("v1 document: %v", err)
	}
	huge := read
	huge.MarkdownSize = collaborationObjectMaxBytes + 1
	reader := &fakeSnapshotReader{content: markdown}
	if _, err := readCollaborationObject(context.Background(), reader, id, huge, "markdown"); errorCode(err) != "collaboration_object_too_large" || reader.calls != 0 {
		t.Fatalf("oversized: %v calls=%d", err, reader.calls)
	}
}
