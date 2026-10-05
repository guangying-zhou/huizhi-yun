package productcenter

import (
	"context"
	"database/sql"
	"errors"
	"testing"
)

func TestAuthorizationFactsRejectInvalidIdentityBeforeDatabase(t *testing.T) {
	for _, pair := range [][2]string{{"", "u1"}, {" P-A", "u1"}, {"P-A", ""}, {"P-A", " u1"}} {
		if _, err := LoadAuthorizationFacts(context.Background(), nil, pair[0], pair[1]); err == nil {
			t.Fatalf("accepted invalid identity %v", pair)
		}
	}
}

func TestMySQLProductAuthorizationFacts(t *testing.T) {
	db := mysqlTestDatabase(t)
	migrateProductCenter(t, db)
	workspaceFixture(t, db, "P-A")
	workspaceFixture(t, db, "P-B")
	ctx := context.Background()
	// Real DB time boundaries; expired-at-now is no longer active.
	_, err := db.Exec(`INSERT INTO product_members
		(product_code,uid,relation_type,status,valid_from,valid_until,created_by,updated_by,created_at,updated_at) VALUES
		('P-A','manager','manager','active',UTC_TIMESTAMP(3)-INTERVAL 1 DAY,NULL,'pm','pm',UTC_TIMESTAMP(3),UTC_TIMESTAMP(3)),
		('P-A','viewer','viewer','active',UTC_TIMESTAMP(3)-INTERVAL 1 DAY,NULL,'pm','pm',UTC_TIMESTAMP(3),UTC_TIMESTAMP(3)),
		('P-A','expired','manager','active',UTC_TIMESTAMP(3)-INTERVAL 1 DAY,UTC_TIMESTAMP(3),'pm','pm',UTC_TIMESTAMP(3),UTC_TIMESTAMP(3)),
		('P-A','future','manager','active',UTC_TIMESTAMP(3)+INTERVAL 1 DAY,NULL,'pm','pm',UTC_TIMESTAMP(3),UTC_TIMESTAMP(3)),
		('P-A','revoked','manager','inactive',UTC_TIMESTAMP(3)-INTERVAL 1 DAY,NULL,'pm','pm',UTC_TIMESTAMP(3),UTC_TIMESTAMP(3))`)
	if err != nil {
		t.Fatal(err)
	}
	for _, tc := range []struct {
		code, uid       string
		member, manager bool
	}{
		{"P-A", "manager", true, true}, {"P-A", "viewer", true, false},
		{"P-A", "expired", false, false}, {"P-A", "future", false, false},
		{"P-A", "revoked", false, false}, {"P-A", "outsider", false, false},
		{"P-B", "manager", false, false}, {"P-A", "Manager", false, false},
	} {
		facts, err := LoadAuthorizationFacts(ctx, db, tc.code, tc.uid)
		if err != nil {
			t.Fatal(err)
		}
		if facts.IsMember != tc.member || facts.IsManager != tc.manager || facts.ActorUID != tc.uid || facts.ProductCode != tc.code {
			t.Fatalf("%+v: %+v", tc, facts)
		}
	}
	if _, err := LoadAuthorizationFacts(ctx, db, "p-a", "manager"); !errors.Is(err, sql.ErrNoRows) {
		t.Fatalf("wrong-case product: %v", err)
	}
	tx, err := db.BeginTx(ctx, nil)
	if err != nil {
		t.Fatal(err)
	}
	defer tx.Rollback()
	if _, err := tx.ExecContext(ctx, `UPDATE product_members SET status='inactive' WHERE product_code='P-A' AND uid='manager'`); err != nil {
		t.Fatal(err)
	}
	facts, err := LoadAuthorizationFacts(ctx, tx, "P-A", "manager")
	if err != nil || facts.IsManager || facts.IsMember {
		t.Fatalf("transaction must see revocation: %+v %v", facts, err)
	}
}
