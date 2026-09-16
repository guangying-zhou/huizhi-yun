package directory

import (
	"errors"
	"os"
	"strings"
	"testing"
)

func TestReservationRejectsSyntheticAndMalformedUIDs(t *testing.T) {
	adapter := &Adapter{}
	// dt-* 是本设计要消除的合成主体，预留阶段就必须拒绝，
	// 不能等到开户或归并时才发现。
	for _, uid := range []string{"dt-0123456789abcdef", "DT-0123456789ABCDEF"} {
		_, err := adapter.ConsoleReserveDirectoryIdentity(t.Context(),
			ConsoleIdentityReservationInput{UID: uid}, "C000001-console")
		if err == nil || !strings.Contains(err.Error(), "synthetic") {
			t.Fatalf("uid=%q err=%v", uid, err)
		}
	}
	for _, uid := range []string{"", "   ", "bad uid", "a", strings.Repeat("x", 200)} {
		_, err := adapter.ConsoleReserveDirectoryIdentity(t.Context(),
			ConsoleIdentityReservationInput{UID: uid}, "C000001-console")
		if err == nil {
			t.Fatalf("uid=%q must be rejected", uid)
		}
	}
}

func TestReservationRejectsMalformedEmailBeforeTouchingTheDatabase(t *testing.T) {
	adapter := &Adapter{}
	_, err := adapter.ConsoleReserveDirectoryIdentity(t.Context(),
		ConsoleIdentityReservationInput{UID: "liukai", Email: "not-an-email"}, "C000001-console")
	if err == nil || !strings.Contains(err.Error(), "email") {
		t.Fatalf("err=%v", err)
	}
}

func TestDuplicateKeyDetectionCoversTheReservationUniqueIndexes(t *testing.T) {
	// 并发预留的最终排他性依赖四个唯一索引；把 1062 误判成 500 会让调用方
	// 以为是服务故障并盲目重试，而不是提示换一个 UID 或邮箱。
	if !isConsoleDuplicateKeyError(errors.New("Error 1062 (23000): Duplicate entry 'liukai' for key 'uk_directory_reservation_active_uid'")) {
		t.Fatal("MySQL duplicate entry must be recognised")
	}
	if isConsoleDuplicateKeyError(errors.New("connection refused")) {
		t.Fatal("an infrastructure failure must not be reported as a reservation conflict")
	}
	if isConsoleDuplicateKeyError(nil) {
		t.Fatal("nil must not be a conflict")
	}
}

func TestReservationSchemaKeepsActiveOnlyUniqueness(t *testing.T) {
	migration, err := os.ReadFile("../../../../console/docs/sql/Console-SQL-Migration-v2.5-directory-identity-reservations.sql")
	if err != nil {
		t.Fatal(err)
	}
	text := string(migration)
	// 已消费/已释放/已过期的预留不得继续占用标识符，否则一次未完成的入职
	// 会让该 UID 和邮箱永久不可用。
	for _, generated := range []string{"active_uid", "active_username", "active_email", "active_provider_subject"} {
		if !strings.Contains(text, generated) {
			t.Fatalf("missing active-only generated column: %s", generated)
		}
	}
	for _, index := range []string{
		"uk_directory_reservation_active_uid",
		"uk_directory_reservation_active_username",
		"uk_directory_reservation_active_email",
		"uk_directory_reservation_active_subject",
	} {
		if !strings.Contains(text, "UNIQUE KEY `"+index+"`") {
			t.Fatalf("missing uniqueness guarantee: %s", index)
		}
	}
	if !strings.Contains(text, "LOWER(`uid`) NOT LIKE 'dt-%'") {
		t.Fatal("the schema must refuse synthetic dt-* reservations")
	}
}

func TestSuggestionRejectsUnusableBaseNames(t *testing.T) {
	adapter := &Adapter{}
	// 纯中文姓名转换失败时基名会被清空，此时必须明确报错，
	// 而不是回落到一个所有人共用的空 UID。
	for _, base := range []string{"", "   ", "刘凯", "!!!", "@@"} {
		if _, err := adapter.ConsoleSuggestDirectoryIdentity(t.Context(), base, "example.com"); err == nil {
			t.Fatalf("base=%q must be rejected", base)
		}
	}
}
