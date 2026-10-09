package codocs

import (
	"context"
	"testing"
)

func TestDocumentPreviewAccessFailsClosedWithoutSignedServiceCommand(t *testing.T) {
	adapter := &Adapter{}

	_, err := adapter.grantDocumentPreviewAccess(context.Background(), "known-document", map[string]any{
		"actorUid":          "forged-user",
		"sourceApp":         "aims",
		"sourceProjectCode": "PROJECT-1",
	})
	if err == nil {
		t.Fatal("raw preview-access payload must not create a document relation")
	}
}
