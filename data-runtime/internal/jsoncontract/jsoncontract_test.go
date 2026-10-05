package jsoncontract

import (
	"fmt"
	"strings"
	"testing"
)

type contractCase struct {
	name string
	raw  string
	want bool
}

func run(t *testing.T, check func([]byte) bool, cases []contractCase) {
	t.Helper()
	for _, c := range cases {
		if got := check([]byte(c.raw)); got != c.want {
			t.Errorf("%s: got %v want %v (%.120s)", c.name, got, c.want, c.raw)
		}
	}
}

func TestStringList(t *testing.T) {
	run(t, StringList, []contractCase{
		{"empty", `[]`, true},
		{"one", `["G"]`, true},
		{"three", `["G","B","C"]`, true},
		{"null literal", `null`, false},
		{"object", `{}`, false},
		{"non string", `["a",1]`, false},
		{"null element", `["a",null]`, false},
		{"empty entry", `[""]`, false},
		{"oversize entry", `["` + strings.Repeat("x", 256) + `"]`, false},
		{"invalid", `["a"`, false},
		{"trailing data", `["a"] ["b"]`, false},
	})
}

func TestAccessWhitelist(t *testing.T) {
	many := make([]string, AccessWhitelistMaxEntries+1)
	for i := range many {
		many[i] = fmt.Sprintf(`"U%d"`, i)
	}
	run(t, AccessWhitelist, []contractCase{
		{"observed empty array", `[]`, true},
		{"uids", `["U1","U2"]`, true},
		{"max entries", "[" + strings.Join(many[:AccessWhitelistMaxEntries], ",") + "]", true},
		{"too many", "[" + strings.Join(many, ",") + "]", false},
		{"max length", `["` + strings.Repeat("u", 128) + `"]`, true},
		{"too long", `["` + strings.Repeat("u", 129) + `"]`, false},
		{"duplicate", `["U1","U1"]`, false},
		{"empty uid", `[""]`, false},
		{"untrimmed", `[" U1"]`, false},
		{"non string", `[1]`, false},
		{"object", `{"U1":true}`, false},
		{"null literal", `null`, false},
		{"plain text", `U1,U2`, false},
	})
}

func TestProjectModuleConfig(t *testing.T) {
	run(t, ProjectModuleConfig, []contractCase{
		{"legacy shape", `{"legacyProjectType":"custom","legacySource":"import"}`, true},
		{"toggle shape", `{"decomposition":true,"environments":false,"milestones":true,"releases":false,"requirements":true,"service_desk":false,"workflows":true}`, true},
		{"empty", `{}`, true},
		{"legacy aliases read by frontend", `{"milestonesEnabled":true,"processAuditEnabled":false}`, true},
		{"unknown key", `{"milestones":true,"extra":true}`, false},
		{"schema comment name", `{"milestones_enabled":true}`, false},
		{"toggle string", `{"milestones":"true"}`, false},
		{"toggle null", `{"milestones":null}`, false},
		{"legacy bool", `{"legacySource":true}`, false},
		{"legacy oversize", `{"legacySource":"` + strings.Repeat("x", 65) + `"}`, false},
		{"array", `[]`, false},
		{"nested", `{"milestones":{"on":true}}`, false},
	})
}

func TestEventData(t *testing.T) {
	deep := func(levels int) string {
		return strings.Repeat(`{"a":`, levels) + `1` + strings.Repeat(`}`, levels)
	}
	run(t, EventData, []contractCase{
		{"summary only", `{"summary":"created"}`, true},
		{"import event", `{"summary":"x","excelRow":12,"productCode":"P","source":"file"}`, true},
		{"base id", `{"summary":"x","technology_base_id":7}`, true},
		{"nested arrays", `{"summary":"x","items":[{"k":1},[1,2]]}`, true},
		{"depth 8", deep(8), true},
		{"depth 9", deep(9), false},
		{"array", `[1]`, false},
		{"null literal", `null`, false},
		{"scalar", `"x"`, false},
		{"empty key", `{"":1}`, false},
		{"long key", `{"` + strings.Repeat("k", 65) + `":1}`, false},
		{"64 char key", `{"` + strings.Repeat("k", 64) + `":1}`, true},
		{"nested empty key", `{"a":{"":1}}`, false},
		{"oversize", `{"summary":"` + strings.Repeat("x", EventDataMaxBytes) + `"}`, false},
		{"just under", `{"s":"` + strings.Repeat("x", EventDataMaxBytes-8) + `"}`, true},
		{"number overflow", `{"n":1e999}`, false},
		{"NaN literal", `{"n":NaN}`, false},
		{"Infinity literal", `{"n":Infinity}`, false},
		{"invalid json", `{"a":`, false},
	})
}

const approvalSnapshot = `{"schema":"aims.milestone-completion-request.v1","project":{"id":1,"code":"P1"},"milestone":{"id":2,"name":"M","sortOrder":1,"status":"active"},` +
	`"deliverables":[{"id":3,"name":"D","deliverable_type":"document","required":1,"status":"approved","quality_status":"passed","current_submission_id":9,"document_uuid":null,"effective_milestone_id":2,"active_waiver_id":null}],` +
	`"workItems":[{"id":4,"item_key":"K","tier":"target","type":"task","title":"T","status":"completed","assignee_uid":"U1"}]}`

func TestApprovalSnapshot(t *testing.T) {
	cases := []contractCase{
		{"observed", approvalSnapshot, true},
		{"string ids from text protocol", strings.Replace(approvalSnapshot, `"required":1`, `"required":"1"`, 1), true},
		{"empty lists", `{"schema":"aims.milestone-completion-request.v1","project":{"id":1,"code":"P1"},"milestone":{"id":2,"name":"M","sortOrder":0,"status":"active"},"deliverables":[],"workItems":[]}`, true},
		{"work item updated_at", strings.Replace(approvalSnapshot, `"assignee_uid":"U1"`, `"assignee_uid":"U1","updated_at":"2026-01-01T00:00:00.000000Z"`, 1), true},
		{"wrong schema", strings.Replace(approvalSnapshot, ".v1", ".v2", 1), false},
		{"unknown top key", strings.Replace(approvalSnapshot, `"workItems"`, `"extra":1,"workItems"`, 1), false},
		{"missing project", strings.Replace(approvalSnapshot, `"project":{"id":1,"code":"P1"},`, ``, 1), false},
		{"deliverable extra key", strings.Replace(approvalSnapshot, `"active_waiver_id":null`, `"active_waiver_id":null,"x":1`, 1), false},
		{"deliverable missing key", strings.Replace(approvalSnapshot, `,"active_waiver_id":null`, ``, 1), false},
		{"deliverable object value", strings.Replace(approvalSnapshot, `"name":"D"`, `"name":{}`, 1), false},
		{"work item bool", strings.Replace(approvalSnapshot, `"title":"T"`, `"title":true`, 1), false},
		{"project id string", strings.Replace(approvalSnapshot, `"id":1,"code"`, `"id":"1","code"`, 1), false},
		{"not object", `[]`, false},
	}
	run(t, ApprovalSnapshot, cases)
}

func TestCanonicalSHA256MatchesWriterEncoding(t *testing.T) {
	// The writer hashes a compact, key-sorted Go marshal; MySQL hands back the
	// same document with different spacing and key order.
	compact := `{"a":1,"b":[true,null,"x<y"],"c":{"d":2}}`
	spaced := `{"c": {"d": 2}, "b": [true, null, "x<y"], "a": 1}`
	first, ok1 := CanonicalSHA256([]byte(compact))
	second, ok2 := CanonicalSHA256([]byte(spaced))
	if !ok1 || !ok2 || first != second || len(first) != 64 {
		t.Fatalf("hashes %q %q", first, second)
	}
	if _, ok := CanonicalSHA256([]byte(`{`)); ok {
		t.Fatal("invalid JSON must not hash")
	}
	changed, _ := CanonicalSHA256([]byte(`{"a":2,"b":[true,null,"x<y"],"c":{"d":2}}`))
	if changed == first {
		t.Fatal("changed payload kept its hash")
	}
}

var sha = strings.Repeat("a", 64)

func TestQualityReviewResult(t *testing.T) {
	base := `{"schema":"aims.deliverable-quality-review.v1","stage":"pm_completeness","checklistVersionId":3,"checklistItemsSha256":"` + sha + `","results":[{"code":"C1","label":"L","passed":true}]}`
	run(t, QualityReviewResult, []contractCase{
		{"pm", base, true},
		{"director", strings.Replace(base, "pm_completeness", "director_quality", 1), true},
		{"empty results", strings.Replace(base, `[{"code":"C1","label":"L","passed":true}]`, `[]`, 1), true},
		{"bad stage", strings.Replace(base, "pm_completeness", "qa", 1), false},
		{"bad schema", strings.Replace(base, ".v1", ".v9", 1), false},
		{"short sha", strings.Replace(base, sha, "abc", 1), false},
		{"upper sha", strings.Replace(base, sha, strings.Repeat("A", 64), 1), false},
		{"version zero", strings.Replace(base, `"checklistVersionId":3`, `"checklistVersionId":0`, 1), false},
		{"passed string", strings.Replace(base, `"passed":true`, `"passed":"yes"`, 1), false},
		{"result extra key", strings.Replace(base, `"passed":true`, `"passed":true,"note":"x"`, 1), false},
		{"duplicate code", strings.Replace(base, `}]`, `},{"code":"C1","label":"L","passed":false}]`, 1), false},
		{"missing results", strings.Replace(base, `,"results":[{"code":"C1","label":"L","passed":true}]`, ``, 1), false},
	})
}

func TestSubmissionEvidence(t *testing.T) {
	repo := `{"schema":"aims.deliverable-submission.evidence.v2","deliverableId":1,"documentSource":"repo","contentSha256":"` + sha + `","checklistVersionId":2,"checklistItemsSha256":"` + sha + `","repoProjectCode":"P","repoFilePath":"a/b.md","repoCommitId":"abc123"}`
	docs := `{"schema":"aims.deliverable-submission.evidence.v2","deliverableId":1,"documentSource":"codocs","contentSha256":"` + sha + `","checklistVersionId":2,"checklistItemsSha256":"` + sha + `","documentUuid":"u-1","documentVersionId":5,"documentVersionNum":2}`
	run(t, SubmissionEvidence, []contractCase{
		{"repo", repo, true},
		{"codocs", docs, true},
		{"codocs with repo keys", strings.Replace(docs, `"documentUuid":"u-1",`, `"documentUuid":"u-1","repoFilePath":"x",`, 1), false},
		{"repo with document keys", strings.Replace(repo, `"repoCommitId":"abc123"`, `"repoCommitId":"abc123","documentUuid":"u"`, 1), false},
		{"unknown source", strings.Replace(repo, `"repo"`, `"git"`, 1), false},
		{"missing source", strings.Replace(repo, `"documentSource":"repo",`, ``, 1), false},
		{"wrong schema", strings.Replace(repo, "evidence.v2", "evidence.v1", 1), false},
		{"bad content hash", strings.Replace(repo, `"contentSha256":"`+sha+`"`, `"contentSha256":"zz"`, 1), false},
		{"missing repo path", strings.Replace(repo, `"repoFilePath":"a/b.md",`, ``, 1), false},
		{"deliverable id string", strings.Replace(repo, `"deliverableId":1`, `"deliverableId":"1"`, 1), false},
		{"empty repo commit", strings.Replace(repo, `"abc123"`, `""`, 1), false},
	})
}

func TestTemplateDefinition(t *testing.T) {
	deliverable := `{"key":"D1","name":"Doc","deliverableType":"document","acceptanceCriteria":"ok","required":true,"sortOrder":1,"description":null}`
	workItem := `{"key":"W1","title":"Task","type":"task","tier":"target","priority":"P2","description":"d","required":true,"reviewLevel":1,"sortOrder":1,"deliverables":[` + deliverable + `]}`
	milestone := `{"key":"M1","name":"Milestone","mode":"once","pivrStage":"P","sortOrder":1,"description":null,"workItems":[` + workItem + `]}`
	full := `{"milestones":[` + milestone + `]}`
	run(t, TemplateDefinition, []contractCase{
		{"three levels", full, true},
		{"null work items", `{"milestones":[{"key":"M1","name":"N","mode":"once","pivrStage":"P","sortOrder":1,"description":null,"workItems":null}]}`, true},
		{"null deliverables", strings.Replace(full, `"deliverables":[`+deliverable+`]`, `"deliverables":null`, 1), true},
		{"empty milestones", `{"milestones":[]}`, true},
		{"legacy milestone without description", `{"milestones":[` + strings.Replace(milestone, `"description":null,`, ``, 1) + `]}`, true},
		{"milestone description number", `{"milestones":[` + strings.Replace(milestone, `"description":null,"workItems"`, `"description":5,"workItems"`, 1) + `]}`, false},
		{"null milestones", `{"milestones":null}`, true},
		{"bare milestone root", strings.Replace(milestone, `"workItems"`, `"recurrenceRule":"monthly","workItems"`, 1), false}, // not wrapped in milestones object
		{"periodic wrapped", `{"milestones":[` + strings.Replace(milestone, `"workItems"`, `"recurrenceRule":"monthly","workItems"`, 1) + `]}`, true},
		{"unknown top key", `{"milestones":[],"default_module_config":{}}`, false},
		{"unknown milestone key", `{"milestones":[` + strings.Replace(milestone, `"workItems"`, `"extra":1,"workItems"`, 1) + `]}`, false},
		{"unknown deliverable key", strings.Replace(full, `"description":null}`, `"description":null,"x":1}`, 1), false},
		{"required string", strings.Replace(full, `"required":true,"reviewLevel"`, `"required":"true","reviewLevel"`, 1), false},
		{"sort order string", strings.Replace(full, `"sortOrder":1,"description":null,"workItems"`, `"sortOrder":"1","description":null,"workItems"`, 1), false},
		{"work items object", strings.Replace(full, `"workItems":[`+workItem+`]`, `"workItems":{}`, 1), false},
		{"missing key", strings.Replace(full, `"key":"M1",`, ``, 1), false},
		{"array root", `[]`, false},
	})
}

func TestQAChecklistItems(t *testing.T) {
	run(t, QAChecklistItems, []contractCase{
		{"observed", `[{"code":"C1","label":"L1","required":true},{"code":"C2","label":"L2","required":false}]`, true},
		{"empty", `[]`, false},
		{"duplicate code", `[{"code":"C1","label":"L","required":true},{"code":"C1","label":"M","required":true}]`, false},
		{"missing required", `[{"code":"C1","label":"L"}]`, false},
		{"required int", `[{"code":"C1","label":"L","required":1}]`, false},
		{"extra key", `[{"code":"C1","label":"L","required":true,"hint":"x"}]`, false},
		{"empty code", `[{"code":"","label":"L","required":true}]`, false},
		{"not array", `{"code":"C1"}`, false},
		{"null literal", `null`, false},
	})
}

func TestAttachments(t *testing.T) {
	run(t, Attachments, []contractCase{
		{"observed", `[{"name":"a.pdf","url":"https://example.test/a.pdf"}]`, true},
		{"empty", `[]`, true},
		{"relative url", `[{"name":"a","url":"/files/a"}]`, true},
		{"missing url", `[{"name":"a"}]`, false},
		{"extra key", `[{"name":"a","url":"u","size":1}]`, false},
		{"url number", `[{"name":"a","url":1}]`, false},
		{"empty name", `[{"name":"","url":"u"}]`, false},
		{"oversize url", `[{"name":"a","url":"` + strings.Repeat("u", 2049) + `"}]`, false},
		{"string entry", `["a"]`, false},
		{"object root", `{"name":"a","url":"u"}`, false},
		{"null literal", `null`, false},
	})
}
