package aims

import (
	"context"
	"net/url"
	"strings"
	"testing"
)

func TestEnterpriseRequirementExtendedReceiptFreezesResults(t *testing.T) {
	for action, value := range map[string]map[string]any{
		"change-create":   {"id": int64(7), "reqCode": "R1B-REQ-003", "parentRequirementId": int64(6), "changeNo": int64(1), "status": "draft"},
		"task-create":     {"taskId": int64(8), "itemKey": "R1B-1", "title": "中文任务", "milestoneId": int64(5), "status": "todo"},
		"review-create":   {"batchId": int64(9), "batchType": "baseline", "title": "需求基线评审", "requirementCount": 1, "status": "pending"},
		"review-append":   {"batchId": int64(9), "appendedCount": 1, "totalCount": 2},
		"review-withdraw": {"batchId": int64(9), "deleted": true, "status": "withdrawn"},
	} {
		t.Run(action, func(t *testing.T) {
			code := requirementReceiptCode("981101", "7", action, value)
			if len(code) > 191 {
				t.Fatalf("ordinary %s outcome exceeds receipt limit: %d", action, len(code))
			}
			result, err := requirementReceiptValue("981101", "7", action, code, nil)
			if err != nil {
				t.Fatal(err)
			}
			for key := range value {
				if _, ok := result[key]; !ok {
					t.Fatalf("lost frozen outcome %s", key)
				}
			}
			for _, parts := range [][3]string{{"other", "7", action}, {"981101", "8", action}, {"981101", "7", "other"}} {
				if _, err := requirementReceiptValue(parts[0], parts[1], parts[2], code, nil); err == nil {
					t.Fatal("cross-binding receipt accepted")
				}
			}
		})
	}
	for _, code := range []string{"r2.invalid", "r2." + strings.Repeat("A", 200)} {
		if _, e := requirementReceiptValue("1", "2", "task-create", code, nil); e == nil {
			t.Fatal("malformed receipt accepted")
		}
	}
}
func TestEnterpriseRequirementPreparedReviewCannotInjectResults(t *testing.T) {
	for _, action := range []string{"change-create", "task-create", "review-create", "review-append", "review-withdraw"} {
		for _, field := range []string{"approvedBy", "workflowInstanceId", "status", "result", "submittedBy", "project_id", "current_user"} {
			if validateEnterpriseRequirementPayload(action, map[string]any{field: "forged"}) == nil {
				t.Fatalf("%s accepted %s", action, field)
			}
		}
	}
	for _, body := range []map[string]any{{"batchType": "approved", "requirementIds": []any{float64(1)}}, {"batchType": "baseline", "requirementIds": []any{1.5}}, {"batchType": "baseline", "requirementIds": []any{"not-id"}}} {
		if validateEnterpriseRequirementPayload("review-create", body) == nil {
			t.Fatal("invalid review payload accepted")
		}
	}
	if err := validateEnterpriseRequirementPayload("review-create", map[string]any{"batchType": "baseline", "requirementIds": []any{float64(1)}}); err != nil {
		t.Fatal(err)
	}
}
func TestEnterpriseRequirementBoundManagementIdentityCannotCrossProject(t *testing.T) {
	a := &Adapter{}
	ctx := context.WithValue(context.Background(), enterpriseRequirementIdentityKey{}, enterpriseRequirementIdentity{"actor", 263})
	if err := a.requireRequirementBoundProjectManagerOrScopedAdmin(ctx, 263, "actor", url.Values{}); err != nil {
		t.Fatal(err)
	}
	for _, args := range []struct {
		project int64
		uid     string
	}{{264, "actor"}, {263, "Actor"}} {
		if err := a.requireRequirementBoundProjectManagerOrScopedAdmin(ctx, args.project, args.uid, nil); err == nil {
			t.Fatal("mismatched management identity accepted")
		}
	}
}
