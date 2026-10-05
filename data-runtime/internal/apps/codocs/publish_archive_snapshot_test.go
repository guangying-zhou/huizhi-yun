package codocs

import (
	"context"
	"database/sql"
	"regexp"
	"testing"

	"github.com/DATA-DOG/go-sqlmock"
)

// A request without a frozen review copy archives the live document. For a v2
// document the plan must carry the exact published version and withhold the
// derived mirror path.
func expectUnfrozenArchivePlan(mock sqlmock.Sqlmock, documentUUID string) {
	mock.ExpectBegin()
	mock.ExpectQuery(`(?s)SELECT pr\.id,pr\.document_id.*FROM document_publish_requests pr.*FOR UPDATE`).WithArgs(int64(42)).
		WillReturnRows(sqlmock.NewRows(publishExecutionColumns).AddRow(
			int64(42), int64(7), documentUUID, "部门发文", "会议记录", "initiator", "department", `{}`,
			nil, "approved", nil, nil, nil, "Minutes", "department", "codocs/departments/D1/minutes.md", int64(128), "D1", int64(1)))
	mock.ExpectQuery(regexp.QuoteMeta("SELECT uuid FROM documents WHERE oss_path=? AND status<>0 LIMIT 1")).
		WithArgs("codocs/departments/D1/records/Minutes_42.md").WillReturnError(sql.ErrNoRows)
	mock.ExpectCommit()
}

func TestPreparePublishArchiveUsesExactSnapshotForV2SourceWithoutReviewCopy(t *testing.T) {
	db, mock, _ := sqlmock.New()
	defer db.Close()
	expectUnfrozenArchivePlan(mock, bodyRefUUID)
	key, version, sha, size := expectPublishedHead(t, mock, bodyRefUUID)

	result, err := (&Adapter{db: db}).preparePublishArchive(context.Background(), "42", trustedPublishExecutionQuery("initiator"))
	if err != nil {
		t.Fatal(err)
	}
	if result["sourceOssPath"] != "" {
		t.Fatalf("sourceOssPath = %#v, want the stale mirror path withheld", result["sourceOssPath"])
	}
	ref, _ := result["sourceBodyRef"].(map[string]any)
	if ref == nil || ref["sha256"] != sha || ref["size"] != size || ref["markdown"].(map[string]any)["key"] != key || ref["markdown"].(map[string]any)["version"] != version {
		t.Fatalf("sourceBodyRef = %#v", result["sourceBodyRef"])
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}

func TestPreparePublishArchiveKeepsMirrorPathForV1SourceAndFrozenCopies(t *testing.T) {
	t.Run("v1 source without review copy", func(t *testing.T) {
		db, mock, _ := sqlmock.New()
		defer db.Close()
		expectUnfrozenArchivePlan(mock, bodyRefUUID)
		mock.ExpectQuery(`SELECT tenant_code, deployment_code FROM document_snapshot_heads`).WithArgs(bodyRefUUID).WillReturnRows(sqlmock.NewRows([]string{"tenant_code", "deployment_code"}))
		result, err := (&Adapter{db: db}).preparePublishArchive(context.Background(), "42", trustedPublishExecutionQuery("initiator"))
		if err != nil {
			t.Fatal(err)
		}
		if result["sourceOssPath"] != "codocs/departments/D1/minutes.md" || result["sourceBodyRef"] != nil {
			t.Fatalf("plan = %#v", result)
		}
	})
	t.Run("frozen review copy is authoritative and needs no head lookup", func(t *testing.T) {
		db, mock, _ := sqlmock.New()
		defer db.Close()
		mock.ExpectBegin()
		expectPublishExecutionRow(mock, nil)
		mock.ExpectQuery(regexp.QuoteMeta("SELECT uuid FROM documents WHERE oss_path=? AND status<>0 LIMIT 1")).
			WithArgs("codocs/departments/D1/outsides/Outbound_Notice_42.md").WillReturnError(sql.ErrNoRows)
		mock.ExpectCommit()
		result, err := (&Adapter{db: db}).preparePublishArchive(context.Background(), "42", trustedPublishExecutionQuery("initiator"))
		if err != nil {
			t.Fatal(err)
		}
		if result["sourceOssPath"] != "codocs/reviews/42/source.md" || result["sourceBodyRef"] != nil {
			t.Fatalf("plan = %#v", result)
		}
		if err := mock.ExpectationsWereMet(); err != nil {
			t.Fatal(err)
		}
	})
}
