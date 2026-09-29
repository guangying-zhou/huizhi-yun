package server

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/DATA-DOG/go-sqlmock"
	codocsapp "github.com/huizhi-yun/data-runtime/internal/apps/codocs"
	directoryapp "github.com/huizhi-yun/data-runtime/internal/apps/directory"
	"github.com/huizhi-yun/data-runtime/internal/httperror"
)

const departmentCollabTestUUID = "00000000-0000-4000-8000-000000000017"

func departmentCollabInput(action string, payload map[string]any) enterpriseDelegatedInput {
	permit := "edit"
	if action == "snapshot-read" || action == "versions" || action == "version-view" {
		permit = "read"
	}
	object := ""
	if action == "version-view" {
		object = "12"
	}
	return enterpriseDelegatedInput{Tenant: "tenant-a", Deployment: "enterprise-test", Code: "D1", ObjectID: object, SubID: departmentCollabTestUUID, Payload: payload, Authorization: enterpriseDelegatedPermit{
		ActorUID: "user-a", Tenant: "tenant-a", Deployment: "enterprise-test", Resource: "department-documents", Action: permit, ExpiresAt: time.Now().Add(10 * time.Second).UnixMilli(),
	}}
}

func TestDepartmentCollaborationRoutesAreExactAndSeparateFromTheDepartmentTable(t *testing.T) {
	want := map[string]string{"collaboration-open": "edit", "snapshot-read": "read", "snapshot-prepare": "edit", "snapshot-publish": "edit", "versions": "read", "version-view": "read"}
	if len(enterpriseCodocsDepartmentCollaborationRoutes) != len(want) {
		t.Fatalf("routes=%d", len(enterpriseCodocsDepartmentCollaborationRoutes))
	}
	for action, permit := range want {
		path := "/v1/enterprise/codocs/department-documents:" + action
		route, ok := enterpriseCodocsDepartmentCollaborationRoutes[path]
		act := route.Spec.Actions[action]
		if !ok || route.Spec.Domain != "codocs" || route.Spec.Resource != "department-documents" || act.PermitAction != permit || !act.NeedsSub || act.SubPattern == nil {
			t.Fatalf("%s: incorrect route %#v", action, route)
		}
		if _, clash := enterpriseCodocsDepartmentAccessRoutes[path]; clash {
			t.Fatalf("%s leaked into the always-on department route table", action)
		}
		if _, personal := enterpriseCodocsCollaborationSessionRoutes["/v1/enterprise/codocs/personal-documents:"+action]; personal && action == "snapshot-read" {
			t.Fatal("unexpected personal alias")
		}
	}
}

func TestDepartmentCollaborationInputIsStrict(t *testing.T) {
	route := enterpriseCodocsDepartmentCollaborationRoutes["/v1/enterprise/codocs/department-documents:collaboration-open"]
	act := route.Spec.Actions["collaboration-open"]
	if _, err := enterpriseDelegatedQuery(departmentCollabInput("collaboration-open", nil), route.Spec, act, "user-a"); err != nil {
		t.Fatal(err)
	}
	if _, err := enterpriseDelegatedQuery(departmentCollabInput("collaboration-open", map[string]any{"deptCode": "D2"}), route.Spec, act, "user-a"); err == nil {
		t.Fatal("collaboration-open accepted a body")
	}
	for _, bad := range []func(*enterpriseDelegatedInput){
		func(in *enterpriseDelegatedInput) { in.SubID = "7" },
		func(in *enterpriseDelegatedInput) { in.SubID = "../" + departmentCollabTestUUID },
		func(in *enterpriseDelegatedInput) { in.Code = "" },
		func(in *enterpriseDelegatedInput) { in.Code = "D1/../D2" },
		func(in *enterpriseDelegatedInput) { in.Query = map[string]string{"dept_code": "D2"} },
	} {
		in := departmentCollabInput("collaboration-open", nil)
		bad(&in)
		if _, err := enterpriseDelegatedQuery(in, route.Spec, act, "user-a"); err == nil {
			t.Fatalf("accepted %+v", in)
		}
	}
	// The permit is bound to the exact resource, action, actor and freshness.
	verified := enterpriseRequestContext{ActorUID: "user-a"}
	verified.Route.Binding.Tenant, verified.Route.HostDeployment = "tenant-a", "enterprise-test"
	good := departmentCollabInput("collaboration-open", nil)
	if err := validateEnterpriseDelegatedPermit(good, verified, route.Spec, act, time.Now()); err != nil {
		t.Fatal(err)
	}
	for name, mutate := range map[string]func(*enterpriseDelegatedInput){
		"personal resource": func(in *enterpriseDelegatedInput) { in.Authorization.Resource = "personal-documents" },
		"wrong resource":    func(in *enterpriseDelegatedInput) { in.Authorization.Resource = "department-folders" },
		"read permit":       func(in *enterpriseDelegatedInput) { in.Authorization.Action = "read" },
		"other actor":       func(in *enterpriseDelegatedInput) { in.Authorization.ActorUID = "user-b" },
		"expired": func(in *enterpriseDelegatedInput) {
			in.Authorization.ExpiresAt = time.Now().Add(-time.Second).UnixMilli()
		},
		"far future":   func(in *enterpriseDelegatedInput) { in.Authorization.ExpiresAt = time.Now().Add(time.Hour).UnixMilli() },
		"other tenant": func(in *enterpriseDelegatedInput) { in.Tenant = "tenant-b" },
	} {
		in := departmentCollabInput("collaboration-open", nil)
		mutate(&in)
		if err := validateEnterpriseDelegatedPermit(in, verified, route.Spec, act, time.Now()); err == nil {
			t.Fatalf("%s: permit accepted", name)
		}
	}
	read := enterpriseCodocsDepartmentCollaborationRoutes["/v1/enterprise/codocs/department-documents:snapshot-read"]
	if err := validateEnterpriseDelegatedPermit(departmentCollabInput("collaboration-open", nil), verified, read.Spec, read.Spec.Actions["snapshot-read"], time.Now()); err == nil {
		t.Fatal("edit permit accepted for snapshot-read")
	}
}

func TestDepartmentCollaborationRoutesNeedAllThreeSwitches(t *testing.T) {
	for _, action := range []string{"collaboration-open", "snapshot-read", "snapshot-prepare", "snapshot-publish", "versions", "version-view"} {
		for _, flags := range [][3]bool{{false, false, false}, {true, true, false}, {false, true, true}, {true, false, true}, {true, true, true}} {
			s := &Server{}
			codocs := &s.cfg.Apps.Codocs
			codocs.SnapshotV2Enabled, codocs.CollaborationV2Enabled, codocs.DepartmentCollaborationV2Enabled = flags[0], flags[1], flags[2]
			request := httptest.NewRequest(http.MethodPost, "/v1/enterprise/codocs/department-documents:"+action, strings.NewReader(`{}`))
			_, err := s.route(request)
			reached := err != nil && strings.HasPrefix(err.Error(), "department_collaboration_unavailable:")
			if reached != (flags[0] && flags[1] && flags[2]) {
				t.Fatalf("%s flags=%v reached=%v err=%v", action, flags, reached, err)
			}
		}
	}
	// The personal route does not need the department switch.
	s := &Server{}
	s.cfg.Apps.Codocs.SnapshotV2Enabled, s.cfg.Apps.Codocs.CollaborationV2Enabled = true, true
	request := httptest.NewRequest(http.MethodPost, "/v1/enterprise/codocs/personal-documents:collaboration-open", strings.NewReader(`{}`))
	if _, err := s.route(request); err == nil || !strings.HasPrefix(err.Error(), "enterprise_codocs_unavailable:") {
		t.Fatalf("personal route err=%v", err)
	}
}

func TestDepartmentRoleLockerFailsClosedAs503(t *testing.T) {
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	mock.ExpectBegin().WillReturnError(errors.New("directory offline"))
	s := &Server{directory: directoryapp.NewWithDB(db, "C000001", "", "")}
	_, release, err := s.departmentRoleLocker()(context.Background(), "D1", []string{"a", "b"})
	if release != nil {
		t.Fatal("unexpected lease")
	}
	he, ok := err.(httperror.Error)
	if !ok || he.Status != 503 || he.Code != "department_directory_unavailable" {
		t.Fatalf("err=%v", err)
	}
	if _, _, err = (&Server{}).departmentRoleLocker()(context.Background(), "D1", nil); err == nil {
		t.Fatal("nil Directory accepted")
	}
}

func TestRenewCollaborationBodyIsValidatedBeforeAnyLookup(t *testing.T) {
	s := &Server{}
	cid := codocsapp.CollaborationIdentity{Tenant: "t", Deployment: "d", SessionID: "00000000-0000-4000-8000-000000000001"}
	many := make([]any, maxConnectedUids+1)
	for i := range many {
		many[i] = "u"
	}
	for name, body := range map[string]map[string]any{
		"unknown field": {"other": 1},
		"extra field":   {"connectedUids": []any{}, "x": 1},
		"not an array":  {"connectedUids": "a"},
		"non string":    {"connectedUids": []any{1}},
		"empty uid":     {"connectedUids": []any{""}},
		"padded uid":    {"connectedUids": []any{" a"}},
		"too long":      {"connectedUids": []any{strings.Repeat("x", 129)}},
		"too many":      {"connectedUids": many},
		"null":          {"connectedUids": nil},
	} {
		_, err := s.renewCollaborationSession(context.Background(), cid, body)
		var he httperror.Error
		if !errors.As(err, &he) || he.Status != 400 || he.Code != "collaboration_snapshot_input_invalid" {
			t.Fatalf("%s: err=%v", name, err)
		}
	}
}

func TestParticipantRevocationErrorRendersRevokedUids(t *testing.T) {
	recorder := httptest.NewRecorder()
	writeError(recorder, "req-1", codocsapp.ParticipantsRevokedError{
		Base: httperror.New(http.StatusConflict, "collaboration_participant_revoked", "A connected participant no longer has write access"),
		UIDs: []string{"u1", "u2"},
	})
	var body struct {
		Error struct {
			Code    string         `json:"code"`
			Details map[string]any `json:"details"`
		} `json:"error"`
	}
	if recorder.Code != http.StatusConflict || json.Unmarshal(recorder.Body.Bytes(), &body) != nil || body.Error.Code != "collaboration_participant_revoked" {
		t.Fatalf("status=%d body=%s", recorder.Code, recorder.Body.String())
	}
	uids, _ := body.Error.Details["revokedUids"].([]any)
	if len(uids) != 2 || uids[0] != "u1" || uids[1] != "u2" {
		t.Fatalf("details=%v", body.Error.Details)
	}
	// Ordinary errors keep empty details.
	recorder = httptest.NewRecorder()
	writeError(recorder, "req-2", httperror.New(http.StatusForbidden, "x", "y"))
	if !strings.Contains(recorder.Body.String(), `"details":{}`) {
		t.Fatalf("body=%s", recorder.Body.String())
	}
}

func TestDepartmentVersionHistoryIsReadOnlyAndStrict(t *testing.T) {
	for _, action := range []string{"versions", "version-view"} {
		route := enterpriseCodocsDepartmentCollaborationRoutes["/v1/enterprise/codocs/department-documents:"+action]
		act := route.Spec.Actions[action]
		if act.Method != http.MethodGet || act.PermitAction != "read" || act.AllowPayload {
			t.Fatalf("%s must be a read-only GET: %+v", action, act)
		}
		if _, err := enterpriseDelegatedQuery(departmentCollabInput(action, nil), route.Spec, act, "user-a"); err != nil {
			t.Fatalf("%s: %v", action, err)
		}
		for name, mutate := range map[string]func(*enterpriseDelegatedInput){
			"body":         func(in *enterpriseDelegatedInput) { in.Payload = map[string]any{"x": 1} },
			"query":        func(in *enterpriseDelegatedInput) { in.Query = map[string]string{"dept_code": "D2"} },
			"bad document": func(in *enterpriseDelegatedInput) { in.SubID = "../x" },
		} {
			in := departmentCollabInput(action, nil)
			mutate(&in)
			if _, err := enterpriseDelegatedQuery(in, route.Spec, act, "user-a"); err == nil {
				t.Fatalf("%s accepted %s", action, name)
			}
		}
		// An edit permit is not a substitute for the read permit, and the reverse holds for writes.
		verified := enterpriseRequestContext{ActorUID: "user-a"}
		verified.Route.Binding.Tenant, verified.Route.HostDeployment = "tenant-a", "enterprise-test"
		edit := departmentCollabInput(action, nil)
		edit.Authorization.Action = "edit"
		if err := validateEnterpriseDelegatedPermit(edit, verified, route.Spec, act, time.Now()); err == nil {
			t.Fatalf("%s accepted an edit permit", action)
		}
	}
	view := enterpriseCodocsDepartmentCollaborationRoutes["/v1/enterprise/codocs/department-documents:version-view"]
	in := departmentCollabInput("version-view", nil)
	in.ObjectID = "../1"
	if _, err := enterpriseDelegatedQuery(in, view.Spec, view.Spec.Actions["version-view"], "user-a"); err == nil {
		t.Fatal("version-view accepted a traversal version id")
	}
	if got := view.Spec.Actions["version-view"].Target(departmentCollabInput("version-view", nil)); got != "/v1/codocs/documents/"+departmentCollabTestUUID+"/versions/12" {
		t.Fatalf("target=%s", got)
	}
}
