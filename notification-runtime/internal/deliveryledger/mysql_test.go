package deliveryledger

import (
	"context"
	"database/sql/driver"
	"errors"
	"os"
	"regexp"
	"strings"
	"testing"
	"time"

	"github.com/DATA-DOG/go-sqlmock"
)

var testIdentity = Identity{
	Tenant: "tenant-a", Deployment: "deploy-a", SourceApp: "aims",
	SourceClientID: "aims-client-v2", IdempotencyKey: "notify-1",
}

func newStore(t *testing.T) (*MySQLStore, sqlmock.Sqlmock) {
	t.Helper()
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = db.Close() })
	store := NewMySQLStore(db)
	store.now = func() time.Time { return time.Date(2026, 7, 10, 12, 0, 0, 0, time.UTC) }
	return store, mock
}

func claimInput() ClaimInput {
	return ClaimInput{
		Identity: testIdentity, RequestHash: strings.Repeat("a", 64),
		Provider: "wecom", Integration: "wecom.default", LeaseOwner: "worker-1", LeaseDuration: time.Minute,
	}
}

func expectSelect(mock sqlmock.Sqlmock, rows *sqlmock.Rows) {
	mock.ExpectQuery(regexp.QuoteMeta(selectForUpdate)).
		WithArgs("tenant-a", "deploy-a", "aims", "notify-1").
		WillReturnRows(rows)
}

func deliveryRows() *sqlmock.Rows {
	return sqlmock.NewRows([]string{"id", "request_hash", "status", "lease_owner", "lease_expires_at", "fencing_token", "result_json"})
}

func TestClaimCreatesDurableProcessingLease(t *testing.T) {
	store, mock := newStore(t)
	mock.ExpectBegin()
	expectSelect(mock, deliveryRows())
	mock.ExpectExec("INSERT INTO notification_delivery_ledger").
		WithArgs("tenant-a", "deploy-a", "aims", "aims-client-v2", "notify-1", sqlmock.AnyArg(), "wecom", "wecom.default", "worker-1", sqlmock.AnyArg(), sqlmock.AnyArg(), sqlmock.AnyArg()).
		WillReturnResult(sqlmock.NewResult(41, 1))
	mock.ExpectCommit()
	claim, err := store.Claim(context.Background(), claimInput())
	if err != nil {
		t.Fatal(err)
	}
	if claim.Decision != DecisionExecute || claim.DeliveryID != 41 || claim.Fencing != 1 {
		t.Fatalf("claim = %+v", claim)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}

func TestClaimReplaysSucceededWithoutNewLease(t *testing.T) {
	store, mock := newStore(t)
	input := claimInput()
	input.RequestHash = strings.Repeat("b", 64)
	mock.ExpectBegin()
	expectSelect(mock, deliveryRows().AddRow(7, strings.Repeat("b", 64), "succeeded", nil, nil, 3, []byte(`{"provider":"wecom"}`)))
	mock.ExpectCommit()
	claim, err := store.Claim(context.Background(), input)
	if err != nil {
		t.Fatal(err)
	}
	if claim.Decision != DecisionReplaySucceeded || string(claim.ResultJSON) != `{"provider":"wecom"}` {
		t.Fatalf("claim = %+v", claim)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}

func TestClaimRejectsSameIdentityDifferentHash(t *testing.T) {
	store, mock := newStore(t)
	mock.ExpectBegin()
	expectSelect(mock, deliveryRows().AddRow(7, "old-hash", "failed", nil, nil, 2, nil))
	mock.ExpectRollback()
	_, err := store.Claim(context.Background(), claimInput())
	if !errors.Is(err, ErrPayloadMismatch) {
		t.Fatalf("err = %v", err)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}

func TestClaimTurnsExpiredProcessingIntoPartialUnknown(t *testing.T) {
	store, mock := newStore(t)
	input := claimInput()
	input.RequestHash = strings.Repeat("b", 64)
	mock.ExpectBegin()
	expectSelect(mock, deliveryRows().AddRow(8, strings.Repeat("b", 64), "processing", "old-worker", time.Date(2026, 7, 10, 11, 59, 0, 0, time.UTC), 4, nil))
	mock.ExpectExec("UPDATE notification_delivery_ledger").WithArgs(sqlmock.AnyArg(), int64(8), int64(4)).WillReturnResult(sqlmock.NewResult(0, 1))
	mock.ExpectCommit()
	claim, err := store.Claim(context.Background(), input)
	if err != nil {
		t.Fatal(err)
	}
	if claim.Decision != DecisionPartialUnknown {
		t.Fatalf("claim = %+v", claim)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}

func TestClaimDoesNotResendActiveProcessingOrPartialUnknown(t *testing.T) {
	for _, item := range []struct {
		name     string
		state    string
		lease    any
		decision Decision
	}{
		{"active processing", "processing", time.Date(2026, 7, 10, 12, 1, 0, 0, time.UTC), DecisionInProgress},
		{"partial unknown", "partial_unknown", nil, DecisionPartialUnknown},
	} {
		t.Run(item.name, func(t *testing.T) {
			store, mock := newStore(t)
			input := claimInput()
			input.RequestHash = strings.Repeat("b", 64)
			mock.ExpectBegin()
			expectSelect(mock, deliveryRows().AddRow(8, input.RequestHash, item.state, nil, item.lease, 4, nil))
			mock.ExpectCommit()
			claim, err := store.Claim(context.Background(), input)
			if err != nil {
				t.Fatal(err)
			}
			if claim.Decision != item.decision {
				t.Fatalf("claim=%+v", claim)
			}
			if err := mock.ExpectationsWereMet(); err != nil {
				t.Fatal(err)
			}
		})
	}
}

func TestClaimRetriesKnownFailureWithNewFencingToken(t *testing.T) {
	store, mock := newStore(t)
	input := claimInput()
	input.RequestHash = strings.Repeat("b", 64)
	mock.ExpectBegin()
	expectSelect(mock, deliveryRows().AddRow(9, strings.Repeat("b", 64), "failed", nil, nil, 5, nil))
	mock.ExpectExec("UPDATE notification_delivery_ledger").
		WithArgs("worker-1", sqlmock.AnyArg(), int64(6), sqlmock.AnyArg(), int64(9), int64(5)).
		WillReturnResult(sqlmock.NewResult(0, 1))
	mock.ExpectCommit()
	claim, err := store.Claim(context.Background(), input)
	if err != nil {
		t.Fatal(err)
	}
	if claim.Decision != DecisionExecute || claim.Fencing != 6 {
		t.Fatalf("claim = %+v", claim)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}

func TestCompletionRequiresCurrentLeaseAndFencing(t *testing.T) {
	store, mock := newStore(t)
	mock.ExpectExec("UPDATE notification_delivery_ledger").
		WithArgs(StateSucceeded, sqlmock.AnyArg(), nil, nil, StateSucceeded, sqlmock.AnyArg(), sqlmock.AnyArg(), int64(9), "worker-1", int64(6)).
		WillReturnResult(sqlmock.NewResult(0, 0))
	err := store.Succeed(context.Background(), Completion{DeliveryID: 9, LeaseOwner: "worker-1", Fencing: 6, ResultJSON: []byte(`{"ok":true}`)})
	if !errors.Is(err, ErrStaleClaim) {
		t.Fatalf("err = %v", err)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}

func TestSucceedFailAndMarkUnknownUseFencedCheckpoint(t *testing.T) {
	for _, item := range []struct {
		name  string
		state State
		call  func(*MySQLStore, Completion) error
	}{
		{"succeed", StateSucceeded, func(store *MySQLStore, input Completion) error {
			input.ResultJSON = []byte(`{"provider":"wecom"}`)
			return store.Succeed(context.Background(), input)
		}},
		{"fail", StateFailed, func(store *MySQLStore, input Completion) error {
			input.ErrorCode = "known_failure"
			input.ErrorSummary = "Notification provider request failed"
			return store.Fail(context.Background(), input)
		}},
		{"unknown", StatePartialUnknown, func(store *MySQLStore, input Completion) error {
			input.ErrorCode = "transport_unknown"
			input.ErrorSummary = "Notification provider request failed"
			return store.MarkUnknown(context.Background(), input)
		}},
	} {
		t.Run(item.name, func(t *testing.T) {
			store, mock := newStore(t)
			mock.ExpectExec("UPDATE notification_delivery_ledger").
				WithArgs(item.state, sqlmock.AnyArg(), sqlmock.AnyArg(), sqlmock.AnyArg(), item.state, sqlmock.AnyArg(), sqlmock.AnyArg(), int64(10), "worker-2", int64(7)).
				WillReturnResult(sqlmock.NewResult(0, 1))
			if err := item.call(store, Completion{DeliveryID: 10, LeaseOwner: "worker-2", Fencing: 7}); err != nil {
				t.Fatal(err)
			}
			if err := mock.ExpectationsWereMet(); err != nil {
				t.Fatal(err)
			}
		})
	}
}

func TestListScopesToTenantDeploymentAndUsesStableIDCursor(t *testing.T) {
	store, mock := newStore(t)
	now := time.Date(2026, 7, 10, 12, 0, 0, 0, time.UTC)
	mock.ExpectQuery("SELECT id, source_app, provider_code, integration_code, status, attempt_count").
		WithArgs("tenant-a", "deploy-a", StatePartialUnknown, int64(80), 3).
		WillReturnRows(sqlmock.NewRows([]string{
			"id", "source_app", "provider_code", "integration_code", "status", "attempt_count",
			"last_error_code", "created_at", "updated_at", "succeeded_at",
		}).AddRow(79, "workflow", "wecom", "wecom.default", "partial_unknown", 1, "transport_unknown", now, now, nil).
			AddRow(78, "aims", "wecom", "wecom.default", "partial_unknown", 2, nil, now, now, nil).
			AddRow(77, "finance", "wecom", "wecom.default", "partial_unknown", 1, nil, now, now, nil))
	result, err := store.List(context.Background(), ListInput{Tenant: "tenant-a", Deployment: "deploy-a", State: StatePartialUnknown, Limit: 2, BeforeID: 80})
	if err != nil {
		t.Fatal(err)
	}
	if len(result.Deliveries) != 2 || result.NextID != 78 {
		t.Fatalf("result=%+v", result)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}

func TestReconcileCASWritesAppendOnlyAuditAndMinimalSuccessReplay(t *testing.T) {
	store, mock := newStore(t)
	now := time.Date(2026, 7, 10, 11, 0, 0, 0, time.UTC)
	mock.ExpectBegin()
	mock.ExpectQuery("SELECT id, source_app, provider_code, integration_code, status").
		WithArgs("tenant-a", "deploy-a", int64(42)).
		WillReturnRows(sqlmock.NewRows([]string{
			"id", "source_app", "provider_code", "integration_code", "status", "attempt_count",
			"last_error_code", "created_at", "updated_at", "succeeded_at", "fencing_token",
		}).AddRow(42, "workflow", "wecom", "wecom.default", "partial_unknown", 1, "transport_unknown", now, now, nil, 3))
	mock.ExpectExec("UPDATE notification_delivery_ledger").
		WithArgs(StateSucceeded, sqlmock.AnyArg(), nil, nil, StateSucceeded, sqlmock.AnyArg(), sqlmock.AnyArg(), int64(42), "tenant-a", "deploy-a", int64(3)).
		WillReturnResult(sqlmock.NewResult(0, 1))
	mock.ExpectExec("INSERT INTO notification_delivery_reconciliations").
		WithArgs(int64(42), "tenant-a", "deploy-a", StateSucceeded, "console", "console-admin-client", "operator-1",
			"Provider admin confirmed the message was accepted", "provider_admin_confirmation", "INC-0042", sqlmock.AnyArg(), sqlmock.AnyArg()).
		WillReturnResult(sqlmock.NewResult(9, 1))
	mock.ExpectCommit()

	result, err := store.Reconcile(context.Background(), ReconcileInput{
		Tenant: "tenant-a", Deployment: "deploy-a", DeliveryID: 42,
		ExpectedState: StatePartialUnknown, Result: StateSucceeded,
		ActorSourceApp: "console", ActorClientID: "console-admin-client", ActorSubject: "operator-1",
		Reason: "Provider admin confirmed the message was accepted", EvidenceType: "provider_admin_confirmation", EvidenceReference: "INC-0042", ProviderMessageID: "msg-42",
	})
	if err != nil {
		t.Fatal(err)
	}
	if result.AuditID != 9 || result.Delivery.State != StateSucceeded || result.Delivery.SucceededAt == nil {
		t.Fatalf("result=%+v", result)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}

func TestReconcileRejectsNonUnknownStateWithoutMutation(t *testing.T) {
	store, mock := newStore(t)
	now := time.Date(2026, 7, 10, 11, 0, 0, 0, time.UTC)
	mock.ExpectBegin()
	mock.ExpectQuery("SELECT id, source_app, provider_code, integration_code, status").
		WithArgs("tenant-a", "deploy-a", int64(42)).
		WillReturnRows(sqlmock.NewRows([]string{
			"id", "source_app", "provider_code", "integration_code", "status", "attempt_count",
			"last_error_code", "created_at", "updated_at", "succeeded_at", "fencing_token",
		}).AddRow(42, "workflow", "wecom", "wecom.default", "succeeded", 1, nil, now, now, now, 3))
	mock.ExpectRollback()
	_, err := store.Reconcile(context.Background(), ReconcileInput{
		Tenant: "tenant-a", Deployment: "deploy-a", DeliveryID: 42,
		ExpectedState: StatePartialUnknown, Result: StateFailed,
		ActorSourceApp: "console", ActorClientID: "console-admin-client",
		Reason: "Provider admin confirmed no message was accepted", EvidenceType: "provider_admin_confirmation", EvidenceReference: "INC-0042",
	})
	if !errors.Is(err, ErrInvalidState) {
		t.Fatalf("err=%v", err)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}

func TestReconcileToFailedOnlyRetriesThroughOriginalClaimIdentityAndHash(t *testing.T) {
	store, mock := newStore(t)
	now := time.Date(2026, 7, 10, 11, 0, 0, 0, time.UTC)
	mock.ExpectBegin()
	mock.ExpectQuery("SELECT id, source_app, provider_code, integration_code, status").
		WithArgs("tenant-a", "deploy-a", int64(42)).
		WillReturnRows(sqlmock.NewRows([]string{
			"id", "source_app", "provider_code", "integration_code", "status", "attempt_count",
			"last_error_code", "created_at", "updated_at", "succeeded_at", "fencing_token",
		}).AddRow(42, "aims", "wecom", "wecom.default", "partial_unknown", 1, "transport_unknown", now, now, nil, 3))
	mock.ExpectExec("UPDATE notification_delivery_ledger").
		WithArgs(StateFailed, nil, "reconciled_failed", "Manual evidence confirmed delivery failed", StateFailed, sqlmock.AnyArg(), sqlmock.AnyArg(), int64(42), "tenant-a", "deploy-a", int64(3)).
		WillReturnResult(sqlmock.NewResult(0, 1))
	mock.ExpectExec("INSERT INTO notification_delivery_reconciliations").WillReturnResult(sqlmock.NewResult(10, 1))
	mock.ExpectCommit()

	_, err := store.Reconcile(context.Background(), ReconcileInput{
		Tenant: "tenant-a", Deployment: "deploy-a", DeliveryID: 42,
		ExpectedState: StatePartialUnknown, Result: StateFailed,
		ActorSourceApp: "console", ActorClientID: "console-admin-client",
		Reason: "Provider admin confirmed no message was accepted", EvidenceType: "provider_admin_confirmation", EvidenceReference: "INC-0042",
	})
	if err != nil {
		t.Fatal(err)
	}

	input := claimInput()
	mock.ExpectBegin()
	expectSelect(mock, deliveryRows().AddRow(42, input.RequestHash, "failed", nil, nil, 3, nil))
	mock.ExpectExec("UPDATE notification_delivery_ledger").
		WithArgs("worker-1", sqlmock.AnyArg(), int64(4), sqlmock.AnyArg(), int64(42), int64(3)).
		WillReturnResult(sqlmock.NewResult(0, 1))
	mock.ExpectCommit()
	claim, err := store.Claim(context.Background(), input)
	if err != nil {
		t.Fatal(err)
	}
	if claim.Decision != DecisionExecute || claim.Fencing != 4 {
		t.Fatalf("claim=%+v", claim)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}

func TestReconcileRejectsSensitiveOrUnstructuredEvidenceBeforeDatabase(t *testing.T) {
	store, mock := newStore(t)
	base := ReconcileInput{
		Tenant: "tenant-a", Deployment: "deploy-a", DeliveryID: 42,
		ExpectedState: StatePartialUnknown, Result: StateFailed,
		ActorSourceApp: "console", ActorClientID: "console-admin-client",
		Reason: "Provider admin confirmed no message was accepted", EvidenceType: "provider_admin_confirmation", EvidenceReference: "INC-0042",
	}
	for _, mutate := range []func(*ReconcileInput){
		func(input *ReconcileInput) { input.Reason = "See https://provider.example/secret" },
		func(input *ReconcileInput) { input.EvidenceReference = "https://provider.example/ticket/42" },
		func(input *ReconcileInput) { input.ProviderMessageID = `{"provider":"raw-body"}` },
	} {
		input := base
		mutate(&input)
		if _, err := store.Reconcile(context.Background(), input); !errors.Is(err, ErrInvalidEvidence) {
			t.Fatalf("err=%v input=%+v", err, input)
		}
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}

func TestSchemaReadinessRequiresLedgerAndReconciliationAudit(t *testing.T) {
	tests := []struct {
		name              string
		ledgerColumnCount int
		auditColumnCount  int
		wantError         bool
	}{
		{name: "complete", ledgerColumnCount: len(requiredColumns), auditColumnCount: len(requiredReconciliationColumns)},
		{name: "ledger incomplete", ledgerColumnCount: len(requiredColumns) - 1, wantError: true},
		{name: "audit incomplete", ledgerColumnCount: len(requiredColumns), auditColumnCount: len(requiredReconciliationColumns) - 1, wantError: true},
	}
	for _, item := range tests {
		t.Run(item.name, func(t *testing.T) {
			db, mock, err := sqlmock.New()
			if err != nil {
				t.Fatal(err)
			}
			defer db.Close()
			mock.ExpectQuery("SELECT COUNT\\(DISTINCT column_name\\) FROM information_schema.columns").
				WithArgs(columnArgs("notification_delivery_ledger", requiredColumns)...).
				WillReturnRows(sqlmock.NewRows([]string{"count"}).AddRow(item.ledgerColumnCount))
			if item.ledgerColumnCount == len(requiredColumns) {
				mock.ExpectQuery("SELECT COUNT\\(DISTINCT column_name\\) FROM information_schema.columns").
					WithArgs(columnArgs("notification_delivery_reconciliations", requiredReconciliationColumns)...).
					WillReturnRows(sqlmock.NewRows([]string{"count"}).AddRow(item.auditColumnCount))
			}
			err = verifySchema(context.Background(), db)
			if !item.wantError && err != nil {
				t.Fatalf("verifySchema: %v", err)
			}
			if item.wantError && err == nil {
				t.Fatal("incomplete schema unexpectedly accepted")
			}
			if err := mock.ExpectationsWereMet(); err != nil {
				t.Fatal(err)
			}
		})
	}
}

func columnArgs(table string, columns []string) []driver.Value {
	values := make([]driver.Value, 0, len(columns)+1)
	values = append(values, table)
	for _, column := range columns {
		values = append(values, column)
	}
	return values
}

func TestReleasePayloadAndInstallerCarryLedgerSchema(t *testing.T) {
	checks := map[string][]string{
		"../../scripts/package-release.sh":                          {`SCHEMA_001_PATH`, `SCHEMA_002_PATH`, `"schemas"`},
		"../../deploy/install.sh":                                   {`install -m 0644 "$tmp_dir/schema/001_notification_delivery_ledger.sql"`, `install -m 0644 "$tmp_dir/schema/002_notification_delivery_reconciliation.sql"`, `HZY_NOTIFICATION_RUNTIME_STORE`, `HZY_NOTIFICATION_RUNTIME_SQLITE_PATH`, `-check-store`},
		"../../schema/001_notification_delivery_ledger.sql":         {"uk_notification_delivery_identity", "fencing_token", "partial_unknown"},
		"../../schema/002_notification_delivery_reconciliation.sql": {"notification_delivery_reconciliations", "partial_unknown", "append-only"},
	}
	for path, markers := range checks {
		body, err := os.ReadFile(path)
		if err != nil {
			t.Fatalf("read %s: %v", path, err)
		}
		for _, marker := range markers {
			if !strings.Contains(string(body), marker) {
				t.Fatalf("%s missing %q", path, marker)
			}
		}
	}
}

func TestInstallerPreflightsStoreBeforeReplacingCurrentBinary(t *testing.T) {
	body, err := os.ReadFile("../../deploy/install.sh")
	if err != nil {
		t.Fatal(err)
	}
	source := string(body)
	preflight := strings.Index(source, `"$tmp_dir/hzy-notification-runtime" -check-store`)
	swap := strings.Index(source, `install -m 0755 "$tmp_dir/hzy-notification-runtime" "$BIN_DIR/hzy-notification-runtime"`)
	if preflight < 0 || swap < 0 {
		t.Fatalf("installer missing preflight or binary swap: preflight=%d swap=%d", preflight, swap)
	}
	if preflight >= swap {
		t.Fatalf("installer replaces the current binary before store preflight: preflight=%d swap=%d", preflight, swap)
	}
}

func TestInstallerRestartsAnAlreadyRunningRuntime(t *testing.T) {
	body, err := os.ReadFile("../../deploy/install.sh")
	if err != nil {
		t.Fatal(err)
	}
	source := string(body)
	if !strings.Contains(source, `systemctl enable "$SERVICE_NAME.service"`) {
		t.Fatal("installer must enable the runtime service")
	}
	if !strings.Contains(source, `systemctl restart "$SERVICE_NAME.service"`) {
		t.Fatal("installer must restart the runtime so updated env and service-token identity take effect")
	}
	if !strings.Contains(source, `UMask=0077`) {
		t.Fatal("runtime service must create SQLite sidecar files with private permissions")
	}
	if strings.Contains(source, `systemctl enable --now "$SERVICE_NAME.service"`) {
		t.Fatal("enable --now does not restart an already running runtime")
	}
}

func TestReleasePublishesLatestPointerAfterReferencedObjects(t *testing.T) {
	body, err := os.ReadFile("../../scripts/upload-r2.sh")
	if err != nil {
		t.Fatal(err)
	}
	source := string(body)
	objectLoop := strings.Index(source, `find "$PACKAGE_DIR" -type f ! -path "$PACKAGE_DIR/latest.json"`)
	pointerUpload := strings.LastIndex(source, `upload_file "$PACKAGE_DIR/latest.json"`)
	if objectLoop < 0 || pointerUpload < 0 || pointerUpload <= objectLoop {
		t.Fatalf("latest pointer must publish after referenced objects: loop=%d pointer=%d", objectLoop, pointerUpload)
	}
}
