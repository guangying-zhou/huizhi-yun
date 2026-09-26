package codocs

import (
	"context"
	"net/http"
	"net/url"
	"testing"

	"github.com/DATA-DOG/go-sqlmock"
	"github.com/huizhi-yun/data-runtime/internal/httperror"
)

func TestCollaborationContextAllowsTrustedDepartmentReadonly(t *testing.T) {
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatalf("sqlmock.New: %v", err)
	}
	defer db.Close()

	adapter := &Adapter{db: db}
	expectSnapshotV2Absent(mock, "doc-dept")
	mock.ExpectQuery("(?s)SELECT id, uuid, doc_type, oss_path, owner_uid, dept_code, readonly_flag, status\\s+FROM documents\\s+WHERE uuid = \\? AND status <> 0\\s+LIMIT 1").
		WithArgs("doc-dept").
		WillReturnRows(sqlmock.NewRows([]string{
			"id",
			"uuid",
			"doc_type",
			"oss_path",
			"owner_uid",
			"dept_code",
			"readonly_flag",
			"status",
		}).AddRow(
			10,
			"doc-dept",
			"department",
			"codocs/departments/D1/docs/doc-dept.md",
			"owner-uid",
			"D1",
			0,
			1,
		))
	mock.ExpectQuery("(?s)SELECT permission\\s+FROM document_shares\\s+WHERE document_id = \\? AND shared_to_uid = \\?\\s+LIMIT 1").
		WithArgs(int64(10), "viewer-uid").
		WillReturnRows(sqlmock.NewRows([]string{"permission"}))

	result, err := adapter.collaborationContext(context.Background(), url.Values{
		"uuid":                              {"doc-dept"},
		"current_user":                      {"viewer-uid"},
		"actorUid":                          {"spoofed-uid"},
		"trusted_department_read_dept_code": {"D1"},
	})
	if err != nil {
		t.Fatalf("collaborationContext returned error: %v", err)
	}
	if got := result["readonly"]; got != true {
		t.Fatalf("readonly = %#v, want true", got)
	}
	if got := result["sharePermission"]; got != nil {
		t.Fatalf("sharePermission = %#v, want nil", got)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatalf("unmet sql expectations: %v", err)
	}
}

func TestHandleRuntimeCollaborationDocumentContextPreservesRouteAndProjection(t *testing.T) {
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatalf("sqlmock.New: %v", err)
	}
	defer db.Close()

	adapter := &Adapter{db: db}
	expectSnapshotV2Absent(mock, "doc-route")
	mock.ExpectQuery("(?s)SELECT id, uuid, doc_type, oss_path, owner_uid, dept_code, readonly_flag, status\\s+FROM documents\\s+WHERE uuid = \\? AND status <> 0\\s+LIMIT 1").
		WithArgs("doc-route").
		WillReturnRows(sqlmock.NewRows([]string{
			"id",
			"uuid",
			"doc_type",
			"oss_path",
			"owner_uid",
			"dept_code",
			"readonly_flag",
			"status",
		}).AddRow(11, "doc-route", "private", "codocs/users/owner/doc-route.md", "owner-uid", nil, 0, 1))
	mock.ExpectQuery("(?s)SELECT permission\\s+FROM document_shares\\s+WHERE document_id = \\? AND shared_to_uid = \\?\\s+LIMIT 1").
		WithArgs(int64(11), "viewer-uid").
		WillReturnRows(sqlmock.NewRows([]string{"permission"}).AddRow("write"))

	response, operation, err := adapter.HandleRuntime(context.Background(), http.MethodGet, "/v1/codocs/collaboration/documents/doc-route/context", url.Values{
		"current_user": {"viewer-uid"},
	}, map[string]any{})
	if err != nil {
		t.Fatalf("HandleRuntime returned error: %v", err)
	}
	if operation != "codocs.collaboration.context" {
		t.Fatalf("operation = %q, want codocs.collaboration.context", operation)
	}
	payload, ok := response.(map[string]any)
	if !ok {
		t.Fatalf("response = %#v, want envelope map", response)
	}
	data, ok := payload["data"].(map[string]any)
	if !ok {
		t.Fatalf("response data = %#v, want context projection", payload["data"])
	}
	if got := data["docUuid"]; got != "doc-route" {
		t.Fatalf("docUuid = %#v, want doc-route", got)
	}
	if got := data["actorUid"]; got != "viewer-uid" {
		t.Fatalf("actorUid = %#v, want viewer-uid", got)
	}
	if got := data["sharePermission"]; got != "write" {
		t.Fatalf("sharePermission = %#v, want write", got)
	}
	if got := data["readonly"]; got != false {
		t.Fatalf("readonly = %#v, want false", got)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatalf("unmet sql expectations: %v", err)
	}
}

func TestHandleRuntimeCollabDocsRejectsMissingActorWithoutQuery(t *testing.T) {
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatalf("sqlmock.New: %v", err)
	}
	defer db.Close()

	adapter := &Adapter{db: db}
	_, operation, err := adapter.HandleRuntime(context.Background(), http.MethodGet, "/v1/codocs/collab-docs", url.Values{}, map[string]any{})
	if operation != "codocs.collab_docs.list" {
		t.Fatalf("operation = %q, want codocs.collab_docs.list", operation)
	}
	httpErr, ok := err.(httperror.Error)
	if !ok {
		t.Fatalf("error = %T %v, want httperror.Error", err, err)
	}
	if httpErr.Status != http.StatusUnauthorized || httpErr.Code != "current_user_required" {
		t.Fatalf("error = %#v, want unauthorized current_user_required", httpErr)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatalf("unexpected query: %v", err)
	}
}

func TestHandleRuntimeCollabDocsProjectsTodoRelation(t *testing.T) {
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatalf("sqlmock.New: %v", err)
	}
	defer db.Close()

	adapter := &Adapter{db: db}
	mock.ExpectQuery("(?s)FROM document_relations dr.*WHERE dr.related_uid = \\? AND dr.status = 1 AND d.status != 0 AND dr.relation_type LIKE \\?.*ORDER BY d.updated_at DESC").
		WithArgs("viewer-uid", "shared_%").
		WillReturnRows(sqlmock.NewRows([]string{
			"document_id",
			"document_uuid",
			"title",
			"doc_type",
			"oss_path",
			"owner_uid",
			"dept_code",
			"readonly_flag",
			"status",
			"publish_info",
			"updated_at",
			"relation_type",
			"source_type",
			"source_id",
			"can_edit",
			"relation_metadata",
			"review_id",
			"review_status",
			"review_type",
			"review_sub_type",
			"review_execution_status",
			"review_current_node",
			"flow_snapshot",
		}).AddRow(
			7, "doc-todo", "待审文档", "department", "codocs/departments/D1/records/doc-todo.md", "owner-uid", "D1", 0, 1, nil, "2026-07-11 12:00:00",
			"shared_to_me", "review", "17", 1, nil, 17, "in_progress", "publish", "standard", "running", 0, `[{"reviewers":["viewer-uid"]}]`,
		))

	response, operation, err := adapter.HandleRuntime(context.Background(), http.MethodGet, "/v1/codocs/collab-docs", url.Values{
		"current_user": {"viewer-uid"},
		"scope":        {"todo"},
	}, map[string]any{})
	if err != nil {
		t.Fatalf("HandleRuntime returned error: %v", err)
	}
	if operation != "codocs.collab_docs.list" {
		t.Fatalf("operation = %q, want codocs.collab_docs.list", operation)
	}
	payload := response.(map[string]any)
	data := payload["data"].(map[string]any)
	items := data["items"].([]map[string]any)
	if len(items) != 1 {
		t.Fatalf("items = %#v, want one todo projection", items)
	}
	item := items[0]
	if got := item["uuid"]; got != "doc-todo" {
		t.Fatalf("uuid = %#v, want doc-todo", got)
	}
	if got := item["isTodo"]; got != true {
		t.Fatalf("isTodo = %#v, want true", got)
	}
	if got := item["relationLabels"]; len(got.([]string)) != 1 || got.([]string)[0] != "共享给我" {
		t.Fatalf("relationLabels = %#v, want shared label", got)
	}
	if got := item["locationLabel"]; got != "部门文档 / 会议记录" {
		t.Fatalf("locationLabel = %#v, want department record label", got)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatalf("unmet sql expectations: %v", err)
	}
}

func TestHandleRuntimeCollabDocsProjectsPendingSealForTrustedAdmin(t *testing.T) {
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatalf("sqlmock.New: %v", err)
	}
	defer db.Close()

	columns := []string{
		"document_id",
		"document_uuid",
		"title",
		"doc_type",
		"oss_path",
		"owner_uid",
		"dept_code",
		"readonly_flag",
		"status",
		"publish_info",
		"updated_at",
		"relation_type",
		"source_type",
		"source_id",
		"can_edit",
		"relation_metadata",
		"review_id",
		"review_status",
		"review_type",
		"review_sub_type",
		"review_execution_status",
		"review_current_node",
		"flow_snapshot",
	}
	adapter := &Adapter{db: db}
	mock.ExpectQuery(`(?s)FROM document_relations dr.*WHERE dr\.related_uid = \? AND dr\.status = 1 AND d\.status != 0 AND dr\.relation_type LIKE \?.*ORDER BY d\.updated_at DESC`).
		WithArgs("seal-admin", "outside_%").
		WillReturnRows(sqlmock.NewRows(columns))
	mock.ExpectQuery(`(?s)FROM document_publish_requests pr.*pr\.execution_status='pending_seal'.*ORDER BY d\.updated_at DESC`).
		WillReturnRows(sqlmock.NewRows(columns).AddRow(
			int64(77),
			"published-doc-uuid",
			"待盖章发文",
			"department",
			"codocs/departments/D1/outsides/published.md",
			"initiator",
			"D1",
			1,
			2,
			nil,
			"2026-07-17 12:00:00",
			"outside_seal_handler",
			"publish_request",
			"42",
			0,
			nil,
			int64(42),
			"archived",
			"对外发文",
			"对外发文",
			"pending_seal",
			0,
			`[]`,
		))

	response, operation, err := adapter.HandleRuntime(context.Background(), http.MethodGet, "/v1/codocs/collab-docs", url.Values{
		"current_user":                          {"seal-admin"},
		"category":                              {"outside"},
		"scope":                                 {"todo"},
		"hzy_runtime_actor_delegated":           {"1"},
		"codocs_trusted_review_execution_admin": {"1"},
	}, map[string]any{})
	if err != nil {
		t.Fatalf("HandleRuntime returned error: %v", err)
	}
	if operation != "codocs.collab_docs.list" {
		t.Fatalf("operation = %q, want codocs.collab_docs.list", operation)
	}
	payload := response.(map[string]any)
	data := payload["data"].(map[string]any)
	items := data["items"].([]map[string]any)
	if len(items) != 1 {
		t.Fatalf("items = %#v, want one pending seal projection", items)
	}
	if items[0]["reviewExecutionStatus"] != "pending_seal" || items[0]["isTodo"] != true {
		t.Fatalf("unexpected pending seal projection: %#v", items[0])
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatalf("unmet sql expectations: %v", err)
	}
}
