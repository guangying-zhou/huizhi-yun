package codocs

import (
	"context"
	"net/url"
	"regexp"
	"testing"

	"github.com/DATA-DOG/go-sqlmock"
)

func TestTrustedDocumentAccessActorFactsRejectsUnsignedOrMissingActor(t *testing.T) {
	for _, query := range []url.Values{
		nil,
		{"current_user": {"forged-user"}},
		{"hzy_runtime_actor_delegated": {"1"}},
	} {
		if _, _, err := trustedDocumentAccessActorFacts(query); err == nil {
			t.Fatalf("query=%#v must not provide trusted document-access facts", query)
		}
	}
}

func TestLoadPolicyGrantsExcludesExpiredRowsInSQL(t *testing.T) {
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatalf("sqlmock.New: %v", err)
	}
	defer db.Close()
	adapter := &Adapter{db: db}
	mock.ExpectQuery(regexp.QuoteMeta("WHERE policy_id = ? AND (expires_at IS NULL OR expires_at > NOW())")).WithArgs(
		int64(7),
	).WillReturnRows(sqlmock.NewRows([]string{"id", "policy_id", "subject_type", "subject_code", "permission", "expires_at", "created_by", "created_at"}))

	grants, err := adapter.loadPolicyGrants(context.Background(), 7)
	if err != nil {
		t.Fatalf("loadPolicyGrants: %v", err)
	}
	if len(grants) != 0 {
		t.Fatalf("grants=%#v", grants)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}

func TestTrustedDocumentAccessActorFactsUsesOnlyInjectedActorAndDepartments(t *testing.T) {
	actorUID, deptCodes, err := trustedDocumentAccessActorFacts(url.Values{
		"current_user":                {"trusted-user"},
		"current_user_dept_codes":     {"dept-a,dept-b"},
		"hzy_runtime_actor_delegated": {"1"},
		"actorProjectCodes":           {"forged-project"},
		"actorRoles":                  {"forged-role"},
	})
	if err != nil {
		t.Fatalf("trustedDocumentAccessActorFacts: %v", err)
	}
	if actorUID != "trusted-user" {
		t.Fatalf("actorUID=%q", actorUID)
	}
	if len(deptCodes) != 2 || deptCodes[0] != "dept-a" || deptCodes[1] != "dept-b" {
		t.Fatalf("deptCodes=%#v", deptCodes)
	}
}

func TestTrustedAimsDocumentAccessScopeFactsRequiresSignedAimsActor(t *testing.T) {
	trusted := url.Values{
		"hzy_runtime_actor_delegated":              {"1"},
		"hzy_runtime_source_app":                   {"aims"},
		aimsTrustedDocumentAccessProjectCodesQuery: {"HZY,OPS"},
		aimsTrustedDocumentAccessRolesQuery:        {"project_manager,employee"},
		"actorProjectCodes":                        {"forged-project"},
		"actorRoles":                               {"forged-role"},
	}
	projectCodes, roles := trustedAimsDocumentAccessScopeFacts(trusted)
	if len(projectCodes) != 2 || projectCodes[0] != "HZY" || projectCodes[1] != "OPS" {
		t.Fatalf("projectCodes=%#v", projectCodes)
	}
	if len(roles) != 2 || roles[0] != "project_manager" || roles[1] != "employee" {
		t.Fatalf("roles=%#v", roles)
	}

	for _, untrusted := range []url.Values{
		{
			"hzy_runtime_source_app":                   {"aims"},
			aimsTrustedDocumentAccessProjectCodesQuery: {"HZY"},
		},
		{
			"hzy_runtime_actor_delegated":              {"1"},
			"hzy_runtime_source_app":                   {"codocs"},
			aimsTrustedDocumentAccessProjectCodesQuery: {"HZY"},
		},
	} {
		projectCodes, roles := trustedAimsDocumentAccessScopeFacts(untrusted)
		if len(projectCodes) != 0 || len(roles) != 0 {
			t.Fatalf("untrusted query=%#v returned projects=%#v roles=%#v", untrusted, projectCodes, roles)
		}
	}
}
