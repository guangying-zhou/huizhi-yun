package integrationoperation

import (
	"context"
	"encoding/json"
	"reflect"
	"strings"
	"testing"
	"time"

	"github.com/DATA-DOG/go-sqlmock"
)

const (
	timelineOperationID = "550e8400-e29b-41d4-a716-446655440000"
	timelineAttemptID   = "660e8400-e29b-41d4-a716-446655440000"
)

var attemptTimelineQueryPattern = `(?s)SELECT.*a\.attempt_id.*a\.operation_id.*a\.operation_code.*a\.attempt_no.*a\.trigger_type.*a\.result_status.*a\.http_status.*a\.error_code.*a\.error_class.*a\.target_biz_type.*a\.target_biz_code.*a\.started_at.*a\.finished_at.*a\.duration_ms.*a\.created_at.*FROM integration_operation_attempt(?: AS)? a.*(?:INNER )?JOIN integration_operation(?: AS)? o.*ON o\.operation_id = a\.operation_id.*WHERE o\.tenant_code = \?.*o\.deployment_code = \?.*o\.source_app = \?.*[ao]\.operation_id = \?.*ORDER BY a\.attempt_no ASC.*LIMIT \?`

func TestListAttemptTimelineIsOperationScopedBoundedOrderedAndSafe(t *testing.T) {
	database, mock, captured, err := newCapturedRepositorySQLMock()
	if err != nil {
		t.Fatalf("sqlmock.New: %v", err)
	}
	defer database.Close()
	repository, err := NewRepository(database)
	if err != nil {
		t.Fatalf("NewRepository: %v", err)
	}
	method, input := validAttemptTimelineCall(t, repository, 100)
	startedAt := time.Date(2026, 7, 10, 12, 0, 0, 0, time.UTC)
	finishedAt := startedAt.Add(250 * time.Millisecond)

	mock.ExpectQuery(attemptTimelineQueryPattern).
		WithArgs("TENANT-A", "DEPLOYMENT-A", "aims", timelineOperationID, 100).
		WillReturnRows(attemptTimelineRows().AddRow(
			timelineAttemptID,
			timelineOperationID,
			"assets.delivery.link_document.v1",
			1,
			"immediate",
			"retry_wait",
			503,
			"upstream_unavailable",
			"transient",
			nil,
			nil,
			startedAt,
			finishedAt,
			250,
			startedAt,
		))

	outputs := method.Call([]reflect.Value{reflect.ValueOf(context.Background()), input})
	if err := reflectedCallError(outputs); err != nil {
		t.Fatalf("ListAttemptTimeline: %v", err)
	}
	items := outputs[0]
	if items.Len() != 1 {
		t.Fatalf("attempt timeline count = %d, want 1", items.Len())
	}
	item := items.Index(0)
	if item.Kind() == reflect.Pointer {
		item = item.Elem()
	}
	requireCandidateStringField(t, item, "AttemptID", timelineAttemptID)
	requireCandidateStringField(t, item, "OperationID", timelineOperationID)
	requireCandidateStringField(t, item, "OperationCode", "assets.delivery.link_document.v1")
	requireCandidateStringField(t, item, "ErrorCode", "upstream_unavailable")
	requireTimelineIntegerField(t, item, "AttemptNo", 1)
	requireTimelineStringLikeField(t, item, "ResultStatus", "retry_wait")
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatalf("attempt timeline SQL contract: %v", err)
	}

	query := strings.ToLower(*captured)
	selectClause := query
	if index := strings.Index(selectClause, "\nfrom "); index >= 0 {
		selectClause = selectClause[:index]
	} else if index := strings.Index(selectClause, " from "); index >= 0 {
		selectClause = selectClause[:index]
	}
	for _, forbidden := range []string{
		"command", "command_json", "command_sha256", "response", "response_summary_sha256",
		"error_summary", "authorization", "cookie", "access_token", "refresh_token", "service_token", "url", "uri",
		"request_id", "correlation_id", "locked_by", "fencing_token",
	} {
		if strings.Contains(selectClause, forbidden) {
			t.Errorf("attempt timeline SELECT exposes forbidden field %q: %s", forbidden, selectClause)
		}
	}
	payload, err := json.Marshal(outputs[0].Interface())
	if err != nil {
		t.Fatalf("marshal attempt timeline: %v", err)
	}
	lowerPayload := strings.ToLower(string(payload))
	for _, forbidden := range []string{
		"command", "sha256", "response", "errorsummary", "authorization", "cookie",
		"accesstoken", "refreshtoken", "servicetoken", "bearer ", "url", "uri",
		"requestid", "correlationid", "lockedby", "fencingtoken",
	} {
		if strings.Contains(lowerPayload, forbidden) {
			t.Errorf("attempt timeline output exposes forbidden content %q: %s", forbidden, payload)
		}
	}
}

func TestListAttemptTimelineAcceptsLowerLimitBoundary(t *testing.T) {
	database, mock, err := sqlmock.New()
	if err != nil {
		t.Fatalf("sqlmock.New: %v", err)
	}
	defer database.Close()
	repository, err := NewRepository(database)
	if err != nil {
		t.Fatalf("NewRepository: %v", err)
	}
	method, input := validAttemptTimelineCall(t, repository, 1)

	mock.ExpectQuery(attemptTimelineQueryPattern).
		WithArgs("TENANT-A", "DEPLOYMENT-A", "aims", timelineOperationID, 1).
		WillReturnRows(attemptTimelineRows())
	outputs := method.Call([]reflect.Value{reflect.ValueOf(context.Background()), input})
	if err := reflectedCallError(outputs); err != nil {
		t.Fatalf("ListAttemptTimeline(limit=1): %v", err)
	}
	if outputs[0].Len() != 0 {
		t.Fatalf("attempt timeline count = %d, want 0", outputs[0].Len())
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatalf("lower attempt timeline limit boundary: %v", err)
	}
}

func TestListAttemptTimelineRejectsMissingScopeInvalidOperationAndUnsafeLimitBeforeSQL(t *testing.T) {
	tests := []struct {
		name   string
		mutate func(t *testing.T, input reflect.Value)
	}{
		{name: "missing tenant", mutate: func(t *testing.T, input reflect.Value) { requireAndSetStringField(t, input, "TenantCode", "") }},
		{name: "missing deployment", mutate: func(t *testing.T, input reflect.Value) { requireAndSetStringField(t, input, "DeploymentCode", "") }},
		{name: "missing source app", mutate: func(t *testing.T, input reflect.Value) { requireAndSetStringField(t, input, "SourceApp", "") }},
		{name: "invalid operation id", mutate: func(t *testing.T, input reflect.Value) {
			requireAndSetStringField(t, input, "OperationID", "not-a-uuid")
		}},
		{name: "zero limit", mutate: func(t *testing.T, input reflect.Value) { requireAndSetIntField(t, input, "Limit", 0) }},
		{name: "limit above one hundred", mutate: func(t *testing.T, input reflect.Value) { requireAndSetIntField(t, input, "Limit", 101) }},
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
			method, input := validAttemptTimelineCall(t, repository, 20)
			tt.mutate(t, input)

			outputs := method.Call([]reflect.Value{reflect.ValueOf(context.Background()), input})
			if err := reflectedCallError(outputs); err == nil {
				t.Fatal("unsafe attempt timeline error = nil")
			}
			if err := mock.ExpectationsWereMet(); err != nil {
				t.Fatalf("unsafe attempt timeline input must fail before SQL: %v", err)
			}
		})
	}
}

func requireListAttemptTimelineMethod(t *testing.T, repository *Repository) (reflect.Value, reflect.Type) {
	t.Helper()
	method := reflect.ValueOf(repository).MethodByName("ListAttemptTimeline")
	if !method.IsValid() {
		t.Fatal("Repository.ListAttemptTimeline is required")
	}
	methodType := method.Type()
	contextType := reflect.TypeOf((*context.Context)(nil)).Elem()
	errorType := reflect.TypeOf((*error)(nil)).Elem()
	if methodType.NumIn() != 2 || methodType.In(0) != contextType || methodType.In(1).Kind() != reflect.Struct ||
		methodType.NumOut() != 2 || methodType.Out(0).Kind() != reflect.Slice || !methodType.Out(1).Implements(errorType) {
		t.Fatalf("Repository.ListAttemptTimeline signature = %s, want (context.Context, AttemptTimelineInput) ([]AttemptTimelineEntry, error)", methodType)
	}
	return method, methodType.In(1)
}

func validAttemptTimelineCall(t *testing.T, repository *Repository, limit int64) (reflect.Value, reflect.Value) {
	t.Helper()
	method, inputType := requireListAttemptTimelineMethod(t, repository)
	input := reflect.New(inputType).Elem()
	requireAndSetStringField(t, input, "TenantCode", "TENANT-A")
	requireAndSetStringField(t, input, "DeploymentCode", "DEPLOYMENT-A")
	requireAndSetStringField(t, input, "SourceApp", "aims")
	requireAndSetStringField(t, input, "OperationID", timelineOperationID)
	requireAndSetIntField(t, input, "Limit", limit)
	return method, input
}

func attemptTimelineRows() *sqlmock.Rows {
	return sqlmock.NewRows([]string{
		"attempt_id", "operation_id", "operation_code", "attempt_no", "trigger_type",
		"result_status",
		"http_status", "error_code", "error_class", "target_biz_type", "target_biz_code",
		"started_at", "finished_at", "duration_ms", "created_at",
	})
}

func requireTimelineIntegerField(t *testing.T, item reflect.Value, name string, want int64) {
	t.Helper()
	field := item.FieldByName(name)
	if !field.IsValid() {
		t.Fatalf("%s.%s integer field is required", item.Type(), name)
	}
	var got int64
	switch field.Kind() {
	case reflect.Int, reflect.Int8, reflect.Int16, reflect.Int32, reflect.Int64:
		got = field.Int()
	case reflect.Uint, reflect.Uint8, reflect.Uint16, reflect.Uint32, reflect.Uint64:
		got = int64(field.Uint())
	default:
		t.Fatalf("%s.%s integer field is required", item.Type(), name)
	}
	if got != want {
		t.Fatalf("%s.%s = %d, want %d", item.Type(), name, got, want)
	}
}

func requireTimelineStringLikeField(t *testing.T, item reflect.Value, name string, want string) {
	t.Helper()
	field := item.FieldByName(name)
	if !field.IsValid() || field.Kind() != reflect.String {
		t.Fatalf("%s.%s string-like field is required", item.Type(), name)
	}
	if field.String() != want {
		t.Fatalf("%s.%s = %q, want %q", item.Type(), name, field.String(), want)
	}
}
