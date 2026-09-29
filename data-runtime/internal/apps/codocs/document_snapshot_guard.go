package codocs

import (
	"context"
	"database/sql"
	"errors"
	"net/http"

	"github.com/go-sql-driver/mysql"
	"github.com/huizhi-yun/data-runtime/internal/httperror"
)

// Once a document has a published v2 snapshot, its authoritative content is
// the snapshot reference. v1 content writers (Host v1 update, legacy PUT with
// content fields, Collab version creation) and Collab sessions must refuse it,
// otherwise they would overwrite the derived copy or resume stale .yjs state.
func errDocumentOnSnapshotV2() error {
	return httperror.New(http.StatusConflict, "document_on_snapshot_v2", "Document is saved with the v2 snapshot protocol")
}

// documentOnSnapshotV2 checks by UUID only: a Codocs database serves one
// tenant, and matching any deployment errs towards refusing v1 writes. A
// missing snapshot table means v2 was never installed, so no document is on it.
func documentOnSnapshotV2(ctx context.Context, db queryRower, uuid string) (bool, error) {
	var generation sql.NullInt64
	err := db.QueryRowContext(ctx, `SELECT MAX(generation) FROM document_snapshot_heads WHERE document_uuid = ?`, uuid).Scan(&generation)
	if isMissingTable(err) {
		return false, nil
	}
	if err != nil {
		return false, err
	}
	return generation.Valid && generation.Int64 > 0, nil
}

func refuseSnapshotV2Document(ctx context.Context, db queryRower, uuid string) error {
	if uuid == "" {
		return nil
	}
	onV2, err := documentOnSnapshotV2(ctx, db, uuid)
	if err != nil {
		return err
	}
	if onV2 {
		return errDocumentOnSnapshotV2()
	}
	return nil
}

// retireSnapshotHead takes a document out of v2 when it stops being a private
// document (e.g. project transfer). Its history rows keep their object_key, and
// prepare/publish refuse non-private documents, so the head cannot return.
func retireSnapshotHead(ctx context.Context, tx execer, uuid string) error {
	_, err := tx.ExecContext(ctx, `DELETE FROM document_snapshot_heads WHERE document_uuid = ?`, uuid)
	if isMissingTable(err) {
		return nil
	}
	return err
}

// isMissingTable reports MySQL error 1146: an optional v2 table is not installed.
func isMissingTable(err error) bool {
	var mysqlErr *mysql.MySQLError
	return errors.As(err, &mysqlErr) && mysqlErr.Number == 1146
}

type execer interface {
	ExecContext(context.Context, string, ...any) (sql.Result, error)
}

type queryRower interface {
	QueryRowContext(context.Context, string, ...any) *sql.Row
}
