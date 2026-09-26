package server

// Collab snapshot bytes through the Runtime (docs/Codocs-Document-Write-Coordination.md,
// stage B storage). The Runtime resolves oss.default from the vault; Collab
// never sees an OSS key. Uploads must match a prepared candidate's declared
// size/SHA-256 and land on a fresh write-once key under its prefix; downloads
// return only the exact objects the session's document currently publishes.

import (
	"context"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"io"
	"net/http"
	"regexp"

	codocsapp "github.com/huizhi-yun/data-runtime/internal/apps/codocs"
	consoleapp "github.com/huizhi-yun/data-runtime/internal/apps/console"
	"github.com/huizhi-yun/data-runtime/internal/httperror"
)

// collaborationObjectMaxBytes bounds one collaboration object (Markdown is
// already capped at 10 MiB by the snapshot command).
const collaborationObjectMaxBytes = 16 << 20

var collaborationUploadBodyLimit = int64(base64.StdEncoding.EncodedLen(collaborationObjectMaxBytes) + 64<<10)

var collaborationAttempt = regexp.MustCompile(`^[0-9a-f]{32}$`)

var collaborationParts = map[string]struct{ name, contentType string }{
	"markdown": {"body.md", "text/markdown; charset=utf-8"},
	"yjs":      {"state.yjs", "application/octet-stream"},
}

type collaborationObjectStorage interface {
	PutOSSObjectWriteOnce(context.Context, string, string, string, []byte, consoleapp.VaultAccessMeta) (consoleapp.OSSObjectVersion, error)
}

type collaborationUpload struct {
	cmd           codocsapp.SnapshotCommand
	attempt, part string
	content       []byte
}

func collaborationUploadInvalid() error {
	return httperror.New(http.StatusBadRequest, "collaboration_upload_invalid", "Invalid collaboration upload")
}

// decodeCollaborationUpload checks the bytes against the command they claim
// to belong to; the candidate lookup then proves that command was prepared.
func decodeCollaborationUpload(documentUUID string, body map[string]any) (collaborationUpload, error) {
	attempt, attemptOK := body["attempt"].(string)
	part, partOK := body["part"].(string)
	encoded, encodedOK := body["contentBase64"].(string)
	if !attemptOK || !partOK || !encodedOK || !collaborationAttempt.MatchString(attempt) {
		return collaborationUpload{}, collaborationUploadInvalid()
	}
	if _, ok := collaborationParts[part]; !ok {
		return collaborationUpload{}, collaborationUploadInvalid()
	}
	command := map[string]any{}
	for key, value := range body {
		if key != "attempt" && key != "part" && key != "contentBase64" {
			command[key] = value
		}
	}
	cmd, _, err := decodeSnapshotCommand(documentUUID, command, false)
	if err != nil {
		return collaborationUpload{}, err
	}
	if cmd.YjsSHA256 == "" {
		return collaborationUpload{}, httperror.New(http.StatusBadRequest, "collaboration_snapshot_pair_required", "Collaboration snapshots publish Markdown and Yjs together")
	}
	if len(encoded) > base64.StdEncoding.EncodedLen(collaborationObjectMaxBytes) {
		return collaborationUpload{}, httperror.New(http.StatusRequestEntityTooLarge, "collaboration_object_too_large", "Collaboration object exceeds the size limit")
	}
	content, err := base64.StdEncoding.DecodeString(encoded)
	if err != nil {
		return collaborationUpload{}, collaborationUploadInvalid()
	}
	size, digest := cmd.MarkdownSize, cmd.MarkdownSHA256
	if part == "yjs" {
		size, digest = cmd.YjsSize, cmd.YjsSHA256
	}
	sum := sha256.Sum256(content)
	if int64(len(content)) != size || hex.EncodeToString(sum[:]) != digest {
		return collaborationUpload{}, httperror.New(http.StatusBadRequest, "collaboration_upload_mismatch", "Uploaded bytes do not match the prepared snapshot")
	}
	return collaborationUpload{cmd: cmd, attempt: attempt, part: part, content: content}, nil
}

func (s *Server) uploadCollaborationObject(ctx context.Context, id codocsapp.PersonalFolderCreationIdentity, documentUUID, key string, body map[string]any) (any, error) {
	if key == "" {
		return nil, collaborationInputInvalid()
	}
	upload, err := decodeCollaborationUpload(documentUUID, body)
	if err != nil {
		return nil, err
	}
	prefix, err := s.codocs.SnapshotUploadPrefix(ctx, id, upload.cmd)
	if err != nil {
		return nil, err
	}
	var storage collaborationObjectStorage
	if s.console != nil {
		storage = s.console
	}
	return putCollaborationObject(ctx, storage, prefix, upload)
}

func putCollaborationObject(ctx context.Context, storage collaborationObjectStorage, prefix string, upload collaborationUpload) (any, error) {
	if storage == nil {
		return nil, httperror.New(http.StatusServiceUnavailable, "collaboration_storage_unavailable", "Collaboration storage is unavailable")
	}
	part := collaborationParts[upload.part]
	stored, err := storage.PutOSSObjectWriteOnce(ctx, "oss.default", prefix+upload.attempt+"/"+part.name, part.contentType, upload.content, consoleapp.VaultAccessMeta{
		ActorType: "service", ActorID: "codocs.collaboration-storage", AppCode: "codocs", Reason: "collaboration snapshot upload",
	})
	if err != nil {
		return nil, err
	}
	return map[string]any{"key": stored.Key, "version": stored.Version}, nil
}

func (s *Server) downloadCollaborationObject(ctx context.Context, id codocsapp.PersonalFolderCreationIdentity, documentUUID string, body map[string]any) (any, error) {
	part, _ := body["part"].(string)
	if len(body) != 1 || collaborationParts[part].name == "" {
		return nil, collaborationInputInvalid()
	}
	read, err := s.codocs.ReadDocumentSnapshot(ctx, id, documentUUID)
	if err != nil {
		return nil, err
	}
	return readCollaborationObject(ctx, s.codocsSnapshotReader(), id, read, part)
}

func readCollaborationObject(ctx context.Context, reader codocsapp.SnapshotExactVersionReader, id codocsapp.PersonalFolderCreationIdentity, read codocsapp.SnapshotRead, part string) (any, error) {
	if read.Objects == nil {
		return nil, httperror.New(http.StatusConflict, "document_not_on_snapshot_v2", "Document is not saved with the v2 snapshot protocol")
	}
	object, size, digest := &read.Objects.Markdown, read.MarkdownSize, read.MarkdownSHA256
	if part == "yjs" {
		object, size, digest = read.Objects.Yjs, read.YjsSize, read.YjsSHA256
	}
	if object == nil || digest == "" {
		return nil, httperror.New(http.StatusNotFound, "collaboration_object_not_published", "The published generation has no such object")
	}
	if size > collaborationObjectMaxBytes {
		return nil, httperror.New(http.StatusRequestEntityTooLarge, "collaboration_object_too_large", "Collaboration object exceeds the size limit")
	}
	opened, err := reader.OpenSnapshotVersion(ctx, id.Tenant, id.Deployment, object.Key, object.Version)
	if err != nil {
		return nil, httperror.New(http.StatusServiceUnavailable, "snapshot_bytes_unavailable", "Published snapshot bytes are unavailable")
	}
	defer opened.Body.Close()
	content, err := io.ReadAll(io.LimitReader(opened.Body, collaborationObjectMaxBytes+1))
	sum := sha256.Sum256(content)
	if err != nil || opened.Key != object.Key || opened.Version != object.Version || int64(len(content)) != size || hex.EncodeToString(sum[:]) != digest {
		return nil, httperror.New(http.StatusServiceUnavailable, "snapshot_bytes_invalid", "Published snapshot bytes do not match their record")
	}
	return map[string]any{"key": object.Key, "version": object.Version, "size": size, "sha256": digest, "contentBase64": base64.StdEncoding.EncodeToString(content)}, nil
}
