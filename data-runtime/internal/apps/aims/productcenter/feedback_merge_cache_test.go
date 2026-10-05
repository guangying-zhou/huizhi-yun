package productcenter

import (
	"context"
	"github.com/DATA-DOG/go-sqlmock"
	"testing"
)

func TestFeedbackMergeCacheReadsSharedAncestorsOnce(t *testing.T) {
	db, m, err := sqlmock.New()
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	m.ExpectBegin()
	tx, err := db.Begin()
	if err != nil {
		t.Fatal(err)
	}
	cache := map[int64]feedbackMergeNode{}
	for _, id := range []int64{1, 3} {
		status := "merged"
		var next any = int64(3)
		if id == 3 {
			status = "accepted"
			next = nil
		}
		// First path is 1->3; second path is 2->3 and must reuse node 3.
		m.ExpectQuery(`SELECT biz_id,decision_status,merged_into_id`).WithArgs("P1", id).WillReturnRows(sqlmock.NewRows([]string{"biz_id", "decision_status", "merged_into_id"}).AddRow("request", status, next))
	}
	root, _, err := resolveFeedbackCanonicalCachedTx(context.Background(), tx, "P1", 1, cache)
	if err != nil || root != 3 {
		t.Fatalf("first path: %d %v", root, err)
	}
	m.ExpectQuery(`SELECT biz_id,decision_status,merged_into_id`).WithArgs("P1", int64(2)).WillReturnRows(sqlmock.NewRows([]string{"biz_id", "decision_status", "merged_into_id"}).AddRow("other", "merged", 3))
	root, _, err = resolveFeedbackCanonicalCachedTx(context.Background(), tx, "P1", 2, cache)
	if err != nil || root != 3 {
		t.Fatalf("shared path: %d %v", root, err)
	}
	m.ExpectRollback()
	tx.Rollback()
	if err := m.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}

func TestFeedbackMergeCacheRetainsCycleDepthAndStatusGuards(t *testing.T) {
	pointer := func(id int64) *int64 { return &id }
	cycle := map[int64]feedbackMergeNode{1: {status: "merged", next: pointer(2)}, 2: {status: "merged", next: pointer(1)}}
	_, _, err := resolveFeedbackCanonicalCachedTx(context.Background(), nil, "P1", 1, cycle)
	requireProductRule(t, err, "product_request_merge_cycle")
	inconsistent := map[int64]feedbackMergeNode{1: {status: "accepted", next: pointer(2)}}
	_, _, err = resolveFeedbackCanonicalCachedTx(context.Background(), nil, "P1", 1, inconsistent)
	requireProductRule(t, err, "product_request_merge_inconsistent")
	depth := map[int64]feedbackMergeNode{}
	for id := int64(1); id <= 65; id++ {
		depth[id] = feedbackMergeNode{status: "merged", next: pointer(id + 1)}
	}
	_, _, err = resolveFeedbackCanonicalCachedTx(context.Background(), nil, "P1", 1, depth)
	requireProductRule(t, err, "product_request_merge_depth")
}

func TestFeedbackMergeCacheThousandSourcesShareOneAncestor(t *testing.T) {
	db, m, err := sqlmock.New()
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	m.ExpectBegin()
	tx, err := db.Begin()
	if err != nil {
		t.Fatal(err)
	}
	cache := map[int64]feedbackMergeNode{}
	// 1,000 distinct sources converge on one canonical request. The mock
	// permits exactly 1,001 SELECTs, not 2,000 ancestor/source reads.
	const rootID int64 = 1001
	for id := int64(1); id <= 1000; id++ {
		m.ExpectQuery(`SELECT biz_id,decision_status,merged_into_id`).WithArgs("P1", id).WillReturnRows(sqlmock.NewRows([]string{"biz_id", "decision_status", "merged_into_id"}).AddRow("source", "merged", rootID))
		if id == 1 {
			m.ExpectQuery(`SELECT biz_id,decision_status,merged_into_id`).WithArgs("P1", rootID).WillReturnRows(sqlmock.NewRows([]string{"biz_id", "decision_status", "merged_into_id"}).AddRow("canonical", "accepted", nil))
		}
		root, progress, err := resolveFeedbackCanonicalCachedTx(context.Background(), tx, "P1", id, cache)
		if err != nil || root != rootID || progress.CanonicalRequestBizID != "canonical" {
			t.Fatalf("source %d: %d %+v %v", id, root, progress, err)
		}
	}
	if len(cache) != 1001 {
		t.Fatalf("unexpected cache growth: %d", len(cache))
	}
	m.ExpectRollback()
	tx.Rollback()
	if err := m.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}
