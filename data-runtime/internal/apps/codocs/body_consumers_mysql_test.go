package codocs

import (
	"net/url"
	"os"
	"regexp"
	"strings"
	"testing"
)

// Runs in the disposable-MySQL suite (Directory and Codocs in separate schemas)
// with the department collaboration tests: batch H1b body-consumer behavior on
// real snapshot heads, sessions and the standalone freeze write.
func TestMySQLDepartmentCollaborationBodyConsumers(t *testing.T) {
	env := newDeptCollabEnv(t)

	t.Run("body reference is the exact published version and v1 has none", func(t *testing.T) {
		v1 := env.newDoc("owner", "department", "D1")
		ref, err := env.a.resolveDocumentBodyRef(env.ctx, v1)
		if err != nil || ref != nil {
			t.Fatalf("v1 ref=%v err=%v", ref, err)
		}
		v2 := env.v2Doc("owner")
		ref, err = env.a.resolveDocumentBodyRef(env.ctx, v2)
		if err != nil || ref == nil {
			t.Fatalf("v2 ref=%v err=%v", ref, err)
		}
		if ref.Generation != 1 || ref.Size != 10 || ref.SHA256 != strings.Repeat("a", 64) || ref.Version != "v-md" || !strings.HasSuffix(ref.Key, "/body.md") || !strings.HasPrefix(ref.Key, "codocs/snapshots/") {
			t.Fatalf("ref = %+v", ref)
		}
		// A head whose candidate no longer matches is refused, never read as legacy.
		dcExec(t, env.docDB, `UPDATE document_snapshot_heads SET published_candidate = ? WHERE document_uuid = ?`, strings.Repeat("e", 64), v2)
		if _, err = env.a.resolveDocumentBodyRef(env.ctx, v2); err == nil {
			t.Fatal("head pointing to a missing candidate was accepted")
		}
	})

	t.Run("snapshot state marks metadata and returns the ref only when asked", func(t *testing.T) {
		v1 := env.newDoc("owner", "department", "D1")
		v2 := env.v2Doc("owner")
		items := []map[string]any{{"uuid": v1}, {"uuid": v2}}
		if err := env.a.annotateSnapshotState(env.ctx, items, false); err != nil {
			t.Fatal(err)
		}
		if items[0]["snapshot_generation"] != int64(0) || items[1]["snapshot_generation"] != int64(1) || items[1]["snapshot_ref"] != nil {
			t.Fatalf("items = %#v", items)
		}
		if err := env.a.annotateSnapshotState(env.ctx, items, true); err != nil {
			t.Fatal(err)
		}
		if items[1]["snapshot_ref"] == nil || items[0]["snapshot_ref"] != nil {
			t.Fatalf("items = %#v", items)
		}
	})

	t.Run("standalone freeze ends the collaboration session before any copy", func(t *testing.T) {
		doc := env.v2Doc("owner")
		s := env.mustOpen("owner", doc)
		_, epochBefore := env.head(doc)
		if _, err := env.a.updateDocument(env.ctx, doc, map[string]any{"current_user": "owner", "readonly_flag": true}); err != nil {
			t.Fatal(err)
		}
		if env.sessionStatus(s.SessionID) != "revoked" {
			t.Fatal("freeze left the collaboration session active")
		}
		if g, epochAfter := env.head(doc); g != 1 || epochAfter != epochBefore+1 {
			t.Fatalf("head generation=%d epoch %d -> %d", g, epochBefore, epochAfter)
		}
		var readonly int
		if err := env.docDB.QueryRow(`SELECT readonly_flag FROM documents WHERE uuid = ?`, doc).Scan(&readonly); err != nil || readonly != 1 {
			t.Fatalf("readonly=%d err=%v", readonly, err)
		}
		// A late Collab publish for the revoked session is refused (body cannot move under the copy).
		if _, err := env.publish(s.SessionID, "late-"+doc, 1, epochBefore); err == nil {
			t.Fatal("publish after freeze was accepted")
		}
	})

	t.Run("legacy Collab v1 context and content saves refuse a department v2 document", func(t *testing.T) {
		doc := env.v2Doc("owner")
		_, err := env.a.collaborationContext(env.ctx, url.Values{"uuid": {doc}})
		env.wantStatus(err, 409, "document_on_snapshot_v2")
		_, err = env.a.updateDocument(env.ctx, doc, map[string]any{"current_user": "owner", "content_size": 12})
		env.wantStatus(err, 409, "document_on_snapshot_v2")
		// Metadata-only edits stay allowed and do not disturb the head.
		if _, err = env.a.updateDocument(env.ctx, doc, map[string]any{"current_user": "owner", "title": "renamed"}); err != nil {
			t.Fatal(err)
		}
		if g, _ := env.head(doc); g != 1 {
			t.Fatalf("generation = %d", g)
		}
	})

	t.Run("service content grants and quick publish refuse or reference v2 sources", func(t *testing.T) {
		v1 := env.newDoc("owner", "department", "D1")
		v2 := env.v2Doc("owner")
		for _, doc := range []string{v1, v2} {
			dcExec(t, env.docDB, `UPDATE documents SET oss_path = ? WHERE uuid = ?`, "codocs/departments/D1/"+doc+".md", doc)
		}
		if err := refuseSnapshotV2Document(env.ctx, env.docDB, v1); err != nil {
			t.Fatalf("v1 refused: %v", err)
		}
		env.wantStatus(refuseSnapshotV2Document(env.ctx, env.docDB, v2), 409, "document_on_snapshot_v2")

		source, err := os.ReadFile("../../../../codocs/docs/codocs_schema.sql")
		if err != nil {
			t.Fatal(err)
		}
		ddl := regexp.MustCompile(`(?ms)^CREATE TABLE IF NOT EXISTS company_asset_quick_publish_operations \(.*?^\) ENGINE=.*?;`).FindString(string(source))
		if ddl == "" {
			t.Fatal("missing quick publish schema")
		}
		dcExec(t, env.docDB, ddl)
		result, err := env.a.quickPublishPrepare(env.ctx, quickPublishTestQuery(), map[string]any{"operationId": "h1b-op", "targetPrefix": "codocs/company/rules/", "documentUuids": []any{v1, v2}})
		if err != nil {
			t.Fatal(err)
		}
		bySource := map[string]quickPublishItem{}
		for _, item := range result["plan"].(quickPublishPlan).Items {
			bySource[item.SourceUUID] = item
		}
		if bySource[v1].SourcePath != "codocs/departments/D1/"+v1+".md" || bySource[v1].BodyRef != nil {
			t.Fatalf("v1 item = %+v", bySource[v1])
		}
		if bySource[v2].SourcePath != "" || bySource[v2].BodyRef == nil || bySource[v2].BodyRef["generation"] != int64(1) {
			t.Fatalf("v2 item = %+v", bySource[v2])
		}
	})
}
