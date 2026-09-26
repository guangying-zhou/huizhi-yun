package enterprisescheduler

import (
	"context"
	"errors"
	"testing"

	io "github.com/huizhi-yun/data-runtime/internal/integrationoperation"
)

var errFakeResponseLost = errors.New("fake provider response lost after commit")

type fakeRecoverableProvider struct {
	receipts  map[string]io.ReceiptEvidence
	mutations *int
	loseNext  bool
}

func (p *fakeRecoverableProvider) LookupReceipt(_ context.Context, expected io.ReceiptEvidence) (*io.ReceiptEvidence, error) {
	receipt, ok := p.receipts[expected.IdempotencyKey]
	if !ok {
		return nil, nil
	}
	return &receipt, nil
}

func (p *fakeRecoverableProvider) Deliver(_ context.Context, expected io.ReceiptEvidence, _ []byte) (io.ReceiptEvidence, error) {
	*p.mutations = *p.mutations + 1
	receipt := expected
	receipt.ReceiptID = "11111111-1111-4111-8111-111111111111"
	p.receipts[expected.IdempotencyKey] = receipt
	if p.loseNext {
		p.loseNext = false
		return io.ReceiptEvidence{}, errFakeResponseLost
	}
	return receipt, nil
}

func TestDeliverOrRecoverUsesTargetReceiptAfterResponseLoss(t *testing.T) {
	mutations := 0
	store := map[string]io.ReceiptEvidence{}
	expected := io.ReceiptEvidence{
		OperationID: "01K598ZY6ZY1M0NE3X8KYCCN1A", OperationCode: "aims.work-item.ticket-result.v1",
		IdempotencyKey: "ticket-response-lost", CommandSchemaVersion: "v1",
		CommandSHA256: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
		TargetBizType: "service_ticket", TargetBizCode: "ST-1",
		ResponseSummarySHA256: "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
	}
	firstWorker := &fakeRecoverableProvider{receipts: store, mutations: &mutations, loseNext: true}
	if _, _, err := DeliverOrRecover(context.Background(), firstWorker, expected, []byte(`{"ticketCode":"ST-1"}`)); !errors.Is(err, errFakeResponseLost) {
		t.Fatal("expected simulated lost response", err)
	}
	// A new worker process has no memory from the first attempt. Its provider
	// client queries the target's durable receipt store with the same identity.
	restartedWorker := &fakeRecoverableProvider{receipts: store, mutations: &mutations}
	receipt, recovered, err := DeliverOrRecover(context.Background(), restartedWorker, expected, []byte(`{"ticketCode":"ST-1"}`))
	if err != nil || !recovered || receipt.ReceiptID == "" || mutations != 1 {
		t.Fatalf("receipt recovery failed: recovered=%v mutations=%d receipt=%+v err=%v", recovered, mutations, receipt, err)
	}
}

func TestDeliverOrRecoverFailsClosedWithManualRecordForLegacyIdentity(t *testing.T) {
	mutations := 0
	provider := &fakeRecoverableProvider{receipts: map[string]io.ReceiptEvidence{}, mutations: &mutations}
	legacy := io.ReceiptEvidence{OperationID: "legacy-17", OperationCode: "legacy.ticket", IdempotencyKey: "legacy-key", CommandSchemaVersion: "v0"}
	_, _, err := DeliverOrRecover(context.Background(), provider, legacy, []byte(`{"legacy":true}`))
	var manual *ManualRecoveryRequiredError
	if !errors.As(err, &manual) || manual.Record.OperationID != "legacy-17" || manual.Record.Reason == "" || mutations != 0 {
		t.Fatalf("legacy command did not fail closed: record=%+v mutations=%d err=%v", manual, mutations, err)
	}
}
