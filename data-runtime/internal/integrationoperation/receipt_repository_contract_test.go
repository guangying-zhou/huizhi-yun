package integrationoperation

import (
	"context"
	"crypto/sha256"
	"database/sql"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"testing"

	"github.com/DATA-DOG/go-sqlmock"
)

const (
	receiptID   = "660e8400-e29b-41d4-a716-446655440000"
	operationID = "550e8400-e29b-41d4-a716-446655440000"
)

var receiptSelectPattern = `(?s)SELECT.*receipt_id.*operation_id.*required_capability.*command_schema_version.*command_sha256.*status.*target_biz_type.*target_biz_code.*response_http_status.*response_summary_sha256.*version_no.*FROM service_command_receipt.*WHERE tenant_code = \?.*source_deployment_code = \?.*deployment_code = \?.*source_app = \?.*target_app = \?.*operation_code = \?.*idempotency_key = \?.*FOR UPDATE`

func TestReceiptExecuteCommitsBusinessEffectAndReceiptThenAckLossRetryReturnsExisting(t *testing.T) {
	database, mock, err := sqlmock.New()
	if err != nil {
		t.Fatalf("sqlmock.New: %v", err)
	}
	defer database.Close()
	repository, err := NewReceiptRepository(database, WithReceiptIDGenerator(func() (string, error) { return receiptID, nil }))
	if err != nil {
		t.Fatalf("NewReceiptRepository: %v", err)
	}
	input := validReceiptCommandInput(t)
	handlerCalls := 0

	// First delivery: receipt processing + business mutation + receipt succeeded
	// are one transaction and one commit boundary.
	mock.ExpectBegin()
	mock.ExpectQuery(receiptSelectPattern).
		WithArgs("TENANT-A", "DEPLOYMENT-A", "DEPLOYMENT-A", "aims", "assets", "assets.delivery.link_document.v1", "delivery:ASSET-1").
		WillReturnRows(receiptRows())
	mock.ExpectExec(`(?s)INSERT INTO service_command_receipt.*receipt_id.*operation_id.*operation_code.*tenant_code.*deployment_code.*source_app.*target_app.*required_capability.*idempotency_key.*command_schema_version.*command_sha256.*status.*fencing_token.*version_no.*first_request_id.*last_request_id.*correlation_id.*original_actor_uid.*service_client_id.*VALUES`).
		WithArgs(
			receiptID, operationID, "assets.delivery.link_document.v1",
			"TENANT-A", "DEPLOYMENT-A", "DEPLOYMENT-A", "aims", "assets",
			"assets.delivery.write", "delivery:ASSET-1", "v1", input.CommandSHA256,
			"REQ-1", "REQ-1", nil, nil, "aims-runtime",
		).
		WillReturnResult(sqlmock.NewResult(0, 1))
	mock.ExpectExec(`INSERT INTO receipt_contract_business_effect`).
		WithArgs("ASSET-1").
		WillReturnResult(sqlmock.NewResult(1, 1))
	mock.ExpectExec(`(?s)UPDATE service_command_receipt.*SET status = 'succeeded'.*target_biz_type = \?.*target_biz_code = \?.*response_http_status = \?.*completed_at.*version_no = version_no \+ 1.*WHERE receipt_id = \?.*status = 'processing'`).
		WithArgs("asset", "ASSET-1", 200, sqlmock.AnyArg(), receiptID).
		WillReturnResult(sqlmock.NewResult(0, 1))
	mock.ExpectCommit()

	first, err := repository.Execute(context.Background(), input, func(ctx context.Context, tx *sql.Tx, command json.RawMessage) (ReceiptBusinessResult, error) {
		handlerCalls++
		if string(command) != string(input.Command) {
			t.Fatalf("handler command = %s, want frozen command %s", command, input.Command)
		}
		if _, err := tx.ExecContext(ctx, `INSERT INTO receipt_contract_business_effect (asset_code) VALUES (?)`, "ASSET-1"); err != nil {
			return ReceiptBusinessResult{}, err
		}
		return ReceiptBusinessResult{TargetBizType: "asset", TargetBizCode: "ASSET-1", HTTPStatus: 200}, nil
	})
	if err != nil {
		t.Fatalf("first Execute: %v", err)
	}
	if first.Existing {
		t.Fatal("first Execute Existing = true, want false")
	}
	if first.TargetBizType != "asset" || first.TargetBizCode != "ASSET-1" {
		t.Fatalf("first target business key = %s/%s", first.TargetBizType, first.TargetBizCode)
	}

	// Simulate source acknowledgement loss: the caller retries the exact frozen
	// command under a new request ID. The target must return the prior business
	// key without invoking the handler (and therefore without a second business
	// mutation).
	retryInput := input
	retryInput.TrustedContext.RequestID = "REQ-2"
	mock.ExpectBegin()
	mock.ExpectQuery(receiptSelectPattern).
		WithArgs("TENANT-A", "DEPLOYMENT-A", "DEPLOYMENT-A", "aims", "assets", "assets.delivery.link_document.v1", "delivery:ASSET-1").
		WillReturnRows(succeededReceiptRows(input))
	mock.ExpectExec(`(?s)UPDATE service_command_receipt.*SET last_request_id = \?.*last_received_at.*WHERE receipt_id = \?`).
		WithArgs("REQ-2", receiptID, 1).
		WillReturnResult(sqlmock.NewResult(0, 1))
	mock.ExpectCommit()

	recovered, err := repository.Execute(context.Background(), retryInput, func(context.Context, *sql.Tx, json.RawMessage) (ReceiptBusinessResult, error) {
		handlerCalls++
		return ReceiptBusinessResult{}, errors.New("handler must not run for a succeeded receipt")
	})
	if err != nil {
		t.Fatalf("ack-loss retry Execute: %v", err)
	}
	if !recovered.Existing {
		t.Fatal("ack-loss retry Existing = false, want true")
	}
	if recovered.TargetBizType != "asset" || recovered.TargetBizCode != "ASSET-1" {
		t.Fatalf("recovered target business key = %s/%s", recovered.TargetBizType, recovered.TargetBizCode)
	}
	if handlerCalls != 1 {
		t.Fatalf("handler calls = %d, want exactly 1 across original delivery and retry", handlerCalls)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatalf("atomic receipt/ack-loss SQL contract: %v", err)
	}
}

func TestReceiptExecuteConcurrentSameIdentityUsesWinningReceiptWithoutRunningHandler(t *testing.T) {
	database, mock, err := sqlmock.New()
	if err != nil {
		t.Fatalf("sqlmock.New: %v", err)
	}
	defer database.Close()
	repository, err := NewReceiptRepository(database, WithReceiptIDGenerator(func() (string, error) { return receiptID, nil }))
	if err != nil {
		t.Fatalf("NewReceiptRepository: %v", err)
	}
	input := validReceiptCommandInput(t)
	handlerCalls := 0

	mock.ExpectBegin()
	mock.ExpectQuery(receiptSelectPattern).
		WithArgs("TENANT-A", "DEPLOYMENT-A", "DEPLOYMENT-A", "aims", "assets", "assets.delivery.link_document.v1", "delivery:ASSET-1").
		WillReturnRows(receiptRows())
	mock.ExpectExec(`(?s)INSERT INTO service_command_receipt.*ON DUPLICATE KEY UPDATE`).
		WillReturnResult(sqlmock.NewResult(0, 0))
	mock.ExpectQuery(receiptSelectPattern).
		WithArgs("TENANT-A", "DEPLOYMENT-A", "DEPLOYMENT-A", "aims", "assets", "assets.delivery.link_document.v1", "delivery:ASSET-1").
		WillReturnRows(succeededReceiptRows(input))
	mock.ExpectExec(`(?s)UPDATE service_command_receipt.*SET last_request_id = \?.*last_received_at.*WHERE receipt_id = \?`).
		WithArgs("REQ-1", receiptID, 1).
		WillReturnResult(sqlmock.NewResult(0, 1))
	mock.ExpectCommit()

	result, err := repository.Execute(context.Background(), input, func(context.Context, *sql.Tx, json.RawMessage) (ReceiptBusinessResult, error) {
		handlerCalls++
		return ReceiptBusinessResult{}, errors.New("handler must not run after a concurrent receipt wins")
	})
	if err != nil {
		t.Fatalf("Execute concurrent identity: %v", err)
	}
	if !result.Existing || result.ReceiptID != receiptID || result.TargetBizCode != "ASSET-1" {
		t.Fatalf("concurrent result = %+v, want winning succeeded receipt", result)
	}
	if handlerCalls != 0 {
		t.Fatalf("handler calls = %d, want 0", handlerCalls)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatalf("concurrent receipt SQL contract: %v", err)
	}
}

func TestReceiptExecuteRepairsHistoricalSucceededReceiptSummaryWithoutRunningHandler(t *testing.T) {
	database, mock, err := sqlmock.New()
	if err != nil {
		t.Fatalf("sqlmock.New: %v", err)
	}
	defer database.Close()
	repository, err := NewReceiptRepository(database)
	if err != nil {
		t.Fatalf("NewReceiptRepository: %v", err)
	}
	input := validReceiptCommandInput(t)
	handlerCalls := 0
	wantDigest, err := ValidateAndDigestCommand(map[string]any{
		"targetBizType": "asset",
		"targetBizCode": "ASSET-1",
	})
	if err != nil {
		t.Fatalf("target business digest: %v", err)
	}

	mock.ExpectBegin()
	mock.ExpectQuery(receiptSelectPattern).
		WithArgs("TENANT-A", "DEPLOYMENT-A", "DEPLOYMENT-A", "aims", "assets", "assets.delivery.link_document.v1", "delivery:ASSET-1").
		WillReturnRows(receiptRows().AddRow(
			receiptID, operationID, "assets.delivery.write", "v1", input.CommandSHA256,
			"succeeded", "asset", "ASSET-1", 200, nil, 7,
		))
	mock.ExpectExec(`(?s)UPDATE service_command_receipt.*SET response_summary_sha256 = \?.*last_request_id = \?.*last_received_at.*version_no = version_no \+ 1.*WHERE receipt_id = \?.*status = 'succeeded'.*version_no = \?.*response_summary_sha256 IS NULL OR response_summary_sha256 = ''`).
		WithArgs(wantDigest, "REQ-1", receiptID, 7).
		WillReturnResult(sqlmock.NewResult(0, 1))
	mock.ExpectCommit()

	result, err := repository.Execute(context.Background(), input, func(context.Context, *sql.Tx, json.RawMessage) (ReceiptBusinessResult, error) {
		handlerCalls++
		return ReceiptBusinessResult{}, errors.New("historical succeeded receipt must not rerun business handler")
	})
	if err != nil {
		t.Fatalf("Execute historical succeeded receipt: %v", err)
	}
	if !result.Existing || result.ResponseSummarySHA256 != wantDigest {
		t.Fatalf("repaired receipt = %+v, want Existing with response summary %s", result, wantDigest)
	}
	if handlerCalls != 0 {
		t.Fatalf("handler calls = %d, want 0", handlerCalls)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatalf("historical receipt repair SQL: %v", err)
	}
}

func TestReceiptExecuteDoesNotRepairHistoricalReceiptWithoutBusinessKeyOrSucceededStatus(t *testing.T) {
	input := validReceiptCommandInput(t)
	tests := []struct {
		name          string
		status        string
		targetBizType any
		targetBizCode any
		want          error
	}{
		{name: "missing target business key", status: "succeeded", targetBizType: nil, targetBizCode: nil, want: ErrCorruptOperation},
		{name: "processing status", status: "processing", targetBizType: "asset", targetBizCode: "ASSET-1", want: ErrReceiptInProgress},
		{name: "rejected status", status: "rejected", targetBizType: "asset", targetBizCode: "ASSET-1", want: ErrReceiptRejected},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			database, mock, err := sqlmock.New()
			if err != nil {
				t.Fatalf("sqlmock.New: %v", err)
			}
			defer database.Close()
			repository, err := NewReceiptRepository(database)
			if err != nil {
				t.Fatalf("NewReceiptRepository: %v", err)
			}
			handlerCalls := 0

			mock.ExpectBegin()
			mock.ExpectQuery(receiptSelectPattern).
				WithArgs("TENANT-A", "DEPLOYMENT-A", "DEPLOYMENT-A", "aims", "assets", "assets.delivery.link_document.v1", "delivery:ASSET-1").
				WillReturnRows(receiptRows().AddRow(
					receiptID, operationID, "assets.delivery.write", "v1", input.CommandSHA256,
					tt.status, tt.targetBizType, tt.targetBizCode, 200, nil, 7,
				))
			mock.ExpectRollback()

			_, err = repository.Execute(context.Background(), input, func(context.Context, *sql.Tx, json.RawMessage) (ReceiptBusinessResult, error) {
				handlerCalls++
				return ReceiptBusinessResult{}, nil
			})
			if !errors.Is(err, tt.want) {
				t.Fatalf("Execute error = %v, want %v", err, tt.want)
			}
			if handlerCalls != 0 {
				t.Fatalf("handler calls = %d, want 0", handlerCalls)
			}
			if err := mock.ExpectationsWereMet(); err != nil {
				t.Fatalf("unsafe historical receipt must not be repaired: %v", err)
			}
		})
	}
}

func TestReceiptExecuteSameKeyWithFrozenIdentityOrPayloadMismatchRollsBackWithoutHandler(t *testing.T) {
	base := validReceiptCommandInput(t)
	tests := []struct {
		name   string
		mutate func(t *testing.T, input *ReceiptCommandInput)
	}{
		{
			name: "command hash",
			mutate: func(t *testing.T, input *ReceiptCommandInput) {
				input.Command = json.RawMessage(`{"assetCode":"ASSET-2"}`)
				input.CommandSHA256 = commandDigest(t, input.Command)
			},
		},
		{name: "operation id", mutate: func(_ *testing.T, input *ReceiptCommandInput) {
			input.OperationID = "770e8400-e29b-41d4-a716-446655440000"
		}},
		{name: "schema", mutate: func(_ *testing.T, input *ReceiptCommandInput) { input.CommandSchemaVersion = "v2" }},
		{name: "capability", mutate: func(_ *testing.T, input *ReceiptCommandInput) { input.RequiredCapability = "assets.admin" }},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			database, mock, err := sqlmock.New()
			if err != nil {
				t.Fatalf("sqlmock.New: %v", err)
			}
			defer database.Close()
			repository, err := NewReceiptRepository(database)
			if err != nil {
				t.Fatalf("NewReceiptRepository: %v", err)
			}
			input := base
			tt.mutate(t, &input)
			handlerCalls := 0

			mock.ExpectBegin()
			mock.ExpectQuery(receiptSelectPattern).
				WithArgs("TENANT-A", "DEPLOYMENT-A", "DEPLOYMENT-A", "aims", "assets", "assets.delivery.link_document.v1", "delivery:ASSET-1").
				WillReturnRows(succeededReceiptRows(base))
			mock.ExpectRollback()

			_, err = repository.Execute(context.Background(), input, func(context.Context, *sql.Tx, json.RawMessage) (ReceiptBusinessResult, error) {
				handlerCalls++
				return ReceiptBusinessResult{}, nil
			})
			if !errors.Is(err, ErrIdempotencyPayloadMismatch) {
				t.Fatalf("Execute mismatch error = %v, want ErrIdempotencyPayloadMismatch (HTTP adapter maps this to 409)", err)
			}
			if handlerCalls != 0 {
				t.Fatalf("handler calls = %d, want 0 for mismatch", handlerCalls)
			}
			if err := mock.ExpectationsWereMet(); err != nil {
				t.Fatalf("mismatch must rollback without business side effect: %v", err)
			}
		})
	}
}

func TestReceiptExecuteHandlerFailureRollsBackProcessingReceiptAndBusinessTransaction(t *testing.T) {
	database, mock, err := sqlmock.New()
	if err != nil {
		t.Fatalf("sqlmock.New: %v", err)
	}
	defer database.Close()
	repository, err := NewReceiptRepository(database)
	if err != nil {
		t.Fatalf("NewReceiptRepository: %v", err)
	}
	input := validReceiptCommandInput(t)
	wantErr := errors.New("business write failed")

	mock.ExpectBegin()
	mock.ExpectQuery(receiptSelectPattern).
		WithArgs("TENANT-A", "DEPLOYMENT-A", "DEPLOYMENT-A", "aims", "assets", "assets.delivery.link_document.v1", "delivery:ASSET-1").
		WillReturnRows(receiptRows())
	mock.ExpectExec(`(?s)INSERT INTO service_command_receipt.*status.*VALUES`).
		WillReturnResult(sqlmock.NewResult(0, 1))
	mock.ExpectRollback()

	_, err = repository.Execute(context.Background(), input, func(context.Context, *sql.Tx, json.RawMessage) (ReceiptBusinessResult, error) {
		return ReceiptBusinessResult{}, wantErr
	})
	if !errors.Is(err, wantErr) {
		t.Fatalf("Execute handler failure = %v, want original handler error", err)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatalf("handler failure must rollback the processing receipt: %v", err)
	}
}

func TestReceiptExecuteRejectsUntrustedUnsafeOrHashTamperedInputBeforeSQL(t *testing.T) {
	tests := []struct {
		name   string
		mutate func(input *ReceiptCommandInput)
		want   error
	}{
		{
			name:   "missing trusted tenant",
			mutate: func(input *ReceiptCommandInput) { input.TrustedContext.TenantCode = "" },
			want:   ErrInvalidIdentity,
		},
		{
			name:   "source equals target",
			mutate: func(input *ReceiptCommandInput) { input.TargetApp = input.TrustedContext.SourceApp },
			want:   ErrInvalidIdentity,
		},
		{
			name: "unsafe command",
			mutate: func(input *ReceiptCommandInput) {
				input.Command = json.RawMessage(`{"access_token":"sk-1234567890123456"}`)
				input.CommandSHA256 = rawCommandDigest(input.Command)
			},
			want: ErrUnsafePersistenceContent,
		},
		{
			name:   "declared hash does not match recomputed command hash",
			mutate: func(input *ReceiptCommandInput) { input.CommandSHA256 = fmt.Sprintf("%064d", 0) },
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			database, mock, err := sqlmock.New()
			if err != nil {
				t.Fatalf("sqlmock.New: %v", err)
			}
			defer database.Close()
			repository, err := NewReceiptRepository(database)
			if err != nil {
				t.Fatalf("NewReceiptRepository: %v", err)
			}
			input := validReceiptCommandInput(t)
			tt.mutate(&input)
			handlerCalls := 0

			_, err = repository.Execute(context.Background(), input, func(context.Context, *sql.Tx, json.RawMessage) (ReceiptBusinessResult, error) {
				handlerCalls++
				return ReceiptBusinessResult{}, nil
			})
			if err == nil {
				t.Fatal("unsafe Execute error = nil")
			}
			if tt.want != nil && !errors.Is(err, tt.want) {
				t.Fatalf("unsafe Execute error = %v, want %v", err, tt.want)
			}
			if handlerCalls != 0 {
				t.Fatalf("handler calls = %d, want 0", handlerCalls)
			}
			if err := mock.ExpectationsWereMet(); err != nil {
				t.Fatalf("unsafe input must fail before SQL: %v", err)
			}
		})
	}
}

func validReceiptCommandInput(t *testing.T) ReceiptCommandInput {
	t.Helper()
	command := json.RawMessage(`{"assetCode":"ASSET-1"}`)
	return ReceiptCommandInput{
		TrustedContext: TrustedContext{
			TenantCode:      "TENANT-A",
			DeploymentCode:  "DEPLOYMENT-A",
			SourceApp:       "aims",
			ServiceClientID: "aims-runtime",
			RequestID:       "REQ-1",
		},
		TargetApp:            "assets",
		OperationID:          operationID,
		OperationCode:        "assets.delivery.link_document.v1",
		RequiredCapability:   "assets.delivery.write",
		IdempotencyKey:       "delivery:ASSET-1",
		CommandSchemaVersion: "v1",
		CommandSHA256:        commandDigest(t, command),
		Command:              command,
	}
}

func commandDigest(t *testing.T, command json.RawMessage) string {
	t.Helper()
	digest, err := ValidateAndDigestCommand(command)
	if err != nil {
		t.Fatalf("ValidateAndDigestCommand: %v", err)
	}
	return digest
}

func rawCommandDigest(command json.RawMessage) string {
	digest := sha256.Sum256(command)
	return hex.EncodeToString(digest[:])
}

func receiptRows() *sqlmock.Rows {
	return sqlmock.NewRows([]string{
		"receipt_id", "operation_id", "required_capability", "command_schema_version", "command_sha256",
		"status", "target_biz_type", "target_biz_code", "response_http_status", "response_summary_sha256", "version_no",
	})
}

func succeededReceiptRows(input ReceiptCommandInput) *sqlmock.Rows {
	digest, err := ValidateAndDigestCommand(map[string]any{
		"targetBizType": "asset",
		"targetBizCode": "ASSET-1",
	})
	if err != nil {
		panic(err)
	}
	return receiptRows().AddRow(
		receiptID, operationID, "assets.delivery.write", "v1", input.CommandSHA256,
		"succeeded", "asset", "ASSET-1", 200, digest, 1,
	)
}

func TestReceiptCallerTransactionRemainsOpenAfterReplay(t *testing.T) {
	for _, commit := range []bool{false, true} {
		t.Run(fmt.Sprintf("commit=%v", commit), func(t *testing.T) {
			database, mock, err := sqlmock.New()
			if err != nil {
				t.Fatal(err)
			}
			defer database.Close()
			repository, err := NewReceiptRepository(database)
			if err != nil {
				t.Fatal(err)
			}
			input := validReceiptCommandInput(t)
			mock.ExpectBegin()
			mock.ExpectQuery(receiptSelectPattern).WillReturnRows(succeededReceiptRows(input))
			mock.ExpectExec(`(?s)UPDATE service_command_receipt.*SET last_request_id`).WillReturnResult(sqlmock.NewResult(0, 1))
			// A later caller-owned audit must still execute in this same transaction.
			mock.ExpectExec(`INSERT INTO caller_audit`).WillReturnResult(sqlmock.NewResult(1, 1))
			if commit {
				mock.ExpectCommit()
			} else {
				mock.ExpectRollback()
			}
			tx, err := database.BeginTx(context.Background(), nil)
			if err != nil {
				t.Fatal(err)
			}
			result, err := repository.ExecuteInTransaction(context.Background(), tx, input, func(context.Context, *sql.Tx, json.RawMessage) (ReceiptBusinessResult, error) {
				t.Fatal("replayed handler must not run")
				return ReceiptBusinessResult{}, nil
			})
			if err != nil || !result.Existing {
				t.Fatalf("replay = %+v, %v", result, err)
			}
			if _, err := tx.ExecContext(context.Background(), "INSERT INTO caller_audit VALUES (1)"); err != nil {
				t.Fatal(err)
			}
			if commit {
				err = tx.Commit()
			} else {
				err = tx.Rollback()
			}
			if err != nil {
				t.Fatal(err)
			}
			if err := mock.ExpectationsWereMet(); err != nil {
				t.Fatal(err)
			}
		})
	}
}

func TestReceiptCallerTransactionRejectsMissingTransaction(t *testing.T) {
	database, mock, err := sqlmock.New()
	if err != nil {
		t.Fatal(err)
	}
	defer database.Close()
	repository, err := NewReceiptRepository(database)
	if err != nil {
		t.Fatal(err)
	}
	_, err = repository.ExecuteInTransaction(context.Background(), nil, validReceiptCommandInput(t), func(context.Context, *sql.Tx, json.RawMessage) (ReceiptBusinessResult, error) {
		t.Fatal("unexpected handler")
		return ReceiptBusinessResult{}, nil
	})
	if err == nil {
		t.Fatal("missing transaction accepted")
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}

func TestOwnedReceiptDoesNotRelaxTransportOrOutboxIdentity(t *testing.T) {
	input := validReceiptCommandInput(t)
	input.TrustedContext.SourceApp = "assets"
	input.OriginalActorUID = "actor-1"
	if err := validateReceiptCommandInput(input); err == nil {
		t.Fatal("transport accepted same-domain identity")
	}
	if err := (Identity{TenantCode: "TENANT-A", DeploymentCode: "DEPLOYMENT-A", SourceApp: "assets", TargetApp: "assets", OperationCode: "assets.product.create.v1", SourceBizType: "product", SourceBizCode: "p1", IdempotencyKey: "key", CommandSHA256: input.CommandSHA256}).Validate(); err == nil {
		t.Fatal("outbox accepted same-domain identity")
	}
	database, mock, err := sqlmock.New()
	if err != nil {
		t.Fatal(err)
	}
	defer database.Close()
	repository, err := NewReceiptRepository(database)
	if err != nil {
		t.Fatal(err)
	}
	mock.ExpectBegin()
	mock.ExpectQuery(receiptSelectPattern).WillReturnRows(succeededReceiptRows(input))
	mock.ExpectExec(`(?s)UPDATE service_command_receipt.*SET last_request_id`).WillReturnResult(sqlmock.NewResult(0, 1))
	mock.ExpectRollback()
	tx, err := database.BeginTx(context.Background(), nil)
	if err != nil {
		t.Fatal(err)
	}
	result, err := repository.ExecuteOwnedInTransaction(context.Background(), tx, OwnedReceiptCommandInput(input), func(context.Context, *sql.Tx, json.RawMessage) (ReceiptBusinessResult, error) {
		t.Fatal("replay handler ran")
		return ReceiptBusinessResult{}, nil
	})
	if err != nil || !result.Existing {
		t.Fatalf("owned replay = %+v, %v", result, err)
	}
	if err := tx.Rollback(); err != nil {
		t.Fatal(err)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}

func TestOwnedReceiptRejectsMismatchedOwnerDeploymentOrMissingActor(t *testing.T) {
	for name, mutate := range map[string]func(*ReceiptCommandInput){
		"different owner":      func(input *ReceiptCommandInput) { input.TargetApp = "aims" },
		"different deployment": func(input *ReceiptCommandInput) { input.TargetDeploymentCode = "other" },
		"missing actor":        func(input *ReceiptCommandInput) { input.OriginalActorUID = "" },
	} {
		t.Run(name, func(t *testing.T) {
			input := validReceiptCommandInput(t)
			input.TrustedContext.SourceApp = "assets"
			input.OriginalActorUID = "actor-1"
			mutate(&input)
			var repository ReceiptRepository
			_, err := repository.ExecuteOwnedInTransaction(context.Background(), nil, OwnedReceiptCommandInput(input), nil)
			if !errors.Is(err, ErrInvalidIdentity) {
				t.Fatalf("expected owner identity error, got %v", err)
			}
		})
	}
}
