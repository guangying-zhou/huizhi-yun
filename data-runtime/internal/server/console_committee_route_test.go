package server

import (
	"errors"
	"github.com/huizhi-yun/data-runtime/internal/auth"
	"github.com/huizhi-yun/data-runtime/internal/httperror"
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestConsoleCommitteeMembersPOSTRequiresEdit(t *testing.T) {
	cfg, key := testRuntimeJWTConfig(t)
	s := &Server{cfg: cfg, auth: auth.New(cfg)}
	for _, tc := range []struct {
		scope, code string
		status      int
	}{
		{"console:directory-department:view", "insufficient_scope", 403},
		{"console:directory-department:edit", "directory_runtime_not_ready", 503},
	} {
		r := httptest.NewRequest(http.MethodPost, "/v1/console/directory/committees/C1/members", nil)
		r.Header.Set("Authorization", "Bearer "+signTestRuntimeJWTForApp(t, key, "console", tc.scope))
		_, err := s.route(r)
		var he httperror.Error
		if !errors.As(err, &he) || he.Code != tc.code || he.Status != tc.status {
			t.Fatalf("scope %s: %v", tc.scope, err)
		}
	}
}

func TestConsoleCommitteeMembersPOSTPathIsExact(t *testing.T) {
	for _, code := range []string{"C1", "C_1.2-3"} {
		if !isConsoleCommitteeMembersPath("/v1/console/directory/committees/" + code + "/members") {
			t.Fatal(code)
		}
	}
	cfg, key := testRuntimeJWTConfig(t)
	s := &Server{cfg: cfg, auth: auth.New(cfg)}
	for _, path := range []string{
		"/v1/console/directory/committees/C1", "/v1/console/directory/committees/C1/members/U1",
		"/v1/console/directory/committees/C1/members/extra/path", "/v1/console/directory/committees/./members",
		"/v1/console/directory/committees/../members", "/v1/console/directory/committees-other/C1/members",
	} {
		if isConsoleCommitteeMembersPath(path) {
			t.Fatal(path)
		}
		r := httptest.NewRequest(http.MethodPost, path, nil)
		r.Header.Set("Authorization", "Bearer "+signTestRuntimeJWTForApp(t, key, "console", "console:directory-department:edit"))
		_, err := s.route(r)
		var he httperror.Error
		if !errors.As(err, &he) || he.Status != 404 {
			t.Fatalf("%s: %v", path, err)
		}
	}
	for _, method := range []string{http.MethodPut, http.MethodOptions} {
		r := httptest.NewRequest(method, "/v1/console/directory/committees/C1/members", nil)
		_, err := s.route(r)
		var he httperror.Error
		if !errors.As(err, &he) || he.Status != 404 {
			t.Fatalf("%s: %v", method, err)
		}
	}
}
