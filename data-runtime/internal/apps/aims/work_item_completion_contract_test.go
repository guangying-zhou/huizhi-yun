package aims

import (
	"net/url"
	"strings"
	"testing"
)

func TestWorkItemCompletionRequiresOriginalTargetReadiness(t *testing.T) {
	item := map[string]any{"tier": "target", "type": "task", "status": "in_progress"}
	children := []map[string]any{{"status": "completed"}}
	if err := validateWorkItemCompletionReady(item, children); err != nil {
		t.Fatal(err)
	}
	for _, change := range []map[string]any{{"tier": "matter"}, {"type": "requirement"}, {"status": "completed"}, {"status": "in_review"}, {"status": "planning"}} {
		bad := map[string]any{}
		for k, v := range item {
			bad[k] = v
		}
		for k, v := range change {
			bad[k] = v
		}
		if validateWorkItemCompletionReady(bad, children) == nil {
			t.Fatal("non-original completion action accepted", bad)
		}
	}
	if validateWorkItemCompletionReady(item, nil) == nil || validateWorkItemCompletionReady(item, []map[string]any{{"status": "todo"}}) == nil {
		t.Fatal("unfinished children accepted")
	}
}

func TestMatterCompletionReadinessMatchesExecutionPage(t *testing.T) {
	item := map[string]any{"tier": "matter", "type": "task", "status": "in_progress"}
	evidence := map[string]any{"deliverables": []map[string]any{{"deliverable_type": "artifact", "required": int64(1), "status": "pending", "evidence_note": "done"}}, "commits": []map[string]any{}, "timeEntries": []map[string]any{{"id": int64(1)}}}
	if err := validateMatterCompletionReady(item, evidence); err != nil {
		t.Fatal(err)
	}
	for _, badItem := range []map[string]any{{"tier": "target", "type": "task", "status": "in_progress"}, {"tier": "matter", "type": "requirement", "status": "in_progress"}, {"tier": "matter", "type": "task", "status": "in_review"}} {
		if validateMatterCompletionReady(badItem, evidence) == nil {
			t.Fatal("invalid matter accepted", badItem)
		}
	}
	for _, bad := range []map[string]any{
		{"deliverables": evidence["deliverables"], "commits": evidence["commits"], "timeEntries": []map[string]any{}},
		{"deliverables": []map[string]any{{"deliverable_type": "artifact", "required": int64(1), "status": "pending"}}, "commits": evidence["commits"], "timeEntries": evidence["timeEntries"]},
		{"deliverables": []map[string]any{{"deliverable_type": "document", "required": int64(1), "document_source": "repo", "repo_project_code": "repo"}}, "commits": evidence["commits"], "timeEntries": evidence["timeEntries"]},
		{"deliverables": []map[string]any{{"deliverable_type": "code", "required": int64(0)}}, "commits": evidence["commits"], "timeEntries": evidence["timeEntries"]},
	} {
		if validateMatterCompletionReady(item, bad) == nil {
			t.Fatal("incomplete matter evidence accepted", bad)
		}
	}
}

func TestWorkItemCompletionCallbackRejectsTrustAndEvidenceDrift(t *testing.T) {
	fresh := func() map[string]any {
		return map[string]any{"hzy_runtime_tenant_code": "T1", "hzy_runtime_deployment_code": "aims-test", "hzy_runtime_source_app": "aims", "hzy_runtime_service_client_id": "aims.runtime", "hzy_runtime_request_id": "r", "event": "flow_completed", "instance_id": 71, "instance_no": "WF71", "app_code": "aims", "resource_code": "tasks", "action_code": "complete", "biz_id": "9", "status": "approved", "initiator_uid": "U1", "idempotencyKey": "workflow:callback:71:flow_completed:approved", "approval_actor_uids": []string{"U9"}, "non_self_approval_actor_uids": []string{"U9"}, "approval_operator_uid": "U9", "form_data": map[string]any{"completionRequestId": 3, "workItemId": 9, "projectId": 2, "snapshotSha256": strings.Repeat("a", 64)}}
	}
	query := url.Values{"workflow_callback_verified": {"1"}}
	if _, err := VerifiedWorkItemCompletionCallbackFromTrustedRuntime(query, fresh()); err != nil {
		t.Fatal(err)
	}
	matter := fresh()
	matter["form_data"].(map[string]any)["kind"] = "matter"
	matter["form_data"].(map[string]any)["evidenceSummary"] = map[string]any{"deliverableCount": 1, "requiredDeliverableCount": 1, "commitCount": 0, "timeEntryCount": 1}
	if _, err := VerifiedWorkItemCompletionCallbackFromTrustedRuntime(query, matter); err != nil {
		t.Fatal("valid matter callback rejected", err)
	}
	matter["form_data"].(map[string]any)["kind"] = "unknown"
	if _, err := VerifiedWorkItemCompletionCallbackFromTrustedRuntime(query, matter); err == nil {
		t.Fatal("unknown completion kind accepted")
	}
	targetWithExplicitKind := fresh()
	targetWithExplicitKind["form_data"].(map[string]any)["kind"] = "target"
	if _, err := VerifiedWorkItemCompletionCallbackFromTrustedRuntime(query, targetWithExplicitKind); err == nil {
		t.Fatal("target callback with explicit kind accepted")
	}
	matterWithoutEvidence := fresh()
	matterWithoutEvidence["form_data"].(map[string]any)["kind"] = "matter"
	if _, err := VerifiedWorkItemCompletionCallbackFromTrustedRuntime(query, matterWithoutEvidence); err == nil {
		t.Fatal("matter callback without evidence summary accepted")
	}
	matter = fresh()
	matter["form_data"].(map[string]any)["kind"] = "matter"
	matter["form_data"].(map[string]any)["evidenceSummary"] = map[string]any{"deliverableCount": 1, "requiredDeliverableCount": 1, "commitCount": 0, "timeEntryCount": 1}
	matter["approval_actor_uids"] = []string{"U1"}
	matter["non_self_approval_actor_uids"] = []string{}
	matter["approval_operator_uid"] = "U1"
	if _, err := VerifiedWorkItemCompletionCallbackFromTrustedRuntime(query, matter); err == nil {
		t.Fatal("matter self-approval accepted")
	}
	if _, err := VerifiedWorkItemCompletionCallbackFromTrustedRuntime(nil, fresh()); err == nil {
		t.Fatal("browser callback accepted")
	}
	changes := []func(map[string]any){func(b map[string]any) { b["hzy_runtime_source_app"] = "enterprise" }, func(b map[string]any) { b["hzy_runtime_service_client_id"] = "enterprise.runtime" }, func(b map[string]any) { b["app_code"] = "altoc" }, func(b map[string]any) { b["resource_code"] = "milestones" }, func(b map[string]any) { b["action_code"] = "edit" }, func(b map[string]any) { b["biz_id"] = "8" }, func(b map[string]any) { b["status"] = "running" }, func(b map[string]any) { b["instance_no"] = "" }, func(b map[string]any) { b["idempotencyKey"] = "caller" }, func(b map[string]any) { b["form_data"].(map[string]any)["extra"] = true }, func(b map[string]any) { b["approval_actor_uids"] = nil }, func(b map[string]any) { b["non_self_approval_actor_uids"] = nil }, func(b map[string]any) { b["approval_operator_uid"] = "U1" }, func(b map[string]any) { b["non_self_approval_actor_uids"] = []string{"U8"} }, func(b map[string]any) { b["approval_actor_uids"] = []string{"U9", "U9"} }}
	for i, change := range changes {
		b := fresh()
		change(b)
		if _, err := VerifiedWorkItemCompletionCallbackFromTrustedRuntime(query, b); err == nil {
			t.Fatal("callback contract drift accepted", i)
		}
	}
}

func TestCompletionActorEvidenceMatchesWorkflowUIDContract(t *testing.T) {
	uid := strings.Repeat("人", 50)
	if actors := completionActorEvidence([]string{uid}); len(actors) != 1 || actors[0] != uid {
		t.Fatal("valid 50-character Workflow UID rejected")
	}
	for _, uid := range []string{strings.Repeat("a", 51), strings.Repeat("人", 51), "actor\x00uid", "actor\x7fuid", string([]byte{0xff}), " actor"} {
		if completionActorEvidence([]string{uid}) != nil {
			t.Fatalf("invalid Workflow UID accepted: %q", uid)
		}
	}
}
