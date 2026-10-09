package aims

import (
	"context"
	"database/sql"
	"errors"
	"net/url"
	"sync"
	"testing"
	"time"

	"github.com/huizhi-yun/data-runtime/internal/httperror"
	"github.com/huizhi-yun/data-runtime/internal/projectscope"
)

func testEnterpriseGitlabReceiptsMySQL(t *testing.T, a *Adapter, db *sql.DB) {
	query := url.Values{"current_user": {"U1"}}
	identity := func(key string, allowed bool) context.Context {
		codes := []string{"GIT-P"}
		if !allowed {
			codes = []string{"P2"}
		}
		return WithEnterpriseProjectCommandScope(context.Background(), EnterpriseProjectUpdateIdentity{
			Tenant: "T1", SourceDeployment: "enterprise-test", TargetDeployment: "aims-test",
			ActorUID: "U1", ServiceClientID: "enterprise.runtime", RequestID: key,
			IdempotencyKey: key, CommandScope: &EnterpriseProjectCommandScope{
				Projection: projectscope.Projection{Version: 1, ProjectCodes: codes, Masks: []int{0, 65535}},
				ExpiresAt:  time.Now().Add(15 * time.Second).UnixMilli(),
			},
		})
	}
	assertStatus := func(err error, status int) {
		t.Helper()
		var failure httperror.Error
		if !errors.As(err, &failure) || failure.Status != status {
			t.Fatalf("wanted %d, got %v", status, err)
		}
	}
	count := func(statement string, args ...any) int {
		t.Helper()
		var n int
		if err := db.QueryRow(statement, args...).Scan(&n); err != nil {
			t.Fatal(err)
		}
		return n
	}
	linkBody := map[string]any{"repoProjectCode": "git/receipt"}
	_, err := a.linkProjectRepo(identity("", true), "981", query, linkBody)
	assertStatus(err, 400)
	linked, err := a.linkProjectRepo(identity("pa04-repo-link", true), "981", query, linkBody)
	if err != nil || linked.(map[string]any)["idempotent"] != false {
		t.Fatalf("first repo link=%#v, %v", linked, err)
	}
	linked, err = a.linkProjectRepo(identity("pa04-repo-link", true), "981", query, linkBody)
	if err != nil || linked.(map[string]any)["idempotent"] != true || count("SELECT COUNT(*) FROM aims_project_repos WHERE project_id=981 AND repo_project_code='git/receipt'") != 1 {
		t.Fatalf("repo link replay=%#v, %v", linked, err)
	}
	_, err = a.linkProjectRepo(identity("pa04-repo-link", true), "981", query, map[string]any{"repoProjectCode": "git/changed"})
	assertStatus(err, 409)
	_, err = a.linkProjectRepo(identity("pa04-repo-link", false), "981", query, linkBody)
	assertStatus(err, 403)
	var repoID int64
	if err := db.QueryRow("SELECT id FROM aims_project_repos WHERE project_id=981 AND repo_project_code='git/receipt'").Scan(&repoID); err != nil {
		t.Fatal(err)
	}
	sha := "1212121212121212121212121212121212121212"
	batch := map[string]any{"repos": []any{map[string]any{"repoId": repoID, "repoProjectCode": "git/receipt", "commits": []any{map[string]any{"sha": sha, "message": "GIT-P-1", "committedDate": "2026-09-28T00:00:00Z"}}}}}
	first, err := a.ingestGitlabCommits(identity("pa04-gitlab-ingest", true), "981", query, batch)
	if err != nil || first["idempotent"] != false || first["synced"] != int64(1) {
		t.Fatalf("first GitLab ingest=%#v, %v", first, err)
	}
	replayed, err := a.ingestGitlabCommits(identity("pa04-gitlab-ingest", true), "981", query, batch)
	if err != nil || replayed["idempotent"] != true || count("SELECT COUNT(*) FROM gitlab_commits WHERE project_id=981 AND commit_sha=?", sha) != 1 {
		t.Fatalf("GitLab ingest replay=%#v, %v", replayed, err)
	}
	changed := map[string]any{"repos": []any{map[string]any{"repoId": repoID, "repoProjectCode": "git/receipt", "commits": []any{map[string]any{"sha": sha, "message": "changed"}}}}}
	_, err = a.ingestGitlabCommits(identity("pa04-gitlab-ingest", true), "981", query, changed)
	assertStatus(err, 409)
	_, err = a.ingestGitlabCommits(identity("pa04-gitlab-ingest", false), "981", query, batch)
	assertStatus(err, 403)
	if _, err := db.Exec("UPDATE aims_projects SET leader_uid='U4' WHERE id=981"); err != nil {
		t.Fatal(err)
	}
	if _, err := db.Exec("UPDATE aims_project_members SET status='suspended' WHERE project_id=981 AND uid='U1'"); err != nil {
		t.Fatal(err)
	}
	_, err = a.ingestGitlabCommits(identity("pa04-gitlab-ingest", true), "981", query, batch)
	assertStatus(err, 403)
	if _, err := db.Exec("UPDATE aims_projects SET leader_uid='U1' WHERE id=981"); err != nil {
		t.Fatal(err)
	}
	if _, err := db.Exec("UPDATE aims_project_members SET status='active' WHERE project_id=981 AND uid='U1'"); err != nil {
		t.Fatal(err)
	}

	unlinkQuery := url.Values{"current_user": {"U1"}, "repoProjectCode": {"git/receipt"}}
	unlinked, err := a.unlinkProjectRepo(identity("pa04-repo-unlink", true), "981", unlinkQuery, nil)
	if err != nil || unlinked.(map[string]any)["idempotent"] != false {
		t.Fatalf("first repo unlink=%#v, %v", unlinked, err)
	}
	unlinked, err = a.unlinkProjectRepo(identity("pa04-repo-unlink", true), "981", unlinkQuery, nil)
	if err != nil || unlinked.(map[string]any)["idempotent"] != true || count("SELECT COUNT(*) FROM aims_project_repos WHERE project_id=981 AND repo_project_code='git/receipt'") != 0 {
		t.Fatalf("repo unlink replay=%#v, %v", unlinked, err)
	}
	_, err = a.ingestGitlabCommits(identity("pa04-gitlab-ingest", true), "981", query, batch)
	assertStatus(err, 403)
	if _, err = a.linkProjectRepo(identity("pa04-repo-relink", true), "981", query, linkBody); err != nil {
		t.Fatal("new intent may relink repository", err)
	}
	oldUnlink, err := a.unlinkProjectRepo(identity("pa04-repo-unlink", true), "981", unlinkQuery, nil)
	if err != nil || oldUnlink.(map[string]any)["idempotent"] != true || oldUnlink.(map[string]any)["linked"] != true {
		t.Fatalf("old unlink replay must report current relink without deleting it: %#v, %v", oldUnlink, err)
	}
	if _, err = a.unlinkProjectRepo(identity("pa04-repo-unlink-again", true), "981", unlinkQuery, nil); err != nil {
		t.Fatal("new intent may unlink repository again", err)
	}
	var wg sync.WaitGroup
	errorsByCall := make(chan error, 2)
	for i := 0; i < 2; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			_, err := a.linkProjectRepo(identity("pa04-repo-parallel", true), "981", query, map[string]any{"repoProjectCode": "git/parallel"})
			errorsByCall <- err
		}()
	}
	wg.Wait()
	close(errorsByCall)
	for err := range errorsByCall {
		if err != nil {
			t.Fatal("parallel repo link", err)
		}
	}
	if count("SELECT COUNT(*) FROM aims_project_repos WHERE project_id=981 AND repo_project_code='git/parallel'") != 1 {
		t.Fatal("parallel same-key repo link created duplicate rows")
	}
	if _, err := db.Exec("UPDATE aims_projects SET leader_uid='U4' WHERE id=981"); err != nil {
		t.Fatal(err)
	}
	defer db.Exec("UPDATE aims_projects SET leader_uid='U1' WHERE id=981")
	if _, err := db.Exec("UPDATE aims_project_members SET status='suspended' WHERE project_id=981 AND uid='U1'"); err != nil {
		t.Fatal(err)
	}
	defer db.Exec("UPDATE aims_project_members SET status='active' WHERE project_id=981 AND uid='U1'")
	_, err = a.linkProjectRepo(identity("pa04-repo-link", true), "981", query, linkBody)
	assertStatus(err, 403)
	_, err = a.unlinkProjectRepo(identity("pa04-repo-unlink", true), "981", unlinkQuery, nil)
	assertStatus(err, 403)
	if _, err := db.Exec("CREATE TRIGGER pa04_d2_receipt_fail BEFORE UPDATE ON service_command_receipt FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='receipt write failed'"); err != nil {
		t.Fatal(err)
	}
	defer db.Exec("DROP TRIGGER pa04_d2_receipt_fail")
	if _, err := db.Exec("UPDATE aims_projects SET leader_uid='U1' WHERE id=981"); err != nil {
		t.Fatal(err)
	}
	if _, err := db.Exec("UPDATE aims_project_members SET status='active' WHERE project_id=981 AND uid='U1'"); err != nil {
		t.Fatal(err)
	}
	_, err = a.linkProjectRepo(identity("pa04-repo-rollback", true), "981", query, map[string]any{"repoProjectCode": "git/rollback"})
	if err == nil || count("SELECT COUNT(*) FROM aims_project_repos WHERE project_id=981 AND repo_project_code='git/rollback'") != 0 {
		t.Fatalf("receipt failure left repository link behind: %v", err)
	}
}
