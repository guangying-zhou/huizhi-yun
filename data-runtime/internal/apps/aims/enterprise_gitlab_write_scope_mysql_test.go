package aims

import (
	"context"
	"database/sql"
	"errors"
	"net/url"
	"strconv"
	"testing"
	"time"

	"github.com/huizhi-yun/data-runtime/internal/httperror"
	"github.com/huizhi-yun/data-runtime/internal/projectscope"
)

func testEnterpriseGitlabWriteScopeMySQL(t *testing.T, a *Adapter, db *sql.DB) {
	for _, statement := range []string{
		"INSERT INTO aims_projects(id,project_code,name,short_name,leader_uid,created_by,lifecycle_status) VALUES(981,'GIT-P','Git project','GIT','U1','U1','active')",
		"INSERT INTO aims_project_members(project_id,uid,role,status) VALUES(981,'U1','manager','active')",
		"INSERT INTO work_items(id,project_id,item_number,item_key,tier,type,title,status) VALUES(9810,981,1,'GIT-P-1','matter','task','Git item','in_progress')",
	} {
		if _, err := db.Exec(statement); err != nil {
			t.Fatal(err)
		}
	}
	query := url.Values{"current_user": {"U1"}}
	scoped := func(code string) context.Context {
		return WithEnterpriseProjectCommandScope(context.Background(), EnterpriseProjectUpdateIdentity{
			ActorUID: "U1", CommandScope: &EnterpriseProjectCommandScope{
				Projection: projectscope.Projection{Version: 1, ProjectCodes: []string{code}, Masks: []int{0, 65535}},
				ExpiresAt:  time.Now().Add(15 * time.Second).UnixMilli(),
			},
		})
	}
	assertCode := func(err error, want string) {
		t.Helper()
		var h httperror.Error
		if !errors.As(err, &h) || h.Status != 403 || h.Code != want {
			t.Fatalf("error=%v; want 403 %s", err, want)
		}
	}
	count := func(table, predicate string) int {
		t.Helper()
		var n int
		if err := db.QueryRow("SELECT COUNT(*) FROM " + table + " WHERE " + predicate).Scan(&n); err != nil {
			t.Fatal(err)
		}
		return n
	}
	repoBody := map[string]any{"repoProjectCode": "git/group"}
	_, err := a.linkProjectRepo(scoped("OTHER"), "981", query, repoBody)
	assertCode(err, "enterprise_project_command_scope_denied")
	if n := count("aims_project_repos", "project_id=981"); n != 0 {
		t.Fatalf("denied repository link wrote %d rows", n)
	}
	if _, err = a.linkProjectRepo(scoped("GIT-P"), "981", query, repoBody); err != nil {
		t.Fatalf("repository link: %v", err)
	}
	var repoID int64
	if err := db.QueryRow("SELECT id FROM aims_project_repos WHERE project_id=981 AND repo_project_code='git/group'").Scan(&repoID); err != nil {
		t.Fatal(err)
	}
	_, err = a.createWorkItemComment(scoped("OTHER"), "9810", query, map[string]any{"content": "denied"})
	assertCode(err, "enterprise_project_command_scope_denied")
	if n := count("work_item_comments", "work_item_id=9810"); n != 0 {
		t.Fatalf("denied comment wrote %d rows", n)
	}
	if _, err = a.createWorkItemComment(scoped("GIT-P"), "9810", query, map[string]any{"content": "allowed"}); err != nil {
		t.Fatalf("comment: %v", err)
	}
	sha := "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
	if _, err := db.Exec("INSERT INTO gitlab_commits(project_id,repo_project_code,commit_sha,message,committed_at) VALUES(981,'git/group',?,'marked',UTC_TIMESTAMP())", sha); err != nil {
		t.Fatal(err)
	}
	var commitID int64
	if err := db.QueryRow("SELECT id FROM gitlab_commits WHERE project_id=981 AND commit_sha=?", sha).Scan(&commitID); err != nil {
		t.Fatal(err)
	}
	if _, err := db.Exec("INSERT INTO gitlab_commits(project_id,repo_project_code,commit_sha,message,committed_at) VALUES(981,'unlinked/repo',?,'marked',UTC_TIMESTAMP())", "dddddddddddddddddddddddddddddddddddddddd"); err != nil {
		t.Fatal(err)
	}
	var unlinkedCommitID int64
	if err := db.QueryRow("SELECT id FROM gitlab_commits WHERE project_id=981 AND repo_project_code='unlinked/repo'").Scan(&unlinkedCommitID); err != nil {
		t.Fatal(err)
	}
	_, err = a.linkWorkItemCommit(scoped("GIT-P"), "9810", query, map[string]any{"commitId": unlinkedCommitID})
	var unlinked httperror.Error
	if !errors.As(err, &unlinked) || unlinked.Status != 404 || unlinked.Code != "commit_repo_not_linked" {
		t.Fatalf("unlinked repository commit result = %v", err)
	}
	_, err = a.linkWorkItemCommit(scoped("OTHER"), "9810", query, map[string]any{"commitId": commitID})
	assertCode(err, "enterprise_project_command_scope_denied")
	if _, err = a.linkWorkItemCommit(scoped("GIT-P"), "9810", query, map[string]any{"commitId": commitID}); err != nil {
		t.Fatalf("commit link: %v", err)
	}
	if _, err = a.linkWorkItemCommit(scoped("GIT-P"), "9810", query, map[string]any{"commitId": commitID}); err != nil {
		t.Fatalf("same-value commit link must succeed: %v", err)
	}
	if _, err := db.Exec("INSERT INTO gitlab_commits(project_id,repo_project_code,commit_sha,message,committed_at) VALUES(1,'git/group',?,'foreign',UTC_TIMESTAMP())", "abababababababababababababababababababab"); err != nil {
		t.Fatal(err)
	}
	var foreignCommitID int64
	if err := db.QueryRow("SELECT id FROM gitlab_commits WHERE project_id=1 AND commit_sha=?", "abababababababababababababababababababab").Scan(&foreignCommitID); err != nil {
		t.Fatal(err)
	}
	_, err = a.linkWorkItemCommit(scoped("GIT-P"), "9810", query, map[string]any{"commitId": foreignCommitID})
	var missing httperror.Error
	if !errors.As(err, &missing) || missing.Status != 404 {
		t.Fatalf("cross-project commit link = %v", err)
	}
	for i := 0; i < 2; i++ {
		if _, err := a.updateWorkItemCommitFilesChanged(scoped("GIT-P"), "9810", strconv.FormatInt(commitID, 10), query, map[string]any{"filesChanged": int64(3)}); err != nil {
			t.Fatalf("same-value files changed update %d = %v", i, err)
		}
	}
	_, err = a.updateWorkItemCommitFilesChanged(scoped("GIT-P"), "9810", strconv.FormatInt(foreignCommitID, 10), query, map[string]any{"filesChanged": int64(3)})
	if !errors.As(err, &missing) || missing.Status != 404 {
		t.Fatalf("cross-project files changed update = %v", err)
	}
	batch := map[string]any{"repos": []any{map[string]any{"repoId": repoID, "repoProjectCode": "git/group", "commits": []any{map[string]any{"sha": "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb", "message": "GIT-P-1", "committedDate": "2026-09-27T00:00:00Z"}}}}}
	_, err = a.ingestGitlabCommits(scoped("OTHER"), "981", query, batch)
	assertCode(err, "enterprise_project_command_scope_denied")
	if n := count("gitlab_commits", "project_id=981"); n != 2 {
		t.Fatalf("denied sync changed commit count to %d", n)
	}
	bad := map[string]any{"repos": []any{
		map[string]any{"repoId": repoID, "repoProjectCode": "git/group", "commits": []any{map[string]any{"sha": "cccccccccccccccccccccccccccccccccccccccc", "message": "marked"}}},
		map[string]any{"repoId": repoID, "repoProjectCode": "other/repo", "commits": []any{map[string]any{"sha": "eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee"}}},
	}}
	_, err = a.ingestGitlabCommits(scoped("GIT-P"), "981", query, bad)
	assertCode(err, "gitlab_repo_project_mismatch")
	if n := count("gitlab_commits", "project_id=981"); n != 2 {
		t.Fatalf("mixed batch partially wrote %d commits", n)
	}
	if _, err := db.Exec("INSERT INTO gitlab_commits(project_id,repo_project_code,commit_sha,message,committed_at) VALUES(1,'git/group',?,'other project',UTC_TIMESTAMP())", "ffffffffffffffffffffffffffffffffffffffff"); err != nil {
		t.Fatal(err)
	}
	foreign := map[string]any{"repos": []any{map[string]any{"repoId": repoID, "repoProjectCode": "git/group", "commits": []any{map[string]any{"sha": "ffffffffffffffffffffffffffffffffffffffff", "message": "GIT-P-1"}}}}}
	_, err = a.ingestGitlabCommits(scoped("GIT-P"), "981", query, foreign)
	var conflict httperror.Error
	if !errors.As(err, &conflict) || conflict.Status != 409 || conflict.Code != "gitlab_commit_project_conflict" {
		t.Fatalf("foreign commit result = %v", err)
	}
	for i := 0; i < 2; i++ {
		if _, err = a.ingestGitlabCommits(scoped("GIT-P"), "981", query, batch); err != nil {
			t.Fatalf("sync replay %d: %v", i, err)
		}
	}
	if n := count("gitlab_commits", "project_id=981"); n != 3 {
		t.Fatalf("sync replay changed commit count to %d", n)
	}
	if _, err = a.unlinkWorkItemCommit(scoped("GIT-P"), "9810", strconv.FormatInt(commitID, 10), query); err != nil {
		t.Fatalf("commit unlink: %v", err)
	}
	_, err = a.unlinkWorkItemCommit(scoped("GIT-P"), "9810", strconv.FormatInt(commitID, 10), query)
	var relationChanged httperror.Error
	if !errors.As(err, &relationChanged) || relationChanged.Status != 409 || relationChanged.Code != "relation_changed" {
		t.Fatalf("changed commit relation = %v", err)
	}
	_, err = a.unlinkWorkItemCommit(scoped("GIT-P"), "9810", "999999999", query)
	if !errors.As(err, &relationChanged) || relationChanged.Status != 404 {
		t.Fatalf("missing commit = %v", err)
	}
	if _, err = a.unlinkProjectRepo(scoped("GIT-P"), "981", url.Values{"current_user": {"U1"}, "repoProjectCode": {"git/group"}}, nil); err != nil {
		t.Fatalf("repo unlink: %v", err)
	}
}
