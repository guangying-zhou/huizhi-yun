package aims

import (
	"net/http"
	"net/url"
	"strings"
	"testing"

	"github.com/huizhi-yun/data-runtime/internal/httperror"
)

func TestHasProjectAdminFlagSupportsSnakeAndCamelQueryKeys(t *testing.T) {
	if !hasProjectAdminFlag(url.Values{"current_user_is_project_admin": {"1"}}) {
		t.Fatal("expected snake_case admin flag to be accepted")
	}
	if !hasProjectAdminFlag(url.Values{"currentUserIsProjectAdmin": {"1"}}) {
		t.Fatal("expected camelCase admin flag to be accepted")
	}
	if hasProjectAdminFlag(url.Values{"current_user_is_project_admin": {"0"}}) {
		t.Fatal("expected disabled admin flag to be rejected")
	}
}

func TestIsAdminProjectObjectPathRequiresDirectAdminProjectID(t *testing.T) {
	if !isAdminProjectObjectPath("/v1/aims/admin/projects/42") {
		t.Fatal("expected direct admin project path to match")
	}
	if isAdminProjectObjectPath("/v1/aims/projects/42") {
		t.Fatal("expected member project path to be rejected")
	}
	if isAdminProjectObjectPath("/v1/aims/admin/projects/42/members") {
		t.Fatal("expected nested admin project path to be rejected")
	}
}

func TestProjectAuthorizationObjectPathRequiresDedicatedSuffix(t *testing.T) {
	projectID, ok := projectAuthorizationObjectPath("/v1/aims/projects/42/authorization-object")
	if !ok || projectID != "42" {
		t.Fatalf("expected authorization object path to match, projectID=%q ok=%v", projectID, ok)
	}
	if _, ok := projectAuthorizationObjectPath("/v1/aims/projects/42"); ok {
		t.Fatal("expected project detail path to be rejected")
	}
	if _, ok := projectAuthorizationObjectPath("/v1/aims/admin/projects/42/authorization-object"); ok {
		t.Fatal("expected admin project path to be rejected")
	}
}

func TestProjectVisibilityWhereIncludesScopedAdminOverride(t *testing.T) {
	query := url.Values{"current_user_is_project_admin": {"1"}}
	where, args := projectVisibilityWhere(query, "p", "u1")

	if !strings.Contains(where, "1 = 1") {
		t.Fatalf("expected admin override in visibility where clause: %s", where)
	}
	if len(args) != 4 {
		t.Fatalf("expected only default current-user args, got %d: %#v", len(args), args)
	}
}

func TestProjectVisibilityWhereIncludesProjectAdminListScopes(t *testing.T) {
	query := url.Values{
		"current_user_project_admin_dept_codes":    {"dept-a,dept-b"},
		"current_user_project_admin_project_codes": {"proj-a,proj-b"},
	}
	where, args := projectVisibilityWhere(query, "p", "u1")

	if !strings.Contains(where, "p.dept_code IN (?,?)") {
		t.Fatalf("expected project admin dept scope in visibility where clause: %s", where)
	}
	if !strings.Contains(where, "p.project_code IN (?,?)") {
		t.Fatalf("expected project admin project scope in visibility where clause: %s", where)
	}
	if len(args) != 8 {
		t.Fatalf("expected default current-user args plus four scope args, got %d: %#v", len(args), args)
	}
}

func TestRequireProjectAdminAccess(t *testing.T) {
	query := url.Values{
		"current_user":                  {"u1"},
		"current_user_is_project_admin": {"1"},
	}
	if err := requireProjectAdminAccess(query, nil, "42"); err != nil {
		t.Fatalf("expected admin access, got %v", err)
	}

	err := requireProjectAdminAccess(url.Values{"current_user": {"u1"}}, nil, "42")
	if err == nil {
		t.Fatal("expected missing admin flag to be rejected")
	}
	httpErr, ok := err.(httperror.Error)
	if !ok || httpErr.Status != http.StatusForbidden || httpErr.Code != "project_admin_required" {
		t.Fatalf("expected project_admin_required 403, got %#v", err)
	}

	err = requireProjectAdminAccess(url.Values{"current_user_is_project_admin": {"1"}}, nil, "42")
	if err == nil {
		t.Fatal("expected missing current_user to be rejected")
	}
	httpErr, ok = err.(httperror.Error)
	if !ok || httpErr.Status != http.StatusUnauthorized || httpErr.Code != "missing_current_user" {
		t.Fatalf("expected missing_current_user 401, got %#v", err)
	}
}
