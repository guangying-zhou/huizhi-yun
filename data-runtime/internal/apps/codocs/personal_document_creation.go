package codocs

import (
	"context"
	"crypto/sha256"
	"fmt"
	"net/url"
	"regexp"
	"strings"

	"github.com/huizhi-yun/data-runtime/internal/httperror"
	io "github.com/huizhi-yun/data-runtime/internal/integrationoperation"
)

var personalDocumentContentHash = regexp.MustCompile(`^[0-9a-f]{64}$`)

// ValidatePersonalDocumentCreation accepts content facts from the authenticated
// Host, never arbitrary ownership, UUIDs, or storage paths from its JSON body.
func ValidatePersonalDocumentCreation(payload map[string]any) error {
	invalid := httperror.New(400, "invalid_document_creation", "Invalid personal document creation")
	for key := range payload {
		if key != "title" && key != "doc_type" && key != "folder_id" && key != "content_sha256" && key != "content_size" {
			return invalid
		}
	}
	title, ok := payload["title"].(string)
	if !ok || strings.TrimSpace(title) == "" || len([]rune(title)) > 255 {
		return invalid
	}
	kind, ok := payload["doc_type"].(string)
	if !ok || (kind != "private" && kind != "slide") {
		return invalid
	}
	hash, ok := payload["content_sha256"].(string)
	if !ok || !personalDocumentContentHash.MatchString(hash) {
		return invalid
	}
	size, ok := payload["content_size"].(float64)
	if !ok || size < 0 || size > 10*1024*1024 || size != float64(int64(size)) {
		return invalid
	}
	if value := payload["folder_id"]; value != nil {
		id, ok := value.(float64)
		if !ok || id < 1 || id > 9007199254740991 || id != float64(int64(id)) {
			return invalid
		}
	}
	return nil
}

func (a *Adapter) CreatePersonalDocument(ctx context.Context, identity PersonalFolderCreationIdentity, payload map[string]any) (map[string]any, error) {
	if identity.Tenant == "" || identity.Deployment == "" || identity.Actor == "" || identity.Client != "enterprise.runtime" || identity.Key == "" || len(identity.Key) > 200 {
		return nil, httperror.New(403, "document_creation_identity_invalid", "Bound document creation identity required")
	}
	if err := ValidatePersonalDocumentCreation(payload); err != nil {
		return nil, err
	}
	kind := payload["doc_type"].(string)
	var folder int64
	if value := payload["folder_id"]; value != nil {
		folder = int64(value.(float64))
	}
	// Replays must also prove current ownership of their selected directory.
	if folder > 0 {
		row, err := readFolderScope(ctx, a.db, folder, false)
		if err != nil {
			return nil, err
		}
		if row.Kind != kind || !folderScopeAllowed(row, identity.Actor, url.Values{"current_user": {identity.Actor}}, true) {
			return nil, httperror.New(403, "document_folder_scope_mismatch", "Folder is outside the personal document scope")
		}
	}
	command := map[string]any{"title": strings.TrimSpace(payload["title"].(string)), "doc_type": kind, "folder_id": folder, "content_sha256": payload["content_sha256"], "content_size": payload["content_size"]}
	digest, err := io.ValidateAndDigestCommand(command)
	if err != nil {
		return nil, err
	}
	// The existing documents.uuid unique key is the durable creation identity.
	// A changed payload yields a different immutable path and conflicts against
	// that same UUID; existing creation replay checks never overwrite a document.
	namespace := sha256.Sum256([]byte(strings.Join([]string{"codocs.personal-document.create.v1", identity.Tenant, identity.Deployment, identity.Actor, identity.Key}, "\x00")))
	namespace[6] = (namespace[6] & 0x0f) | 0x40
	namespace[8] = (namespace[8] & 0x3f) | 0x80
	uuid := fmt.Sprintf("%x-%x-%x-%x-%x", namespace[:4], namespace[4:6], namespace[6:8], namespace[8:10], namespace[10:16])
	path := "codocs/document-creations/" + uuid + "/" + digest + ".md"
	if err := a.ensureDocumentTitleAvailable(ctx, uuid, map[string]any{"owner_uid": identity.Actor, "doc_type": kind}, command["title"].(string), nullableInt64(folder)); err != nil {
		return nil, err
	}
	return a.createDocument(ctx, map[string]any{"uuid": uuid, "title": command["title"], "docType": kind, "ownerUid": identity.Actor, "folderId": folder, "ossPath": path, "contentSize": payload["content_size"]})
}
