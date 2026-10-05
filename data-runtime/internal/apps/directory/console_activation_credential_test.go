package directory

import (
	"context"
	"strings"
	"testing"

	"github.com/DATA-DOG/go-sqlmock"
	"github.com/huizhi-yun/data-runtime/internal/httperror"
)

func TestConsoleActivationTokenIsUnpredictableAndStoredOnlyAsHash(t *testing.T) {
	seen := map[string]bool{}
	for range 64 {
		token, err := newConsoleActivationToken()
		if err != nil {
			t.Fatal(err)
		}
		if seen[token] {
			t.Fatalf("generated a repeated activation token: %q", token)
		}
		seen[token] = true
		if len(token) < 40 {
			t.Fatalf("token %q is too short to resist guessing", token)
		}

		hash := consoleActivationTokenHash(token)
		if len(hash) != 64 {
			t.Fatalf("token hash must be a sha256 hex digest, got %q", hash)
		}
		if strings.Contains(hash, token) {
			t.Fatal("the stored hash must not embed the plaintext token")
		}
		// 入库前后都按同一规则规范化，链接里的多余空白不应导致兑换失败。
		if consoleActivationTokenHash("  "+token+"  ") != hash {
			t.Fatal("token hashing must be whitespace stable")
		}
	}
}

func TestConsoleActivationInvalidHidesWhichCheckFailed(t *testing.T) {
	// 不存在、已兑换、已过期、已作废必须返回同一个错误码，
	// 否则暴力尝试者可以据此判断某个令牌是否真实存在。
	typed, ok := consoleActivationInvalid().(httperror.Error)
	if !ok {
		t.Fatal("activation failures must be typed http errors")
	}
	if typed.Code != "directory_activation_credential_invalid" {
		t.Fatalf("code=%q", typed.Code)
	}
	if typed.Status != 404 {
		t.Fatalf("status=%d", typed.Status)
	}
	if strings.Contains(strings.ToLower(typed.Message), "expired") &&
		strings.Contains(strings.ToLower(typed.Message), "redeemed") {
		t.Fatal("the message must not enumerate which specific check failed")
	}
}

func TestOnboardingActivationBindsTheSuccessfulOperationToItsCase(t *testing.T) {
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	adapter := newAdapter(db, false, "tenant-1", "", "")
	operationID := "550e8400-e29b-41d4-a716-446655440000"

	mock.ExpectBegin()
	mock.ExpectQuery(`(?s)SELECT status FROM integration_operation.*JSON_EXTRACT\(command_json,'\$\.sourceApp'\).*JSON_EXTRACT\(command_json,'\$\.sourceBizCode'\)`).
		WithArgs(operationID, "liukai", "ONB-LIUKAI").
		WillReturnRows(sqlmock.NewRows([]string{"status"}).AddRow("succeeded"))
	mock.ExpectQuery(`SELECT COUNT\(\*\) FROM directory_identities`).
		WithArgs("liukai").
		WillReturnRows(sqlmock.NewRows([]string{"COUNT(*)"}).AddRow(1))
	mock.ExpectExec(`UPDATE directory_activation_credentials`).
		WithArgs("liukai").
		WillReturnResult(sqlmock.NewResult(0, 0))
	mock.ExpectExec(`INSERT INTO directory_activation_credentials`).
		WithArgs(sqlmock.AnyArg(), "liukai", sqlmock.AnyArg(), "initial_activation", "people", operationID, sqlmock.AnyArg()).
		WillReturnResult(sqlmock.NewResult(1, 1))
	mock.ExpectCommit()

	result, err := adapter.ConsoleIssueOnboardingActivationCredential(
		context.Background(), "liukai", operationID, "ONB-LIUKAI", "people",
	)
	if err != nil {
		t.Fatal(err)
	}
	if result["uid"] != "liukai" || strings.TrimSpace(result["activationToken"].(string)) == "" {
		t.Fatalf("result=%#v", result)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}

func TestIsTrueConsoleFlagAcceptsOnlyExplicitTruth(t *testing.T) {
	for _, truthy := range []any{true, "true", "TRUE", " True "} {
		if !isTrueConsoleFlag(truthy) {
			t.Fatalf("%#v must be treated as true", truthy)
		}
	}
	for _, falsy := range []any{nil, false, "", "false", "1", "yes", 0} {
		if isTrueConsoleFlag(falsy) {
			t.Fatalf("%#v must not be treated as true", falsy)
		}
	}
}
