package aims

import (
	"context"
	io "github.com/huizhi-yun/data-runtime/internal/integrationoperation"
	"strings"
	"testing"
)

func TestContractMalformedReceiptRejectsBeforeDatabase(t *testing.T) {
	a, mock, closeDB := newAimsSQLMockAdapter(t)
	defer closeDB()
	body := map[string]any{io.ServiceCommandEnvelopeKey: map[string]any{}}
	for _, call := range []func() error{
		func() error { _, err := a.createProjectFromContractCommand(context.Background(), body); return err },
		func() error { _, err := a.syncPaymentMilestonesCommand(context.Background(), "PRJ", body); return err },
		func() error {
			_, err := a.executeAimsServiceReceipt(context.Background(), body, "op", "aims:write", nil)
			return err
		},
	} {
		if err := call(); err == nil || strings.Contains(err.Error(), "not expected") || strings.Contains(err.Error(), "expectations") {
			t.Fatalf("invalid envelope reached DB or accepted: %v", err)
		}
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}
