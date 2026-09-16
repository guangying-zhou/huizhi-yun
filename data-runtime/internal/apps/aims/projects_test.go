package aims

import (
	"os"
	"strings"
	"testing"
)

func TestProjectDetailReturnsMemberAndRepoCompatibilityFields(t *testing.T) {
	contentBytes, err := os.ReadFile("projects.go")
	if err != nil {
		t.Fatalf("read projects.go: %v", err)
	}
	content := string(contentBytes)

	requiredTokens := []string{
		"func (a *Adapter) projectDetailMembers",
		"func (a *Adapter) projectDetailRepos",
		`item["members"] = members`,
		`item["repos"] = repos`,
		"FROM aims_project_members",
		"FROM aims_project_repos",
	}
	for _, token := range requiredTokens {
		if !strings.Contains(content, token) {
			t.Fatalf("expected project detail runtime to include %q", token)
		}
	}

	detailIndex := strings.Index(content, "func (a *Adapter) projectDetail(")
	membersIndex := strings.Index(content, "members, err := a.projectDetailMembers")
	reposIndex := strings.Index(content, "repos, err := a.projectDetailRepos")
	returnIndex := strings.Index(content, "return item, nil")
	if detailIndex < 0 || membersIndex < detailIndex || reposIndex < membersIndex || returnIndex < reposIndex {
		t.Fatalf("projectDetail must load members and repos before returning")
	}
}
