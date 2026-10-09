package codocs

import (
	"context"
	"database/sql"
	"errors"
	"net/http"
	"strings"

	"github.com/huizhi-yun/data-runtime/internal/httperror"
)

// DocumentBodyRef names the exact published Markdown of a v2 (snapshot-backed)
// document. Once a document has a head, `documents.oss_path` is only a
// best-effort compatibility mirror; every consumer that must copy, publish or
// display the body reads this exact provider version and verifies the length
// and SHA-256 before use. It is resolved from the committed head by the same
// validation as ReadDocumentSnapshot, never from the mirror.
type DocumentBodyRef struct {
	Generation int64
	Epoch      int64
	Key        string
	Version    string
	Size       int64
	SHA256     string
}

// Map is the wire shape shared with the BFF/Host helpers (lowercase keys).
func (r *DocumentBodyRef) Map() map[string]any {
	if r == nil {
		return nil
	}
	return map[string]any{
		"generation": r.Generation,
		"epoch":      r.Epoch,
		"markdown":   map[string]any{"key": r.Key, "version": r.Version},
		"size":       r.Size,
		"sha256":     r.SHA256,
	}
}

// resolveDocumentBodyRef returns nil for a v1 document (no head, generation 0
// or the snapshot tables are not installed). A head that cannot be verified is
// an error: the caller must fail closed and never fall back to the mirror.
//
// A Codocs database serves one tenant, so the head is looked up by document
// UUID (matching documentOnSnapshotV2) and validated against the tenant and
// deployment recorded on that head row.
func (a *Adapter) resolveDocumentBodyRef(ctx context.Context, uuid string) (*DocumentBodyRef, error) {
	uuid = strings.TrimSpace(uuid)
	if uuid == "" {
		return nil, nil
	}
	var tenant, deployment string
	err := a.db.QueryRowContext(ctx, `SELECT tenant_code, deployment_code FROM document_snapshot_heads WHERE document_uuid = ? AND generation > 0 ORDER BY generation DESC, deployment_code LIMIT 1`, uuid).Scan(&tenant, &deployment)
	if errors.Is(err, sql.ErrNoRows) || isMissingTable(err) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	tx, err := a.db.BeginTx(ctx, &sql.TxOptions{ReadOnly: true})
	if err != nil {
		return nil, err
	}
	defer tx.Rollback()
	head, err := readSnapshotHead(ctx, tx, PersonalFolderCreationIdentity{Tenant: tenant, Deployment: deployment}, uuid, "")
	if err != nil {
		return nil, err
	}
	if head.Generation <= 0 || head.Objects == nil || head.Objects.Markdown.Key == "" || head.Objects.Markdown.Version == "" || !personalDocumentContentHash.MatchString(head.MarkdownSHA256) {
		return nil, snapshotError(503, "snapshot_reference_invalid")
	}
	return &DocumentBodyRef{
		Generation: head.Generation,
		Epoch:      head.Epoch,
		Key:        head.Objects.Markdown.Key,
		Version:    head.Objects.Markdown.Version,
		Size:       head.MarkdownSize,
		SHA256:     head.MarkdownSHA256,
	}, nil
}

// annotateSnapshotState marks documents with `snapshot_generation` (0 = v1) so
// the standalone BFF can fail closed on v2 documents before any storage
// access. With withRef, v2 documents also carry `snapshot_ref` (trusted server
// callers only; never forwarded to browsers).
func (a *Adapter) annotateSnapshotState(ctx context.Context, items []map[string]any, withRef bool) error {
	uuids := make([]string, 0, len(items))
	seen := map[string]bool{}
	for _, item := range items {
		uuid := strings.TrimSpace(stringValue(item["uuid"]))
		if uuid != "" && !seen[uuid] {
			seen[uuid] = true
			uuids = append(uuids, uuid)
		}
	}
	generations := map[string]int64{}
	if len(uuids) > 0 {
		args := make([]any, len(uuids))
		for i, uuid := range uuids {
			args[i] = uuid
		}
		rows, err := a.db.QueryContext(ctx, `SELECT document_uuid, MAX(generation) FROM document_snapshot_heads WHERE document_uuid IN (`+placeholders(len(uuids))+`) GROUP BY document_uuid`, args...)
		if err != nil && !isMissingTable(err) {
			return err
		}
		if err == nil {
			for rows.Next() {
				var uuid string
				var generation int64
				if err = rows.Scan(&uuid, &generation); err != nil {
					rows.Close()
					return err
				}
				generations[uuid] = generation
			}
			if err = rows.Err(); err != nil {
				rows.Close()
				return err
			}
			rows.Close()
		}
	}
	refs := map[string]*DocumentBodyRef{}
	for _, item := range items {
		uuid := strings.TrimSpace(stringValue(item["uuid"]))
		generation := generations[uuid]
		item["snapshot_generation"] = generation
		if !withRef || generation <= 0 {
			continue
		}
		ref, ok := refs[uuid]
		if !ok {
			var err error
			if ref, err = a.resolveDocumentBodyRef(ctx, uuid); err != nil {
				return err
			}
			refs[uuid] = ref
		}
		if ref == nil {
			return snapshotError(503, "snapshot_reference_invalid")
		}
		item["snapshot_ref"] = ref.Map()
	}
	return nil
}

func wantsSnapshotRef(value string) bool { return value == "1" || value == "true" }

type bodyRefLookup struct {
	ref *DocumentBodyRef
	err error
}

// prefetchBodyRefs resolves heads before a planning transaction starts, so the
// nested read never runs while the planner holds document row locks. Errors are
// kept per document and only surface if that document is actually planned.
func (a *Adapter) prefetchBodyRefs(ctx context.Context, uuids []string) map[string]bodyRefLookup {
	lookups := make(map[string]bodyRefLookup, len(uuids))
	for _, uuid := range uuids {
		ref, err := a.resolveDocumentBodyRef(ctx, uuid)
		lookups[uuid] = bodyRefLookup{ref: ref, err: err}
	}
	return lookups
}

// currentSnapshotGeneration is 0 for a v1 document (or when v2 is not installed).
func currentSnapshotGeneration(ctx context.Context, db queryRower, uuid string) (int64, error) {
	var generation sql.NullInt64
	err := db.QueryRowContext(ctx, `SELECT MAX(generation) FROM document_snapshot_heads WHERE document_uuid = ?`, uuid).Scan(&generation)
	if isMissingTable(err) {
		return 0, nil
	}
	if err != nil {
		return 0, err
	}
	return generation.Int64, nil
}

// verifyPlannedBodyRef is called under the source document's row lock: the
// prefetched reference must still be the head, otherwise the planner would
// record a version older than the one a user can now see.
func verifyPlannedBodyRef(ctx context.Context, db queryRower, uuid string, lookup bodyRefLookup) (*DocumentBodyRef, error) {
	if lookup.err != nil {
		return nil, lookup.err
	}
	expected := int64(0)
	if lookup.ref != nil {
		expected = lookup.ref.Generation
	}
	generation, err := currentSnapshotGeneration(ctx, db, uuid)
	if err != nil {
		return nil, err
	}
	if generation != expected {
		return nil, httperror.New(http.StatusConflict, "document_snapshot_changed", "Document changed while the plan was prepared; retry")
	}
	return lookup.ref, nil
}
