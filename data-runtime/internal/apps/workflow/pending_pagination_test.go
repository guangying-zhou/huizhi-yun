package workflow

import (
	"context"
	"github.com/DATA-DOG/go-sqlmock"
	"net/url"
	"regexp"
	"strings"
	"testing"
)

func TestPendingPaginationStrictBoundsAndLegacyShape(t *testing.T) {
	for _, q := range []url.Values{{}, {"page": {"2"}, "page_size": {"20"}}} {
		if _, paged, err := pendingTaskPage(q); paged || err != nil {
			t.Fatal(q, paged, err)
		}
	}
	for _, q := range []url.Values{{"page": {""}}, {"page": {"01"}}, {"page": {"0"}}, {"page": {"1", "2"}}, {"pageSize": {"101"}}, {"pageSize": {"20"}, "page_size": {"20"}}} {
		if _, _, err := pendingTaskPage(q); err == nil {
			t.Fatal(q)
		}
	}
}
func TestPendingScopeCountAndPageSameSnapshotNonInitiatorBusinessRule(t *testing.T) {
	db, m, e := sqlmock.New()
	if e != nil {
		t.Fatal(e)
	}
	defer db.Close()
	a := &Adapter{db: db}
	m.ExpectBegin()
	directorFilter := regexp.QuoteMeta(strings.Join(strings.Fields(pendingNonDirectorPredicate), " "))
	where := `(?s)t.assignee_uid = \? AND t.status = 'pending' AND i.status = 'running' AND ` + directorFilter + ` AND i.app_code = \? AND CAST\(i.app_code AS BINARY\) = CAST\(\? AS BINARY\) AND CAST\(i.resource_code AS BINARY\) = CAST\(\? AS BINARY\) AND CAST\(i.action_code AS BINARY\) = CAST\(\? AS BINARY\) AND CAST\(COALESCE\(i.initiator_uid,''\) AS BINARY\) <> CAST\(\? AS BINARY\)`
	m.ExpectQuery(`SELECT COUNT\(\*\).*`+where).WithArgs("viewer", "aims", "aims", "tasks", "complete", "viewer").WillReturnRows(sqlmock.NewRows([]string{"total"}).AddRow(3))
	m.ExpectQuery(`SELECT t.id AS task_id.*`+where+`.*ORDER BY t.created_at DESC, t.id DESC.*LIMIT \? OFFSET \?`).WithArgs("viewer", "aims", "aims", "tasks", "complete", "viewer", 2, 2).WillReturnRows(sqlmock.NewRows([]string{"task_id", "app_code", "resource_code", "action_code", "initiator_uid"}).AddRow(1, "aims", "tasks", "complete", "other"))
	m.ExpectCommit()
	result, _, err := a.listTasks(context.Background(), url.Values{"current_user": {"viewer"}, "app_code": {"aims"}, "resource_code": {"tasks"}, "action_code": {"complete"}, "exclude_initiator": {"true"}, "page": {"2"}, "pageSize": {"2"}}, "pending")
	if err != nil {
		t.Fatal(err)
	}
	data := result.Data.(map[string]any)
	if data["total"] != int64(3) || data["page"] != 2 || data["pageSize"] != 2 || len(data["items"].([]map[string]any)) != 1 {
		t.Fatal(data)
	}
	if err = m.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}
func TestPendingFilterRejectsArbitraryExcludedActorAndDuplicatesBeforeSQL(t *testing.T) {
	db, m, e := sqlmock.New()
	if e != nil {
		t.Fatal(e)
	}
	defer db.Close()
	a := &Adapter{db: db}
	for _, q := range []url.Values{{"exclude_initiator": {"another-uid"}}, {"resource_code": {"tasks", "projects"}}, {"action_code": {""}}} {
		q.Set("current_user", "viewer")
		q.Set("pageSize", "20")
		if _, _, err := a.listTasks(context.Background(), q, "pending"); err == nil {
			t.Fatal(q)
		}
	}
	if err := m.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}
