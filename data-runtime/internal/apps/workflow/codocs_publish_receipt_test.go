package workflow

import "testing"

func TestCodocsPublishServiceContractIsFixed(t *testing.T) {
	if codocsPublishWorkflowOperationCode != "codocs.publish-request.workflow-submit.v1" || codocsPublishWorkflowCapability != "workflow:document-publish:create" || codocsPublishWorkflowCallback != "/api/reviews/workflow-callback" {
		t.Fatalf("unexpected Codocs publish service contract: %q %q %q", codocsPublishWorkflowOperationCode, codocsPublishWorkflowCapability, codocsPublishWorkflowCallback)
	}
}
