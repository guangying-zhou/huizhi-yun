package codocs

import (
	"context"
	"net/http"
	"net/url"
	"strings"
	"testing"

	"github.com/DATA-DOG/go-sqlmock"
	"github.com/huizhi-yun/data-runtime/internal/httperror"
)

func slideFolderActorQuery(uid string) url.Values {
	return url.Values{"current_user": {uid}, "hzy_runtime_actor_delegated": {"1"}}
}

func TestSlideFolderCreateBindsSignedActorAndIgnoresForgedOwnerScope(t *testing.T) {
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatalf("sqlmock.New: %v", err)
	}
	defer db.Close()

	adapter := &Adapter{db: db}
	mock.ExpectExec("INSERT INTO folders").
		WithArgs("演示", "slide", "owner-1", nil, nil, nil, 0).
		WillReturnResult(sqlmock.NewResult(71, 1))
	result, err := adapter.createFolder(context.Background(), slideFolderActorQuery("owner-1"), map[string]any{
		"name": " 演示 ", "folder_type": "slide", "owner_uid": "victim", "dept_code": "D2", "project_code": "P2",
	})
	if err != nil {
		t.Fatalf("slide folder create: %v", err)
	}
	if result["folder_type"] != "slide" || result["owner_uid"] != "owner-1" || result["dept_code"] != nil || result["project_code"] != nil {
		t.Fatalf("slide folder scope = %#v", result)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatalf("slide folder insert expectations: %v", err)
	}
}

func TestSlideFolderCreateRequiresSignedActor(t *testing.T) {
	adapter := &Adapter{}
	if _, err := adapter.createFolder(context.Background(), url.Values{"current_user": {"owner-1"}}, map[string]any{
		"name": "演示", "folder_type": "slide",
	}); err == nil {
		t.Fatal("slide folder create accepted an unsigned actor")
	}
}

func TestSlideFolderParentMustStayInExactPersonalSlideScope(t *testing.T) {
	tests := []struct {
		name       string
		parentType string
		owner      any
		dept       any
		project    any
		wantErr    bool
	}{
		{name: "same owner slide parent is valid", parentType: "slide", owner: "owner-1", dept: nil, project: nil, wantErr: false},
		{name: "other owner slide parent is rejected", parentType: "slide", owner: "owner-2", dept: nil, project: nil, wantErr: true},
		{name: "private parent cannot host slide child", parentType: "private", owner: "owner-1", dept: nil, project: nil, wantErr: true},
		{name: "department parent cannot host slide child", parentType: "department", owner: nil, dept: "D1", project: nil, wantErr: true},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			db, mock, err := sqlmock.New()
			if err != nil {
				t.Fatalf("sqlmock.New: %v", err)
			}
			defer db.Close()
			adapter := &Adapter{db: db}
			mock.ExpectQuery("SELECT folder_type, owner_uid, dept_code, project_code.*FROM folders.*WHERE id = \\\\?").
				WithArgs(int64(9)).
				WillReturnRows(sqlmock.NewRows([]string{"folder_type", "owner_uid", "dept_code", "project_code"}).AddRow(tt.parentType, tt.owner, tt.dept, tt.project))
			err = adapter.validateFolderParent(context.Background(), 9, "slide", "owner-1", "", "")
			if (err != nil) != tt.wantErr {
				t.Fatalf("validateFolderParent error = %v, wantErr=%v", err, tt.wantErr)
			}
			if tt.wantErr {
				httpErr, ok := err.(httperror.Error)
				if !ok || httpErr.Status != http.StatusForbidden || httpErr.Code != "folder_parent_scope_mismatch" {
					t.Fatalf("error = %#v, want folder_parent_scope_mismatch", err)
				}
			}
			if err := mock.ExpectationsWereMet(); err != nil {
				t.Fatalf("parent query expectations: %v", err)
			}
		})
	}
}

func TestSlideFolderListUsesPersonalOwnerVisibility(t *testing.T) {
	where, args := folderReadVisibilityPredicate("owner-1", "D1")
	if !strings.Contains(where, "folder_type = 'slide'") || !strings.Contains(where, "owner_uid = ?") {
		t.Fatalf("slide owner predicate missing: %s", where)
	}
	if !strings.Contains(where, "folder_type = 'department'") || len(args) != 2 || args[0] != "owner-1" || args[1] != "D1" {
		t.Fatalf("department predicate changed unexpectedly: %s %#v", where, args)
	}
}
