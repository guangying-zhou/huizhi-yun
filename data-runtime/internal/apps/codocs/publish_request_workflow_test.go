package codocs

import (
	"database/sql"
	"strings"
	"testing"
)

func TestPublishWorkflowEnvelopeIsStableAndFixed(t *testing.T) {
	row := publishWorkflowRow{ID: 42, DocumentUUID: "doc-uuid", ReviewType: "department", InitiatorUID: "u-1", TargetCategory: "department", DocumentTitle: "Release note"}
	first, err := publishWorkflowEnvelope(row)
	if err != nil {
		t.Fatal(err)
	}
	second, err := publishWorkflowEnvelope(row)
	if err != nil {
		t.Fatal(err)
	}
	if first["operationId"] != second["operationId"] || !strings.Contains(first["operationId"].(string), "-") {
		t.Fatalf("stable operation id = %#v", first["operationId"])
	}
	if first["targetApp"] != "workflow" || first["operationCode"] != codocsPublishWorkflowOperationCode || first["requiredCapability"] != codocsPublishWorkflowCapability {
		t.Fatalf("unexpected fixed envelope: %#v", first)
	}
	command := first["command"].(map[string]any)
	if command["actorUid"] != "u-1" || command["idempotencyKey"] != "codocs:publish-request:42:workflow-submit:v1" || command["bizUrl"] != nil || command["callbackUrl"] != nil {
		t.Fatalf("unexpected trusted command: %#v", command)
	}
}

func TestPublishWorkflowCommandExpandsTrustedRoutingFields(t *testing.T) {
	row := publishWorkflowRow{
		ID: 7, DocumentUUID: "doc-7", ReviewType: "对外发文", InitiatorUID: "u-7",
		TargetCategory: "department", DocumentTitle: "Outbound", DocumentDeptCode: sql.NullString{String: "D1", Valid: true},
		Extra: sql.NullString{String: `{"outsideFileLevel":"critical","needsOfficialSeal":true,"businessDeptCode":"B1","committeeDeptCode":"C1","upperLeaderId":"leader","committeeMode":"vote","committeeVoteType":"supermajority"}`, Valid: true},
	}
	command, _, err := publishWorkflowCommand(row)
	if err != nil {
		t.Fatal(err)
	}
	bizContext := command["bizContext"].(map[string]any)
	formData := command["formData"].(map[string]any)
	if bizContext["resource_dept_code"] != "D1" || bizContext["outside_file_level"] != "critical" || bizContext["committee_dept_code"] != "C1" {
		t.Fatalf("unexpected routing context: %#v", bizContext)
	}
	if formData["committee_mode"] != "vote" || formData["committee_vote_type"] != "supermajority" || formData["needs_official_seal"] != true {
		t.Fatalf("unexpected workflow form data: %#v", formData)
	}
}
