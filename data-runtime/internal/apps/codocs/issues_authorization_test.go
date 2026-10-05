package codocs

import (
	"context"
	"net/http"
	"net/url"
	"regexp"
	"testing"

	"github.com/DATA-DOG/go-sqlmock"
)

func TestIssueRuntimeRejectsActorWithoutTrustedDelegation(t *testing.T) {
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatalf("sqlmock.New: %v", err)
	}
	defer db.Close()
	adapter := &Adapter{db: db}
	query := url.Values{"current_user": {"spoofed-user"}}

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
		{"pending-count", func() error { _, err := adapter.issuePendingCount(context.Background(), query); return err }},
		{"comment", func() error {
			_, err := adapter.createIssueComment(context.Background(), "7", query, map[string]any{"author": "spoofed-author", "content": "comment"})
			return err
		}},
	}

	for _, check := range checks {
		t.Run(check.name, func(t *testing.T) {
			if err := check.call(); err == nil {
				t.Fatal("untrusted actor must be rejected")
			}
		})
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatalf("untrusted issue calls must not query or mutate storage: %v", err)
	}
}

func TestIssueRuntimeRoutesKeepScopedHandlersAndOperations(t *testing.T) {
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatalf("sqlmock.New: %v", err)
	}
	defer db.Close()
	adapter := &Adapter{db: db}
	query := url.Values{"current_user": {"spoofed-user"}}

	checks := []struct {
		name      string
		method    string
		path      string
		body      map[string]any
		operation string
	}{
		{"list", http.MethodGet, "/v1/codocs/issues", nil, "codocs.issues.list"},
		{"create", http.MethodPost, "/v1/codocs/issues", map[string]any{"project_code": "P1", "title": "issue"}, "codocs.issues.create"},
		{"pending-count", http.MethodGet, "/v1/codocs/issues/pending-count", nil, "codocs.issues.pending_count"},
		{"comment", http.MethodPost, "/v1/codocs/issues/7/comments", map[string]any{"content": "comment"}, "codocs.issues.comments.create"},
		{"detail", http.MethodGet, "/v1/codocs/issues/7", nil, "codocs.issues.get"},
		{"update", http.MethodPatch, "/v1/codocs/issues/7", map[string]any{"title": "issue"}, "codocs.issues.update"},
		{"delete", http.MethodDelete, "/v1/codocs/issues/7", nil, "codocs.issues.delete"},
	}

	for _, check := range checks {
		t.Run(check.name, func(t *testing.T) {
			_, operation, err := adapter.HandleRuntime(context.Background(), check.method, check.path, query, check.body)
			if err == nil {
				t.Fatal("untrusted actor must be rejected before storage access")
			}
			if operation != check.operation {
				t.Fatalf("operation=%q, want %q", operation, check.operation)
			}
		})
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatalf("untrusted issue routes must not query or mutate storage: %v", err)
	}
}

func TestIssueCommentUsesTrustedActorInsteadOfClientAuthor(t *testing.T) {
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatalf("sqlmock.New: %v", err)
	}
	defer db.Close()
	adapter := &Adapter{db: db}
	mock.ExpectExec(regexp.QuoteMeta("INSERT INTO issue_comments (issue_id, author, content)\n      SELECT id, ?, ? FROM project_issues WHERE id = ? AND project_code = ?")).WithArgs(
		"trusted-user", "comment", "7", "P1",
	).WillReturnResult(sqlmock.NewResult(9, 1))

	result, err := adapter.createIssueComment(context.Background(), "7", url.Values{
		"current_user":                    {"trusted-user"},
		"hzy_runtime_actor_delegated":     {"1"},
		codocsTrustedIssueProjectQueryKey: {"P1"},
	}, map[string]any{
		"author":  "spoofed-author",
		"content": "comment",
	})
	if err != nil {
		t.Fatalf("createIssueComment: %v", err)
	}
	if result["id"] != int64(9) {
		t.Fatalf("result=%#v", result)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}
