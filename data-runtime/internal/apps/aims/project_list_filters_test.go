package aims

import (
	"net/url"
	"reflect"
	"strings"
	"testing"
)

func TestProjectListFiltersSupportExactCodesAndArchivedOptIn(t *testing.T) {
	query := url.Values{
		"project_codes":    {"PRJ-2, PRJ-1,PRJ-2"},
		"include_archived": {"1"},
	}

	memberWhere, memberArgs := memberProjectsWhere(query, "u-1")
	if !strings.Contains(strings.Join(memberWhere, " "), "p.project_code IN (?,?)") {
		t.Fatalf("member project codes were not pushed into SQL: %#v", memberWhere)
	}
	if strings.Contains(strings.Join(memberWhere, " "), "lifecycle_status != 'archived'") {
		t.Fatalf("archived projects must be included only when explicitly requested: %#v", memberWhere)
	}
	if !reflect.DeepEqual(memberArgs, []any{"PRJ-2", "PRJ-1"}) {
		t.Fatalf("unexpected member args: %#v", memberArgs)
	}

	adminWhere, adminArgs := adminProjectWhere(query)
	if !strings.Contains(strings.Join(adminWhere, " "), "p.project_code IN (?,?)") {
		t.Fatalf("admin project codes were not pushed into SQL: %#v", adminWhere)
	}
	if !reflect.DeepEqual(adminArgs, []any{"PRJ-2", "PRJ-1"}) {
		t.Fatalf("unexpected admin args: %#v", adminArgs)
	}

	adminWhere, _ = adminProjectWhere(url.Values{"exclude_archived": {"1"}})
	if !strings.Contains(strings.Join(adminWhere, " "), "p.lifecycle_status != 'archived'") {
		t.Fatalf("admin list must support an explicit archived exclusion: %#v", adminWhere)
	}
}
