package server

import (
	"errors"
	"io"
	"net/http"
	"os"
	"reflect"
	"regexp"
	"sort"
	"strings"
	"testing"

	"github.com/DATA-DOG/go-sqlmock"
	"github.com/golang-jwt/jwt/v5"
	consoleapp "github.com/huizhi-yun/data-runtime/internal/apps/console"
	directoryapp "github.com/huizhi-yun/data-runtime/internal/apps/directory"
	"github.com/huizhi-yun/data-runtime/internal/config"
	"github.com/huizhi-yun/data-runtime/internal/httperror"
)

var directorySelfDepartmentColumns = []string{"id", "dept_code", "dept_name", "parent_dept_code", "level_no", "sort_order", "manager_uid", "manager_name", "leader_uid", "leader_name", "org_type", "dept_category", "description", "status"}

type directorySelfRouteCase struct {
	query, body string
	mutate      func(jwt.MapClaims)
	forgedActor string
}

// directorySelfAccessibleServer drives the real dispatch, Enterprise
// authentication, Console grant verification and Directory adapter against a
// single ordered sqlmock connection.
func directorySelfAccessibleServer(t *testing.T, tc directorySelfRouteCase) (*Server, sqlmock.Sqlmock, *http.Request) {
	t.Helper()
	database, mock, err := sqlmock.New()
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { database.Close() })
	a, r, _ := enterpriseContextFixture(t, func(c jwt.MapClaims) {
		c["scope"] = "console:enterprise-host:execute"
		if tc.mutate != nil {
			tc.mutate(c)
		}
	}, true)
	r.Method, r.URL.Path, r.URL.RawQuery = http.MethodPost, enterpriseDirectorySelfAccessibleDepartmentsPath, tc.query
	r.Body = io.NopCloser(strings.NewReader(tc.body))
	bearer := strings.TrimPrefix(r.Header.Get("Authorization"), "Bearer ")
	r.Header.Set("X-HZY-Actor-Signature", testActorSignature(t, bearer, r.Method, r.URL.RequestURI(), "person-a", nil, r.Header.Get("X-HZY-Actor-Signed-At")))
	if tc.forgedActor != "" {
		r.Header.Set("X-HZY-Actor-Uid", tc.forgedActor)
	}
	cfg := config.Config{Tenant: "tenant-a", Deployment: "runtime-test", DeploymentBindings: map[string]string{"enterprise": "enterprise-test"}}
	cfg.Enterprise.Enabled, cfg.Enterprise.Environment = true, "test"
	s := &Server{cfg: cfg, auth: a, console: consoleapp.NewWithDB(config.ConsoleConfig{}, "tenant-a", database), directory: directoryapp.NewWithDB(database, "tenant-a", "", "")}
	return s, mock, r
}

func expectEnterpriseConsoleGrant(mock sqlmock.Sqlmock, active bool) {
	mock.ExpectQuery(`(?s)SELECT sc.id,sc.status,sc.current_credential_id,scc.status,scc.expires_at`).WithArgs(7, "enterprise.runtime").
		WillReturnRows(sqlmock.NewRows([]string{"id", "status", "current_credential_id", "credential_status", "expires_at", "client_code", "client_name", "client_type", "app_code"}).AddRow(5, "active", 7, "active", nil, "enterprise.runtime", "Enterprise Runtime", "runtime", "enterprise"))
	rows := sqlmock.NewRows([]string{"resource_code", "action", "scope_json"})
	if active {
		rows.AddRow("data-runtime:console:enterprise-host", "execute", `{"audience":"data-runtime","semanticScope":"console:enterprise-host:execute"}`)
	}
	mock.ExpectQuery(`SELECT resource_code,action,scope_json FROM service_client_grants`).WithArgs(uint64(5)).WillReturnRows(rows)
}

func expectAccessibleDepartmentRows(mock sqlmock.Sqlmock, actor string) {
	mock.ExpectQuery(`(?s)FROM directory_departments d.*WHERE d.status=\?`).WithArgs("active").WillReturnRows(sqlmock.NewRows(directorySelfDepartmentColumns).
		AddRow(1, "root", "Company", nil, 1, 0, nil, nil, nil, nil, "department", nil, nil, "active").
		AddRow(2, "dept-a", "Team A", "root", 2, 1, "manager-a", "Manager", "leader-a", "Leader", "department", nil, "private", "active").
		AddRow(3, "dept-a-1", "Team A1", "dept-a", 3, 2, nil, nil, nil, nil, "department", nil, nil, "active").
		AddRow(4, "dept-b", "Team B", "root", 2, 3, nil, nil, nil, nil, "department", nil, nil, "active"))
	mock.ExpectQuery(`SELECT dept_code FROM directory_user_departments`).WithArgs(actor).
		WillReturnRows(sqlmock.NewRows([]string{"dept_code"}).AddRow("dept-a"))
}

func TestEnterpriseDirectorySelfAccessibleDepartmentsReturnsSignedActorMinimalProjection(t *testing.T) {
	s, mock, r := directorySelfAccessibleServer(t, directorySelfRouteCase{body: `{}`})
	expectEnterpriseConsoleGrant(mock, true)
	expectAccessibleDepartmentRows(mock, "person-a")
	result, err := s.route(r)
	if err != nil {
		t.Fatal(err)
	}
	if result.Operation != "enterprise.console.directory-self.read" {
		t.Fatalf("unexpected operation %q", result.Operation)
	}
	rows := result.Body.(map[string]any)["data"].([]map[string]any)
	codes := make([]string, 0, len(rows))
	for _, row := range rows {
		keys := make([]string, 0, len(row))
		for key := range row {
			keys = append(keys, key)
		}
		sort.Strings(keys)
		if !reflect.DeepEqual(keys, []string{"deptCode", "name"}) {
			t.Fatalf("projection leaked fields: %#v", row)
		}
		codes = append(codes, row["deptCode"].(string))
	}
	// Own department plus descendants; the root and sibling stay hidden.
	if !reflect.DeepEqual(codes, []string{"dept-a", "dept-a-1"}) {
		t.Fatalf("unexpected accessible departments %v", codes)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}

func TestEnterpriseDirectorySelfAccessibleDepartmentsRejectsRequestChosenActor(t *testing.T) {
	// Replacing the signed actor header breaks the delegation before any read.
	s, mock, r := directorySelfAccessibleServer(t, directorySelfRouteCase{body: `{}`, forgedActor: "other"})
	_, err := s.route(r)
	var failure httperror.Error
	if !errors.As(err, &failure) || (failure.Status != 401 && failure.Status != 403) {
		t.Fatalf("forged actor accepted: %v", err)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}

func TestEnterpriseDirectorySelfAccessibleDepartmentsRejectsCallerInput(t *testing.T) {
	for name, tc := range map[string]directorySelfRouteCase{
		"uid query":       {query: "uid=other", body: `{}`},
		"any query":       {query: "page=1"},
		"uid body":        {body: `{"uid":"other"}`},
		"actor body":      {body: `{"actorUid":"other"}`},
		"nested uid body": {body: `{"query":{"uid":"other"}}`},
		"invalid body":    {body: `[]`},
	} {
		t.Run(name, func(t *testing.T) {
			s, mock, r := directorySelfAccessibleServer(t, tc)
			expectEnterpriseConsoleGrant(mock, true)
			_, err := s.route(r)
			var failure httperror.Error
			if !errors.As(err, &failure) || failure.Status != 400 {
				t.Fatalf("got %v, want 400", err)
			}
			if err := mock.ExpectationsWereMet(); err != nil {
				t.Fatal(err)
			}
		})
	}
}

func TestEnterpriseDirectorySelfAccessibleDepartmentsIdentityAndDependencyFailures(t *testing.T) {
	for _, tc := range []struct {
		name   string
		mutate func(jwt.MapClaims)
		setup  func(sqlmock.Sqlmock)
		status int
	}{
		{name: "unauthenticated", mutate: func(c jwt.MapClaims) { c["iss"] = "https://forged.test" }, setup: func(sqlmock.Sqlmock) {}, status: 401},
		{name: "wrong capability", mutate: func(c jwt.MapClaims) { c["scope"] = "aims:enterprise-host:execute" }, setup: func(sqlmock.Sqlmock) {}, status: 403},
		{name: "legacy directory scope", mutate: func(c jwt.MapClaims) { c["scope"] = "console:directory-department:view" }, setup: func(sqlmock.Sqlmock) {}, status: 403},
		{name: "revoked grant", setup: func(m sqlmock.Sqlmock) { expectEnterpriseConsoleGrant(m, false) }, status: 403},
		{name: "directory dependency", setup: func(m sqlmock.Sqlmock) {
			expectEnterpriseConsoleGrant(m, true)
			m.ExpectQuery(`(?s)FROM directory_departments d`).WillReturnError(errors.New("database unavailable"))
		}, status: 503},
		{name: "membership dependency", setup: func(m sqlmock.Sqlmock) {
			expectEnterpriseConsoleGrant(m, true)
			m.ExpectQuery(`(?s)FROM directory_departments d`).WillReturnRows(sqlmock.NewRows(directorySelfDepartmentColumns))
			m.ExpectQuery(`SELECT dept_code FROM directory_user_departments`).WillReturnError(errors.New("database unavailable"))
		}, status: 503},
	} {
		t.Run(tc.name, func(t *testing.T) {
			s, mock, r := directorySelfAccessibleServer(t, directorySelfRouteCase{body: `{}`, mutate: tc.mutate})
			tc.setup(mock)
			_, err := s.route(r)
			var failure httperror.Error
			if !errors.As(err, &failure) || failure.Status != tc.status {
				t.Fatalf("got %v, want %d", err, tc.status)
			}
			if err := mock.ExpectationsWereMet(); err != nil {
				t.Fatal(err)
			}
		})
	}
}

func TestEnterpriseDirectorySelfAccessibleProjectionRejectsMalformedRows(t *testing.T) {
	if directorySelfAccessibleDepartments(nil) != nil {
		t.Fatal("nil dependency result accepted")
	}
	if directorySelfAccessibleDepartments([]map[string]any{{"deptCode": 7, "name": "x"}}) != nil {
		t.Fatal("malformed department accepted")
	}
}

// Every Runtime directory-self path is a fixed Foundation operation; the
// all-routes capability test derives console:enterprise-host:execute from it.
func TestEnterpriseDirectorySelfPathsMatchFoundationOperations(t *testing.T) {
	foundation, err := os.ReadFile("../../../foundation/server/utils/enterpriseRuntimeClient.ts")
	if err != nil {
		t.Fatal(err)
	}
	registered := map[string]string{}
	for _, match := range regexp.MustCompile(`'(console\.directory-self-[a-z-]+)': \{ path: '([^']+)' \}`).FindAllStringSubmatch(string(foundation), -1) {
		registered[match[2]] = match[1]
	}
	if !reflect.DeepEqual(registered, enterpriseDirectorySelfPaths) {
		t.Fatalf("Foundation directory-self operations %v differ from Runtime %v", registered, enterpriseDirectorySelfPaths)
	}
	if enterpriseHostDomainCapability("console") != "console:enterprise-host:execute" {
		t.Fatal("directory-self domain capability drifted")
	}
}
