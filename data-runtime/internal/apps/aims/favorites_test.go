package aims

import (
	"context"
	"net/url"
	"testing"

	"github.com/DATA-DOG/go-sqlmock"
)

func TestFavoritesRuntimePreservesLegacyListShape(t *testing.T) {
	adapter, mock, cleanup := newAimsSQLMockAdapter(t)
	defer cleanup()

	mock.ExpectQuery("(?s)SELECT f.project_id, p.project_code, p.name, p.lifecycle_status, f.created_at.*FROM user_favorite_projects f.*INNER JOIN aims_projects p").
		WithArgs("u1").
		WillReturnRows(sqlmock.NewRows([]string{
			"project_id",
			"project_code",
			"name",
			"lifecycle_status",
			"created_at",
		}).AddRow(int64(42), "PRJ-1", "项目一", "active", "2026-06-30 10:00:00"))

	data, operation, err := adapter.handleFavoritesRuntime(
		context.Background(),
		"GET",
		url.Values{"current_user": {"u1"}},
		nil,
	)
	if err != nil {
		t.Fatalf("expected favorite list to pass, got %v", err)
	}
	if operation != "aims.favorites.list" {
		t.Fatalf("operation = %q, want aims.favorites.list", operation)
	}
	items, ok := data.([]favoriteProject)
	if !ok || len(items) != 1 {
		t.Fatalf("data = %#v, want one favoriteProject", data)
	}
	if items[0].ProjectID != 42 || items[0].ProjectCode != "PRJ-1" || items[0].Name != "项目一" {
		t.Fatalf("favorite item = %#v", items[0])
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatalf("expectations: %v", err)
	}
}

func TestFavoritesRuntimeCreateAndDeleteUseTrustedActor(t *testing.T) {
	adapter, mock, cleanup := newAimsSQLMockAdapter(t)
	defer cleanup()

	mock.ExpectQuery("SELECT id FROM aims_projects WHERE id = \\?").
		WithArgs(int64(42)).
		WillReturnRows(sqlmock.NewRows([]string{"id"}).AddRow(int64(42)))
	mock.ExpectExec("INSERT IGNORE INTO user_favorite_projects").
		WithArgs("u1", int64(42)).
		WillReturnResult(sqlmock.NewResult(0, 1))
	mock.ExpectExec("DELETE FROM user_favorite_projects WHERE uid = \\? AND project_id = \\?").
		WithArgs("u1", int64(42)).
		WillReturnResult(sqlmock.NewResult(0, 1))

	if data, operation, err := adapter.handleFavoritesRuntime(
		context.Background(),
		"POST",
		url.Values{"current_user": {"u1"}},
		map[string]any{"projectId": float64(42), "current_user": "spoofed"},
	); err != nil || data != nil || operation != "aims.favorites.create" {
		t.Fatalf("create data=%#v operation=%q err=%v", data, operation, err)
	}

	if data, operation, err := adapter.handleFavoritesRuntime(
		context.Background(),
		"DELETE",
		url.Values{"current_user": {"u1"}, "projectId": {"42"}},
		map[string]any{"current_user": "spoofed"},
	); err != nil || data != nil || operation != "aims.favorites.delete" {
		t.Fatalf("delete data=%#v operation=%q err=%v", data, operation, err)
	}

	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatalf("expectations: %v", err)
	}
}
