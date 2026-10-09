package integrationoperation

import (
	"context"
	"errors"
	"regexp"
	"testing"
	"time"

	"github.com/DATA-DOG/go-sqlmock"
)

const deadLetterTestOperationID = "550e8400-e29b-41d4-a716-446655440099"

func newDeadLetterRepository(t *testing.T) (*Repository, sqlmock.Sqlmock, func()) {
	t.Helper()
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatal(err)
	}
	repository, err := NewRepository(db)
	if err != nil {
		t.Fatal(err)
	}
	return repository, mock, func() { _ = db.Close() }
}

func TestDeadLetterActionableScanMaterializesStableSafeGenerationAndBlocksOldUnclosedProjection(t *testing.T) {
	repository, mock, closeDB := newDeadLetterRepository(t)
	defer closeDB()
	now := time.Date(2026, 7, 11, 12, 0, 0, 0, time.UTC)
	mock.ExpectExec(`(?s)INSERT IGNORE INTO integration_operation_dead_letter_actionable.*SELECT.*version_no.*FROM integration_operation.*tenant_code = \?.*deployment_code = \?.*source_app = \?.*status = 'dead_letter'`).
		WithArgs(now, now, "tenant-1", "aims-prod", "aims").WillReturnResult(sqlmock.NewResult(0, 1))
	mock.ExpectQuery(`(?s)SELECT.*d.operation_id.*d.generation_no.*d.actionable_key.*d.publish_object_version.*FROM integration_operation_dead_letter_actionable d.*publish_acked_at IS NULL.*NOT EXISTS.*prior.generation_no < d.generation_no.*prior.closure_acked_at IS NULL.*LIMIT \?`).
		WithArgs("tenant-1", "aims-prod", "aims", 20).
		WillReturnRows(sqlmock.NewRows([]string{"operation_id", "generation_no", "target_app", "operation_code", "source_biz_type", "source_biz_code", "attempt_count", "max_attempts", "last_error_code", "last_error_class", "dead_lettered_at", "original_actor_uid", "source_operation_version", "actionable_key", "publish_object_version"}).
			AddRow(deadLetterTestOperationID, 7, "altoc", "aims.sync.v1", "work_item", "WI-1", 8, 8, "timeout", "transient", now.Add(-time.Minute), "u1", 7, "integration-operation:aims:"+deadLetterTestOperationID+":dead-letter:g7", "dead-letter:g7:operation-v7"))
	items, err := repository.ListPendingDeadLetterActionables(context.Background(), "tenant-1", "aims-prod", "aims", 20, now)
	if err != nil {
		t.Fatal(err)
	}
	if len(items) != 1 || items[0].Generation != 7 || items[0].ActionableKey == "" {
		t.Fatalf("items=%#v", items)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}

func TestDeadLetterPublishAckBindsExactGenerationNotificationAndNormalizedRecipients(t *testing.T) {
	repository, mock, closeDB := newDeadLetterRepository(t)
	defer closeDB()
	now := time.Now().UTC()
	input := MarkDeadLetterActionablePublishedInput{TenantCode: "tenant-1", DeploymentCode: "aims-prod", SourceApp: "aims", OperationID: deadLetterTestOperationID, Generation: 7, OperationVersion: 7, ActionableKey: "integration-operation:aims:x:g7", ObjectVersion: "dead-letter:g7:operation-v7", NotificationID: "notif-1", RecipientUIDs: []string{"u2", "u1", "u2"}, Now: now}
	mock.ExpectExec(`(?s)UPDATE integration_operation_dead_letter_actionable.*notification_id = \?.*recipient_uids = CAST\(\? AS JSON\).*operation_id = \?.*generation_no = \?.*tenant_code = \?.*deployment_code = \?.*source_app = \?.*source_operation_version = \?.*actionable_key = \?.*publish_object_version = \?.*publish_acked_at IS NULL`).
		WithArgs("notif-1", `["u1","u2"]`, now, now, deadLetterTestOperationID, uint64(7), "tenant-1", "aims-prod", "aims", uint64(7), input.ActionableKey, input.ObjectVersion).
		WillReturnResult(sqlmock.NewResult(0, 1))
	marked, err := repository.MarkDeadLetterActionablePublished(context.Background(), input)
	if err != nil || !marked {
		t.Fatalf("marked=%v err=%v", marked, err)
	}
	mock.ExpectExec(`(?s)UPDATE integration_operation_dead_letter_actionable.*publish_acked_at IS NULL`).WillReturnResult(sqlmock.NewResult(0, 0))
	mock.ExpectQuery(`(?s)SELECT notification_id, recipient_uids, publish_object_version.*WHERE operation_id = \?.*generation_no = \?.*tenant_code = \?.*deployment_code = \?.*source_app = \?.*source_operation_version = \?.*actionable_key = \?`).
		WillReturnRows(sqlmock.NewRows([]string{"notification_id", "recipient_uids", "publish_object_version"}).AddRow("notif-1", `["u1","u2"]`, input.ObjectVersion))
	marked, err = repository.MarkDeadLetterActionablePublished(context.Background(), input)
	if err != nil || !marked {
		t.Fatalf("idempotent marked=%v err=%v", marked, err)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}

func TestDeadLetterClosureScanAndAckAreExactAndIdempotent(t *testing.T) {
	repository, mock, closeDB := newDeadLetterRepository(t)
	defer closeDB()
	now := time.Now().UTC()
	mock.ExpectQuery(`(?s)FROM integration_operation_dead_letter_actionable.*publish_acked_at IS NOT NULL.*closure_state IS NOT NULL.*closure_acked_at IS NULL`).
		WithArgs("tenant-1", "aims-prod", "aims", 20).
		WillReturnRows(sqlmock.NewRows([]string{"operation_id", "generation_no", "actionable_key", "publish_object_version", "closure_object_version", "closure_state", "recipient_uids"}).AddRow(deadLetterTestOperationID, 7, "action:g7", "dead-letter:g7:operation-v7", "resolved:g7:operation-v9", "resolved", `["u1"]`))
	closures, err := repository.ListPendingDeadLetterClosures(context.Background(), "tenant-1", "aims-prod", "aims", 20)
	if err != nil || len(closures) != 1 || closures[0].RecipientUIDs[0] != "u1" {
		t.Fatalf("closures=%#v err=%v", closures, err)
	}
	input := MarkDeadLetterClosureAcknowledgedInput{TenantCode: "tenant-1", DeploymentCode: "aims-prod", SourceApp: "aims", OperationID: deadLetterTestOperationID, Generation: 7, ActionableKey: "action:g7", ExpectedVersion: "dead-letter:g7:operation-v7", NextVersion: "resolved:g7:operation-v9", State: "resolved", Now: now}
	mock.ExpectExec(`(?s)UPDATE integration_operation_dead_letter_actionable.*closure_acked_at = \?.*operation_id = \?.*generation_no = \?.*actionable_key = \?.*publish_object_version = \?.*closure_object_version = \?.*closure_state = \?.*closure_acked_at IS NULL`).WillReturnResult(sqlmock.NewResult(0, 1))
	acked, err := repository.MarkDeadLetterClosureAcknowledged(context.Background(), input)
	if err != nil || !acked {
		t.Fatalf("acked=%v err=%v", acked, err)
	}
	mock.ExpectExec(`(?s)UPDATE integration_operation_dead_letter_actionable.*closure_acked_at IS NULL`).WillReturnResult(sqlmock.NewResult(0, 0))
	mock.ExpectQuery(`(?s)SELECT closure_acked_at.*WHERE operation_id = \?.*generation_no = \?.*tenant_code = \?.*deployment_code = \?.*source_app = \?.*actionable_key = \?.*publish_object_version = \?.*closure_object_version = \?.*closure_state = \?`).
		WillReturnRows(sqlmock.NewRows([]string{"closure_acked_at"}).AddRow(now))
	acked, err = repository.MarkDeadLetterClosureAcknowledged(context.Background(), input)
	if err != nil || !acked {
		t.Fatalf("idempotent acked=%v err=%v", acked, err)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}

func TestRecordSuccessClosureFailureRollsBackOperationSuccessAtomically(t *testing.T) {
	repository, mock, closeDB := newDeadLetterRepository(t)
	defer closeDB()
	now := time.Now().UTC()
	mock.ExpectBegin()
	mock.ExpectQuery(regexp.QuoteMeta("SELECT\n  status,")).WithArgs(deadLetterTestOperationID).
		WillReturnRows(sqlmock.NewRows([]string{"status", "locked_by", "locked_until", "fencing_token", "attempt_count", "max_attempts", "version_no", "created_at", "last_attempt_at"}).AddRow("processing", "worker-1", now.Add(time.Minute), 1, 1, 8, 8, now.Add(-time.Hour), now.Add(-time.Second)))
	mock.ExpectExec(`(?s)UPDATE integration_operation_attempt.*result_status = 'succeeded'`).WillReturnResult(sqlmock.NewResult(0, 1))
	mock.ExpectExec(`(?s)UPDATE integration_operation.*status = 'succeeded'`).WillReturnResult(sqlmock.NewResult(0, 1))
	mock.ExpectExec(`(?s)UPDATE integration_operation_dead_letter_actionable.*closure_state = \?`).WillReturnError(errors.New("closure write failed"))
	mock.ExpectRollback()
	_, err := repository.RecordSuccess(context.Background(), RecordSuccessInput{Lease: CompletionLease{OperationID: deadLetterTestOperationID, Worker: "worker-1", FencingToken: 1}, Now: now, HTTPStatus: 200})
	if err == nil || err.Error() != "closure write failed" {
		t.Fatalf("err=%v", err)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}

func TestIdempotentExistingFailureCreatesResolvedClosureInSameTransaction(t *testing.T) {
	repository, mock, closeDB := newDeadLetterRepository(t)
	defer closeDB()
	now := time.Now().UTC()
	mock.ExpectBegin()
	mock.ExpectQuery(regexp.QuoteMeta("SELECT\n  status,")).WithArgs(deadLetterTestOperationID).
		WillReturnRows(sqlmock.NewRows([]string{"status", "locked_by", "locked_until", "fencing_token", "attempt_count", "max_attempts", "version_no", "created_at", "last_attempt_at"}).AddRow("processing", "worker-1", now.Add(time.Minute), 1, 2, 8, 10, now.Add(-time.Hour), now.Add(-time.Second)))
	mock.ExpectExec(`(?s)UPDATE integration_operation_attempt.*result_status = \?.*WHERE operation_id = \?`).WillReturnResult(sqlmock.NewResult(0, 1))
	mock.ExpectExec(`(?s)UPDATE integration_operation.*SET status = \?.*version_no = \?.*WHERE operation_id = \?.*status = 'processing'`).WillReturnResult(sqlmock.NewResult(0, 1))
	mock.ExpectExec(`(?s)UPDATE integration_operation_dead_letter_actionable.*SET closure_state = \?.*WHERE operation_id = \?.*source_operation_version <= \?.*closure_state IS NULL`).WillReturnResult(sqlmock.NewResult(0, 1))
	mock.ExpectCommit()
	result, err := repository.RecordFailure(context.Background(), RecordFailureInput{Lease: CompletionLease{OperationID: deadLetterTestOperationID, Worker: "worker-1", FencingToken: 1}, Now: now, Failure: FailureInput{HTTPStatus: 409, ConflictDisposition: ConflictIdempotentExisting}, ErrorCode: "already_applied"})
	if err != nil || result.Status != StatusSucceeded || result.Version != 11 {
		t.Fatalf("result=%#v err=%v", result, err)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}

func TestAuthorizeDeadLetterNotificationUsesExactScopeRecipientAndCurrentGeneration(t *testing.T) {
	for _, test := range []struct {
		name, recipients, closure, status, reason string
		version, sourceVersion                    uint64
		allowed                                   bool
	}{
		{"allowed", `["u1","u2"]`, "", "dead_letter", "allowed", 7, 7, true},
		{"not recipient", `["u2"]`, "", "dead_letter", "not_recipient", 7, 7, false},
		{"closed", `["u1"]`, "resolved", "succeeded", "stale_notification", 8, 7, false},
		{"replayed", `["u1"]`, "", "pending", "stale_notification", 8, 7, false},
	} {
		t.Run(test.name, func(t *testing.T) {
			repository, mock, closeDB := newDeadLetterRepository(t)
			defer closeDB()
			closure := any(nil)
			if test.closure != "" {
				closure = test.closure
			}
			mock.ExpectQuery(`(?s)SELECT d.recipient_uids.*d.closure_state.*i.status.*i.version_no.*d.source_operation_version.*WHERE d.operation_id = \?.*d.notification_id = \?.*d.tenant_code = \?.*d.deployment_code = \?.*d.source_app = \?.*d.publish_acked_at IS NOT NULL`).
				WithArgs(deadLetterTestOperationID, "notif-1", "tenant-1", "aims-prod", "aims").
				WillReturnRows(sqlmock.NewRows([]string{"recipient_uids", "closure_state", "status", "version_no", "source_operation_version"}).AddRow(test.recipients, closure, test.status, test.version, test.sourceVersion))
			allowed, reason, err := repository.AuthorizeDeadLetterNotification(context.Background(), AuthorizeDeadLetterNotificationInput{TenantCode: "tenant-1", DeploymentCode: "aims-prod", SourceApp: "aims", OperationID: deadLetterTestOperationID, NotificationID: "notif-1", SubjectUID: "u1"})
			if err != nil || allowed != test.allowed || reason != test.reason {
				t.Fatalf("allowed=%v reason=%s err=%v", allowed, reason, err)
			}
		})
	}
}
