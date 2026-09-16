package aims

import (
	"os"
	"strings"
	"testing"
)

func TestProjectRequirementReviewsUseDedicatedHandlerBeforeGenericRuntime(t *testing.T) {
	contentBytes, err := os.ReadFile("workspace.go")
	if err != nil {
		t.Fatalf("read workspace.go: %v", err)
	}
	content := string(contentBytes)

	routeIndex := strings.Index(content, `pathParam(path, "/v1/aims/projects/", "/requirement-reviews")`)
	if routeIndex == -1 {
		t.Fatal("missing project requirement reviews dedicated route")
	}
	genericIndex := strings.Index(content, "handleProjectScopedGenericRuntime")
	if genericIndex == -1 {
		t.Fatal("missing project scoped generic runtime")
	}
	if routeIndex > genericIndex {
		t.Fatal("project requirement reviews must use dedicated handler before generic runtime")
	}
	if !strings.Contains(content[routeIndex:], "a.projectRequirementReviews(ctx, projectID, query)") {
		t.Fatal("project requirement reviews route must call dedicated handler")
	}
}

func TestProjectRequirementReviewsGuardAccessBeforeDataReads(t *testing.T) {
	contentBytes, err := os.ReadFile("requirement_reviews.go")
	if err != nil {
		t.Fatalf("read requirement_reviews.go: %v", err)
	}
	content := string(contentBytes)
	startIndex := strings.Index(content, "func (a *Adapter) projectRequirementReviews")
	if startIndex == -1 {
		t.Fatal("missing projectRequirementReviews")
	}
	segment := content[startIndex:]

	guardIndex := strings.Index(segment, "a.requireProjectReadAccess")
	batchesIndex := strings.Index(segment, "a.requirementReviewBatches")
	requirementsIndex := strings.Index(segment, "a.requirementReviewRequirementMap")

	if guardIndex == -1 {
		t.Fatal("expected project requirement review reads to require project read access")
	}
	for name, index := range map[string]int{
		"batches":      batchesIndex,
		"requirements": requirementsIndex,
	} {
		if index == -1 {
			t.Fatalf("missing %s data read", name)
		}
		if guardIndex > index {
			t.Fatalf("expected project read access guard before %s data read", name)
		}
	}
}

func TestRequirementReviewDetailUsesDedicatedGuardedRuntimeBeforeGenericFallback(t *testing.T) {
	contentBytes, err := os.ReadFile("workspace.go")
	if err != nil {
		t.Fatalf("read workspace.go: %v", err)
	}
	content := string(contentBytes)

	routeIndex := strings.Index(content, `directPathParam(path, "/v1/aims/requirement-reviews/")`)
	if routeIndex == -1 {
		t.Fatal("missing direct requirement review detail route")
	}
	genericIndex := strings.Index(content, "handleProjectScopedGenericRuntime")
	if genericIndex == -1 {
		t.Fatal("missing project scoped generic runtime")
	}
	if routeIndex > genericIndex {
		t.Fatal("requirement review detail route must run before generic runtime fallback")
	}
	if !strings.Contains(content[routeIndex:], "a.requirementReviewBatchDetail(ctx, batchID, query)") {
		t.Fatal("requirement review detail route must call guarded dedicated handler")
	}
}

func TestRequirementReviewDetailGuardsAfterProjectResolutionBeforeResponse(t *testing.T) {
	contentBytes, err := os.ReadFile("requirement_reviews.go")
	if err != nil {
		t.Fatalf("read requirement_reviews.go: %v", err)
	}
	content := string(contentBytes)
	startIndex := strings.Index(content, "func (a *Adapter) requirementReviewBatchDetail")
	if startIndex == -1 {
		t.Fatal("missing requirementReviewBatchDetail")
	}
	segment := content[startIndex:]

	loadIndex := strings.Index(segment, "a.loadRequirementReviewBatch")
	guardIndex := strings.Index(segment, "a.requireProjectMemberOrScopedAdmin(ctx, batch.projectID, uid, query)")
	returnIndex := strings.Index(segment, "return map[string]any")
	for name, index := range map[string]int{
		"batch load": loadIndex,
		"guard":      guardIndex,
		"response":   returnIndex,
	} {
		if index == -1 {
			t.Fatalf("missing %s", name)
		}
	}
	if loadIndex > guardIndex {
		t.Fatal("requirement review detail must resolve project before project access guard")
	}
	if guardIndex > returnIndex {
		t.Fatal("requirement review detail must guard before returning batch facts")
	}
}

func TestRequirementReviewCreateAndSyncUseDedicatedRuntimeBeforeGenericFallback(t *testing.T) {
	contentBytes, err := os.ReadFile("workspace.go")
	if err != nil {
		t.Fatalf("read workspace.go: %v", err)
	}
	content := string(contentBytes)
	postIndex := strings.Index(content, "if method == http.MethodPost {")
	if postIndex == -1 {
		t.Fatal("missing POST branch")
	}
	postSegment := content[postIndex:]
	createIndex := strings.Index(postSegment, "a.createRequirementReviewBatch(ctx, projectID, query, body)")
	syncIndex := strings.Index(postSegment, "a.syncRequirementReviewWorkflow(ctx, batchID, query, body)")
	genericIndex := strings.Index(postSegment, "handleProjectScopedGenericRuntime")
	if createIndex == -1 {
		t.Fatal("missing requirement review create runtime route")
	}
	if syncIndex == -1 {
		t.Fatal("missing requirement review sync workflow runtime route")
	}
	if genericIndex != -1 && createIndex > genericIndex {
		t.Fatal("requirement review create route must run before generic runtime fallback")
	}
}

func TestRequirementReviewCreateAndSyncGuardBeforeWrites(t *testing.T) {
	contentBytes, err := os.ReadFile("requirement_reviews.go")
	if err != nil {
		t.Fatalf("read requirement_reviews.go: %v", err)
	}
	content := string(contentBytes)
	for _, tt := range []struct {
		name       string
		startToken string
		guardToken string
		writeToken string
	}{
		{
			name:       "create",
			startToken: "func (a *Adapter) createRequirementReviewBatch",
			guardToken: "a.requireProjectUpdateAccess",
			writeToken: "INSERT INTO requirement_review_batches",
		},
		{
			name:       "sync",
			startToken: "func (a *Adapter) syncRequirementReviewWorkflow",
			guardToken: "a.requireProjectUpdateAccess",
			writeToken: "UPDATE requirement_review_batches",
		},
	} {
		t.Run(tt.name, func(t *testing.T) {
			startIndex := strings.Index(content, tt.startToken)
			if startIndex == -1 {
				t.Fatalf("missing %s", tt.startToken)
			}
			segment := content[startIndex:]
			guardIndex := strings.Index(segment, tt.guardToken)
			writeIndex := strings.Index(segment, tt.writeToken)
			if guardIndex == -1 {
				t.Fatalf("missing %s", tt.guardToken)
			}
			if writeIndex == -1 {
				t.Fatalf("missing %s", tt.writeToken)
			}
			if guardIndex > writeIndex {
				t.Fatalf("%s must run before %s", tt.guardToken, tt.writeToken)
			}
		})
	}
}
