package codocs

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/url"
	"regexp"
	"strings"
	"testing"

	"github.com/DATA-DOG/go-sqlmock"
	"github.com/huizhi-yun/data-runtime/internal/httperror"
)

const bodyRefUUID = "00000000-0000-4000-8000-0000000000b1"

// expectSnapshotGeneration answers the batch generation lookup used to mark
// documents with snapshot_generation.
func expectSnapshotGeneration(mock sqlmock.Sqlmock, uuid string, generation int64) {
	rows := sqlmock.NewRows([]string{"document_uuid", "MAX(generation)"})
	if generation > 0 {
		rows.AddRow(uuid, generation)
	}
	mock.ExpectQuery(regexp.QuoteMeta("SELECT document_uuid, MAX(generation) FROM document_snapshot_heads WHERE document_uuid IN (?) GROUP BY document_uuid")).WithArgs(uuid).WillReturnRows(rows)
}

// expectNotSnapshotV2 answers refuseSnapshotV2Document / currentSnapshotGeneration.
func expectSnapshotGenerationOf(mock sqlmock.Sqlmock, uuid string, generation any) {
	mock.ExpectQuery(regexp.QuoteMeta("SELECT MAX(generation) FROM document_snapshot_heads WHERE document_uuid = ?")).WithArgs(uuid).WillReturnRows(sqlmock.NewRows([]string{"MAX(generation)"}).AddRow(generation))
}

func expectNotSnapshotV2(mock sqlmock.Sqlmock, uuid string) {
	expectSnapshotGenerationOf(mock, uuid, nil)
}

// expectPublishedHead answers resolveDocumentBodyRef for a valid published
// generation 1 head whose candidate carries a matching command digest.
func expectPublishedHead(t *testing.T, mock sqlmock.Sqlmock, uuid string) (key, version, sha string, size int64) {
	t.Helper()
	tenant, deployment, candidate := "T1", "D1", strings.Repeat("c", 64)
	sha, size = strings.Repeat("a", 64), int64(11)
	command := SnapshotCommand{UUID: uuid, Generation: 0, Epoch: 0, MarkdownSHA256: sha, MarkdownSize: size}
	prefix := "codocs/snapshots/" + snapshotHash(tenant+"\x00"+deployment) + "/" + uuid + "/" + candidate + "/"
	objects := SnapshotObjects{Markdown: SnapshotObject{Key: prefix + strings.Repeat("d", 32) + "/body.md", Version: "v-md-1"}}
	commandJSON, _ := json.Marshal(command)
	objectsJSON, _ := json.Marshal(objects)
	mock.ExpectQuery(`SELECT tenant_code, deployment_code FROM document_snapshot_heads`).WithArgs(uuid).WillReturnRows(sqlmock.NewRows([]string{"tenant_code", "deployment_code"}).AddRow(tenant, deployment))
	mock.ExpectBegin()
	mock.ExpectQuery(`FROM document_snapshot_heads WHERE tenant_code = \? AND deployment_code = \? AND document_uuid = \? FOR SHARE`).WithArgs(tenant, deployment, uuid).
		WillReturnRows(sqlmock.NewRows([]string{"generation", "collaboration_epoch", "published_candidate", "objects_json"}).AddRow(1, 3, candidate, objectsJSON))
	mock.ExpectQuery(`FROM document_snapshot_candidates WHERE tenant_code = \? AND deployment_code = \? AND candidate_key = \? AND document_uuid = \? FOR SHARE`).WithArgs(tenant, deployment, candidate, uuid).
		WillReturnRows(sqlmock.NewRows([]string{"state", "published_generation", "command_sha256", "expected_generation", "expected_epoch", "command_json", "objects_json"}).
			AddRow("published", 1, snapshotReadCommandDigest(command), 0, 0, commandJSON, objectsJSON))
	mock.ExpectCommit()
	return objects.Markdown.Key, objects.Markdown.Version, sha, size
}

func TestResolveDocumentBodyRefReturnsExactVerifiedVersion(t *testing.T) {
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	key, version, sha, size := expectPublishedHead(t, mock, bodyRefUUID)
	ref, err := (&Adapter{db: db}).resolveDocumentBodyRef(context.Background(), bodyRefUUID)
	if err != nil || ref == nil {
		t.Fatalf("ref=%v err=%v", ref, err)
	}
	if ref.Generation != 1 || ref.Epoch != 3 || ref.Key != key || ref.Version != version || ref.SHA256 != sha || ref.Size != size {
		t.Fatalf("ref = %+v", ref)
	}
	wire := ref.Map()
	if wire["markdown"].(map[string]any)["key"] != key || wire["sha256"] != sha {
		t.Fatalf("wire = %#v", wire)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}

func TestResolveDocumentBodyRefIsNilForV1AndFailsClosedOnBadReference(t *testing.T) {
	t.Run("no head is v1", func(t *testing.T) {
		db, mock, _ := sqlmock.New()
		defer db.Close()
		mock.ExpectQuery(`SELECT tenant_code, deployment_code FROM document_snapshot_heads`).WithArgs(bodyRefUUID).WillReturnRows(sqlmock.NewRows([]string{"tenant_code", "deployment_code"}))
		ref, err := (&Adapter{db: db}).resolveDocumentBodyRef(context.Background(), bodyRefUUID)
		if err != nil || ref != nil {
			t.Fatalf("ref=%v err=%v", ref, err)
		}
	})
	t.Run("candidate that does not match the head is refused", func(t *testing.T) {
		db, mock, _ := sqlmock.New()
		defer db.Close()
		mock.ExpectQuery(`SELECT tenant_code, deployment_code FROM document_snapshot_heads`).WithArgs(bodyRefUUID).WillReturnRows(sqlmock.NewRows([]string{"tenant_code", "deployment_code"}).AddRow("T1", "D1"))
		mock.ExpectBegin()
		mock.ExpectQuery(`FROM document_snapshot_heads WHERE`).WillReturnRows(sqlmock.NewRows([]string{"generation", "collaboration_epoch", "published_candidate", "objects_json"}).AddRow(1, 0, strings.Repeat("c", 64), []byte(`{"Markdown":{"Key":"x","Version":"y"}}`)))
		mock.ExpectQuery(`FROM document_snapshot_candidates`).WillReturnError(errors.New("boom"))
		mock.ExpectRollback()
		ref, err := (&Adapter{db: db}).resolveDocumentBodyRef(context.Background(), bodyRefUUID)
		var he httperror.Error
		if ref != nil || !errors.As(err, &he) || he.Status != 503 || he.Code != "snapshot_reference_invalid" {
			t.Fatalf("ref=%v err=%v", ref, err)
		}
	})
}

func TestVerifyPlannedBodyRefRequiresTheSameGenerationUnderTheDocumentLock(t *testing.T) {
	for _, test := range []struct {
		name      string
		lookup    bodyRefLookup
		current   any
		wantErr   string
		wantV2Ref bool
	}{
		{name: "v1 stays v1", lookup: bodyRefLookup{}, current: nil},
		{name: "v1 became v2", lookup: bodyRefLookup{}, current: int64(2), wantErr: "document_snapshot_changed"},
		{name: "v2 unchanged", lookup: bodyRefLookup{ref: &DocumentBodyRef{Generation: 4}}, current: int64(4), wantV2Ref: true},
		{name: "v2 advanced", lookup: bodyRefLookup{ref: &DocumentBodyRef{Generation: 4}}, current: int64(5), wantErr: "document_snapshot_changed"},
		{name: "unverifiable head is surfaced", lookup: bodyRefLookup{err: snapshotError(503, "snapshot_reference_invalid")}, wantErr: "snapshot_reference_invalid"},
	} {
		t.Run(test.name, func(t *testing.T) {
			db, mock, _ := sqlmock.New()
			defer db.Close()
			if test.lookup.err == nil {
				expectSnapshotGenerationOf(mock, bodyRefUUID, test.current)
			}
			ref, err := verifyPlannedBodyRef(context.Background(), db, bodyRefUUID, test.lookup)
			if test.wantErr == "" {
				if err != nil || (ref != nil) != test.wantV2Ref {
					t.Fatalf("ref=%v err=%v", ref, err)
				}
				return
			}
			var he httperror.Error
			if !errors.As(err, &he) || he.Code != test.wantErr {
				t.Fatalf("err = %v, want %s", err, test.wantErr)
			}
		})
	}
}

func TestAnnotateSnapshotStateMarksGenerationAndOnlyReturnsRefWhenAsked(t *testing.T) {
	t.Run("generation only", func(t *testing.T) {
		db, mock, _ := sqlmock.New()
		defer db.Close()
		expectSnapshotGeneration(mock, bodyRefUUID, 2)
		items := []map[string]any{{"uuid": bodyRefUUID}}
		if err := (&Adapter{db: db}).annotateSnapshotState(context.Background(), items, false); err != nil {
			t.Fatal(err)
		}
		if items[0]["snapshot_generation"] != int64(2) || items[0]["snapshot_ref"] != nil {
			t.Fatalf("item = %#v", items[0])
		}
	})
	t.Run("v1 has generation zero and no ref", func(t *testing.T) {
		db, mock, _ := sqlmock.New()
		defer db.Close()
		expectSnapshotGeneration(mock, bodyRefUUID, 0)
		items := []map[string]any{{"uuid": bodyRefUUID}}
		if err := (&Adapter{db: db}).annotateSnapshotState(context.Background(), items, true); err != nil {
			t.Fatal(err)
		}
		if items[0]["snapshot_generation"] != int64(0) || items[0]["snapshot_ref"] != nil {
			t.Fatalf("item = %#v", items[0])
		}
	})
	t.Run("ref requested for v2", func(t *testing.T) {
		db, mock, _ := sqlmock.New()
		defer db.Close()
		expectSnapshotGeneration(mock, bodyRefUUID, 1)
		key, _, _, _ := expectPublishedHead(t, mock, bodyRefUUID)
		items := []map[string]any{{"uuid": bodyRefUUID}}
		if err := (&Adapter{db: db}).annotateSnapshotState(context.Background(), items, true); err != nil {
			t.Fatal(err)
		}
		ref, _ := items[0]["snapshot_ref"].(map[string]any)
		if ref == nil || ref["markdown"].(map[string]any)["key"] != key {
			t.Fatalf("item = %#v", items[0])
		}
	})
}

func TestDocumentGetRouteMarksSnapshotGenerationForStandaloneCodocs(t *testing.T) {
	db, mock, _ := sqlmock.New()
	defer db.Close()
	expectDocumentRead(mock, 11, bodyRefUUID, "owner-uid", "department", "D1", 0, 1)
	expectSnapshotGeneration(mock, bodyRefUUID, 2)
	response, _, err := (&Adapter{db: db}).HandleRuntime(context.Background(), http.MethodGet, "/v1/codocs/documents/"+bodyRefUUID, url.Values{"current_user": {"owner-uid"}}, map[string]any{})
	if err != nil {
		t.Fatal(err)
	}
	data := response.(map[string]any)["data"].(map[string]any)
	if data["snapshot_generation"] != int64(2) || data["snapshot_ref"] != nil {
		t.Fatalf("data = %#v", data)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}
