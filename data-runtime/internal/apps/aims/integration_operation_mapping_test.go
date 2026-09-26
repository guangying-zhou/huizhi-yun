package aims

import (
	"context"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/DATA-DOG/go-sqlmock"
	"github.com/huizhi-yun/data-runtime/internal/integrationoperation"
)

func TestAimsIntegrationOperationRepositoryUsesRegisteredTables(t *testing.T) {
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	tables, err := integrationoperation.NewOutboxTables("`aims_integration_operation`", "`aims_integration_operation_attempt`", "`aims_service_command_receipt`", "`aims_integration_operation_dead_letter_actionable`")
	if err != nil {
		t.Fatal(err)
	}
	repository, err := aimsCompletionRepository(db, integrationoperation.TrustedContext{OutboxTables: &tables})
	if err != nil {
		t.Fatal(err)
	}
	identity := integrationoperation.DiagnosticListInput{TenantCode: "C000001", DeploymentCode: "C000001-test-aims", SourceApp: "aims", Limit: 1}
	mock.ExpectQuery("FROM `aims_integration_operation`").WillReturnRows(sqlmock.NewRows([]string{"operation_id"}))
	if _, err := repository.ListDiagnostics(context.Background(), identity); err != nil {
		t.Fatal(err)
	}
	mock.ExpectQuery("FROM `aims_integration_operation_attempt` a\\s+INNER JOIN `aims_integration_operation` o").WillReturnRows(sqlmock.NewRows([]string{"attempt_id"}))
	if _, err := repository.ListAttemptTimeline(context.Background(), integrationoperation.AttemptTimelineInput{TenantCode: identity.TenantCode, DeploymentCode: identity.DeploymentCode, SourceApp: identity.SourceApp, OperationID: "550e8400-e29b-41d4-a716-446655440010", Limit: 1}); err != nil {
		t.Fatal(err)
	}
	mock.ExpectQuery("FROM `aims_integration_operation_dead_letter_actionable` d\\s+JOIN `aims_integration_operation` i").WillReturnRows(sqlmock.NewRows([]string{"recipient_uids"}))
	if _, _, err := repository.AuthorizeDeadLetterNotification(context.Background(), integrationoperation.AuthorizeDeadLetterNotificationInput{TenantCode: identity.TenantCode, DeploymentCode: identity.DeploymentCode, SourceApp: identity.SourceApp, OperationID: "550e8400-e29b-41d4-a716-446655440010", NotificationID: "notification-1", SubjectUID: "user-1"}); err != nil {
		t.Fatal(err)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}

func TestAimsIntegrationOperationRoutesNeverConstructBareRepository(t *testing.T) {
	files, err := filepath.Glob("*.go")
	if err != nil {
		t.Fatal(err)
	}
	for _, path := range files {
		if strings.HasSuffix(path, "_test.go") {
			continue
		}
		content, err := os.ReadFile(path)
		if err != nil {
			t.Fatal(err)
		}
		if strings.Contains(string(content), "integrationoperation.NewRepository(a.DB())") {
			t.Errorf("%s constructs a bare integration operation repository on the unified Aims adapter", path)
		}
	}
}
