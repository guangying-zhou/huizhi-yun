package codocs

import (
	"context"
	"net/http"
	"net/url"
	"regexp"
	"testing"

	"github.com/DATA-DOG/go-sqlmock"
	"github.com/huizhi-yun/data-runtime/internal/httperror"
)

func trustedIssueQuery(projectCode string) url.Values {
	return url.Values{
		"current_user":                    {"issue-user"},
		"hzy_runtime_actor_delegated":     {"1"},
		codocsTrustedIssueProjectQueryKey: {projectCode},
	}
}

func TestIssueRuntimeRequiresTrustedProjectScopeBeforeStorage(t *testing.T) {
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatalf("sqlmock.New: %v", err)
	}
	defer db.Close()
	adapter := &Adapter{db: db}
	query := url.Values{"current_user": {"issue-user"}, "hzy_runtime_actor_delegated": {"1"}}

	checks := []struct {
		name string
		call func() error
	}{
		{"list", func() error { _, err := adapter.issuesList(context.Background(), query); return err }},
		{"create", func() error {
			_, err := adapter.createIssue(context.Background(), query, map[string]any{"project_code": "P1", "title": "issue"})
			return err
		}},
		{"detail", func() error { _, err := adapter.issueDetail(context.Background(), "7", query); return err }},
		{"update", func() error {
			_, err := adapter.updateIssue(context.Background(), "7", query, map[string]any{"title": "issue"})
			return err
		}},
		{"delete", func() error { _, err := adapter.deleteIssue(context.Background(), "7", query); return err }},
		{"pending", func() error { _, err := adapter.issuePendingCount(context.Background(), query); return err }},
		{"comment", func() error {
			_, err := adapter.createIssueComment(context.Background(), "7", query, map[string]any{"content": "comment"})
			return err
		}},
	}

	for _, check := range checks {
		t.Run(check.name, func(t *testing.T) {
			err := check.call()
			httpErr, ok := err.(httperror.Error)
			if !ok || httpErr.Status != http.StatusForbidden || httpErr.Code != "issue_project_scope_required" {
				t.Fatalf("error = %#v", err)
			}
		})
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatalf("missing scope must not access storage: %v", err)
	}
}

func TestIssueRuntimeRejectsPurposeDelegationBeforeStorage(t *testing.T) {
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatalf("sqlmock.New: %v", err)
	}
	defer db.Close()
	adapter := &Adapter{db: db}
	query := trustedIssueQuery("P1")
	query.Set("hzy_runtime_actor_purpose", "service-command")

	_, err = adapter.issuesList(context.Background(), query)
	httpErr, ok := err.(httperror.Error)
	if !ok || httpErr.Status != http.StatusForbidden || httpErr.Code != "issue_user_actor_required" {
		t.Fatalf("error = %#v", err)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatalf("purpose delegation must not access storage: %v", err)
	}
}

func TestIssueRuntimeListAndPendingCountBindTrustedProject(t *testing.T) {
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatalf("sqlmock.New: %v", err)
	}
	defer db.Close()
	adapter := &Adapter{db: db}
	query := trustedIssueQuery("P1")

	mock.ExpectQuery(regexp.QuoteMeta("SELECT COUNT(*) FROM project_issues i WHERE i.project_code = ?")).WithArgs("P1").WillReturnRows(sqlmock.NewRows([]string{"count"}).AddRow(1))
	mock.ExpectQuery("(?s)SELECT i\\.\\*.*FROM project_issues i.*WHERE i\\.project_code = \\?.*LIMIT \\? OFFSET \\?").WithArgs("P1", 20, 0).WillReturnRows(sqlmock.NewRows([]string{"id", "project_code", "title", "comment_count"}).AddRow(7, "P1", "scoped", 0))
	page, err := adapter.issuesList(context.Background(), query)
	if err != nil || page["total"] != int64(1) {
		t.Fatalf("issuesList result=%#v err=%v", page, err)
	}

	mock.ExpectQuery(regexp.QuoteMeta("SELECT COUNT(*) FROM project_issues WHERE project_code = ? AND status IN ('open', 'in_progress')")).WithArgs("P1").WillReturnRows(sqlmock.NewRows([]string{"count"}).AddRow(1))
	mock.ExpectQuery(regexp.QuoteMeta("SELECT COUNT(*) FROM project_issues WHERE project_code = ?")).WithArgs("P1").WillReturnRows(sqlmock.NewRows([]string{"count"}).AddRow(2))
	counts, err := adapter.issuePendingCount(context.Background(), query)
	if err != nil || counts["pending"] != int64(1) || counts["total"] != int64(2) {
		t.Fatalf("issuePendingCount result=%#v err=%v", counts, err)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}

func TestIssueRuntimeDetailDeleteAndCommentBindTrustedProject(t *testing.T) {
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatalf("sqlmock.New: %v", err)
	}
	defer db.Close()
	adapter := &Adapter{db: db}
	query := trustedIssueQuery("P1")

	mock.ExpectQuery(regexp.QuoteMeta("SELECT * FROM project_issues WHERE id = ? AND project_code = ? LIMIT 1")).WithArgs("7", "P1").WillReturnRows(sqlmock.NewRows([]string{"id", "project_code", "title"}).AddRow(7, "P1", "scoped"))
	mock.ExpectQuery(regexp.QuoteMeta("SELECT * FROM issue_comments WHERE issue_id = ? ORDER BY created_at ASC, id ASC")).WithArgs("7").WillReturnRows(sqlmock.NewRows([]string{"id", "issue_id", "author", "content"}))
	if _, err := adapter.issueDetail(context.Background(), "7", query); err != nil {
		t.Fatalf("issueDetail: %v", err)
	}

	mock.ExpectExec(regexp.QuoteMeta("DELETE FROM project_issues WHERE id = ? AND project_code = ?")).WithArgs("7", "P1").WillReturnResult(sqlmock.NewResult(0, 1))
	if _, err := adapter.deleteIssue(context.Background(), "7", query); err != nil {
		t.Fatalf("deleteIssue: %v", err)
	}

	mock.ExpectExec("(?s)INSERT INTO issue_comments.*SELECT id, \\?, \\? FROM project_issues WHERE id = \\? AND project_code = \\?").WithArgs("issue-user", "comment", "7", "P1").WillReturnResult(sqlmock.NewResult(8, 1))
	if _, err := adapter.createIssueComment(context.Background(), "7", query, map[string]any{"author": "spoofed", "content": "comment"}); err != nil {
		t.Fatalf("createIssueComment: %v", err)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}

func TestIssueRuntimeDocumentAssociationIsTransactionScoped(t *testing.T) {
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatalf("sqlmock.New: %v", err)
	}
	defer db.Close()
	adapter := &Adapter{db: db}
	query := trustedIssueQuery("P1")

	mock.ExpectBegin()
	mock.ExpectQuery("(?s)SELECT uuid FROM documents.*uuid = \\? AND project_code = \\?.*doc_type IN \\('project', 'git-project'\\).*FOR SHARE").WithArgs("foreign-doc", "P1").WillReturnRows(sqlmock.NewRows([]string{"uuid"}))
	mock.ExpectRollback()
	_, err = adapter.createIssue(context.Background(), query, map[string]any{"project_code": "P1", "title": "issue", "document_uuid": "foreign-doc"})
	httpErr, ok := err.(httperror.Error)
	if !ok || httpErr.Code != "issue_document_scope_invalid" {
		t.Fatalf("create error=%#v", err)
	}

	mock.ExpectBegin()
	mock.ExpectQuery("(?s)SELECT uuid FROM documents.*uuid = \\? AND project_code = \\?.*doc_type IN \\('project', 'git-project'\\).*FOR SHARE").WithArgs("private-doc", "P1").WillReturnRows(sqlmock.NewRows([]string{"uuid"}))
	mock.ExpectRollback()
	_, err = adapter.updateIssue(context.Background(), "7", query, map[string]any{"document_uuid": "private-doc"})
	httpErr, ok = err.(httperror.Error)
	if !ok || httpErr.Code != "issue_document_scope_invalid" {
		t.Fatalf("update error=%#v", err)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatalf("cross-project/private document must not write issues: %v", err)
	}
}

func TestIssueRuntimeUpdateBindsProjectInTransaction(t *testing.T) {
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatalf("sqlmock.New: %v", err)
	}
	defer db.Close()
	adapter := &Adapter{db: db}
	mock.ExpectBegin()
	mock.ExpectExec(regexp.QuoteMeta("UPDATE project_issues SET `title` = ? WHERE id = ? AND project_code = ?")).WithArgs("scoped", "7", "P1").WillReturnResult(sqlmock.NewResult(0, 1))
	mock.ExpectCommit()
	result, err := adapter.updateIssue(context.Background(), "7", trustedIssueQuery("P1"), map[string]any{"title": "scoped"})
	if err != nil || result["updated"] != true {
		t.Fatalf("update result=%#v err=%v", result, err)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}
