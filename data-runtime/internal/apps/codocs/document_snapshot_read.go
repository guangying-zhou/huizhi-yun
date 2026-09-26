package codocs

// Dormant v2 read primitive. No HTTP route calls this until every writer and
// storage consumer has migrated to the same published-reference contract.
import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"math"
	"reflect"
	"strings"
)

type SnapshotRead struct {
	Generation int64
	// Epoch is the head's collaboration epoch; writers must send it back.
	Epoch      int64
	LegacyPath string
	Objects    *SnapshotObjects
	// Published Markdown facts, so readers can verify the exact bytes.
	MarkdownSize   int64
	MarkdownSHA256 string
	// Paired Yjs facts (empty when the generation has no Yjs object).
	YjsSize   int64
	YjsSHA256 string
}

// ReadDocumentSnapshot resolves one authorized, committed generation. The
// caller must use the exact provider versions; it must not read object latest.
func (a *Adapter) ReadDocumentSnapshot(ctx context.Context, id PersonalFolderCreationIdentity, uuid string) (SnapshotRead, error) {
	if !snapshotUUID.MatchString(uuid) || !snapshotClientAllowed(id) || !snapshotReadIdentityValid(id.Tenant) || !snapshotReadIdentityValid(id.Deployment) || !snapshotReadIdentityValid(id.Actor) {
		return SnapshotRead{}, snapshotError(403, "snapshot_identity_invalid")
	}
	tx, err := a.db.BeginTx(ctx, &sql.TxOptions{ReadOnly: true})
	if err != nil {
		return SnapshotRead{}, err
	}
	defer tx.Rollback()
	var docID int64
	var owner, kind, legacyPath string
	var status int
	err = tx.QueryRowContext(ctx, `SELECT id, owner_uid, doc_type, COALESCE(oss_path,''), status FROM documents WHERE uuid = ? FOR SHARE`, uuid).Scan(&docID, &owner, &kind, &legacyPath, &status)
	if errors.Is(err, sql.ErrNoRows) {
		return SnapshotRead{}, snapshotError(404, "document_not_found")
	}
	if err != nil {
		return SnapshotRead{}, err
	}
	if status != 1 || kind != "private" {
		return SnapshotRead{}, snapshotError(404, "document_not_found")
	}
	if owner != id.Actor {
		var permission string
		err = tx.QueryRowContext(ctx, `SELECT permission FROM document_shares WHERE document_id = ? AND shared_to_uid = ? LIMIT 1 FOR SHARE`, docID, id.Actor).Scan(&permission)
		if errors.Is(err, sql.ErrNoRows) || (err == nil && permission != "read" && permission != "write") {
			return SnapshotRead{}, snapshotError(404, "document_not_found")
		}
		if err != nil {
			return SnapshotRead{}, err
		}
	}
	var generation, epoch int64
	var candidate sql.NullString
	var headObjects []byte
	err = tx.QueryRowContext(ctx, `SELECT generation, collaboration_epoch, published_candidate, objects_json FROM document_snapshot_heads WHERE tenant_code = ? AND deployment_code = ? AND document_uuid = ? FOR SHARE`, id.Tenant, id.Deployment, uuid).Scan(&generation, &epoch, &candidate, &headObjects)
	if errors.Is(err, sql.ErrNoRows) {
		return SnapshotRead{LegacyPath: legacyPath}, tx.Commit()
	}
	if err != nil {
		return SnapshotRead{}, err
	}
	if generation == 0 && !candidate.Valid && len(headObjects) == 0 {
		return SnapshotRead{Epoch: epoch, LegacyPath: legacyPath}, tx.Commit()
	}
	if generation <= 0 || !candidate.Valid || !personalDocumentContentHash.MatchString(candidate.String) || len(headObjects) == 0 {
		return SnapshotRead{}, snapshotError(503, "snapshot_reference_invalid")
	}
	var publishedGeneration int64
	var expectedGeneration, expectedEpoch int64
	var state, commandDigest string
	var commandJSON, publishedObjects []byte
	err = tx.QueryRowContext(ctx, `SELECT state, published_generation, command_sha256, expected_generation, expected_epoch, command_json, objects_json FROM document_snapshot_candidates WHERE tenant_code = ? AND deployment_code = ? AND candidate_key = ? AND document_uuid = ? FOR SHARE`, id.Tenant, id.Deployment, candidate.String, uuid).Scan(&state, &publishedGeneration, &commandDigest, &expectedGeneration, &expectedEpoch, &commandJSON, &publishedObjects)
	if err != nil {
		return SnapshotRead{}, snapshotError(503, "snapshot_reference_invalid")
	}
	var command SnapshotCommand
	var objects, candidateObjects SnapshotObjects
	if state != "published" || publishedGeneration != generation || json.Unmarshal(commandJSON, &command) != nil || !snapshotReadCommandValid(command, uuid, generation) || command.Generation != expectedGeneration || command.Epoch != expectedEpoch || snapshotReadCommandDigest(command) != commandDigest || json.Unmarshal(headObjects, &objects) != nil || json.Unmarshal(publishedObjects, &candidateObjects) != nil || !reflect.DeepEqual(objects, candidateObjects) {
		return SnapshotRead{}, snapshotError(503, "snapshot_reference_invalid")
	}
	prefix := "codocs/snapshots/" + snapshotHash(id.Tenant+"\x00"+id.Deployment) + "/" + uuid + "/" + candidate.String + "/"
	if validateSnapshotObjects(prefix, command, objects) != nil {
		return SnapshotRead{}, snapshotError(503, "snapshot_reference_invalid")
	}
	return SnapshotRead{Generation: generation, Epoch: epoch, Objects: &objects, MarkdownSize: command.MarkdownSize, MarkdownSHA256: command.MarkdownSHA256, YjsSize: command.YjsSize, YjsSHA256: command.YjsSHA256}, tx.Commit()
}

func snapshotReadIdentityValid(value string) bool {
	return value != "" && len(value) <= 200 && strings.TrimSpace(value) == value && !strings.ContainsRune(value, 0)
}

func snapshotReadCommandValid(command SnapshotCommand, uuid string, generation int64) bool {
	return command.UUID == uuid && command.Generation >= 0 && command.Generation < math.MaxInt64 && command.Generation+1 == generation && command.Epoch >= 0 && personalDocumentContentHash.MatchString(command.MarkdownSHA256) && command.MarkdownSize >= 0 && command.MarkdownSize <= 10*1024*1024 && ((command.YjsSHA256 == "" && command.YjsSize == 0) || (personalDocumentContentHash.MatchString(command.YjsSHA256) && command.YjsSize > 0 && command.YjsSize <= 100*1024*1024))
}

func snapshotReadCommandDigest(command SnapshotCommand) string {
	raw, err := json.Marshal(command)
	if err != nil {
		return ""
	}
	return snapshotHash(string(raw))
}
