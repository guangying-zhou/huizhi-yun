package integrationoperation

import (
	"context"
	"encoding/json"
	"errors"
	"reflect"
	"strings"
	"testing"
	"time"

	"github.com/DATA-DOG/go-sqlmock"
)

const (
	failureNotificationOperationID = "550e8400-e29b-41d4-a716-446655440000"
	failureNotificationID          = "880e8400-e29b-41d4-a716-446655440000"
)

func TestListPendingFailureNotificationsIsDeadLetterOnlyScopedBoundedAndSafe(t *testing.T) {
	database, mock, captured, err := newCapturedRepositorySQLMock()
	if err != nil {
		t.Fatalf("sqlmock.New: %v", err)
	}
	defer database.Close()
	repository, err := NewRepository(database)
	if err != nil {
		t.Fatalf("NewRepository: %v", err)
	}
	method := requireListPendingFailureNotificationsMethod(t, repository)
	deadLetteredAt := time.Date(2026, 7, 10, 12, 0, 0, 0, time.UTC)

	mock.ExpectQuery(`(?s)SELECT.*operation_id.*operation_key.*target_app.*operation_code.*source_biz_type.*source_biz_code.*attempt_count.*max_attempts.*last_error_code.*last_error_class.*dead_lettered_at.*original_actor_uid.*FROM integration_operation.*WHERE tenant_code = \?.*deployment_code = \?.*source_app = \?.*status = 'dead_letter'.*failure_notified_at IS NULL.*ORDER BY dead_lettered_at(?: ASC)?, operation_id(?: ASC)?.*LIMIT \?`).
		WithArgs("TENANT-A", "DEPLOYMENT-A", "aims", 20).
		WillReturnRows(sqlmock.NewRows([]string{
			"operation_id", "operation_key", "target_app", "operation_code",
			"source_biz_type", "source_biz_code", "attempt_count", "max_attempts",
			"last_error_code", "last_error_class", "dead_lettered_at", "original_actor_uid",
		}).AddRow(
			failureNotificationOperationID, "delivery:ASSET-1", "assets", "assets.delivery.link_document.v1",
			"service_ticket", "TICKET-1", 8, 8,
			"upstream_unavailable", "transient", deadLetteredAt, "OPERATOR-1",
		))

	outputs := method.Call([]reflect.Value{
		reflect.ValueOf(context.Background()),
		reflect.ValueOf("TENANT-A"),
		reflect.ValueOf("DEPLOYMENT-A"),
		reflect.ValueOf("aims"),
		reflect.ValueOf(20),
	})
	if err := reflectedCallError(outputs); err != nil {
		t.Fatalf("ListPendingFailureNotifications: %v", err)
	}
	items := outputs[0]
	if items.Len() != 1 {
		t.Fatalf("pending failure notification count = %d, want 1", items.Len())
	}
	item := items.Index(0)
	if item.Kind() == reflect.Pointer {
		item = item.Elem()
	}
	requireCandidateStringField(t, item, "OperationID", failureNotificationOperationID)
	requireCandidateStringField(t, item, "OperationKey", "delivery:ASSET-1")
	requireCandidateStringField(t, item, "TargetApp", "assets")
	requireCandidateStringField(t, item, "LastErrorCode", "upstream_unavailable")
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatalf("pending failure notification SQL contract: %v", err)
	}

	query := strings.ToLower(*captured)
	selectClause := query
	if index := strings.Index(selectClause, " from "); index >= 0 {
		selectClause = selectClause[:index]
	}
	for _, forbidden := range []string{
		"command_json", "command_sha256", "response_summary_sha256", "last_error_summary",
		"authorization", "cookie", "token", "url", "uri",
	} {
		if strings.Contains(selectClause, forbidden) {
			t.Errorf("failure notification candidate SELECT exposes forbidden field %q: %s", forbidden, selectClause)
		}
	}
	payload, err := json.Marshal(outputs[0].Interface())
	if err != nil {
		t.Fatalf("marshal failure notification candidates: %v", err)
	}
	lowerPayload := strings.ToLower(string(payload))
	for _, forbidden := range []string{
		"command", "sha256", "errorsummary", "authorization", "cookie", "token", "url", "uri",
	} {
		if strings.Contains(lowerPayload, forbidden) {
			t.Errorf("failure notification candidate output exposes forbidden content %q: %s", forbidden, payload)
		}
	}
}

func TestListPendingFailureNotificationsRejectsUnsafeScopeAndLimitBeforeSQL(t *testing.T) {
	tests := []struct {
		name       string
		tenant     string
		deployment string
		sourceApp  string
		limit      int
	}{
		{name: "missing tenant", tenant: "", deployment: "DEPLOYMENT-A", sourceApp: "aims", limit: 10},
		{name: "missing deployment", tenant: "TENANT-A", deployment: "", sourceApp: "aims", limit: 10},
		{name: "missing source app", tenant: "TENANT-A", deployment: "DEPLOYMENT-A", sourceApp: "", limit: 10},
		{name: "zero limit", tenant: "TENANT-A", deployment: "DEPLOYMENT-A", sourceApp: "aims", limit: 0},
		{name: "limit above twenty", tenant: "TENANT-A", deployment: "DEPLOYMENT-A", sourceApp: "aims", limit: 21},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			database, mock, err := sqlmock.New()
			if err != nil {
				t.Fatalf("sqlmock.New: %v", err)
			}
			defer database.Close()
			repository, err := NewRepository(database)
			if err != nil {
				t.Fatalf("NewRepository: %v", err)
			}
			method := requireListPendingFailureNotificationsMethod(t, repository)

			outputs := method.Call([]reflect.Value{
				reflect.ValueOf(context.Background()),
				reflect.ValueOf(tt.tenant),
				reflect.ValueOf(tt.deployment),
				reflect.ValueOf(tt.sourceApp),
				reflect.ValueOf(tt.limit),
			})
			if err := reflectedCallError(outputs); err == nil {
				t.Fatal("unsafe notification list error = nil")
			}
			if err := mock.ExpectationsWereMet(); err != nil {
				t.Fatalf("unsafe notification list input must fail before SQL: %v", err)
			}
		})
	}
}

func TestListPendingFailureNotificationsAcceptsLowerLimitBoundary(t *testing.T) {
	database, mock, err := sqlmock.New()
	if err != nil {
		t.Fatalf("sqlmock.New: %v", err)
	}
	defer database.Close()
	repository, err := NewRepository(database)
	if err != nil {
		t.Fatalf("NewRepository: %v", err)
	}
	method := requireListPendingFailureNotificationsMethod(t, repository)

	mock.ExpectQuery(`(?s)FROM integration_operation.*WHERE tenant_code = \?.*deployment_code = \?.*source_app = \?.*status = 'dead_letter'.*failure_notified_at IS NULL.*LIMIT \?`).
		WithArgs("TENANT-A", "DEPLOYMENT-A", "aims", 1).
		WillReturnRows(sqlmock.NewRows([]string{
			"operation_id", "operation_key", "target_app", "operation_code",
			"source_biz_type", "source_biz_code", "attempt_count", "max_attempts",
			"last_error_code", "last_error_class", "dead_lettered_at", "original_actor_uid",
		}))

	outputs := method.Call([]reflect.Value{
		reflect.ValueOf(context.Background()),
		reflect.ValueOf("TENANT-A"),
		reflect.ValueOf("DEPLOYMENT-A"),
		reflect.ValueOf("aims"),
		reflect.ValueOf(1),
	})
	if err := reflectedCallError(outputs); err != nil {
		t.Fatalf("ListPendingFailureNotifications(limit=1): %v", err)
	}
	if outputs[0].Len() != 0 {
		t.Fatalf("pending failure notification count = %d, want 0", outputs[0].Len())
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatalf("lower notification limit boundary SQL: %v", err)
	}
}

func TestMarkFailureNotifiedFirstAckUsesScopedDeadLetterCAS(t *testing.T) {
	database, mock, err := sqlmock.New()
	if err != nil {
		t.Fatalf("sqlmock.New: %v", err)
	}
	defer database.Close()
	repository, err := NewRepository(database)
	if err != nil {
		t.Fatalf("NewRepository: %v", err)
	}
	method, input := validMarkFailureNotifiedCall(t, repository, failureNotificationID)
	now := markFailureNotifiedTime(t, input)

	mock.ExpectExec(`(?s)UPDATE integration_operation.*SET failure_notified_at = \?.*failure_notification_id = \?.*updated_at = \?.*WHERE operation_id = \?.*tenant_code = \?.*deployment_code = \?.*source_app = \?.*status = 'dead_letter'.*failure_notified_at IS NULL`).
		WithArgs(now, failureNotificationID, now, failureNotificationOperationID, "TENANT-A", "DEPLOYMENT-A", "aims").
		WillReturnResult(sqlmock.NewResult(0, 1))

	outputs := method.Call([]reflect.Value{reflect.ValueOf(context.Background()), input})
	if err := reflectedCallError(outputs); err != nil {
		t.Fatalf("MarkFailureNotified first ack: %v", err)
	}
	if !reflectedBoolResult(t, outputs) {
		t.Fatal("MarkFailureNotified first ack = false, want true")
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatalf("first failure notification ack CAS: %v", err)
	}
}

func TestMarkFailureNotifiedSameNotificationIDReplayIsIdempotent(t *testing.T) {
	database, mock, err := sqlmock.New()
	if err != nil {
		t.Fatalf("sqlmock.New: %v", err)
	}
	defer database.Close()
	repository, err := NewRepository(database)
	if err != nil {
		t.Fatalf("NewRepository: %v", err)
	}
	method, input := validMarkFailureNotifiedCall(t, repository, failureNotificationID)
	now := markFailureNotifiedTime(t, input)

	mock.ExpectExec(`(?s)UPDATE integration_operation.*SET failure_notified_at = \?.*failure_notification_id = \?.*updated_at = \?.*WHERE operation_id = \?.*tenant_code = \?.*deployment_code = \?.*source_app = \?.*status = 'dead_letter'.*failure_notified_at IS NULL`).
		WithArgs(now, failureNotificationID, now, failureNotificationOperationID, "TENANT-A", "DEPLOYMENT-A", "aims").
		WillReturnResult(sqlmock.NewResult(0, 0))
	mock.ExpectQuery(`(?s)SELECT failure_notification_id.*FROM integration_operation.*WHERE operation_id = \?.*tenant_code = \?.*deployment_code = \?.*source_app = \?.*status = 'dead_letter'`).
		WithArgs(failureNotificationOperationID, "TENANT-A", "DEPLOYMENT-A", "aims").
		WillReturnRows(sqlmock.NewRows([]string{"failure_notification_id"}).AddRow(failureNotificationID))

	outputs := method.Call([]reflect.Value{reflect.ValueOf(context.Background()), input})
	if err := reflectedCallError(outputs); err != nil {
		t.Fatalf("MarkFailureNotified idempotent replay: %v", err)
	}
	if !reflectedBoolResult(t, outputs) {
		t.Fatal("MarkFailureNotified same ID replay = false, want true")
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatalf("same notification ID must not rewrite ack: %v", err)
	}
}

func TestMarkFailureNotifiedRejectsDifferentIDAndNonDeadLetterWithoutMutation(t *testing.T) {
	tests := []struct {
		name                 string
		existingNotification any
		wantErr              error
	}{
		{name: "different notification id", existingNotification: failureNotificationID, wantErr: ErrPersistenceRace},
		{name: "not dead letter", existingNotification: nil, wantErr: ErrOperationNotFound},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			database, mock, err := sqlmock.New()
			if err != nil {
				t.Fatalf("sqlmock.New: %v", err)
			}
			defer database.Close()
			repository, err := NewRepository(database)
			if err != nil {
				t.Fatalf("NewRepository: %v", err)
			}
			method, input := validMarkFailureNotifiedCall(t, repository, "990e8400-e29b-41d4-a716-446655440000")
			now := markFailureNotifiedTime(t, input)

			mock.ExpectExec(`(?s)UPDATE integration_operation.*SET failure_notified_at = \?.*failure_notification_id = \?.*updated_at = \?.*WHERE operation_id = \?.*tenant_code = \?.*deployment_code = \?.*source_app = \?.*status = 'dead_letter'.*failure_notified_at IS NULL`).
				WithArgs(now, "990e8400-e29b-41d4-a716-446655440000", now, failureNotificationOperationID, "TENANT-A", "DEPLOYMENT-A", "aims").
				WillReturnResult(sqlmock.NewResult(0, 0))
			rows := sqlmock.NewRows([]string{"failure_notification_id"})
			if tt.existingNotification != nil {
				rows.AddRow(tt.existingNotification)
			}
			mock.ExpectQuery(`(?s)SELECT failure_notification_id.*FROM integration_operation.*WHERE operation_id = \?.*tenant_code = \?.*deployment_code = \?.*source_app = \?.*status = 'dead_letter'`).
				WithArgs(failureNotificationOperationID, "TENANT-A", "DEPLOYMENT-A", "aims").
				WillReturnRows(rows)

			outputs := method.Call([]reflect.Value{reflect.ValueOf(context.Background()), input})
			if err := reflectedCallError(outputs); !errors.Is(err, tt.wantErr) {
				t.Fatalf("MarkFailureNotified rejected ack error = %v, want %v", err, tt.wantErr)
			}
			if reflectedBoolResult(t, outputs) {
				t.Fatal("MarkFailureNotified rejected ack = true, want false")
			}
			if err := mock.ExpectationsWereMet(); err != nil {
				t.Fatalf("rejected ack must not mutate operation: %v", err)
			}
		})
	}
}

func requireListPendingFailureNotificationsMethod(t *testing.T, repository *Repository) reflect.Value {
	t.Helper()
	method := reflect.ValueOf(repository).MethodByName("ListPendingFailureNotifications")
	if !method.IsValid() {
		t.Fatal("Repository.ListPendingFailureNotifications is required")
	}
	methodType := method.Type()
	contextType := reflect.TypeOf((*context.Context)(nil)).Elem()
	errorType := reflect.TypeOf((*error)(nil)).Elem()
	if methodType.NumIn() != 5 || methodType.In(0) != contextType ||
		methodType.In(1).Kind() != reflect.String || methodType.In(2).Kind() != reflect.String ||
		methodType.In(3).Kind() != reflect.String || methodType.In(4).Kind() != reflect.Int ||
		methodType.NumOut() != 2 || methodType.Out(0).Kind() != reflect.Slice || !methodType.Out(1).Implements(errorType) {
		t.Fatalf("Repository.ListPendingFailureNotifications signature = %s, want (context.Context, tenant, deployment, sourceApp string, limit int) ([]FailureNotificationCandidate, error)", methodType)
	}
	return method
}

func requireMarkFailureNotifiedMethod(t *testing.T, repository *Repository) (reflect.Value, reflect.Type) {
	t.Helper()
	method := reflect.ValueOf(repository).MethodByName("MarkFailureNotified")
	if !method.IsValid() {
		t.Fatal("Repository.MarkFailureNotified is required")
	}
	methodType := method.Type()
	contextType := reflect.TypeOf((*context.Context)(nil)).Elem()
	errorType := reflect.TypeOf((*error)(nil)).Elem()
	if methodType.NumIn() != 2 || methodType.In(0) != contextType || methodType.In(1).Kind() != reflect.Struct ||
		methodType.NumOut() != 2 || methodType.Out(0).Kind() != reflect.Bool || !methodType.Out(1).Implements(errorType) {
		t.Fatalf("Repository.MarkFailureNotified signature = %s, want (context.Context, MarkFailureNotifiedInput) (bool, error)", methodType)
	}
	return method, methodType.In(1)
}

func validMarkFailureNotifiedCall(t *testing.T, repository *Repository, notificationID string) (reflect.Value, reflect.Value) {
	t.Helper()
	method, inputType := requireMarkFailureNotifiedMethod(t, repository)
	input := reflect.New(inputType).Elem()
	requireAndSetStringField(t, input, "TenantCode", "TENANT-A")
	requireAndSetStringField(t, input, "DeploymentCode", "DEPLOYMENT-A")
	requireAndSetStringField(t, input, "SourceApp", "aims")
	requireAndSetStringField(t, input, "OperationID", failureNotificationOperationID)
	requireAndSetStringField(t, input, "NotificationID", notificationID)
	now := input.FieldByName("Now")
	if !now.IsValid() || !now.CanSet() || now.Type() != reflect.TypeOf(time.Time{}) {
		t.Fatalf("%s.Now time.Time field is required", input.Type())
	}
	now.Set(reflect.ValueOf(time.Date(2026, 7, 10, 12, 30, 0, 0, time.UTC)))
	return method, input
}

func markFailureNotifiedTime(t *testing.T, input reflect.Value) time.Time {
	t.Helper()
	field := input.FieldByName("Now")
	if !field.IsValid() || field.Type() != reflect.TypeOf(time.Time{}) {
		t.Fatalf("%s.Now time.Time field is required", input.Type())
	}
	return field.Interface().(time.Time)
}

func reflectedBoolResult(t *testing.T, outputs []reflect.Value) bool {
	t.Helper()
	if len(outputs) != 2 || outputs[0].Kind() != reflect.Bool {
		t.Fatalf("method outputs = %v, want (bool, error)", outputs)
	}
	return outputs[0].Bool()
}

func requireCandidateStringField(t *testing.T, candidate reflect.Value, name string, want string) {
	t.Helper()
	field := candidate.FieldByName(name)
	if !field.IsValid() || field.Kind() != reflect.String {
		t.Fatalf("%s.%s string field is required", candidate.Type(), name)
	}
	if field.String() != want {
		t.Fatalf("%s.%s = %q, want %q", candidate.Type(), name, field.String(), want)
	}
}
