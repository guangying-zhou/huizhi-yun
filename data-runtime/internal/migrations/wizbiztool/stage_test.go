package wizbiztool

import (
	"context"
	"errors"
	"github.com/DATA-DOG/go-sqlmock"
	"testing"
	"time"
)

func TestSourcePrivileges(t *testing.T) {
	for _, grant := range []string{"GRANT SELECT ON `stage`.* TO 'reader'@'localhost'", "GRANT SELECT (`ba_id`, `balance`) ON `stage`.`wb_bank_account` TO 'reader'@'localhost'"} {
		if ValidateSourceGrants([]string{"GRANT USAGE ON *.* TO 'reader'@'localhost'", grant}, "stage") != nil {
			t.Fatal("read-only grant rejected")
		}
	}
	for _, grant := range []string{"GRANT ALL PRIVILEGES ON `stage`.* TO 'reader'@'localhost'", "GRANT SELECT, INSERT ON `stage`.* TO 'reader'@'localhost'", "GRANT SELECT ON *.* TO 'reader'@'localhost'", "GRANT SELECT ON `other`.* TO 'reader'@'localhost'", "GRANT SELECT ON `stage`.* TO 'reader'@'localhost' WITH GRANT OPTION", "GRANT `role` TO 'reader'@'localhost'"} {
		if ValidateSourceGrants([]string{grant}, "stage") == nil {
			t.Fatal("unsafe grant accepted")
		}
	}
}
func TestSourceSnapshotReadOnlyAndDriverErrorRedaction(t *testing.T) {
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	mock.ExpectBegin()
	mock.ExpectQuery("SELECT DATABASE\\(\\), @@server_uuid").WillReturnRows(sqlmock.NewRows([]string{"db", "uuid"}).AddRow("stage", "instance"))
	mock.ExpectQuery("SHOW GRANTS FOR CURRENT_USER").WillReturnRows(sqlmock.NewRows([]string{"grant"}).AddRow("GRANT SELECT ON `stage`.* TO 'reader'@'localhost'"))
	source, err := OpenSourceSnapshot(context.Background(), db, "stage")
	if err != nil {
		t.Fatal(err)
	}
	mock.ExpectQuery("SELECT.*FROM `wb_bank_account` ORDER BY `ba_id`").WillReturnError(errors.New("database password and account number must not leak"))
	if err := source.eachRow(context.Background(), "wb_bank_account", []string{"ba_id"}, []string{"ba_id"}, func(map[string]any) error { return nil }); err != ErrSourceBinding {
		t.Fatal("driver error leaked")
	}
	mock.ExpectRollback()
	_ = source.Close()
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}
func TestReceiptDrift(t *testing.T) {
	base := StageReceipt{SnapshotID: "snapshot", SQLSHA256: Digest(nil), ManifestSHA256: Digest(nil), InstanceID: "instance", Database: "stage", Tables: map[string]StageTable{"wb_bank_account": {Rows: 1, Digest: Digest(nil), ExcludedColumns: []string{"account_number"}}}, VerifiedAt: time.Now()}
	identical := base
	identical.VerifiedAt = base.VerifiedAt.Add(time.Minute)
	if CheckStageReceipt(base, identical) != nil {
		t.Fatal("timestamp affects source binding")
	}
	for _, change := range []func(*StageReceipt){func(r *StageReceipt) { r.InstanceID = "other" }, func(r *StageReceipt) { r.Database = "other" }, func(r *StageReceipt) { r.ManifestSHA256 = Digest([]byte("other")) }, func(r *StageReceipt) {
		r.Tables = map[string]StageTable{"wb_bank_account": {Rows: 1, Digest: Digest(nil)}}
	}} {
		next := base
		change(&next)
		if CheckStageReceipt(base, next) == nil {
			t.Fatal("source drift accepted")
		}
	}
}

func TestStageBankAccountNeverReadsSecretColumn(t *testing.T) {
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	mock.ExpectBegin()
	mock.ExpectQuery("SELECT DATABASE\\(\\), @@server_uuid").WillReturnRows(sqlmock.NewRows([]string{"db", "uuid"}).AddRow("stage", "instance"))
	mock.ExpectQuery("SHOW GRANTS FOR CURRENT_USER").WillReturnRows(sqlmock.NewRows([]string{"grant"}).AddRow("GRANT SELECT (`ba_id`, `balance`) ON `stage`.`wb_bank_account` TO 'reader'@'localhost'"))
	source, err := OpenSourceSnapshot(context.Background(), db, "stage")
	if err != nil {
		t.Fatal(err)
	}
	source.metadata = source.tx // A SQL mock only; real callers must AttachMetadata.
	manifest := SnapshotManifest{SnapshotID: "fixture", SourceSystem: "wizbiz", SQLSHA256: Digest(nil), EncryptedSHA256: Digest(nil), MySQLVersion: "8.0.34", Timezone: "Asia/Shanghai", Tables: map[string]ManifestTable{"wb_bank_account": {Rows: 1, PrimaryKey: []string{"ba_id"}, Columns: []SourceColumn{{Name: "ba_id", Type: "bigint"}, {Name: "account_number", Type: "varchar(30)"}, {Name: "balance", Type: "decimal(12,2)", Nullable: true}}, InsertSequenceSHA256: Digest(nil)}}}
	mock.ExpectQuery("SELECT TABLE_NAME, TABLE_TYPE FROM information_schema.TABLES").WithArgs("stage").WillReturnRows(sqlmock.NewRows([]string{"name", "type"}).AddRow("wb_bank_account", "BASE TABLE"))
	mock.ExpectQuery("SHOW CREATE TABLE `wb_bank_account`").WillReturnRows(sqlmock.NewRows([]string{"name", "ddl"}).AddRow("wb_bank_account", "CREATE TABLE `wb_bank_account` (`ba_id` bigint NOT NULL, `account_number` varchar(30) NOT NULL, `balance` decimal(12,2) DEFAULT NULL, PRIMARY KEY (`ba_id`)) ENGINE=InnoDB"))
	mock.ExpectQuery("SELECT COLUMN_NAME FROM information_schema.STATISTICS").WithArgs("stage", "wb_bank_account").WillReturnRows(sqlmock.NewRows([]string{"name"}).AddRow("ba_id"))
	mock.ExpectQuery("SELECT COUNT\\(\\*\\) FROM `wb_bank_account`").WillReturnRows(sqlmock.NewRows([]string{"count"}).AddRow(1))
	// Column-level grants make SELECT account_number (or SELECT *) fail in the
	// real fixture. The exact expectation catches either regression here too.
	mock.ExpectQuery("^SELECT `ba_id`,`balance` FROM `wb_bank_account` ORDER BY `ba_id`$").WillReturnRows(sqlmock.NewRows([]string{"ba_id", "balance"}).AddRow("2", "1200.00"))
	receipt, err := source.VerifyStage(context.Background(), manifest, Digest([]byte("manifest")))
	if err != nil {
		t.Fatal(err)
	}
	table := receipt.Tables["wb_bank_account"]
	if table.Rows != 1 || len(table.ExcludedColumns) != 1 || table.ExcludedColumns[0] != "account_number" {
		t.Fatal("secret exclusion absent from binding")
	}
	row, err := CanonicalRow(map[string]any{"ba_id": "2", "balance": "1200.00"})
	if err != nil {
		t.Fatal(err)
	}
	want, _ := TableDigest([]string{Digest(row)})
	if table.Digest != want {
		t.Fatal("source digest mismatch")
	}
	mock.ExpectRollback()
	_ = source.Close()
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}
