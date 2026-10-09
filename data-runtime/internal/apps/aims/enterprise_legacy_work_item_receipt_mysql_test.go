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

func testEnterpriseLegacyWorkItemReceiptsMySQL(t *testing.T, a *Adapter, db *sql.DB) {
	for _, statement := range []string{
		"INSERT INTO aims_projects(id,project_code,name,short_name,leader_uid,created_by,lifecycle_status) VALUES(997,'LEG-P','Legacy','LEG','U1','U1','active')",
		"INSERT INTO aims_project_members(project_id,uid,role,status) VALUES(997,'U1','manager','active')",
		"INSERT INTO project_counters(project_id,counter) VALUES(997,2)",
		"INSERT INTO milestones(id,project_id,name,start_date,end_date,status) VALUES(99700,997,'Legacy milestone','2026-09-01','2026-12-31','active')",
		"INSERT INTO work_items(id,project_id,milestone_id,item_number,item_key,tier,type,title,status,priority) VALUES(9970,997,99700,1,'LEG-1','matter','task','Legacy item','todo','P2')",
		"INSERT INTO work_items(id,project_id,milestone_id,item_number,item_key,tier,type,title,status,priority,template_key,review_level) VALUES(9971,997,99700,2,'LEG-2','target','task','Legacy clone','todo','P2','requirement_change',0)",
		"INSERT INTO aims_project_repos(project_id,repo_project_code) VALUES(997,'git/legacy')",
		"INSERT INTO gitlab_commits(project_id,repo_project_code,commit_sha,message,committed_at) VALUES(997,'git/legacy','bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb','legacy',UTC_TIMESTAMP())",
		"INSERT INTO project_documents(uuid,project_id,project_code,title,is_folder,codocs_uuid,document_source,created_by,updated_by) VALUES('33333333-3333-4333-8333-333333333337',997,'LEG-P','Legacy doc',0,'11111111-1111-4111-8111-111111111117','codocs','U1','U1')",
	} {
		if _, err := db.Exec(statement); err != nil {
			t.Fatal(err)
		}
	}
	query := url.Values{"current_user": {"U1"}}
	identity := func(key string, allowed bool) context.Context {
		codes := []string{"LEG-P"}
		if !allowed {
			codes = []string{"OTHER"}
		}
		return WithEnterpriseProjectCommandScope(context.Background(), EnterpriseProjectUpdateIdentity{Tenant: "T1", SourceDeployment: "enterprise-test", TargetDeployment: "aims-test", ActorUID: "U1", ServiceClientID: "enterprise.runtime", RequestID: key, IdempotencyKey: key, CommandScope: &EnterpriseProjectCommandScope{Projection: projectscope.Projection{Version: 1, ProjectCodes: codes, Masks: []int{0, 65535}}, ExpiresAt: time.Now().Add(15 * time.Second).UnixMilli()}})
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
	commentBody := map[string]any{"content": "PA04 C comment"}
	comment, err := a.createWorkItemComment(identity("pa04-c-comment", true), "9970", query, commentBody)
	if err != nil || comment.ID == 0 || comment.ReceiptID == "" {
		t.Fatalf("comment=%#v err=%v", comment, err)
	}
	commentReplay, err := a.createWorkItemComment(identity("pa04-c-comment", true), "9970", query, commentBody)
	if err != nil || commentReplay.ID != comment.ID || commentReplay.Idempotent == nil || !*commentReplay.Idempotent || count("SELECT COUNT(*) FROM work_item_comments WHERE work_item_id=9970") != 1 {
		t.Fatalf("comment replay=%#v err=%v", commentReplay, err)
	}
	_, err = a.createWorkItemComment(identity("pa04-c-comment", true), "9970", query, map[string]any{"content": "different"})
	assertStatus(err, 409)
	_, err = a.createWorkItemComment(identity("pa04-c-comment", false), "9970", query, commentBody)
	assertStatus(err, 403)
	var commitID int64
	if err := db.QueryRow("SELECT id FROM gitlab_commits WHERE project_id=997").Scan(&commitID); err != nil {
		t.Fatal(err)
	}
	commitBody := map[string]any{"commitId": commitID}
	commit, err := a.linkWorkItemCommit(identity("pa04-c-commit-link", true), "9970", query, commitBody)
	if err != nil || commit["idempotent"] != false {
		t.Fatalf("commit link=%#v err=%v", commit, err)
	}
	commit, err = a.linkWorkItemCommit(identity("pa04-c-commit-link", true), "9970", query, commitBody)
	if err != nil || commit["idempotent"] != true {
		t.Fatalf("commit link replay=%#v err=%v", commit, err)
	}
	commitIDText := strconv.FormatInt(commitID, 10)
	unlinked, err := a.unlinkWorkItemCommit(identity("pa04-c-commit-unlink", true), "9970", commitIDText, query)
	if err != nil || unlinked["idempotent"] != false {
		t.Fatalf("commit unlink=%#v err=%v", unlinked, err)
	}
	unlinked, err = a.unlinkWorkItemCommit(identity("pa04-c-commit-unlink", true), "9970", commitIDText, query)
	if err != nil || unlinked["idempotent"] != true {
		t.Fatalf("commit unlink replay=%#v err=%v", unlinked, err)
	}
	const doc = "11111111-1111-4111-8111-111111111117"
	aclAllowed := true
	aclCalls := 0
	withACL := func(key string) context.Context {
		return WithEnterpriseWorkItemDocumentACL(identity(key, true), func(_ context.Context, uuid, ref string, facts EnterpriseProjectDocumentAccessFacts) (map[string]any, error) {
			aclCalls++
			if uuid != doc || ref != "codocs_document" || facts.ActorUID != "U1" {
				t.Fatalf("bad ACL facts %q %q %#v", uuid, ref, facts)
			}
			return map[string]any{"allowed": aclAllowed}, nil
		})
	}
	docBody := map[string]any{"documentId": doc}
	linked, err := a.linkWorkItemDocument(withACL("pa04-c-document-link"), "9970", query, docBody)
	if err != nil || linked["idempotent"] != false {
		t.Fatalf("document link=%#v err=%v", linked, err)
	}
	linked, err = a.linkWorkItemDocument(withACL("pa04-c-document-link"), "9970", query, docBody)
	if err != nil || linked["idempotent"] != true || aclCalls < 2 || count("SELECT COUNT(*) FROM project_documents WHERE work_item_id=9970") != 1 {
		t.Fatalf("document replay=%#v calls=%d err=%v", linked, aclCalls, err)
	}
	aclAllowed = false
	_, err = a.linkWorkItemDocument(withACL("pa04-c-document-link"), "9970", query, docBody)
	assertStatus(err, 403)
	_, err = a.linkWorkItemDocument(WithEnterpriseWorkItemDocumentACL(identity("pa04-c-document-link", true), func(context.Context, string, string, EnterpriseProjectDocumentAccessFacts) (map[string]any, error) {
		return nil, httperror.New(503, "document_acl_unavailable", "Document access check unavailable")
	}), "9970", query, docBody)
	assertStatus(err, 503)
	unlinkedDoc, err := a.unlinkWorkItemDocument(identity("pa04-c-document-unlink", true), "9970", doc, query)
	if err != nil || unlinkedDoc["idempotent"] != false {
		t.Fatalf("document unlink=%#v err=%v", unlinkedDoc, err)
	}
	unlinkedDoc, err = a.unlinkWorkItemDocument(identity("pa04-c-document-unlink", true), "9970", doc, query)
	if err != nil || unlinkedDoc["idempotent"] != true {
		t.Fatalf("document unlink replay=%#v err=%v", unlinkedDoc, err)
	}
	cloned, err := a.cloneWorkItemFromTemplate(identity("pa04-c-clone", true), "9971", query)
	if err != nil || cloned["idempotent"] != false {
		t.Fatalf("clone=%#v err=%v", cloned, err)
	}
	clonedReplay, err := a.cloneWorkItemFromTemplate(identity("pa04-c-clone", true), "9971", query)
	if err != nil || clonedReplay["idempotent"] != true || clonedReplay["id"] != cloned["id"] {
		t.Fatalf("clone replay=%#v err=%v", clonedReplay, err)
	}
	batchBody := map[string]any{"ids": []any{float64(9970)}, "changes": map[string]any{"priority": "P0"}}
	batch, err := a.batchUpdateWorkItems(identity("pa04-c-batch", true), query, batchBody)
	if err != nil || batch["idempotent"] != false {
		t.Fatalf("batch=%#v err=%v", batch, err)
	}
	batch, err = a.batchUpdateWorkItems(identity("pa04-c-batch", true), query, batchBody)
	if err != nil || batch["idempotent"] != true || count("SELECT COUNT(*) FROM work_item_changelog WHERE work_item_id=9970 AND field_name='priority'") != 1 {
		t.Fatalf("batch replay=%#v err=%v", batch, err)
	}
	_, err = a.batchUpdateWorkItems(identity("pa04-c-batch", true), query, map[string]any{"ids": []any{float64(9970)}, "changes": map[string]any{"priority": "P1"}})
	assertStatus(err, 409)
	if _, err := db.Exec("UPDATE aims_projects SET leader_uid='U9' WHERE id=997"); err != nil {
		t.Fatal(err)
	}
	if _, err := db.Exec("UPDATE aims_project_members SET role='member' WHERE project_id=997 AND uid='U1'"); err != nil {
		t.Fatal(err)
	}
	_, err = a.cloneWorkItemFromTemplate(identity("pa04-c-clone", true), "9971", query)
	assertStatus(err, 403)
	_, err = a.unlinkWorkItemDocument(identity("pa04-c-document-unlink", true), "9970", doc, query)
	assertStatus(err, 403)
}
