package integrationoperation

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"reflect"
	"regexp"
	"strings"
	"testing"
	"time"

	"github.com/DATA-DOG/go-sqlmock"
)

func TestClaimNextRequiresTenantScopeBeforeDatabaseAccess(t *testing.T) {
	database, mock, err := sqlmock.New()
	if err != nil {
		t.Fatalf("sqlmock.New: %v", err)
	}
	defer database.Close()
	repository, err := NewRepository(database)
	if err != nil {
		t.Fatalf("NewRepository: %v", err)
	}

	_, err = repository.ClaimNext(context.Background(), "", "DEPLOYMENT-A", "aims", "worker-1", time.Now(), time.Minute)
	if !errors.Is(err, ErrInvalidIdentity) {
		t.Fatalf("missing tenant error = %v, want ErrInvalidIdentity", err)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatalf("missing tenant must be rejected before SQL: %v", err)
	}
}

func TestClaimNextScopesLeaseRecoveryAndDueSelectionToOneTenant(t *testing.T) {
	database, mock, err := sqlmock.New()
	if err != nil {
		t.Fatalf("sqlmock.New: %v", err)
	}
	defer database.Close()
	repository, err := NewRepository(database)
	if err != nil {
		t.Fatalf("NewRepository: %v", err)
	}
	now := time.Date(2026, 7, 10, 12, 0, 0, 0, time.UTC)

	mock.ExpectBegin()
	mock.ExpectExec(`(?s)UPDATE integration_operation_attempt attempt.*operation\.tenant_code = \?.*operation\.deployment_code = \?.*operation\.source_app = \?`).
		WithArgs(now, now, "TENANT-A", "DEPLOYMENT-A", "aims", now).
		WillReturnResult(sqlmock.NewResult(0, 0))
	mock.ExpectExec(`(?s)UPDATE integration_operation.*WHERE tenant_code = \?.*deployment_code = \?.*source_app = \?.*status = 'processing'`).
		WithArgs(now, "worker-a", now, "TENANT-A", "DEPLOYMENT-A", "aims", now).
		WillReturnResult(sqlmock.NewResult(0, 0))
	mock.ExpectQuery(`(?s)SELECT.*FROM integration_operation o.*WHERE o\.tenant_code = \?.*o\.deployment_code = \?.*o\.source_app = \?.*dependency\.tenant_code = o\.tenant_code.*ORDER BY.*FOR UPDATE SKIP LOCKED`).
		WithArgs("TENANT-A", "DEPLOYMENT-A", "aims", now).
		WillReturnRows(sqlmock.NewRows([]string{"operation_id"}))
	mock.ExpectCommit()

	claimed, err := repository.ClaimNext(context.Background(), "TENANT-A", "DEPLOYMENT-A", "aims", "worker-a", now, time.Minute)
	if err != nil {
		t.Fatalf("ClaimNext: %v", err)
	}
	if claimed != nil {
		t.Fatalf("claimed = %#v, want nil; another tenant's due row must not be visible", claimed)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatalf("claim and expired-lease recovery must use the same tenant/deployment/source scope: %v", err)
	}
}

func TestListDiagnosticsRequiresSafeTenantScopedKeysetAPI(t *testing.T) {
	database, mock, captured, err := newCapturedRepositorySQLMock()
	if err != nil {
		t.Fatalf("sqlmock.New: %v", err)
	}
	defer database.Close()
	repository, err := NewRepository(database)
	if err != nil {
		t.Fatalf("NewRepository: %v", err)
	}

	method, inputType := requireRepositoryStructMethod(t, repository, "ListDiagnostics")
	input := reflect.New(inputType).Elem()
	requireAndSetStringField(t, input, "TenantCode", "TENANT-A")
	requireAndSetStringField(t, input, "DeploymentCode", "DEPLOYMENT-A")
	requireAndSetStringField(t, input, "SourceApp", "aims")
	requireAndSetIntField(t, input, "Limit", 2)
	requireAndSetStatusesField(t, input, "Statuses", []Status{StatusFailedPermanent, StatusDeadLetter})
	requireAndSetDiagnosticCursor(t, input, time.Date(2026, 7, 10, 12, 0, 0, 0, time.UTC), "550e8400-e29b-41d4-a716-446655440000")

	mock.ExpectQuery(`(?s)SELECT.*FROM integration_operation.*WHERE.*tenant_code = \?.*deployment_code = \?.*source_app = \?.*status IN.*updated_at < \?.*updated_at = \?.*operation_id < \?.*ORDER BY updated_at DESC, operation_id DESC.*LIMIT \?`).
		WillReturnRows(sqlmock.NewRows([]string{"operation_id"}))

	outputs := method.Call([]reflect.Value{reflect.ValueOf(context.Background()), input})
	if err := reflectedCallError(outputs); err != nil {
		t.Fatalf("ListDiagnostics: %v", err)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatalf("diagnostics must use tenant-scoped status filtering and keyset pagination: %v", err)
	}
	query := strings.ToLower(*captured)
	selectClause := query
	if index := strings.Index(selectClause, " from "); index >= 0 {
		selectClause = selectClause[:index]
	}
	for _, forbidden := range []string{"command_json", "authorization", "cookie", "service token", "internal_url"} {
		if strings.Contains(selectClause, forbidden) {
			t.Errorf("diagnostic list SELECT exposes forbidden field %q: %s", forbidden, selectClause)
		}
	}
}

func TestListDiagnosticsRejectsUnsafeScopeStatusAndPaginationBeforeSQL(t *testing.T) {
	tests := []struct {
		name   string
		mutate func(t *testing.T, input reflect.Value)
		want   func(error) bool
	}{
		{
			name: "missing tenant",
			mutate: func(t *testing.T, input reflect.Value) {
				requireAndSetStringField(t, input, "TenantCode", "")
			},
			want: func(err error) bool { return errors.Is(err, ErrInvalidIdentity) },
		},
		{
			name: "invalid status",
			mutate: func(t *testing.T, input reflect.Value) {
				requireAndSetStatusesField(t, input, "Statuses", []Status{"not-a-status"})
			},
			want: func(err error) bool { return errors.Is(err, ErrInvalidStatus) },
		},
		{
			name: "zero limit",
			mutate: func(t *testing.T, input reflect.Value) {
				requireAndSetIntField(t, input, "Limit", 0)
			},
			want: func(err error) bool {
				return err != nil && strings.Contains(strings.ToLower(err.Error()), "diagnostic limit")
			},
		},
		{
			name: "limit over 100",
			mutate: func(t *testing.T, input reflect.Value) {
				requireAndSetIntField(t, input, "Limit", 101)
			},
			want: func(err error) bool {
				return err != nil && strings.Contains(strings.ToLower(err.Error()), "diagnostic limit")
			},
		},
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
			method, inputType := requireRepositoryStructMethod(t, repository, "ListDiagnostics")
			input := reflect.New(inputType).Elem()
			requireAndSetStringField(t, input, "TenantCode", "TENANT-A")
			requireAndSetStringField(t, input, "DeploymentCode", "DEPLOYMENT-A")
			requireAndSetStringField(t, input, "SourceApp", "aims")
			requireAndSetIntField(t, input, "Limit", 20)
			requireAndSetStatusesField(t, input, "Statuses", []Status{StatusFailedPermanent})
			tt.mutate(t, input)

			outputs := method.Call([]reflect.Value{reflect.ValueOf(context.Background()), input})
			if err := reflectedCallError(outputs); !tt.want(err) {
				t.Fatalf("unsafe diagnostic error = %v, want validation failure", err)
			}
			if err := mock.ExpectationsWereMet(); err != nil {
				t.Fatalf("unsafe diagnostic input must fail before SQL: %v", err)
			}
		})
	}
}

func TestReplayIsTenantScopedAndDoesNotRewriteFrozenIdentityOrCommand(t *testing.T) {
	for _, priorStatus := range []Status{StatusFailedPermanent, StatusDeadLetter} {
		t.Run(string(priorStatus), func(t *testing.T) {
			database, mock, captured, err := newCapturedRepositorySQLMock()
			if err != nil {
				t.Fatalf("sqlmock.New: %v", err)
			}
			defer database.Close()
			repository, err := NewRepository(database)
			if err != nil {
				t.Fatalf("NewRepository: %v", err)
			}
			method, inputType := requireRepositoryStructMethod(t, repository, "Replay")
			input := validReplayInputValue(t, inputType)

			mock.ExpectBegin()
			mock.ExpectExec(`(?s)UPDATE integration_operation_dead_letter_actionable.*SET closure_state = \?.*WHERE operation_id = \?.*source_operation_version <= \?.*closure_state IS NULL`).
				WillReturnResult(sqlmock.NewResult(0, 1))
			mock.ExpectExec(`(?s)UPDATE integration_operation.*SET status = 'pending'.*WHERE operation_id = \?.*tenant_code = \?.*deployment_code = \?.*source_app = \?.*version_no = \?.*status IN \('failed_permanent', 'dead_letter'\)`).
				WillReturnResult(sqlmock.NewResult(0, 1))
			mock.ExpectCommit()
			outputs := method.Call([]reflect.Value{reflect.ValueOf(context.Background()), input})
			if err := reflectedCallError(outputs); err != nil {
				t.Fatalf("Replay(%s): %v", priorStatus, err)
			}
			if err := mock.ExpectationsWereMet(); err != nil {
				t.Fatalf("replay SQL contract: %v", err)
			}
			setClause := strings.ToLower(*captured)
			if index := strings.Index(setClause, "\nwhere "); index >= 0 {
				setClause = setClause[:index]
			}
			for _, immutable := range []string{
				"operation_key", "correlation_key", "tenant_code", "deployment_code", "source_app", "target_app",
				"operation_code", "required_capability", "source_biz_type", "source_biz_code", "idempotency_key",
				"command_schema_version", "command_json", "command_sha256",
			} {
				if regexp.MustCompile(`\b` + regexp.QuoteMeta(immutable) + `\s*=`).MatchString(setClause) {
					t.Errorf("replay mutates frozen field %s: %s", immutable, setClause)
				}
			}
		})
	}
}

func TestReplayRejectsProcessingAndSucceededOperations(t *testing.T) {
	for _, status := range []Status{StatusProcessing, StatusSucceeded} {
		t.Run(string(status), func(t *testing.T) {
			database, mock, _, err := newCapturedRepositorySQLMock()
			if err != nil {
				t.Fatalf("sqlmock.New: %v", err)
			}
			defer database.Close()
			repository, err := NewRepository(database)
			if err != nil {
				t.Fatalf("NewRepository: %v", err)
			}
			method, inputType := requireRepositoryStructMethod(t, repository, "Replay")
			input := validReplayInputValue(t, inputType)
			mock.ExpectBegin()
			mock.ExpectExec(`(?s)UPDATE integration_operation_dead_letter_actionable.*SET closure_state = \?.*WHERE operation_id = \?.*source_operation_version <= \?.*closure_state IS NULL`).
				WillReturnResult(sqlmock.NewResult(0, 0))
			mock.ExpectExec(`(?s)UPDATE integration_operation.*WHERE operation_id = \?.*tenant_code = \?.*deployment_code = \?.*source_app = \?.*version_no = \?.*status IN \('failed_permanent', 'dead_letter'\)`).
				WillReturnResult(sqlmock.NewResult(0, 0))
			mock.ExpectRollback()

			outputs := method.Call([]reflect.Value{reflect.ValueOf(context.Background()), input})
			if err := reflectedCallError(outputs); !errors.Is(err, ErrReplayRejected) {
				t.Fatalf("Replay(%s) error = %v, want ErrReplayRejected", status, err)
			}
			if err := mock.ExpectationsWereMet(); err != nil {
				t.Fatalf("processing/succeeded replay must not update a row: %v", err)
			}
		})
	}
}

func newCapturedRepositorySQLMock() (*sql.DB, sqlmock.Sqlmock, *string, error) {
	var captured string
	matcher := sqlmock.QueryMatcherFunc(func(expectedSQL string, actualSQL string) error {
		captured = actualSQL
		return sqlmock.QueryMatcherRegexp.Match(expectedSQL, actualSQL)
	})
	database, mock, err := sqlmock.New(sqlmock.QueryMatcherOption(matcher))
	return database, mock, &captured, err
}

func requireRepositoryStructMethod(t *testing.T, repository *Repository, name string) (reflect.Value, reflect.Type) {
	t.Helper()
	method := reflect.ValueOf(repository).MethodByName(name)
	if !method.IsValid() {
		t.Fatalf("Repository.%s is required", name)
	}
	methodType := method.Type()
	if methodType.NumIn() != 2 || methodType.In(0) != reflect.TypeOf((*context.Context)(nil)).Elem() || methodType.In(1).Kind() != reflect.Struct {
		t.Fatalf("Repository.%s signature = %s, want (context.Context, struct input)", name, methodType)
	}
	return method, methodType.In(1)
}

func requireAndSetStringField(t *testing.T, value reflect.Value, name string, text string) {
	t.Helper()
	field := value.FieldByName(name)
	if !field.IsValid() || !field.CanSet() || field.Kind() != reflect.String {
		t.Fatalf("%s.%s string field is required", value.Type(), name)
	}
	field.SetString(text)
}

func requireAndSetIntField(t *testing.T, value reflect.Value, name string, number int64) {
	t.Helper()
	field := value.FieldByName(name)
	if !field.IsValid() || !field.CanSet() {
		t.Fatalf("%s.%s int field is required", value.Type(), name)
	}
	switch field.Kind() {
	case reflect.Int, reflect.Int8, reflect.Int16, reflect.Int32, reflect.Int64:
		field.SetInt(number)
	case reflect.Uint, reflect.Uint8, reflect.Uint16, reflect.Uint32, reflect.Uint64:
		if number < 0 {
			t.Fatalf("%s.%s unsigned field cannot accept %d", value.Type(), name, number)
		}
		field.SetUint(uint64(number))
	default:
		t.Fatalf("%s.%s int field is required", value.Type(), name)
	}
}

func requireAndSetStatusesField(t *testing.T, value reflect.Value, name string, statuses []Status) {
	t.Helper()
	field := value.FieldByName(name)
	if !field.IsValid() || !field.CanSet() || field.Kind() != reflect.Slice || field.Type().Elem().Kind() != reflect.String {
		t.Fatalf("%s.%s []Status field is required", value.Type(), name)
	}
	slice := reflect.MakeSlice(field.Type(), len(statuses), len(statuses))
	for index, status := range statuses {
		slice.Index(index).SetString(string(status))
	}
	field.Set(slice)
}

func requireAndSetDiagnosticCursor(t *testing.T, input reflect.Value, updatedAt time.Time, operationID string) {
	t.Helper()
	field := input.FieldByName("Cursor")
	if !field.IsValid() || !field.CanSet() || field.Kind() != reflect.Pointer || field.Type().Elem().Kind() != reflect.Struct {
		t.Fatalf("%s.Cursor *DiagnosticCursor field is required", input.Type())
	}
	cursor := reflect.New(field.Type().Elem())
	updated := cursor.Elem().FieldByName("UpdatedAt")
	id := cursor.Elem().FieldByName("OperationID")
	if !updated.IsValid() || updated.Type() != reflect.TypeOf(time.Time{}) || !id.IsValid() || id.Kind() != reflect.String {
		t.Fatalf("%s must contain UpdatedAt time.Time and OperationID string", field.Type().Elem())
	}
	updated.Set(reflect.ValueOf(updatedAt))
	id.SetString(operationID)
	field.Set(cursor)
}

func validReplayInputValue(t *testing.T, inputType reflect.Type) reflect.Value {
	t.Helper()
	input := reflect.New(inputType).Elem()
	requireAndSetStringField(t, input, "OperationID", "550e8400-e29b-41d4-a716-446655440000")
	requireAndSetStringField(t, input, "TenantCode", "TENANT-A")
	requireAndSetStringField(t, input, "DeploymentCode", "DEPLOYMENT-A")
	requireAndSetStringField(t, input, "SourceApp", "aims")
	requireAndSetStringField(t, input, "ActorUID", "admin-1")
	requireAndSetStringField(t, input, "Reason", "authorization repaired")
	requireAndSetIntField(t, input, "ExpectedVersion", 4)
	now := input.FieldByName("Now")
	if !now.IsValid() || now.Type() != reflect.TypeOf(time.Time{}) {
		t.Fatalf("%s.Now time.Time field is required", inputType)
	}
	now.Set(reflect.ValueOf(time.Date(2026, 7, 10, 12, 0, 0, 0, time.UTC)))
	return input
}

func reflectedCallError(outputs []reflect.Value) error {
	if len(outputs) == 0 {
		return fmt.Errorf("repository method returned no values")
	}
	last := outputs[len(outputs)-1]
	if last.Type() != reflect.TypeOf((*error)(nil)).Elem() {
		return fmt.Errorf("repository method last return is %s, want error", last.Type())
	}
	if last.IsNil() {
		return nil
	}
	return last.Interface().(error)
}
