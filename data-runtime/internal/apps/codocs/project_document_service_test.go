package codocs

import (
	"context"
	"net/http"
	"net/url"
	"regexp"
	"testing"

	"github.com/DATA-DOG/go-sqlmock"
	"github.com/huizhi-yun/data-runtime/internal/httperror"
	"github.com/huizhi-yun/data-runtime/internal/integrationoperation"
)

func projectDocumentServiceQuery() url.Values {
	return url.Values{
		"current_user":                {"reader-uid"},
		"hzy_runtime_actor_delegated": {"1"},
		"hzy_runtime_actor_purpose":   {"service-command"},
	}
}

func projectDocumentServiceBody(uuid, projectCode string) map[string]any {
	return map[string]any{
		integrationoperation.TrustedServiceCommandTenantKey:           "TENANT-1",
		integrationoperation.TrustedServiceCommandSourceDeploymentKey: "AIMS-DEPLOYMENT",
		integrationoperation.TrustedServiceCommandTargetDeploymentKey: "CODOCS-DEPLOYMENT",
		integrationoperation.TrustedServiceCommandSourceAppKey:        "aims",
		integrationoperation.TrustedServiceCommandTargetAppKey:        "codocs",
		integrationoperation.TrustedServiceCommandSourceClientKey:     "aims.runtime",
		integrationoperation.ServiceCommandEnvelopeKey: map[string]any{
			"targetApp":            "codocs",
			"operationCode":        aimsProjectDocumentContentOperation,
			"requiredCapability":   aimsProjectDocumentContentCapability,
			"commandSchemaVersion": aimsProjectDocumentContentSchema,
			"command": map[string]any{
				"actorUid":     "reader-uid",
				"projectCode":  projectCode,
				"documentUuid": uuid,
				"action":       "content:read",
			},
		},
	}
}

func projectDocumentServiceReadRows(uuid, projectCode string) *sqlmock.Rows {
	return sqlmock.NewRows([]string{
		"id", "uuid", "title", "owner_uid", "doc_type", "dept_code", "readonly_flag", "status", "project_code", "oss_path", "content_size", "updated_at",
	}).AddRow(19, uuid, "Project requirement", "reader-uid", "project", nil, 0, 1, projectCode, "codocs/projects/PRJ-1/doc.md", 42, "2026-07-12 12:00:00")
}

func TestProjectDocumentServiceCommandRejectsBeforeStorage(t *testing.T) {
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatalf("sqlmock.New: %v", err)
	}
	defer db.Close()

	adapter := &Adapter{db: db}
	body := projectDocumentServiceBody("doc-1", "PRJ-1")
	body[integrationoperation.TrustedServiceCommandSourceClientKey] = "aims"
	_, operation, err := adapter.HandleRuntime(context.Background(), http.MethodPost, "/v1/codocs/service/project-documents/doc-1/content", projectDocumentServiceQuery(), body)
	if operation != "codocs.service.project_document.content" {
		t.Fatalf("operation = %q", operation)
	}
	httpErr, ok := err.(httperror.Error)
	if !ok || httpErr.Status != http.StatusForbidden || httpErr.Code != "project_document_service_command_invalid" {
		t.Fatalf("error = %#v", err)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatalf("invalid command must not access storage: %v", err)
	}
}

func TestProjectDocumentServiceContentRequiresCodocsACL(t *testing.T) {
	t.Run("returns only internal metadata after owner ACL", func(t *testing.T) {
		db, mock, err := sqlmock.New()
		if err != nil {
			t.Fatalf("sqlmock.New: %v", err)
		}
		defer db.Close()
		adapter := &Adapter{db: db}
		mock.ExpectQuery(regexp.QuoteMeta("SELECT * FROM documents WHERE uuid = ? AND status <> 0 LIMIT 1")).WithArgs("doc-1").WillReturnRows(projectDocumentServiceReadRows("doc-1", "PRJ-1"))

		result, _, err := adapter.HandleRuntime(context.Background(), http.MethodPost, "/v1/codocs/service/project-documents/doc-1/content", projectDocumentServiceQuery(), projectDocumentServiceBody("doc-1", "PRJ-1"))
		if err != nil {
			t.Fatalf("HandleRuntime: %v", err)
		}
		data := result.(map[string]any)["data"].(map[string]any)
		if data["uuid"] != "doc-1" || data["ossPath"] != "codocs/projects/PRJ-1/doc.md" || data["docType"] != "project" {
			t.Fatalf("runtime metadata = %#v", data)
		}
		if err := mock.ExpectationsWereMet(); err != nil {
			t.Fatal(err)
		}
	})

	t.Run("allows an Aims project to reference an ACL-readable department document", func(t *testing.T) {
		db, mock, err := sqlmock.New()
		if err != nil {
			t.Fatalf("sqlmock.New: %v", err)
		}
		defer db.Close()
		adapter := &Adapter{db: db}
		mock.ExpectQuery(regexp.QuoteMeta("SELECT * FROM documents WHERE uuid = ? AND status <> 0 LIMIT 1")).WithArgs("doc-1").WillReturnRows(sqlmock.NewRows([]string{
			"id", "uuid", "title", "owner_uid", "doc_type", "dept_code", "readonly_flag", "status", "project_code", "oss_path", "content_size", "updated_at",
		}).AddRow(19, "doc-1", "Department requirement", "reader-uid", "department", "RD", 0, 1, nil, "codocs/departments/RD/doc.md", 42, "2026-07-12 12:00:00"))

		result, _, err := adapter.HandleRuntime(context.Background(), http.MethodPost, "/v1/codocs/service/project-documents/doc-1/content", projectDocumentServiceQuery(), projectDocumentServiceBody("doc-1", "PRJ-1"))
		if err != nil {
			t.Fatalf("HandleRuntime: %v", err)
		}
		data := result.(map[string]any)["data"].(map[string]any)
		if data["docType"] != "department" || data["ossPath"] != "codocs/departments/RD/doc.md" {
			t.Fatalf("runtime metadata = %#v", data)
		}
		if err := mock.ExpectationsWereMet(); err != nil {
			t.Fatal(err)
		}
	})

	t.Run("Aims project relation does not replace Codocs share ACL", func(t *testing.T) {
		db, mock, err := sqlmock.New()
		if err != nil {
			t.Fatalf("sqlmock.New: %v", err)
		}
		defer db.Close()
		adapter := &Adapter{db: db}
		mock.ExpectQuery(regexp.QuoteMeta("SELECT * FROM documents WHERE uuid = ? AND status <> 0 LIMIT 1")).WithArgs("doc-1").WillReturnRows(sqlmock.NewRows([]string{
			"id", "uuid", "title", "owner_uid", "doc_type", "dept_code", "readonly_flag", "status", "project_code", "oss_path",
		}).AddRow(19, "doc-1", "Project requirement", "owner-uid", "project", nil, 0, 1, "PRJ-1", "codocs/projects/PRJ-1/doc.md"))
		mock.ExpectQuery(regexp.QuoteMeta("SELECT permission\n      FROM document_shares\n      WHERE document_id = ? AND shared_to_uid = ?\n      LIMIT 1")).WithArgs(int64(19), "reader-uid").WillReturnRows(sqlmock.NewRows([]string{"permission"}))
		mock.ExpectQuery(`(?s)SELECT TABLE_NAME.*FROM information_schema\.TABLES.*TABLE_SCHEMA = DATABASE\(\) AND TABLE_NAME = \?.*LIMIT 1`).WithArgs("document_relations").WillReturnRows(sqlmock.NewRows([]string{"TABLE_NAME"}).AddRow("document_relations"))
		mock.ExpectQuery(`(?s)SELECT COUNT\(\*\).*FROM document_relations.*document_id = \? AND related_uid = \? AND status = 1 AND can_read = 1.*source_type <> 'project_preview_access'.*updated_at >= DATE_SUB\(NOW\(\), INTERVAL 12 HOUR\)`).WithArgs(int64(19), "reader-uid").WillReturnRows(sqlmock.NewRows([]string{"COUNT(*)"}).AddRow(0))

		_, _, err = adapter.HandleRuntime(context.Background(), http.MethodPost, "/v1/codocs/service/project-documents/doc-1/content", projectDocumentServiceQuery(), projectDocumentServiceBody("doc-1", "PRJ-1"))
		httpErr, ok := err.(httperror.Error)
		if !ok || httpErr.Status != http.StatusForbidden || httpErr.Code != "permission_denied" {
			t.Fatalf("error = %#v", err)
		}
		if err := mock.ExpectationsWereMet(); err != nil {
			t.Fatal(err)
		}
	})
}

// ADR-018 §3.2 要求的「错来源应用」验收：统一企业宿主是与 Aims 并列的来源，
// 两条来源各自与自己的 source client 绑定。交叉组合（aims + enterprise.runtime、
// enterprise + aims.runtime）以及任何第三方来源都必须在触达存储前被拒。
func TestProjectDocumentServiceContentBindsEachSourceAppToItsOwnClient(t *testing.T) {
	for _, source := range []string{"aims", "enterprise"} {
		other := "enterprise"
		if source == "enterprise" {
			other = "aims"
		}
		t.Run(source, func(t *testing.T) {
			db, mock, err := sqlmock.New()
			if err != nil {
				t.Fatalf("sqlmock.New: %v", err)
			}
			defer db.Close()
			adapter := &Adapter{db: db}

			// 交叉来源/客户端：不得访问存储。
			for _, client := range []string{other + ".runtime", source, "other.runtime"} {
				body := projectDocumentServiceBody("doc-1", "PRJ-1")
				body[integrationoperation.TrustedServiceCommandSourceAppKey] = source
				body[integrationoperation.TrustedServiceCommandSourceClientKey] = client
				_, _, err := adapter.HandleRuntime(context.Background(), http.MethodPost, "/v1/codocs/service/project-documents/doc-1/content", projectDocumentServiceQuery(), body)
				httpErr, ok := err.(httperror.Error)
				if !ok || httpErr.Status != http.StatusForbidden || httpErr.Code != "project_document_service_command_invalid" {
					t.Fatalf("source %s client %s: error = %#v", source, client, err)
				}
			}
			// 未登记的第三方来源即便自洽也必须被拒。
			for _, stranger := range []string{"assets", "altoc", "console", ""} {
				body := projectDocumentServiceBody("doc-1", "PRJ-1")
				body[integrationoperation.TrustedServiceCommandSourceAppKey] = stranger
				body[integrationoperation.TrustedServiceCommandSourceClientKey] = stranger + ".runtime"
				_, _, err := adapter.HandleRuntime(context.Background(), http.MethodPost, "/v1/codocs/service/project-documents/doc-1/content", projectDocumentServiceQuery(), body)
				httpErr, ok := err.(httperror.Error)
				if !ok || httpErr.Status != http.StatusForbidden || httpErr.Code != "project_document_service_command_invalid" {
					t.Fatalf("stranger %q: error = %#v", stranger, err)
				}
			}
			if err := mock.ExpectationsWereMet(); err != nil {
				t.Fatalf("rejected identity must not access storage: %v", err)
			}

			// 自洽来源仍要通过 Codocs 自己的文档 ACL，宿主不获得额外授权。
			mock.ExpectQuery(regexp.QuoteMeta("SELECT * FROM documents WHERE uuid = ? AND status <> 0 LIMIT 1")).WithArgs("doc-1").WillReturnRows(projectDocumentServiceReadRows("doc-1", "PRJ-1"))
			body := projectDocumentServiceBody("doc-1", "PRJ-1")
			body[integrationoperation.TrustedServiceCommandSourceAppKey] = source
			body[integrationoperation.TrustedServiceCommandSourceClientKey] = source + ".runtime"
			result, _, err := adapter.HandleRuntime(context.Background(), http.MethodPost, "/v1/codocs/service/project-documents/doc-1/content", projectDocumentServiceQuery(), body)
			if err != nil {
				t.Fatalf("source %s: HandleRuntime: %v", source, err)
			}
			data := result.(map[string]any)["data"].(map[string]any)
			if data["uuid"] != "doc-1" || data["ossPath"] != "codocs/projects/PRJ-1/doc.md" {
				t.Fatalf("source %s: metadata = %#v", source, data)
			}
			if err := mock.ExpectationsWereMet(); err != nil {
				t.Fatal(err)
			}
		})
	}
}
