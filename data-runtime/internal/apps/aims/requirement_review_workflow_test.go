package aims

import (
	"context"
	"errors"
	"fmt"
	"github.com/DATA-DOG/go-sqlmock"
	"github.com/huizhi-yun/data-runtime/internal/httperror"
	"net/url"
	"strings"
	"testing"
)

func frozenReviewFixture() (requirementReviewBatchRow, map[string]any) {
	actor := "actor"
	binding := "rrb:42:" + strings.Repeat("a", 64)
	batch := requirementReviewBatchRow{id: 9, projectID: 263, batchType: "baseline", submittedBy: &actor, workflowInstanceID: &binding}
	return batch, map[string]any{"id": int64(42), "app_code": "aims", "resource_code": "requirements", "action_code": "requirement_baseline", "biz_id": "9", "initiator_uid": "actor", "status": "approved", "form_data": reviewWorkflowForm(batch, strings.Repeat("a", 64))}
}
func TestRequirementReviewWorkflowBindingMatrix(t *testing.T) {
	batch, instance := frozenReviewFixture()
	if err := validateReviewWorkflowInstance(batch, strings.Repeat("a", 64), instance); err != nil {
		t.Fatal(err)
	}
	for _, key := range []string{"id", "app_code", "resource_code", "action_code", "biz_id", "initiator_uid", "form_data"} {
		t.Run(key, func(t *testing.T) {
			bad := map[string]any{}
			for k, v := range instance {
				bad[k] = v
			}
			bad[key] = "forged"
			if validateReviewWorkflowInstance(batch, strings.Repeat("a", 64), bad) == nil {
				t.Fatal("forged binding accepted")
			}
		})
	}
	for _, action := range []string{"review-sync", "review-create-tasks"} {
		for _, field := range []string{"workflowInstanceId", "status", "approvedBy", "result", "formData"} {
			if validateEnterpriseRequirementPayload(action, map[string]any{field: "forged"}) == nil {
				t.Fatal("browser result accepted", action, field)
			}
		}
	}
	a := &Adapter{}
	_, err := a.applyRequirementReviewWorkflowCallback(context.Background(), url.Values{}, map[string]any{})
	var h httperror.Error
	if !errors.As(err, &h) || h.Status != 403 {
		t.Fatal(err)
	}
}
func TestRequirementReviewTaskReceiptKeepsSummary(t *testing.T) {
	value := map[string]any{"batchId": int64(9), "createdCount": int64(1000), "skippedCount": int64(0)}
	code := requirementReceiptCode("263", "9", "review-create-tasks", value)
	if len(code) > 191 {
		t.Fatal(len(code))
	}
	out, err := requirementReceiptValue("263", "9", "review-create-tasks", code, nil)
	if err != nil || out["createdCount"] != float64(1000) {
		t.Fatal(out, err)
	}
}

func TestRequirementReviewRawApprovalCannotBypassCallback(t *testing.T) {
	a := &Adapter{enterpriseWrites: &enterpriseWriteBinding{}}
	q := url.Values{"current_user": {"actor"}, "workflow_callback_verified": {"1"}}
	for _, approve := range []bool{true, false} {
		var err error
		if approve {
			_, err = a.approveRequirementReviewBatch(context.Background(), "9", q, nil)
		} else {
			_, err = a.rejectRequirementReviewBatch(context.Background(), "9", q)
		}
		var h httperror.Error
		if !errors.As(err, &h) || h.Status != 403 {
			t.Fatal("raw route bypassed formal result", err)
		}
	}
	batch, _ := frozenReviewFixture()
	legacy := &Adapter{}
	if err := legacy.requireRequirementReviewResultContext(context.Background(), &batch); err == nil {
		t.Fatal("frozen review accepted standalone bypass")
	}
	if err := legacy.requireRequirementReviewResultContext(context.Background(), nil); err != nil {
		t.Fatal("independent historical behavior changed", err)
	}
}

type requirementReviewReaderFunc func(context.Context, string, string, string, string) (map[string]any, error)

func (r requirementReviewReaderFunc) ReadAimsRequirementReviewInstance(c context.Context, b, i, a, v string) (map[string]any, error) {
	return r(c, b, i, a, v)
}
func (r requirementReviewReaderFunc) ReadProjectLifecycleInstance(context.Context, string) (ProjectLifecycleInstance, error) {
	panic("unexpected lifecycle read")
}

func TestRequirementWorkflowReaderPreservesClientErrors(t *testing.T) {
	for _, status := range []int{400, 401, 403, 404, 409, 429, 500, 503} {
		t.Run(fmt.Sprint(status), func(t *testing.T) {
			a, m, done := newAimsSQLMockAdapter(t)
			defer done()
			m.ExpectQuery("SELECT id, project_id, title, batch_type, status, workflow_instance_id, submitted_by, requirement_ids_json").WithArgs(int64(9)).WillReturnRows(sqlmock.NewRows([]string{"id", "project", "title", "type", "status", "instance", "actor", "ids"}).AddRow(9, 263, "Review", "baseline", "pending", "rrb:42:"+strings.Repeat("a", 64), "actor", "[1]"))
			original := httperror.New(status, "reader_fixed_code", "safe")
			a.ConfigureWorkflowInstanceReader(requirementReviewReaderFunc(func(_ context.Context, b, i, u, action string) (map[string]any, error) {
				if b != "9" || i != "42" || u != "actor" || action != "requirement_baseline" {
					t.Fatal(b, i, u, action)
				}
				return nil, original
			}))
			_, err := a.readRequirementReviewWorkflow(context.Background(), "9")
			var h httperror.Error
			want := status
			if want >= 500 {
				want = 503
			}
			if !errors.As(err, &h) || h.Status != want {
				t.Fatal(err)
			}
			if status < 500 && h.Code != "reader_fixed_code" {
				t.Fatal("4xx code lost", h)
			}
			if err := m.ExpectationsWereMet(); err != nil {
				t.Fatal(err)
			}
		})
	}
}
func TestRequirementWorkflowBindingEncoding(t *testing.T) {
	for _, id := range []string{"pending", "42"} {
		raw := "rrb:" + id + ":" + strings.Repeat("a", 64)
		got, hash, frozen := reviewWorkflowBinding(&raw)
		if got != id || len(hash) != 64 || !frozen {
			t.Fatal(got, hash, frozen)
		}
	}
	for _, raw := range []string{"42", "rrb:0:" + strings.Repeat("a", 64), "rrb:42:invalid"} {
		id, _, frozen := reviewWorkflowBinding(&raw)
		if frozen || id != raw {
			t.Fatal("legacy guessed", raw)
		}
	}
}
