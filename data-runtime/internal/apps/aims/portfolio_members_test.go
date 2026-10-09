package aims

import (
	"context"
	"errors"
	"net/url"
	"testing"

	"github.com/DATA-DOG/go-sqlmock"
	"github.com/huizhi-yun/data-runtime/internal/httperror"
)

const (
	portfolioOwnerQuery    = "SELECT owner_uid FROM project_portfolios WHERE id=\\?"
	portfolioManagersQuery = "SELECT uid FROM `aims_portfolio_members` WHERE portfolio_id=\\? AND relation_type='manager'"
	portfolioMemberQuery   = "SELECT relation_type,status,revision,.* FROM `aims_portfolio_members` WHERE portfolio_id=\\? AND uid=\\? FOR UPDATE"
)

func portfolioActorQuery(uid string, admin bool) url.Values {
	q := url.Values{"current_user": {uid}}
	if admin {
		q.Set("current_user_can_manage_portfolios", "1")
	}
	return q
}

// expectPortfolioActor mocks the locked portfolio row and its effective managers.
func expectPortfolioActor(m sqlmock.Sqlmock, owner any, managers ...string) {
	m.ExpectQuery(portfolioOwnerQuery).WithArgs(int64(7)).WillReturnRows(sqlmock.NewRows([]string{"owner_uid"}).AddRow(owner))
	rows := sqlmock.NewRows([]string{"uid"})
	for _, uid := range managers {
		rows.AddRow(uid)
	}
	m.ExpectQuery(portfolioManagersQuery).WithArgs(int64(7)).WillReturnRows(rows)
}

func portfolioErrorCode(err error) string {
	var h httperror.Error
	if errors.As(err, &h) {
		return h.Code
	}
	return ""
}

func TestPortfolioMemberSaveRequiresPermissionAndCurrentRelation(t *testing.T) {
	for _, test := range []struct {
		name     string
		actor    string
		admin    bool
		owner    any
		managers []string
		body     map[string]any
		code     string
	}{
		{name: "permission without relation", actor: "admin", admin: true, owner: "owner", managers: []string{"mgr"}, body: map[string]any{"action": "upsert", "uid": "new", "relationType": "viewer"}, code: "portfolio_member_manager_required"},
		{name: "manager without permission", actor: "mgr", admin: false, owner: "owner", managers: []string{"mgr"}, body: map[string]any{"action": "upsert", "uid": "new", "relationType": "viewer"}, code: "portfolio_member_manager_required"},
		{name: "owner without permission", actor: "owner", admin: false, owner: "owner", body: map[string]any{"action": "upsert", "uid": "new", "relationType": "viewer"}, code: "portfolio_member_manager_required"},
		{name: "bootstrap cannot add a non-manager", actor: "admin", admin: true, owner: nil, body: map[string]any{"action": "upsert", "uid": "new", "relationType": "contributor"}, code: "portfolio_member_manager_required"},
		{name: "bootstrap needs the permission", actor: "someone", admin: false, owner: nil, body: map[string]any{"action": "upsert", "uid": "someone", "relationType": "manager"}, code: "portfolio_member_manager_required"},
		{name: "no bootstrap once a manager exists", actor: "admin", admin: true, owner: nil, managers: []string{"mgr"}, body: map[string]any{"action": "upsert", "uid": "admin", "relationType": "manager"}, code: "portfolio_member_manager_required"},
	} {
		t.Run(test.name, func(t *testing.T) {
			a, m, done := newAimsSQLMockAdapter(t)
			defer done()
			m.ExpectBegin()
			expectPortfolioActor(m, test.owner, test.managers...)
			m.ExpectRollback()
			_, err := a.savePortfolioMember(context.Background(), "7", portfolioActorQuery(test.actor, test.admin), test.body)
			if portfolioErrorCode(err) != test.code {
				t.Fatalf("error=%v", err)
			}
			// No member lookup or write expectation: any further SQL fails the test.
			if err = m.ExpectationsWereMet(); err != nil {
				t.Fatal(err)
			}
		})
	}
}

func TestPortfolioMemberSaveInsertsUpdatesAndBootstraps(t *testing.T) {
	t.Run("owner with permission adds a member", func(t *testing.T) {
		a, m, done := newAimsSQLMockAdapter(t)
		defer done()
		m.ExpectBegin()
		expectPortfolioActor(m, "owner")
		m.ExpectQuery(portfolioMemberQuery).WithArgs(int64(7), "new").WillReturnRows(sqlmock.NewRows([]string{"relation_type", "status", "revision", "effective"}))
		m.ExpectExec("INSERT INTO `aims_portfolio_members`").WithArgs(int64(7), "new", "contributor", nil, "owner", "owner").WillReturnResult(sqlmock.NewResult(1, 1))
		m.ExpectCommit()
		out, err := a.savePortfolioMember(context.Background(), "7", portfolioActorQuery("owner", true), map[string]any{"action": "upsert", "uid": "new", "relationType": "contributor"})
		if err != nil || out["revision"] != int64(1) || out["changed"] != true {
			t.Fatalf("out=%v err=%v", out, err)
		}
		if err = m.ExpectationsWereMet(); err != nil {
			t.Fatal(err)
		}
	})
	t.Run("bootstrap adds the first manager only when the member is new", func(t *testing.T) {
		a, m, done := newAimsSQLMockAdapter(t)
		defer done()
		m.ExpectBegin()
		expectPortfolioActor(m, nil)
		m.ExpectQuery(portfolioMemberQuery).WithArgs(int64(7), "first").WillReturnRows(sqlmock.NewRows([]string{"relation_type", "status", "revision", "effective"}))
		m.ExpectExec("INSERT INTO `aims_portfolio_members`").WithArgs(int64(7), "first", "manager", nil, "admin", "admin").WillReturnResult(sqlmock.NewResult(1, 1))
		m.ExpectCommit()
		if _, err := a.savePortfolioMember(context.Background(), "7", portfolioActorQuery("admin", true), map[string]any{"action": "upsert", "uid": "first", "relationType": "manager"}); err != nil {
			t.Fatal(err)
		}
		if err := m.ExpectationsWereMet(); err != nil {
			t.Fatal(err)
		}
	})
	t.Run("bootstrap cannot re-activate or change an existing member", func(t *testing.T) {
		a, m, done := newAimsSQLMockAdapter(t)
		defer done()
		m.ExpectBegin()
		expectPortfolioActor(m, nil)
		m.ExpectQuery(portfolioMemberQuery).WithArgs(int64(7), "old").WillReturnRows(sqlmock.NewRows([]string{"relation_type", "status", "revision", "effective"}).AddRow("viewer", "inactive", int64(3), false))
		m.ExpectRollback()
		_, err := a.savePortfolioMember(context.Background(), "7", portfolioActorQuery("admin", true), map[string]any{"action": "upsert", "uid": "old", "relationType": "manager", "expectedRevision": 3})
		if portfolioErrorCode(err) != "portfolio_member_manager_required" {
			t.Fatalf("error=%v", err)
		}
		if err = m.ExpectationsWereMet(); err != nil {
			t.Fatal(err)
		}
	})
	t.Run("manager with permission changes a relation under the expected revision", func(t *testing.T) {
		a, m, done := newAimsSQLMockAdapter(t)
		defer done()
		m.ExpectBegin()
		expectPortfolioActor(m, "owner", "mgr")
		m.ExpectQuery(portfolioMemberQuery).WithArgs(int64(7), "u1").WillReturnRows(sqlmock.NewRows([]string{"relation_type", "status", "revision", "effective"}).AddRow("viewer", "active", int64(2), true))
		m.ExpectExec("UPDATE `aims_portfolio_members` SET relation_type=").WithArgs("contributor", nil, int64(3), "mgr", int64(7), "u1", int64(2)).WillReturnResult(sqlmock.NewResult(0, 1))
		m.ExpectCommit()
		out, err := a.savePortfolioMember(context.Background(), "7", portfolioActorQuery("mgr", true), map[string]any{"action": "upsert", "uid": "u1", "relationType": "contributor", "expectedRevision": 2})
		if err != nil || out["revision"] != int64(3) {
			t.Fatalf("out=%v err=%v", out, err)
		}
		if err = m.ExpectationsWereMet(); err != nil {
			t.Fatal(err)
		}
	})
}

func TestPortfolioMemberSaveConflicts(t *testing.T) {
	for _, test := range []struct {
		name     string
		owner    any
		managers []string
		existing []any
		body     map[string]any
		code     string
	}{
		{name: "stale revision", owner: "mgr", existing: []any{"viewer", "active", int64(4), true}, body: map[string]any{"action": "upsert", "uid": "u1", "relationType": "contributor", "expectedRevision": 3}, code: "portfolio_member_revision_conflict"},
		{name: "remove a member that does not exist", owner: "mgr", body: map[string]any{"action": "remove", "uid": "u1"}, code: "portfolio_member_revision_conflict"},
		{name: "last manager cannot remove themself without an owner", owner: nil, managers: []string{"mgr"}, existing: []any{"manager", "active", int64(1), true}, body: map[string]any{"action": "remove", "uid": "mgr", "expectedRevision": 1}, code: "portfolio_last_manager_required"},
		{name: "last manager cannot demote themself without an owner", owner: nil, managers: []string{"mgr"}, existing: []any{"manager", "active", int64(1), true}, body: map[string]any{"action": "upsert", "uid": "mgr", "relationType": "viewer", "expectedRevision": 1}, code: "portfolio_last_manager_required"},
	} {
		t.Run(test.name, func(t *testing.T) {
			a, m, done := newAimsSQLMockAdapter(t)
			defer done()
			m.ExpectBegin()
			expectPortfolioActor(m, test.owner, test.managers...)
			rows := sqlmock.NewRows([]string{"relation_type", "status", "revision", "effective"})
			if test.existing != nil {
				rows.AddRow(test.existing[0], test.existing[1], test.existing[2], test.existing[3])
			}
			m.ExpectQuery(portfolioMemberQuery).WithArgs(int64(7), test.body["uid"]).WillReturnRows(rows)
			m.ExpectRollback()
			_, err := a.savePortfolioMember(context.Background(), "7", portfolioActorQuery("mgr", true), test.body)
			if portfolioErrorCode(err) != test.code {
				t.Fatalf("error=%v", err)
			}
			if err = m.ExpectationsWereMet(); err != nil {
				t.Fatal(err)
			}
		})
	}
}

func TestPortfolioMemberInputIsRejectedBeforeAnyTransaction(t *testing.T) {
	for name, body := range map[string]map[string]any{
		"unknown field":    {"action": "upsert", "uid": "u1", "relationType": "viewer", "actorUid": "owner"},
		"system subject":   {"action": "upsert", "uid": "system:scheduler", "relationType": "viewer"},
		"service subject":  {"action": "upsert", "uid": "client:aims.runtime", "relationType": "viewer"},
		"unknown relation": {"action": "upsert", "uid": "u1", "relationType": "owner"},
		"past expiry":      {"action": "upsert", "uid": "u1", "relationType": "viewer", "validUntil": "2020-01-01T00:00:00Z"},
		"unknown action":   {"action": "delete", "uid": "u1"},
	} {
		t.Run(name, func(t *testing.T) {
			a, m, done := newAimsSQLMockAdapter(t)
			defer done()
			_, err := a.savePortfolioMember(context.Background(), "7", portfolioActorQuery("owner", true), body)
			if portfolioErrorCode(err) != "portfolio_member_input_invalid" {
				t.Fatalf("error=%v", err)
			}
			if err = m.ExpectationsWereMet(); err != nil {
				t.Fatal(err)
			}
		})
	}
}

func TestPortfolioMembersFailClosedWhenTablesAreNotInstalled(t *testing.T) {
	a, m, done := newAimsSQLMockAdapter(t)
	defer done()
	// The registered mapping has no portfolio member tables.
	bindProjectCallbackMock(t, a)
	for _, call := range []func() error{
		func() error {
			_, err := a.listPortfolioMembers(context.Background(), "7", portfolioActorQuery("owner", true))
			return err
		},
		func() error {
			_, err := a.savePortfolioMember(context.Background(), "7", portfolioActorQuery("owner", true), map[string]any{"action": "upsert", "uid": "u1", "relationType": "viewer"})
			return err
		},
		func() error {
			_, err := a.savePortfolioDocRepo(context.Background(), "7", portfolioActorQuery("owner", true), map[string]any{"repoPath": "group/docs"})
			return err
		},
	} {
		m.ExpectBegin()
		expectProjectCallbackFence(m, 1)
		m.ExpectRollback()
		if err := call(); portfolioErrorCode(err) != "aims_portfolio_members_unavailable" {
			t.Fatalf("error=%v", err)
		}
	}
	if err := m.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}

func TestPortfolioDocRepoRequiresManagerAndValidPath(t *testing.T) {
	a, m, done := newAimsSQLMockAdapter(t)
	defer done()
	for _, path := range []string{"docs", "../group/docs", "group/docs with space", "https://gitlab.example/group/docs"} {
		if _, err := a.savePortfolioDocRepo(context.Background(), "7", portfolioActorQuery("owner", true), map[string]any{"repoPath": path}); portfolioErrorCode(err) != "portfolio_doc_repo_input_invalid" {
			t.Fatalf("path %q error=%v", path, err)
		}
	}
	m.ExpectBegin()
	expectPortfolioActor(m, nil) // bootstrap never applies to the repository
	m.ExpectRollback()
	if _, err := a.savePortfolioDocRepo(context.Background(), "7", portfolioActorQuery("admin", true), map[string]any{"repoPath": "group/docs"}); portfolioErrorCode(err) != "portfolio_member_manager_required" {
		t.Fatalf("error=%v", err)
	}
	m.ExpectBegin()
	expectPortfolioActor(m, "owner")
	m.ExpectQuery("SELECT row_version FROM `aims_portfolio_doc_repos` WHERE portfolio_id=\\? FOR UPDATE").WithArgs(int64(7)).WillReturnRows(sqlmock.NewRows([]string{"row_version"}))
	m.ExpectExec("INSERT INTO `aims_portfolio_doc_repos`").WithArgs(int64(7), "group/docs", "owner", "owner").WillReturnResult(sqlmock.NewResult(1, 1))
	m.ExpectCommit()
	if _, err := a.savePortfolioDocRepo(context.Background(), "7", portfolioActorQuery("owner", true), map[string]any{"repoPath": "group/docs"}); err != nil {
		t.Fatal(err)
	}
	if err := m.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}
