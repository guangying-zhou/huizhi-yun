package people

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"testing"

	"github.com/DATA-DOG/go-sqlmock"
)

func TestConnectorPeopleFinalBatchIsIdempotent(t *testing.T) {
	adapter, mock, closeDB := newPeopleSQLMockAdapter(t)
	defer closeDB()
	body := map[string]any{"jobId": "crj_test_000000000000000001", "provider": "dingtalk", "integrationCode": "dingtalk.default", "batchNumber": float64(3), "final": true, "watermark": "2026-07-14T12:00:00Z", "users": []any{}}
	mock.ExpectQuery(`SELECT batch_hash,status,applied_count,skipped_count`).WithArgs("crj_test_000000000000000001", 3).WillReturnRows(sqlmock.NewRows([]string{"batch_hash", "status", "applied_count", "skipped_count"}))
	mock.ExpectExec(`INSERT INTO people_connector_sync_receipts`).WithArgs("crj_test_000000000000000001", 3, sqlmock.AnyArg(), "dingtalk", "dingtalk.default").WillReturnResult(sqlmock.NewResult(1, 1))
	mock.ExpectExec(`UPDATE people_connector_sync_receipts SET status='success'`).WithArgs(0, 0, true, "crj_test_000000000000000001", 3).WillReturnResult(sqlmock.NewResult(0, 1))
	first, err := adapter.ApplyConnectorPeopleBatch(context.Background(), body, nil, nil, 0)
	if err != nil || first["replayed"] != false {
		t.Fatalf("first=%#v err=%v", first, err)
	}
	mock.ExpectQuery(`SELECT batch_hash,status,applied_count,skipped_count`).WithArgs("crj_test_000000000000000001", 3).WillReturnRows(sqlmock.NewRows([]string{"batch_hash", "status", "applied_count", "skipped_count"}).AddRow(connectorBatchHash(body), "success", 0, 0))
	second, err := adapter.ApplyConnectorPeopleBatch(context.Background(), body, nil, nil, 0)
	if err != nil || second["replayed"] != true {
		t.Fatalf("second=%#v err=%v", second, err)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}

func TestConnectorPeopleFailedBatchCanRetry(t *testing.T) {
	adapter, mock, closeDB := newPeopleSQLMockAdapter(t)
	defer closeDB()
	body := map[string]any{"jobId": "crj_test_000000000000000002", "provider": "dingtalk", "integrationCode": "dingtalk.default", "batchNumber": float64(1), "final": true, "watermark": "2026-07-14T12:00:00Z", "users": []any{}}
	mock.ExpectQuery(`SELECT batch_hash,status,applied_count,skipped_count`).
		WithArgs("crj_test_000000000000000002", 1).
		WillReturnRows(sqlmock.NewRows([]string{"batch_hash", "status", "applied_count", "skipped_count"}).
			AddRow(connectorBatchHash(body), "failed", 0, 0))
	mock.ExpectExec(`UPDATE people_connector_sync_receipts SET status='processing'`).
		WithArgs("crj_test_000000000000000002", 1).
		WillReturnResult(sqlmock.NewResult(0, 1))
	mock.ExpectExec(`UPDATE people_connector_sync_receipts SET status='success'`).
		WithArgs(0, 0, true, "crj_test_000000000000000002", 1).
		WillReturnResult(sqlmock.NewResult(0, 1))

	result, err := adapter.ApplyConnectorPeopleBatch(context.Background(), body, nil, nil, 0)
	if err != nil || result == nil || result["replayed"] != false {
		t.Fatalf("result=%#v err=%v", result, err)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}

func connectorBatchHash(body map[string]any) string {
	encoded, _ := json.Marshal(body)
	digest := sha256.Sum256(encoded)
	return hex.EncodeToString(digest[:])
}
