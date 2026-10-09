// Package documentcatalog registers documents whose content lives outside the
// Codocs documents table (repository files, module-held content) so that a
// later index can enumerate every document asset in one place.
//
// Document asset design DOC-07. The catalog tables are structurally separate
// from documents: no existing Codocs read or write path can see or modify a
// registration. Only this package, the Runtime wiring that calls it and the
// reconcile command may reference the catalog tables and the document_catalog
// view; a source-level test enforces that.
//
// Registrations hold metadata only. Content stays in the owning system and is
// authorized there.
package documentcatalog

import (
	"context"
	"crypto/sha256"
	"database/sql"
	"encoding/hex"
	"encoding/json"
	"errors"
	"regexp"
	"sort"
	"strings"

	"github.com/go-sql-driver/mysql"
	"github.com/google/uuid"
)

// ErrUnavailable is returned when the catalog database or tables are not
// available. Callers must treat it as "not registered yet": the owning
// business operation still succeeds and the reconcile command repairs it.
var ErrUnavailable = errors.New("documentcatalog: catalog unavailable")

// ErrInvalid marks an entry that violates the closed registration contract.
var ErrInvalid = errors.New("documentcatalog: invalid entry")

// namespace is the fixed UUIDv5 namespace of catalog identities. It is part of
// the contract: changing it would orphan every registered entry.
var namespace = uuid.MustParse("3f6c8f0e-6b0a-5c1e-9d4a-7a2b8c5e1f90")

const (
	StorageGit    = "git"
	StorageModule = "module"
)

// kinds is the closed set of registrable sources and the storage each one uses.
var kinds = map[string]string{
	"aims/project_repo_document": StorageGit,
	"aims/requirement_spec":      StorageModule,
	"aims/project_weekly_report": StorageModule,
}

var (
	objectIDPattern = regexp.MustCompile(`^[A-Za-z0-9_.:-]{1,128}$`)
	shaPattern      = regexp.MustCompile(`^[a-f0-9]{64}$`)
)

// Entry is the desired registration of one external document.
type Entry struct {
	App, Kind, ObjectID  string
	Title                string
	OwnerType, OwnerCode string
	Locator              map[string]any
	Revision             string
	ContentSHA256        string
}

// UUID derives the stable catalog identity of an external document.
func UUID(tenant, app, kind, objectID string) string {
	return uuid.NewSHA1(namespace, []byte(tenant+"\x00"+app+"\x00"+kind+"\x00"+objectID)).String()
}

// StorageType returns the storage of a registered kind.
func StorageType(app, kind string) (string, bool) {
	storage, ok := kinds[app+"/"+kind]
	return storage, ok
}

func (e Entry) validate() error {
	if _, ok := StorageType(e.App, e.Kind); !ok || !objectIDPattern.MatchString(e.ObjectID) {
		return ErrInvalid
	}
	title := strings.TrimSpace(e.Title)
	if title == "" || len(title) > 255 || len(e.Revision) > 128 || len(e.OwnerCode) == 0 || len(e.OwnerCode) > 100 {
		return ErrInvalid
	}
	if e.OwnerType != "project" && e.OwnerType != "portfolio" && e.OwnerType != "product_line" {
		return ErrInvalid
	}
	if e.ContentSHA256 != "" && !shaPattern.MatchString(e.ContentSHA256) {
		return ErrInvalid
	}
	if len(e.Locator) == 0 {
		return ErrInvalid
	}
	return nil
}

// Scope limits a reconcile to one app and a set of kinds, and optionally to
// specific objects of those kinds. Only entries inside the scope are created,
// updated or marked inactive.
type Scope struct {
	App       string
	Kinds     []string
	ObjectIDs []string // empty means every object of the kinds
	// OwnerType and OwnerCode, when set, narrow the scope to one owner: a
	// reconcile then creates, updates and deactivates only that owner's entries.
	OwnerType, OwnerCode string
}

// Filter narrows what a source returns and what a reconcile may touch. The
// zero value means every object of the kind and is reserved for the reconcile
// command.
type Filter struct {
	ObjectIDs            []string
	OwnerType, OwnerCode string
}

// Change is one difference between the desired state and the catalog.
type Change struct {
	Action   string `json:"action"` // create, update, deactivate
	UUID     string `json:"uuid"`
	Kind     string `json:"kind"`
	ObjectID string `json:"objectId"`
}

// Report is the outcome of a reconcile. With apply=false nothing is written.
type Report struct {
	Applied   bool     `json:"applied"`
	Desired   int      `json:"desired"`
	Unchanged int      `json:"unchanged"`
	Changes   []Change `json:"changes"`
}

// ErrBusy is returned when another reconcile of the same kind holds the
// serialization lock for too long. Nothing was written; retry later.
var ErrBusy = errors.New("documentcatalog: reconcile busy")

// Store reads and writes the catalog tables of one Codocs database.
type Store struct{ db *sql.DB }

type beginner interface {
	BeginTx(context.Context, *sql.TxOptions) (*sql.Tx, error)
}

func NewStore(db *sql.DB) *Store { return &Store{db: db} }

func unavailable(err error) bool {
	var driverErr *mysql.MySQLError
	if errors.As(err, &driverErr) {
		// 1146 table missing, 1049 unknown database, 1045/1044 access denied.
		return driverErr.Number == 1146 || driverErr.Number == 1049 || driverErr.Number == 1045 || driverErr.Number == 1044
	}
	return errors.Is(err, sql.ErrConnDone) || errors.Is(err, mysql.ErrInvalidConn)
}

type stored struct {
	uuid, title, ownerType, ownerCode, locator, revision, status string
	sha                                                          sql.NullString
}

// Reconcile makes the catalog match desired inside scope. It is idempotent:
// applying the same desired state twice changes nothing the second time.
func (s *Store) Reconcile(ctx context.Context, tenant string, scope Scope, desired []Entry, apply bool) (Report, error) {
	if s == nil || s.db == nil {
		return Report{Applied: apply, Desired: len(desired), Changes: []Change{}}, ErrUnavailable
	}
	return reconcile(ctx, s.db, tenant, scope, desired, apply)
}

func reconcile(ctx context.Context, db beginner, tenant string, scope Scope, desired []Entry, apply bool) (Report, error) {
	report := Report{Applied: apply, Desired: len(desired), Changes: []Change{}}
	if strings.TrimSpace(tenant) == "" || scope.App == "" || len(scope.Kinds) == 0 || (scope.OwnerType == "") != (scope.OwnerCode == "") {
		return report, ErrInvalid
	}
	inScope := map[string]bool{}
	for _, kind := range scope.Kinds {
		if _, ok := StorageType(scope.App, kind); !ok {
			return report, ErrInvalid
		}
		inScope[kind] = true
	}
	objects := map[string]bool{}
	for _, id := range scope.ObjectIDs {
		objects[id] = true
	}
	want := map[string]Entry{}
	for _, entry := range desired {
		if entry.App != scope.App || !inScope[entry.Kind] || (len(objects) > 0 && !objects[entry.ObjectID]) || (scope.OwnerCode != "" && (entry.OwnerType != scope.OwnerType || entry.OwnerCode != scope.OwnerCode)) {
			return report, ErrInvalid
		}
		if err := entry.validate(); err != nil {
			return report, err
		}
		want[UUID(tenant, entry.App, entry.Kind, entry.ObjectID)] = entry
	}

	tx, err := db.BeginTx(ctx, nil)
	if err != nil {
		if unavailable(err) {
			return report, ErrUnavailable
		}
		return report, err
	}
	defer tx.Rollback()
	query := "SELECT uuid,source_kind,source_object_id,title,owner_type,owner_code,CAST(storage_locator AS CHAR),storage_revision,content_sha256,status FROM document_catalog_entries WHERE tenant_code=? AND source_app=? AND source_kind IN (" + strings.TrimSuffix(strings.Repeat("?,", len(scope.Kinds)), ",") + ")"
	args := []any{tenant, scope.App}
	for _, kind := range scope.Kinds {
		args = append(args, kind)
	}
	if len(scope.ObjectIDs) > 0 {
		query += " AND source_object_id IN (" + strings.TrimSuffix(strings.Repeat("?,", len(scope.ObjectIDs)), ",") + ")"
		for _, id := range scope.ObjectIDs {
			args = append(args, id)
		}
	}
	if scope.OwnerCode != "" {
		query += " AND owner_type=? AND owner_code=?"
		args = append(args, scope.OwnerType, scope.OwnerCode)
	}
	if apply {
		query += " FOR UPDATE"
	}
	rows, err := tx.QueryContext(ctx, query, args...)
	if err != nil {
		if unavailable(err) {
			return report, ErrUnavailable
		}
		return report, err
	}
	have := map[string]stored{}
	kindOf, objectOf := map[string]string{}, map[string]string{}
	for rows.Next() {
		var row stored
		var kind, object string
		if err = rows.Scan(&row.uuid, &kind, &object, &row.title, &row.ownerType, &row.ownerCode, &row.locator, &row.revision, &row.sha, &row.status); err != nil {
			rows.Close()
			return report, err
		}
		have[row.uuid], kindOf[row.uuid], objectOf[row.uuid] = row, kind, object
	}
	if err = rows.Close(); err != nil {
		return report, err
	}

	ids := make([]string, 0, len(want))
	for id := range want {
		ids = append(ids, id)
	}
	sort.Strings(ids)
	for _, id := range ids {
		entry := want[id]
		storage, _ := StorageType(entry.App, entry.Kind)
		locator, _ := json.Marshal(entry.Locator)
		var sha any
		if entry.ContentSHA256 != "" {
			sha = entry.ContentSHA256
		}
		row, exists := have[id]
		switch {
		case !exists:
			report.Changes = append(report.Changes, Change{"create", id, entry.Kind, entry.ObjectID})
			if apply {
				if _, err = tx.ExecContext(ctx, "INSERT INTO document_catalog_entries(uuid,tenant_code,source_app,source_kind,source_object_id,title,owner_type,owner_code,storage_type,storage_locator,storage_revision,content_sha256,status,row_version,registered_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,'active',1,UTC_TIMESTAMP(3),UTC_TIMESTAMP(3))", id, tenant, entry.App, entry.Kind, entry.ObjectID, strings.TrimSpace(entry.Title), entry.OwnerType, entry.OwnerCode, storage, string(locator), entry.Revision, sha); err != nil {
					return report, err
				}
			}
		case row.status == "active" && row.title == strings.TrimSpace(entry.Title) && row.ownerType == entry.OwnerType && row.ownerCode == entry.OwnerCode && sameJSON(row.locator, locator) && row.revision == entry.Revision && row.sha.String == entry.ContentSHA256:
			report.Unchanged++
			continue
		default:
			report.Changes = append(report.Changes, Change{"update", id, entry.Kind, entry.ObjectID})
			if apply {
				if _, err = tx.ExecContext(ctx, "UPDATE document_catalog_entries SET title=?,owner_type=?,owner_code=?,storage_locator=?,storage_revision=?,content_sha256=?,status='active',row_version=row_version+1,updated_at=UTC_TIMESTAMP(3) WHERE uuid=?", strings.TrimSpace(entry.Title), entry.OwnerType, entry.OwnerCode, string(locator), entry.Revision, sha, id); err != nil {
					return report, err
				}
			}
		}
		if apply {
			// One immutable version row per revision; replays are no-ops.
			if _, err = tx.ExecContext(ctx, "INSERT IGNORE INTO document_catalog_entry_versions(entry_uuid,storage_revision,content_sha256,recorded_at) VALUES(?,?,?,UTC_TIMESTAMP(3))", id, entry.Revision, sha); err != nil {
				return report, err
			}
		}
	}
	// Objects that no longer exist or are no longer registrable stay in the
	// catalog as inactive entries; nothing is physically deleted.
	stale := make([]string, 0)
	for id, row := range have {
		if _, ok := want[id]; !ok && row.status == "active" {
			stale = append(stale, id)
		}
	}
	sort.Strings(stale)
	for _, id := range stale {
		report.Changes = append(report.Changes, Change{"deactivate", id, kindOf[id], objectOf[id]})
		if apply {
			if _, err = tx.ExecContext(ctx, "UPDATE document_catalog_entries SET status='inactive',row_version=row_version+1,updated_at=UTC_TIMESTAMP(3) WHERE uuid=? AND status='active'", id); err != nil {
				return report, err
			}
		}
	}
	if !apply {
		return report, nil
	}
	return report, tx.Commit()
}

func sameJSON(storedJSON string, desired []byte) bool {
	var a, b any
	if json.Unmarshal([]byte(storedJSON), &a) != nil || json.Unmarshal(desired, &b) != nil {
		return false
	}
	left, _ := json.Marshal(a)
	right, _ := json.Marshal(b)
	return string(left) == string(right)
}

// Source states which documents of one kind an owning module wants registered.
type Source interface {
	DocumentCatalogEntries(ctx context.Context, kind string, filter Filter) ([]Entry, error)
}

func lockName(tenant, app, kind string) string {
	sum := sha256.Sum256([]byte(tenant + "\x00" + app + "\x00" + kind))
	return "hzy-doccat:" + hex.EncodeToString(sum[:20])
}

// Sync reconciles one kind of one app from its source. With apply=false it
// only reports the differences.
//
// Ordering contract: an applying Sync first takes a per-(tenant, app, kind)
// lock on the catalog database and only then reads the source. Reconciles of a
// kind are therefore serialized across goroutines, processes and the reconcile
// command, and each one writes a source state at least as new as the one
// written before it: the current revision of an entry never moves backwards
// because of a late or reordered trigger.
func Sync(ctx context.Context, store *Store, tenant, app string, source Source, kind string, filter Filter, apply bool) (Report, error) {
	empty := Report{Applied: apply, Changes: []Change{}}
	if store == nil || store.db == nil || source == nil {
		return empty, ErrUnavailable
	}
	scope := Scope{App: app, Kinds: []string{kind}, ObjectIDs: filter.ObjectIDs, OwnerType: filter.OwnerType, OwnerCode: filter.OwnerCode}
	if !apply {
		desired, err := source.DocumentCatalogEntries(ctx, kind, filter)
		if err != nil {
			return empty, err
		}
		return store.Reconcile(ctx, tenant, scope, desired, false)
	}
	conn, err := store.db.Conn(ctx)
	if err != nil {
		if unavailable(err) {
			return empty, ErrUnavailable
		}
		return empty, err
	}
	defer conn.Close()
	name := lockName(tenant, app, kind)
	var locked sql.NullInt64
	if err = conn.QueryRowContext(ctx, "SELECT GET_LOCK(?, 10)", name).Scan(&locked); err != nil {
		if unavailable(err) {
			return empty, ErrUnavailable
		}
		return empty, err
	}
	if locked.Int64 != 1 {
		return empty, ErrBusy
	}
	// Release on the same session even if the request context is already done.
	defer conn.ExecContext(context.WithoutCancel(ctx), "SELECT RELEASE_LOCK(?)", name)
	desired, err := source.DocumentCatalogEntries(ctx, kind, filter)
	if err != nil {
		return empty, err
	}
	return reconcile(ctx, conn, tenant, scope, desired, true)
}
