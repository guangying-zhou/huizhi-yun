package aims

import (
	"context"
	"errors"
	"github.com/DATA-DOG/go-sqlmock"
	"github.com/huizhi-yun/data-runtime/internal/projectscope"
	"testing"
)

func TestEnterpriseProjectTabFactsAreFreshAndCaseSensitive(t *testing.T) {
	a, mock, cleanup := newAimsSQLMockAdapter(t)
	defer cleanup()
	ctx := WithEnterpriseProjectManagementScope(context.Background(), projectscope.Projection{Version: 1, Masks: []int{0}}, nil)
	for _, f := range []EnterpriseProjectTabAccess{{}, {Member: true}, {Manager: true, Member: true}, {AnyProjectManager: true}, {Management: true}} {
		mock.ExpectQuery("SELECT.*BINARY p.leader_uid=BINARY.*FROM aims_projects p WHERE p.id=\\?").WillReturnRows(sqlmock.NewRows([]string{"member", "manager", "management", "any"}).AddRow(f.Member, f.Manager, f.Management, f.AnyProjectManager))
		actual, err := a.EnterpriseProjectTabs(ctx, "1", "User")
		if err != nil || actual != f {
			t.Fatalf("facts=%+v error=%v", actual, err)
		}
	}
	mock.ExpectQuery("SELECT").WillReturnError(errors.New("dependency failed"))
	if _, err := a.EnterpriseProjectTabs(ctx, "1", "User"); err == nil {
		t.Fatal("database failure accepted")
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
	if _, err := a.EnterpriseProjectTabs(context.Background(), "1", "User"); err == nil {
		t.Fatal("missing signed management projection accepted")
	}
}
