package productcenter

import (
	"context"
	"github.com/huizhi-yun/data-runtime/internal/integrationoperation"
	"testing"
)

func TestHostSourceStopsDiscardedFeedbackProducersBeforeDatabase(t *testing.T) {
	trusted := integrationoperation.TrustedContext{RetireAPFCommands: true}
	if err := enqueueFeedbackProgressTx(context.Background(), nil, trusted, "actor", "product", 1, 1); err != nil {
		t.Fatal(err)
	}
	if err := enqueueFeedbackDecisionTx(context.Background(), nil, trusted, "actor", "product", 1, "canonical", "accepted", 1); err != nil {
		t.Fatal(err)
	}
}
