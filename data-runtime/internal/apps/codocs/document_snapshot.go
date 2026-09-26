package codocs

// This repository is deliberately NOT registered as an HTTP operation. All
// writers/readers and the storage verifier must be migrated before activation.
import (
	"context"
	"crypto/sha256"
	"database/sql"
	"encoding/hex"
	"encoding/json"
	"errors"
	"math"
	"regexp"
	"strings"

	"github.com/huizhi-yun/data-runtime/internal/httperror"
)

var snapshotUUID = regexp.MustCompile(`^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$`)
var snapshotAttempt = regexp.MustCompile(`^[0-9a-f]{32}$`)

// SnapshotCommand is content-only. Renaming is intentionally not part of this
// first transaction primitive. Identity must come from a verified runtime route.
type SnapshotCommand struct {
	UUID              string
	Generation, Epoch int64
	MarkdownSHA256    string
	MarkdownSize      int64
	YjsSHA256         string
	YjsSize           int64
}

// SnapshotObject identifies an exact immutable provider version, not "latest".
type SnapshotObject struct{ Key, Version string }
type SnapshotObjects struct {
	Markdown SnapshotObject
	Yjs      *SnapshotObject
}
type SnapshotPlan struct {
	Candidate, Prefix string
	Generation        int64
	Replayed          bool
}

// SnapshotVerifier is a trusted server adapter, never a browser supplied flag.
// It must read the EXACT object versions using tenant/deployment-bound storage,
// verify both hashes/lengths and guarantee those versions remain addressable.
// No production verifier or HTTP registration is supplied in this increment.
type SnapshotVerifier func(context.Context, PersonalFolderCreationIdentity, SnapshotCommand, SnapshotObjects) error

func snapshotError(status int, code string) error { return httperror.New(status, code, code) }
func snapshotHash(s string) string                { h := sha256.Sum256([]byte(s)); return hex.EncodeToString(h[:]) }

func snapshotFacts(id PersonalFolderCreationIdentity, cmd SnapshotCommand) (key, digest, prefix string, err error) {
	for _, value := range []string{id.Tenant, id.Deployment, id.Actor, id.Key} {
		if value == "" || strings.TrimSpace(value) != value || strings.ContainsRune(value, 0) || len(value) > 200 {
			return "", "", "", snapshotError(403, "snapshot_identity_invalid")
		}
	}
	if !snapshotClientAllowed(id) {
		return "", "", "", snapshotError(403, "snapshot_identity_invalid")
	}
	if !snapshotUUID.MatchString(cmd.UUID) || cmd.Generation < 0 || cmd.Generation == math.MaxInt64 || cmd.Epoch < 0 || !personalDocumentContentHash.MatchString(cmd.MarkdownSHA256) || cmd.MarkdownSize < 0 || cmd.MarkdownSize > 10*1024*1024 || (cmd.YjsSHA256 == "" && cmd.YjsSize != 0) || (cmd.YjsSHA256 != "" && (!personalDocumentContentHash.MatchString(cmd.YjsSHA256) || cmd.YjsSize <= 0 || cmd.YjsSize > 100*1024*1024)) {
		return "", "", "", snapshotError(400, "snapshot_command_invalid")
	}
	raw, err := json.Marshal(cmd)
	if err != nil {
		return "", "", "", err
	}
	key = snapshotHash(strings.Join([]string{"codocs.snapshot.v2", id.Tenant, id.Deployment, id.Actor, id.Key}, "\x00"))
	digest = snapshotHash(string(raw))
	prefix = "codocs/snapshots/" + snapshotHash(id.Tenant+"\x00"+id.Deployment) + "/" + cmd.UUID + "/" + key + "/"
	return key, digest, prefix, nil
}

func validateSnapshotObjects(prefix string, cmd SnapshotCommand, objects SnapshotObjects) error {
	valid := func(object SnapshotObject, suffix string) (string, bool) {
		if !strings.HasPrefix(object.Key, prefix) || !strings.HasSuffix(object.Key, suffix) || object.Version == "" || object.Version == "null" || strings.TrimSpace(object.Version) != object.Version || len(object.Version) > 255 || strings.ContainsAny(object.Version, "\x00\r\n") {
			return "", false
		}
		attempt := strings.TrimSuffix(strings.TrimPrefix(object.Key, prefix), suffix)
		return attempt, snapshotAttempt.MatchString(attempt)
	}
	attempt, ok := valid(objects.Markdown, "/body.md")
	if !ok {
		return snapshotError(400, "snapshot_object_invalid")
	}
	if cmd.YjsSHA256 == "" {
		if objects.Yjs != nil {
			return snapshotError(400, "snapshot_pair_invalid")
		}
	} else {
		if objects.Yjs == nil {
			return snapshotError(400, "snapshot_pair_invalid")
		}
		yjsAttempt, ok := valid(*objects.Yjs, "/state.yjs")
		if !ok || attempt != yjsAttempt {
			return snapshotError(400, "snapshot_pair_invalid")
		}
	}
	return nil
}

// Lock the document first, then the head, then the candidate, in both commands.
// ACL reads are locking/current reads, not a repeatable-read snapshot from before
// a concurrent revoke. Only private documents are in this first increment.
func lockSnapshotDocument(ctx context.Context, tx *sql.Tx, id PersonalFolderCreationIdentity, uuid string) (int64, error) {
	var docID int64
	var owner, kind string
	var readonly, status int
	if err := tx.QueryRowContext(ctx, `SELECT id, owner_uid, doc_type, readonly_flag, status FROM documents WHERE uuid = ? FOR UPDATE`, uuid).Scan(&docID, &owner, &kind, &readonly, &status); errors.Is(err, sql.ErrNoRows) {
		return 0, snapshotError(404, "document_not_found")
	} else if err != nil {
		return 0, err
	}
	if status == 0 {
		return 0, snapshotError(404, "document_not_found")
	}
	if kind != "private" || status != 1 || readonly != 0 {
		return 0, snapshotError(403, "snapshot_document_not_writable")
	}
	if owner != id.Actor {
		var permission string
		err := tx.QueryRowContext(ctx, `SELECT permission FROM document_shares WHERE document_id = ? AND shared_to_uid = ? LIMIT 1 FOR UPDATE`, docID, id.Actor).Scan(&permission)
		if err != nil && !errors.Is(err, sql.ErrNoRows) {
			return 0, err
		}
		if err != nil || permission != "write" {
			return 0, snapshotError(403, "permission_denied")
		}
	}
	return docID, nil
}

func lockSnapshotHead(ctx context.Context, tx *sql.Tx, id PersonalFolderCreationIdentity, uuid string, create bool) (generation, epoch int64, err error) {
	if create {
		_, err = tx.ExecContext(ctx, `INSERT INTO document_snapshot_heads (tenant_code, deployment_code, document_uuid) VALUES (?, ?, ?) ON DUPLICATE KEY UPDATE document_uuid = document_uuid`, id.Tenant, id.Deployment, uuid)
		if err != nil {
			return
		}
	}
	err = tx.QueryRowContext(ctx, `SELECT generation, collaboration_epoch FROM document_snapshot_heads WHERE tenant_code = ? AND deployment_code = ? AND document_uuid = ? FOR UPDATE`, id.Tenant, id.Deployment, uuid).Scan(&generation, &epoch)
	if errors.Is(err, sql.ErrNoRows) {
		err = snapshotError(409, "snapshot_not_prepared")
	}
	return
}

type snapshotCandidate struct {
	uuid, digest, state string
	generation          sql.NullInt64
}

func readSnapshotCandidate(ctx context.Context, tx *sql.Tx, id PersonalFolderCreationIdentity, key string) (snapshotCandidate, error) {
	var c snapshotCandidate
	err := tx.QueryRowContext(ctx, `SELECT document_uuid, command_sha256, state, published_generation FROM document_snapshot_candidates WHERE tenant_code = ? AND deployment_code = ? AND candidate_key = ? FOR UPDATE`, id.Tenant, id.Deployment, key).Scan(&c.uuid, &c.digest, &c.state, &c.generation)
	return c, err
}
func checkSnapshotCandidate(c snapshotCandidate, cmd SnapshotCommand, digest string) error {
	if c.uuid != cmd.UUID || c.digest != digest {
		return snapshotError(409, "snapshot_key_conflict")
	}
	if (c.state != "prepared" && c.state != "published") || (c.state == "published" && (!c.generation.Valid || c.generation.Int64 != cmd.Generation+1)) || (c.state == "prepared" && c.generation.Valid) {
		return snapshotError(503, "snapshot_candidate_invalid")
	}
	return nil
}

// PrepareDocumentSnapshot persists intent but neither uploads nor changes the
// currently published content. Retrying a published intent preserves its result.
func (a *Adapter) PrepareDocumentSnapshot(ctx context.Context, id PersonalFolderCreationIdentity, cmd SnapshotCommand) (SnapshotPlan, error) {
	key, digest, prefix, err := snapshotFacts(id, cmd)
	if err != nil {
		return SnapshotPlan{}, err
	}
	tx, err := a.db.BeginTx(ctx, nil)
	if err != nil {
		return SnapshotPlan{}, err
	}
	defer tx.Rollback()
	if _, err = lockSnapshotDocument(ctx, tx, id, cmd.UUID); err != nil {
		return SnapshotPlan{}, err
	}
	generation, epoch, err := lockSnapshotHead(ctx, tx, id, cmd.UUID, true)
	if err != nil {
		return SnapshotPlan{}, err
	}
	c, err := readSnapshotCandidate(ctx, tx, id, key)
	if err == nil {
		if err = checkSnapshotCandidate(c, cmd, digest); err != nil {
			return SnapshotPlan{}, err
		}
		if c.state == "published" {
			return SnapshotPlan{Candidate: key, Prefix: prefix, Generation: c.generation.Int64, Replayed: true}, tx.Commit()
		}
	} else if !errors.Is(err, sql.ErrNoRows) {
		return SnapshotPlan{}, err
	}
	if generation != cmd.Generation || epoch != cmd.Epoch {
		return SnapshotPlan{}, snapshotError(409, "snapshot_generation_conflict")
	}
	if collabErr := checkCollaborationForWrite(ctx, tx, id, cmd, epoch); collabErr != nil {
		return SnapshotPlan{}, collabErr
	}
	if errors.Is(err, sql.ErrNoRows) {
		raw, marshalErr := json.Marshal(cmd)
		if marshalErr != nil {
			return SnapshotPlan{}, marshalErr
		}
		_, err = tx.ExecContext(ctx, `INSERT INTO document_snapshot_candidates (tenant_code, deployment_code, candidate_key, document_uuid, actor_uid, command_sha256, command_json, expected_generation, expected_epoch) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`, id.Tenant, id.Deployment, key, cmd.UUID, id.Actor, digest, string(raw), cmd.Generation, cmd.Epoch)
		if err != nil {
			return SnapshotPlan{}, err
		}
	}
	return SnapshotPlan{Candidate: key, Prefix: prefix, Generation: generation}, tx.Commit()
}

// PublishDocumentSnapshot verifies storage outside the SQL transaction, then
// rechecks ACL and generation under row locks. Candidate history is the v2
// publication receipt/version fact; legacy v1 service receipts are untouched.
func (a *Adapter) PublishDocumentSnapshot(ctx context.Context, id PersonalFolderCreationIdentity, cmd SnapshotCommand, objects SnapshotObjects, verify SnapshotVerifier) (SnapshotPlan, error) {
	key, digest, prefix, err := snapshotFacts(id, cmd)
	if err != nil {
		return SnapshotPlan{}, err
	}
	// Preflight must find an existing candidate; it must not create one. A
	// successful replay never calls storage, even after a later generation.
	preflight, err := a.snapshotPublication(ctx, id, cmd, key, digest, prefix, nil)
	if err != nil || preflight.Replayed {
		return preflight, err
	}
	if err = validateSnapshotObjects(prefix, cmd, objects); err != nil {
		return SnapshotPlan{}, err
	}
	if verify == nil {
		return SnapshotPlan{}, snapshotError(503, "snapshot_verifier_unavailable")
	}
	// Copy the optional pointer so a verifier cannot change the submitted pair.
	if objects.Yjs != nil {
		yjs := *objects.Yjs
		objects.Yjs = &yjs
	}
	verificationObjects := objects
	if objects.Yjs != nil {
		yjs := *objects.Yjs
		verificationObjects.Yjs = &yjs
	}
	if err = verify(ctx, id, cmd, verificationObjects); err != nil {
		return SnapshotPlan{}, snapshotError(503, "snapshot_storage_unverified")
	}
	return a.snapshotPublication(ctx, id, cmd, key, digest, prefix, &objects)
}

func (a *Adapter) snapshotPublication(ctx context.Context, id PersonalFolderCreationIdentity, cmd SnapshotCommand, key, digest, prefix string, verified *SnapshotObjects) (SnapshotPlan, error) {
	tx, err := a.db.BeginTx(ctx, nil)
	if err != nil {
		return SnapshotPlan{}, err
	}
	defer tx.Rollback()
	docID, err := lockSnapshotDocument(ctx, tx, id, cmd.UUID)
	if err != nil {
		return SnapshotPlan{}, err
	}
	generation, epoch, err := lockSnapshotHead(ctx, tx, id, cmd.UUID, false)
	if err != nil {
		return SnapshotPlan{}, err
	}
	c, err := readSnapshotCandidate(ctx, tx, id, key)
	if errors.Is(err, sql.ErrNoRows) {
		return SnapshotPlan{}, snapshotError(409, "snapshot_not_prepared")
	}
	if err != nil {
		return SnapshotPlan{}, err
	}
	if err = checkSnapshotCandidate(c, cmd, digest); err != nil {
		return SnapshotPlan{}, err
	}
	if c.state == "published" {
		return SnapshotPlan{Candidate: key, Prefix: prefix, Generation: c.generation.Int64, Replayed: true}, tx.Commit()
	}
	if generation != cmd.Generation || epoch != cmd.Epoch {
		return SnapshotPlan{}, snapshotError(409, "snapshot_generation_conflict")
	}
	if err = checkCollaborationForWrite(ctx, tx, id, cmd, epoch); err != nil {
		return SnapshotPlan{}, err
	}
	if verified == nil {
		return SnapshotPlan{Candidate: key, Prefix: prefix, Generation: generation}, tx.Commit()
	}
	raw, err := json.Marshal(verified)
	if err != nil {
		return SnapshotPlan{}, err
	}
	result, err := tx.ExecContext(ctx, `UPDATE document_snapshot_heads SET generation = ?, published_candidate = ?, objects_json = ? WHERE tenant_code = ? AND deployment_code = ? AND document_uuid = ? AND generation = ? AND collaboration_epoch = ?`, generation+1, key, string(raw), id.Tenant, id.Deployment, cmd.UUID, generation, epoch)
	if err != nil {
		return SnapshotPlan{}, err
	}
	if n, err := result.RowsAffected(); err != nil {
		return SnapshotPlan{}, err
	} else if n != 1 {
		return SnapshotPlan{}, snapshotError(409, "snapshot_generation_conflict")
	}
	result, err = tx.ExecContext(ctx, `UPDATE document_snapshot_candidates SET state = 'published', published_generation = ?, objects_json = ?, published_at = NOW() WHERE tenant_code = ? AND deployment_code = ? AND candidate_key = ? AND state = 'prepared'`, generation+1, string(raw), id.Tenant, id.Deployment, key)
	if err != nil {
		return SnapshotPlan{}, err
	}
	if n, err := result.RowsAffected(); err != nil {
		return SnapshotPlan{}, err
	} else if n != 1 {
		return SnapshotPlan{}, snapshotError(503, "snapshot_candidate_invalid")
	}
	if _, err = tx.ExecContext(ctx, `UPDATE documents SET content_size = ?, last_editor_uid = ?, updated_at = NOW() WHERE id = ?`, cmd.MarkdownSize, id.Actor, docID); err != nil {
		return SnapshotPlan{}, err
	}
	if id.Client == "collab.runtime" {
		if err = recordCollaborationPublication(ctx, tx, id, key); err != nil {
			return SnapshotPlan{}, err
		}
	}
	// History row in the same transaction; its content is the exact snapshot
	// object, not documents.oss_path (the derived copy).
	var maxVersion sql.NullInt64
	if err = tx.QueryRowContext(ctx, `SELECT MAX(version_num) FROM document_versions WHERE document_id = ?`, docID).Scan(&maxVersion); err != nil {
		return SnapshotPlan{}, err
	}
	if _, err = tx.ExecContext(ctx, `INSERT INTO document_versions (document_id, version_num, oss_version_id, object_key, editor_uid, content_size, content_sha256) VALUES (?, ?, ?, ?, ?, ?, ?)`, docID, maxVersion.Int64+1, verified.Markdown.Version, verified.Markdown.Key, id.Actor, cmd.MarkdownSize, cmd.MarkdownSHA256); err != nil {
		return SnapshotPlan{}, err
	}
	return SnapshotPlan{Candidate: key, Prefix: prefix, Generation: generation + 1}, tx.Commit()
}

// SnapshotUploadPrefix returns the prepared prefix a trusted uploader may
// write under for this exact command. It does not upload; the caller must
// write only fresh write-once keys below it and still publish afterwards.
func (a *Adapter) SnapshotUploadPrefix(ctx context.Context, id PersonalFolderCreationIdentity, cmd SnapshotCommand) (string, error) {
	key, digest, prefix, err := snapshotFacts(id, cmd)
	if err != nil {
		return "", err
	}
	var uuid, commandDigest, state string
	err = a.db.QueryRowContext(ctx, `SELECT document_uuid, command_sha256, state FROM document_snapshot_candidates WHERE tenant_code = ? AND deployment_code = ? AND candidate_key = ?`, id.Tenant, id.Deployment, key).Scan(&uuid, &commandDigest, &state)
	if errors.Is(err, sql.ErrNoRows) {
		return "", snapshotError(409, "snapshot_not_prepared")
	}
	if err != nil {
		return "", err
	}
	if uuid != cmd.UUID || commandDigest != digest {
		return "", snapshotError(409, "snapshot_key_conflict")
	}
	if state != "prepared" {
		return "", snapshotError(409, "snapshot_candidate_not_prepared")
	}
	return prefix, nil
}
