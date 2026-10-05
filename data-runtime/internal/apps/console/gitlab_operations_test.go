package console

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strconv"
	"strings"
	"testing"

	"github.com/DATA-DOG/go-sqlmock"
)

func TestGitLabGroupProjectsReadsEveryPageAndPreservesArchivedRepositories(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Header.Get("PRIVATE-TOKEN") != "secret" || r.URL.Query().Get("per_page") != "100" ||
			r.URL.Query().Get("include_subgroups") != "false" || r.URL.Query().Get("with_shared") != "false" ||
			r.URL.Query().Get("order_by") != "id" || r.URL.Query().Get("sort") != "asc" ||
			r.URL.Query().Has("archived") {
			t.Fatalf("unexpected GitLab group request: %s %#v", r.URL.String(), r.Header)
		}
		page, _ := strconv.Atoi(r.URL.Query().Get("page"))
		count := 100
		if page == 2 {
			count = 1
		} else if page != 1 {
			t.Fatalf("unexpected page: %d", page)
		}
		projects := make([]map[string]any, 0, count)
		for index := 0; index < count; index++ {
			id := int64((page-1)*100 + index + 1)
			projects = append(projects, map[string]any{
				"id": id, "name": fmt.Sprintf("repo-%03d", id),
				"path_with_namespace": fmt.Sprintf("huizhi-yun/repo-%03d", id),
				"web_url":             fmt.Sprintf("https://gitlab.example/huizhi-yun/repo-%03d", id),
				"archived":            id == 1,
				"namespace":           map[string]any{"full_path": "huizhi-yun"},
			})
		}
		w.Header().Set("Content-Type", "application/json")
		if err := json.NewEncoder(w).Encode(projects); err != nil {
			t.Fatal(err)
		}
	}))
	defer server.Close()

	result, err := (gitLabOperationRuntime{BaseURL: server.URL, Token: "secret"}).groupProjects(
		context.Background(), "huizhi-yun", map[string]any{"includeArchived": true},
	)
	if err != nil {
		t.Fatal(err)
	}
	items, ok := result["items"].([]map[string]any)
	if !ok || len(items) != 101 || result["total"] != 101 {
		t.Fatalf("unexpected paginated GitLab result: total=%#v items=%d", result["total"], len(items))
	}
	if items[0]["archived"] != true || items[100]["projectCode"] != "huizhi-yun/repo-101" {
		t.Fatalf("unexpected GitLab group projects: first=%#v last=%#v", items[0], items[100])
	}
}

func TestGitLabMarkdownTreeReadsRootAndDocsSeparately(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Header.Get("PRIVATE-TOKEN") != "secret" {
			t.Fatalf("unexpected GitLab authentication: %s %#v", r.URL.String(), r.Header)
		}

		var response any
		switch {
		case strings.HasSuffix(r.URL.Path, "/repository/commits"):
			if r.URL.Query().Get("ref_name") != "main" || r.URL.Query().Get("per_page") != "1" ||
				r.URL.Query().Get("page") != "1" || r.URL.Query().Get("with_stats") != "true" {
				t.Fatalf("unexpected GitLab commits request: %s", r.URL.String())
			}
			response = []map[string]any{{"id": "head-sha", "sha": "head-sha"}}
		case !strings.HasSuffix(r.URL.Path, "/repository/tree"):
			t.Fatalf("unexpected GitLab endpoint: %s", r.URL.String())
		case r.URL.Query().Get("path") == "":
			if r.URL.Query().Get("ref") != "main" || r.URL.Query().Get("per_page") != "100" ||
				r.URL.Query().Get("page") != "1" {
				t.Fatalf("unexpected GitLab root tree request: %s", r.URL.String())
			}
			if r.URL.Query().Get("recursive") != "false" {
				t.Fatalf("root tree must not scan unrelated source directories: %s", r.URL.String())
			}
			response = []map[string]any{
				{"id": "root-readme", "name": "README.md", "type": "blob", "path": "README.md"},
				{"id": "root-text", "name": "LICENSE", "type": "blob", "path": "LICENSE"},
				{"id": "docs-tree", "name": "docs", "type": "tree", "path": "docs"},
			}
		case r.URL.Query().Get("path") == "docs":
			if r.URL.Query().Get("ref") != "main" || r.URL.Query().Get("per_page") != "100" ||
				r.URL.Query().Get("page") != "1" {
				t.Fatalf("unexpected GitLab docs tree request: %s", r.URL.String())
			}
			if r.URL.Query().Get("recursive") != "true" {
				t.Fatalf("docs tree must be recursive: %s", r.URL.String())
			}
			response = []map[string]any{
				{"id": "guide", "name": "guide.md", "type": "blob", "path": "docs/guide.md"},
				{"id": "spec", "name": "SPEC.MD", "type": "blob", "path": "docs/design/SPEC.MD"},
				{"id": "image", "name": "diagram.png", "type": "blob", "path": "docs/diagram.png"},
			}
		default:
			t.Fatalf("unexpected repository tree path: %s", r.URL.String())
		}

		w.Header().Set("Content-Type", "application/json")
		if err := json.NewEncoder(w).Encode(response); err != nil {
			t.Fatal(err)
		}
	}))
	defer server.Close()

	result, err := (gitLabOperationRuntime{
		BaseURL: server.URL, Token: "secret", DefaultBranch: "main",
	}).markdownTree(context.Background(), "huizhi-yun/huizhiyun", map[string]any{})
	if err != nil {
		t.Fatal(err)
	}
	files, ok := result["files"].([]map[string]any)
	if !ok || len(files) != 3 {
		t.Fatalf("unexpected markdown files: %#v", result["files"])
	}
	wantPaths := []string{"README.md", "docs/design/SPEC.MD", "docs/guide.md"}
	for index, want := range wantPaths {
		if files[index]["path"] != want {
			t.Fatalf("file[%d] path = %#v, want %q", index, files[index]["path"], want)
		}
	}
}

func TestNormalizeGitLabRepoAndFilePaths(t *testing.T) {
	repo, err := normalizeGitLabRepoPath("group/platform.git")
	if err != nil || repo != "group/platform" {
		t.Fatalf("repo=%q error=%v", repo, err)
	}
	file, err := normalizeGitLabFilePath("docs/runtime/README.md")
	if err != nil || file != "docs/runtime/README.md" {
		t.Fatalf("file=%q error=%v", file, err)
	}
	for _, value := range []string{
		"https://gitlab.example/group/repo",
		"group/../repo",
		"group/repo?private_token=value",
		"group\\repo",
	} {
		if _, err := normalizeGitLabRepoPath(value); err == nil {
			t.Fatalf("unsafe repository path accepted: %q", value)
		}
	}
	for _, value := range []string{
		"../secret.md",
		"docs\\secret.md",
		"docs/file.md?private_token=value",
	} {
		if _, err := normalizeGitLabFilePath(value); err == nil {
			t.Fatalf("unsafe file path accepted: %q", value)
		}
	}
}

func TestServiceGitLabGrantBindsIntegrationAndOperation(t *testing.T) {
	database, mock, err := sqlmock.New()
	if err != nil {
		t.Fatal(err)
	}
	defer database.Close()
	adapter := &Adapter{db: database}
	query := "SELECT CAST\\(scg.scope_json AS CHAR\\)"

	mock.ExpectQuery(query).
		WithArgs("aims.runtime", "aims.runtime", "aims").
		WillReturnRows(sqlmock.NewRows([]string{"scope_json"}).AddRow(
			`{"integrationCodes":["gitlab.default"],"operations":["gitlab.markdown-tree"]}`,
		))
	code, err := adapter.requireAuthorizedIntegrationOperation(
		context.Background(),
		"gitlab.default",
		"gitlab.markdown-tree",
		"client:aims.runtime",
		"aims",
	)
	if err != nil || code != "gitlab.default" {
		t.Fatalf("authorized code=%q error=%v", code, err)
	}

	mock.ExpectQuery(query).
		WithArgs("aims.runtime", "aims.runtime", "aims").
		WillReturnRows(sqlmock.NewRows([]string{"scope_json"}).AddRow(
			`{"integrationCodes":["gitlab.default"],"operations":["gitlab.markdown-tree"]}`,
		))
	if _, err := adapter.requireAuthorizedIntegrationOperation(
		context.Background(),
		"gitlab.default",
		"gitlab.commit",
		"aims.runtime",
		"aims",
	); err == nil {
		t.Fatal("operation not present in grant must be denied")
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}
