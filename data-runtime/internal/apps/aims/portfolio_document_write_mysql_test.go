package aims

import (
	"context"
	"database/sql"
	"reflect"
	"strconv"
	"testing"

	"github.com/huizhi-yun/data-runtime/internal/documentcatalog"
	"github.com/huizhi-yun/data-runtime/internal/httperror"
)

// Runs inside TestEnterpriseProjectMembersMySQL: unified mode with the Registry
// fence, canonical tables, real locks. Document asset design DOC-05, batch 5b-2.
func testPortfolioDocumentWritesMySQL(t *testing.T, a *Adapter, db *sql.DB) {
	exec := func(q string, args ...any) {
		t.Helper()
		if _, err := db.Exec(q, args...); err != nil {
			t.Fatalf("%v\n%s", err, q)
		}
	}
	count := func(q string, args ...any) (n int) {
		t.Helper()
		if err := db.QueryRow(q, args...).Scan(&n); err != nil {
			t.Fatalf("%v\n%s", err, q)
		}
		return n
	}
	exec("INSERT INTO project_portfolios(id,code,name,owner_uid,created_by) VALUES(921,'PFW','Writes','OWN','OWN'),(922,'PFX','Other','OWN','OWN')")
	exec("INSERT INTO aims_projects(id,project_code,name,short_name,leader_uid,created_by,portfolio_id) VALUES(9211,'INPFW','In portfolio','IN','LEAD','LEAD',921)")
	exec("INSERT INTO aims_project_members(project_id,uid,role,status) VALUES(9211,'MEM','member','active')")
	exec(`INSERT INTO aims_portfolio_members(portfolio_id,uid,relation_type,status,valid_from,valid_until,revision,created_by,updated_by,created_at,updated_at) VALUES
		(921,'MGR','manager','active',UTC_TIMESTAMP(3),NULL,1,'OWN','OWN',UTC_TIMESTAMP(3),UTC_TIMESTAMP(3)),
		(921,'CON','contributor','active',UTC_TIMESTAMP(3),NULL,1,'OWN','OWN',UTC_TIMESTAMP(3),UTC_TIMESTAMP(3)),
		(921,'CON2','contributor','active',UTC_TIMESTAMP(3),NULL,1,'OWN','OWN',UTC_TIMESTAMP(3),UTC_TIMESTAMP(3)),
		(921,'VIEW','viewer','active',UTC_TIMESTAMP(3),NULL,1,'OWN','OWN',UTC_TIMESTAMP(3),UTC_TIMESTAMP(3))`)
	exec(`INSERT INTO project_documents(id,uuid,portfolio_id,project_id,project_code,title,is_folder,document_source,created_by) VALUES
		(9290,UUID(),922,NULL,NULL,'他集目录',1,'codocs','OWN'),
		(9291,UUID(),NULL,9211,'INPFW','项目目录',1,'codocs','LEAD')`)
	previousSync := a.documentCatalogSync
	defer func() {
		a.documentCatalogSync = previousSync
		exec("DELETE FROM project_documents WHERE portfolio_id IN (921,922) OR project_id=9211")
		exec("DELETE FROM aims_portfolio_doc_repos WHERE portfolio_id IN (921,922)")
		exec("DELETE FROM aims_portfolio_members WHERE portfolio_id IN (921,922)")
		exec("DELETE FROM aims_project_members WHERE project_id=9211")
		exec("DELETE FROM aims_projects WHERE id=9211")
		exec("DELETE FROM project_portfolios WHERE id IN (921,922)")
	}()
	var synced []documentcatalog.Filter
	a.ConfigureDocumentCatalogSync(func(kind string, filter documentcatalog.Filter) {
		if kind != catalogKindRepoDocument {
			t.Fatalf("unexpected catalog kind %s", kind)
		}
		synced = append(synced, filter)
	})

	const index1, index2, index3, folder1, folder2, repo1 = "cccccccc-0000-4000-8000-000000000001", "cccccccc-0000-4000-8000-000000000002", "cccccccc-0000-4000-8000-000000000003", "cccccccc-0000-4000-8000-0000000000f1", "cccccccc-0000-4000-8000-0000000000f2", "cccccccc-0000-4000-8000-0000000000a1"
	const codocsA, codocsB, codocsDenied, codocsElsewhere = "dddddddd-0000-4000-8000-00000000000a", "dddddddd-0000-4000-8000-00000000000b", "dddddddd-0000-4000-8000-00000000000c", "dddddddd-0000-4000-8000-00000000000d"
	type shareCall struct{ uuid, actor, code string }
	var shares []shareCall
	sharer := PortfolioDocumentSharer(func(_ context.Context, uuid, actor, code string) (bool, error) {
		shares = append(shares, shareCall{uuid, actor, code})
		if uuid == codocsDenied {
			return false, httperror.New(403, "portfolio_document_share_required", "owner only")
		}
		return uuid == codocsElsewhere, nil
	})
	base := WithPortfolioDocumentSharer(context.Background(), sharer)
	create := func(ctx context.Context, portfolio, actor string, body map[string]any) (map[string]any, string) {
		t.Helper()
		out, err := a.createPortfolioDocument(ctx, portfolio, portfolioActorQuery(actor, false), body)
		return out, portfolioErrorCode(err)
	}
	documents := func() int { return count("SELECT COUNT(*) FROM project_documents WHERE portfolio_id=921") }
	linkA := map[string]any{"uuid": index1, "title": "方案 A", "codocsUuid": codocsA}

	// ---- create ----
	// Only managers and contributors write; an inherited relation never does.
	for _, actor := range []string{"VIEW", "MEM", "LEAD", "NOBODY"} {
		if _, code := create(base, "921", actor, linkA); code != "portfolio_document_write_denied" {
			t.Fatalf("%s create code=%q", actor, code)
		}
	}
	// The owner is the portfolio in the path and nothing else.
	for _, body := range []map[string]any{
		{"uuid": index1, "title": "x", "codocsUuid": codocsA, "projectId": 9211},
		{"uuid": index1, "title": "x", "codocsUuid": codocsA, "portfolioId": 922},
		{"uuid": index1, "title": "x", "codocsUuid": codocsA, "project_code": "INPFW"},
		{"uuid": index1, "title": "x", "codocsUuid": codocsA, "createdBy": "OWN"},
		{"uuid": "not-a-uuid", "title": "x", "codocsUuid": codocsA},
		{"uuid": index1, "title": " ", "codocsUuid": codocsA},
		{"uuid": index1, "title": "x"},
		{"uuid": index1, "title": "x", "isFolder": true, "codocsUuid": codocsA},
		{"uuid": index1, "title": "x", "documentSource": "oss", "codocsUuid": codocsA},
		{"uuid": index1, "title": "x", "documentSource": "repo", "repoFilePath": "docs/a.md"},
		{"uuid": index1, "title": "x", "documentSource": "repo", "repoFilePath": "../a.md", "repoCommitId": "abc"},
		{"uuid": index1, "title": "x", "documentSource": "repo", "repoFilePath": "docs/a.md", "repoCommitId": "abc", "codocsUuid": codocsA},
	} {
		if _, code := create(base, "921", "CON", body); code != "portfolio_document_input_invalid" {
			t.Fatalf("body %v code=%q", body, code)
		}
	}
	// A parent must be a folder of this very portfolio.
	for _, parent := range []int64{9290, 9291, 424242} {
		if _, code := create(base, "921", "CON", map[string]any{"uuid": index1, "title": "x", "codocsUuid": codocsA, "parentId": parent}); code != "portfolio_document_input_invalid" {
			t.Fatalf("parent %d code=%q", parent, code)
		}
	}
	// Linking is sharing: the Codocs owner check runs first and its refusal wins.
	if _, code := create(base, "921", "CON", map[string]any{"uuid": index1, "title": "x", "codocsUuid": codocsDenied}); code != "portfolio_document_share_required" {
		t.Fatalf("non-owner link code=%q", code)
	}
	if _, err := a.createPortfolioDocument(context.Background(), "921", portfolioActorQuery("CON", false), linkA); portfolioErrorCode(err) != "document_acl_unavailable" {
		t.Fatalf("missing sharer err=%v", err)
	}
	if documents() != 0 {
		t.Fatalf("rejected creations wrote %d rows", documents())
	}

	shares = nil
	first, code := create(base, "921", "CON", linkA)
	if code != "" || first["replayed"] != false || first["policyOwnedElsewhere"] != false || first["portfolioId"] != int64(921) {
		t.Fatalf("link out=%v code=%q", first, code)
	}
	if !reflect.DeepEqual(shares, []shareCall{{codocsA, "CON", "PFW"}}) {
		t.Fatalf("share checks=%+v", shares)
	}
	if n := count("SELECT COUNT(*) FROM project_documents WHERE id=? AND portfolio_id=921 AND project_id IS NULL AND project_code IS NULL AND codocs_uuid=? AND document_source='codocs' AND created_by='CON' AND is_folder=0", first["id"], codocsA); n != 1 {
		t.Fatal("linked row has the wrong shape")
	}
	// Same intent again: the same row. A different creation under the same uuid, a
	// replay by somebody else, or linking the same document twice are refused.
	if replay, code := create(base, "921", "CON", linkA); code != "" || replay["id"] != first["id"] || replay["replayed"] != true || documents() != 1 {
		t.Fatalf("replay out=%v code=%q", replay, code)
	}
	if _, code := create(base, "921", "CON", map[string]any{"uuid": index1, "title": "另一个标题", "codocsUuid": codocsA}); code != "document_uuid_conflict" {
		t.Fatalf("uuid reuse code=%q", code)
	}
	if _, code := create(base, "921", "MGR", linkA); code != "document_uuid_conflict" {
		t.Fatalf("replay by another actor code=%q", code)
	}
	if _, code := create(base, "921", "MGR", map[string]any{"uuid": index2, "title": "方案 A 重复", "codocsUuid": codocsA}); code != "portfolio_document_already_linked" {
		t.Fatalf("double link code=%q", code)
	}
	// A policy owned elsewhere does not block the link; the caller is told.
	if out, code := create(base, "921", "MGR", map[string]any{"uuid": index2, "title": "别处策略", "codocsUuid": codocsElsewhere}); code != "" || out["policyOwnedElsewhere"] != true {
		t.Fatalf("elsewhere out=%v code=%q", out, code)
	}
	// Folders, nesting.
	top, code := create(base, "921", "CON", map[string]any{"uuid": folder1, "title": "目录", "isFolder": true})
	if code != "" {
		t.Fatalf("folder code=%q", code)
	}
	nested, code := create(base, "921", "CON", map[string]any{"uuid": folder2, "title": "子目录", "isFolder": true, "parentId": top["id"]})
	if code != "" {
		t.Fatalf("nested folder code=%q", code)
	}
	inFolder, code := create(base, "921", "CON2", map[string]any{"uuid": index3, "title": "方案 B", "codocsUuid": codocsB, "parentId": top["id"], "docCategory": "design"})
	if code != "" {
		t.Fatalf("link in folder code=%q", code)
	}
	if len(synced) != 0 {
		t.Fatalf("Codocs links must not trigger the repository catalog: %+v", synced)
	}

	// Repository files: only from the registered document repository, with a frozen commit.
	repoBody := map[string]any{"uuid": repo1, "title": "仓库说明", "documentSource": "repo", "repoFilePath": "docs/readme.md", "repoCommitId": "abc123"}
	if _, code := create(base, "921", "CON", repoBody); code != "portfolio_doc_repo_required" {
		t.Fatalf("repo without registration code=%q", code)
	}
	if _, err := a.savePortfolioDocRepo(context.Background(), "921", portfolioActorQuery("OWN", true), map[string]any{"repoPath": "group/pfw-docs"}); err != nil {
		t.Fatal(err)
	}
	repoDoc, code := create(base, "921", "CON", repoBody)
	if code != "" || count("SELECT COUNT(*) FROM project_documents WHERE id=? AND repo_project_code='group/pfw-docs' AND repo_file_path='docs/readme.md' AND repo_commit_id='abc123' AND codocs_uuid IS NULL", repoDoc["id"]) != 1 {
		t.Fatalf("repo link out=%v code=%q", repoDoc, code)
	}
	if !reflect.DeepEqual(synced, []documentcatalog.Filter{{OwnerType: "portfolio", OwnerCode: "PFW"}}) {
		t.Fatalf("catalog triggers=%+v", synced)
	}
	entries, err := a.DocumentCatalogEntries(context.Background(), catalogKindRepoDocument, documentcatalog.Filter{OwnerType: "portfolio", OwnerCode: "PFW"})
	if err != nil || len(entries) != 1 || entries[0].OwnerType != "portfolio" || entries[0].OwnerCode != "PFW" || entries[0].Revision != "abc123" || entries[0].Locator["repoPath"] != "group/pfw-docs" {
		t.Fatalf("catalog entries=%+v err=%v", entries, err)
	}

	// Revocation is immediate, including for the replay of an accepted creation.
	exec("UPDATE aims_portfolio_members SET status='inactive' WHERE portfolio_id=921 AND uid='CON'")
	if _, code := create(base, "921", "CON", linkA); code != "portfolio_document_write_denied" {
		t.Fatalf("replay after revocation code=%q", code)
	}
	exec("UPDATE aims_portfolio_members SET status='active' WHERE portfolio_id=921 AND uid='CON'")
	// An owner who is no longer an active employee is not an implicit manager.
	gone := WithPortfolioOwnerStatus(base, func(context.Context, string) (bool, error) { return false, nil })
	if _, code := create(gone, "921", "OWN", map[string]any{"uuid": "cccccccc-0000-4000-8000-0000000000e1", "title": "x", "isFolder": true}); code != "portfolio_document_write_denied" {
		t.Fatalf("inactive owner create code=%q", code)
	}
	down := WithPortfolioOwnerStatus(base, func(context.Context, string) (bool, error) {
		return false, httperror.New(503, "directory_subject_status_unavailable", "down")
	})
	if _, code := create(down, "921", "MGR", map[string]any{"uuid": "cccccccc-0000-4000-8000-0000000000e1", "title": "x", "isFolder": true}); code != "directory_subject_status_unavailable" {
		t.Fatalf("directory down create code=%q", code)
	}
	// A changed Registry generation rejects the command before any write.
	before := documents()
	exec("UPDATE enterprise_schema_registry SET generation=generation+1 WHERE id=1")
	_, err = a.createPortfolioDocument(base, "921", portfolioActorQuery("MGR", false), map[string]any{"uuid": "cccccccc-0000-4000-8000-0000000000e2", "title": "x", "isFolder": true})
	exec("UPDATE enterprise_schema_registry SET generation=generation-1 WHERE id=1")
	if err == nil || documents() != before {
		t.Fatalf("stale generation err=%v", err)
	}
	// The project entry point still refuses portfolio-owned documents.
	if _, err = a.ResolveEnterpriseProjectDocumentOwner(context.Background(), nil, idText(first["id"])); portfolioErrorCode(err) != "project_document_portfolio_owner_unsupported" {
		t.Fatalf("project path on a portfolio document err=%v", err)
	}

	// ---- policy ----
	type saved struct {
		policy PortfolioDocumentPolicy
	}
	var saves []saved
	var saveErr error
	saver := PortfolioDocumentPolicySaver(func(_ context.Context, p PortfolioDocumentPolicy) (map[string]any, error) {
		saves = append(saves, saved{p})
		if saveErr != nil {
			return nil, saveErr
		}
		return map[string]any{"documentUuid": p.DocumentUUID, "etag": "next", "changed": true}, nil
	})
	policyCtx := WithPortfolioDocumentPolicySaver(context.Background(), saver)
	policy := func(ctx context.Context, actor string, document any, body map[string]any) (map[string]any, string) {
		t.Helper()
		out, err := a.savePortfolioDocumentPolicy(ctx, "921", idText(document), portfolioActorQuery(actor, false), body)
		return out, portfolioErrorCode(err)
	}
	open := map[string]any{"lifecycleStage": "formal", "confidentialityLevel": "L1", "defaultPermission": "view", "inheritToMemberProjects": true, "expectedEtag": ""}
	for _, actor := range []string{"CON", "VIEW", "MEM", "NOBODY"} {
		if _, code := policy(policyCtx, actor, first["id"], open); code != "portfolio_document_manager_required" {
			t.Fatalf("%s policy code=%q", actor, code)
		}
	}
	for _, body := range []map[string]any{
		{"lifecycleStage": "formal", "confidentialityLevel": "L1", "defaultPermission": "view", "inheritToMemberProjects": true},
		{"lifecycleStage": "formal", "confidentialityLevel": "L9", "defaultPermission": "view", "inheritToMemberProjects": true, "expectedEtag": ""},
		{"lifecycleStage": "formal", "confidentialityLevel": "L1", "defaultPermission": "edit", "inheritToMemberProjects": true, "expectedEtag": ""},
		{"lifecycleStage": "formal", "confidentialityLevel": "L1", "defaultPermission": "view", "inheritToMemberProjects": "yes", "expectedEtag": ""},
		{"lifecycleStage": "formal", "confidentialityLevel": "L1", "defaultPermission": "view", "inheritToMemberProjects": true, "expectedEtag": "", "sourceOwnerType": "project"},
	} {
		if _, code := policy(policyCtx, "MGR", first["id"], body); code != "portfolio_document_input_invalid" {
			t.Fatalf("policy body %v code=%q", body, code)
		}
	}
	if _, code := policy(context.Background(), "MGR", first["id"], open); code != "document_acl_unavailable" {
		t.Fatalf("missing saver code=%q", code)
	}
	for _, target := range []any{top["id"], repoDoc["id"]} {
		if _, code := policy(policyCtx, "MGR", target, open); code != "portfolio_document_policy_unsupported" {
			t.Fatalf("policy on folder/repo code=%q", code)
		}
	}
	for _, target := range []any{int64(9290), int64(9291), int64(424242)} {
		if _, code := policy(policyCtx, "MGR", target, open); code != "portfolio_document_not_found" {
			t.Fatalf("policy on foreign document %v code=%q", target, code)
		}
	}
	if len(saves) != 0 {
		t.Fatalf("rejected policy commands reached Codocs: %+v", saves)
	}
	out, code := policy(policyCtx, "MGR", first["id"], open)
	want := PortfolioDocumentPolicy{ActorUID: "MGR", PortfolioCode: "PFW", DocumentUUID: codocsA, LifecycleStage: "formal", Confidentiality: "L1", DefaultPermission: "view", InheritToMemberProjects: true}
	if code != "" || len(saves) != 1 || saves[0].policy != want || out["accessSummary"] != "项目集成员及组内项目成员" || out["etag"] != "next" {
		t.Fatalf("policy out=%v saves=%+v code=%q", out, saves, code)
	}
	if n := count("SELECT COUNT(*) FROM project_documents WHERE id=? AND access_lifecycle_stage='formal' AND access_confidentiality_level='L1' AND access_summary='项目集成员及组内项目成员' AND updated_by='MGR'", first["id"]); n != 1 {
		t.Fatal("mirror not updated")
	}
	// Codocs refuses (policy owned elsewhere, stale etag): the mirror is untouched.
	saveErr = httperror.New(409, "portfolio_document_policy_owned_elsewhere", "elsewhere")
	closed := map[string]any{"lifecycleStage": "formal", "confidentialityLevel": "L3", "defaultPermission": "none", "inheritToMemberProjects": false, "expectedEtag": "next"}
	if _, code := policy(policyCtx, "OWN", first["id"], closed); code != "portfolio_document_policy_owned_elsewhere" {
		t.Fatalf("elsewhere policy code=%q", code)
	}
	if n := count("SELECT COUNT(*) FROM project_documents WHERE id=? AND access_confidentiality_level='L1'", first["id"]); n != 1 {
		t.Fatal("mirror changed although Codocs refused")
	}
	saveErr = nil
	if out, code = policy(policyCtx, "OWN", first["id"], closed); code != "" || out["accessSummary"] != "项目集成员" {
		t.Fatalf("closed policy out=%v code=%q", out, code)
	}

	// ---- delete ----
	remove := func(ctx context.Context, actor string, document any) (map[string]any, string) {
		t.Helper()
		out, err := a.deletePortfolioDocument(ctx, "921", idText(document), portfolioActorQuery(actor, false))
		return out, portfolioErrorCode(err)
	}
	for _, actor := range []string{"VIEW", "MEM", "NOBODY"} {
		if _, code := remove(context.Background(), actor, inFolder["id"]); code != "portfolio_document_write_denied" {
			t.Fatalf("%s delete code=%q", actor, code)
		}
	}
	// A contributor removes only what he linked himself, and never a folder.
	if _, code := remove(context.Background(), "CON", inFolder["id"]); code != "portfolio_document_delete_denied" {
		t.Fatalf("contributor deletes another's link code=%q", code)
	}
	if _, code := remove(context.Background(), "CON", nested["id"]); code != "portfolio_document_delete_denied" {
		t.Fatalf("contributor deletes folder code=%q", code)
	}
	// Documents of another portfolio or of a project are not addressable here.
	for _, target := range []any{int64(9290), int64(9291)} {
		if _, code := remove(context.Background(), "MGR", target); code != "portfolio_document_not_found" {
			t.Fatalf("foreign delete %v code=%q", target, code)
		}
	}
	if _, code := remove(context.Background(), "MGR", top["id"]); code != "portfolio_document_folder_not_empty" {
		t.Fatalf("non-empty folder code=%q", code)
	}
	before = documents()
	if out, code := remove(context.Background(), "CON2", inFolder["id"]); code != "" || out["removed"] != 1 {
		t.Fatalf("own link delete out=%v code=%q", out, code)
	}
	if out, code := remove(context.Background(), "MGR", top["id"]); code != "" || out["removed"] != 2 || documents() != before-3 {
		t.Fatalf("folder tree delete out=%v code=%q", out, code)
	}
	// Replays find nothing; revoked actors are refused before that.
	if _, code := remove(context.Background(), "MGR", top["id"]); code != "portfolio_document_not_found" {
		t.Fatalf("delete replay code=%q", code)
	}
	synced = nil
	if _, code := remove(context.Background(), "CON", repoDoc["id"]); code != "" {
		t.Fatalf("repo link delete code=%q", code)
	}
	if !reflect.DeepEqual(synced, []documentcatalog.Filter{{OwnerType: "portfolio", OwnerCode: "PFW"}}) {
		t.Fatalf("catalog triggers after delete=%+v", synced)
	}
	// Only references are removed; untouched rows of other owners remain.
	if n := count("SELECT COUNT(*) FROM project_documents WHERE id IN (9290,9291)"); n != 2 {
		t.Fatal("deleting touched another owner's documents")
	}

	// The list tells direct relations what they may do and passes the policy state through.
	acl := EnterprisePortfolioDocumentACL(func(_ context.Context, uuid, _ string, f EnterprisePortfolioDocumentAccessFacts) (map[string]any, error) {
		out := map[string]any{"allowed": true, "readonly": true, "reason": "test", "permission": "view", "lifecycleStage": "formal", "confidentialityLevel": "L1"}
		if f.Relation != portfolioRelationInherited {
			out["policy"] = map[string]any{"etag": "e-" + uuid}
		}
		return out, nil
	})
	listCtx := WithEnterprisePortfolioDocumentACL(context.Background(), acl)
	for actor, flags := range map[string][2]bool{"MGR": {true, true}, "CON": {true, false}, "VIEW": {false, false}, "MEM": {false, false}} {
		list, err := a.listPortfolioDocuments(listCtx, "921", portfolioActorQuery(actor, false))
		if err != nil || list["canLink"] != flags[0] || list["canManagePolicy"] != flags[1] {
			t.Fatalf("%s list=%v err=%v", actor, list, err)
		}
		for _, item := range list["items"].([]map[string]any) {
			if actor == "MEM" && item["policy"] != nil {
				t.Fatalf("inherited relation sees policy state: %v", item)
			}
			if actor == "MGR" && item["codocsUuid"] == codocsA && !reflect.DeepEqual(item["policy"], map[string]any{"etag": "e-" + codocsA}) {
				t.Fatalf("policy state missing: %v", item)
			}
		}
	}
}

func idText(value any) string {
	switch v := value.(type) {
	case int64:
		return strconv.FormatInt(v, 10)
	case int:
		return strconv.FormatInt(int64(v), 10)
	}
	return ""
}
