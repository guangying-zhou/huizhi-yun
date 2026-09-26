package productcenter

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	e "github.com/huizhi-yun/data-runtime/internal/enterprise"
	"reflect"
	"testing"
)

type lightweightChainCommands struct {
	t        *testing.T
	registry *e.Registry
	requests []e.ResolveRequest
}

func TestMySQLEnterpriseLightweightPlanningChain(t *testing.T) { exerciseLightweightPlanChain(t, true) }
func lightweightChainFixture(t *testing.T, unified bool) (lightweightChainCommands, *sql.DB) {
	c := lightweightChainCommands{t: t}
	if !unified {
		db := mysqlTestDatabase(t)
		migrateProductCenter(t, db)
		return c, db
	}
	db, b, names := enterpriseProductFixture(t)
	ctx := context.Background()
	plan, err := e.PlanCompatibilityViews(ctx, db, b, "aims", names)
	if err != nil {
		t.Fatal(err)
	}
	if err = e.ApplyCompatibilityViews(ctx, db, b, "aims", names, plan.ReviewHash); err != nil {
		t.Fatal(err)
	}
	if _, err = db.Exec("UPDATE enterprise_schema_registry SET generation=1 WHERE id=1"); err != nil {
		t.Fatal(err)
	}
	if err = e.VerifyCompatibilityViews(ctx, db, b, "aims", names); err != nil {
		t.Fatal(err)
	}
	c.registry = e.NewRegistry(func(context.Context, e.Storage) (*sql.DB, error) { return db, nil })
	if err = c.registry.Register(ctx, b); err != nil {
		t.Fatal(err)
	}
	for _, domain := range []string{"aims", "assets"} {
		c.requests = append(c.requests, e.ResolveRequest{Key: b.Key, Domain: domain, OwnerDeployment: b.Domains[domain].OwnerDeployment, SchemaVersion: b.SchemaVersion, Generation: b.Generation, Operation: e.Write})
	}
	// Fixture owns its borrowed pool, including dropping its temporary database.
	return c, db
}
func (c lightweightChainCommands) fresh(db *sql.DB, id CommandIdentity, p AuthorizationPermit) AuthorizationPermit {
	fresh := workspacePermit(c.t, db, id.ProductCode, id.ActorUID, p.Action)
	fresh.Resource = p.Resource
	return fresh
}
func (c lightweightChainCommands) run(ctx context.Context, db *sql.DB, id CommandIdentity, apply func(*sql.Tx) (CommandResult, error), replay func() (CommandResult, error)) (CommandResult, error) {
	t := c.t
	t.Helper()
	state := func() [3]int64 {
		var out [3]int64
		if err := db.QueryRow("SELECT revision,(SELECT COUNT(*) FROM product_command_receipts),(SELECT COUNT(*) FROM product_activity_logs) FROM product_workspaces WHERE product_code=?", id.ProductCode).Scan(&out[0], &out[1], &out[2]); err != nil {
			t.Fatal(err)
		}
		return out
	}
	before := state()
	var marker string
	if err := db.QueryRow("SELECT product_name FROM assets_product_assets WHERE product_code='P-ENTERPRISE'").Scan(&marker); err != nil {
		t.Fatal(err)
	}
	begin := func() *sql.Tx {
		tx, _, err := c.registry.BeginWriteTransaction(ctx, c.requests...)
		if err != nil {
			t.Fatal(err)
		}
		if _, err = tx.Exec("UPDATE assets_product_assets SET product_name='uncommitted-other-domain' WHERE product_code='P-ENTERPRISE'"); err != nil {
			tx.Rollback()
			t.Fatal(err)
		}
		return tx
	}
	tx := begin()
	_, err := apply(tx)
	if err != nil {
		if commitErr := tx.Commit(); !errors.Is(commitErr, sql.ErrTxDone) {
			t.Fatal("failed command left transaction committable", commitErr)
		}
	} else if rollbackErr := tx.Rollback(); rollbackErr != nil {
		t.Fatal(rollbackErr)
	}
	if got := state(); got != before {
		t.Fatal("domain revision/receipt/audit escaped shared rollback", id.Action, before, got)
	}
	var afterMarker string
	if readErr := db.QueryRow("SELECT product_name FROM assets_product_assets WHERE product_code='P-ENTERPRISE'").Scan(&afterMarker); readErr != nil || marker != afterMarker {
		t.Fatal("other-domain mutation escaped rollback", readErr)
	}
	if err != nil {
		return CommandResult{}, err
	}
	tx = begin()
	first, err := apply(tx)
	if err != nil {
		tx.Rollback()
		t.Fatal(err)
	}
	if err = tx.Commit(); err != nil {
		t.Fatal(err)
	}
	committed := state()
	old, err := replay()
	if err != nil {
		t.Fatal("old entry replay failed", id.Action, err)
	}
	var a, b any
	if json.Unmarshal(first.Value, &a) != nil || json.Unmarshal(old.Value, &b) != nil || !old.Replayed || old.ReceiptID != first.ReceiptID || !reflect.DeepEqual(a, b) {
		t.Fatal("old entry returned different receipt", id.Action)
	}
	if got := state(); got != committed {
		t.Fatal("old replay repeated mutation", id.Action)
	}
	t.Log("shared rollback, commit and old entry replay:", id.Action)
	return first, nil
}
func (c lightweightChainCommands) CreateProductRequest(ctx context.Context, db *sql.DB, identity CommandIdentity, permit AuthorizationPermit, input RequestDraft) (CommandResult, error) {
	if c.registry == nil {
		return CreateProductRequest(ctx, db, identity, permit, input)
	}
	return c.run(ctx, db, identity, func(tx *sql.Tx) (CommandResult, error) {
		return CreateProductRequestInTransaction(ctx, tx, identity, permit, input)
	}, func() (CommandResult, error) {
		return CreateProductRequest(ctx, db, identity, c.fresh(db, identity, permit), input)
	})
}
func (c lightweightChainCommands) CreateProductCenterVersion(ctx context.Context, db *sql.DB, identity CommandIdentity, permit AuthorizationPermit, input ProductVersionDraft) (CommandResult, error) {
	if c.registry == nil {
		return CreateProductCenterVersion(ctx, db, identity, permit, input)
	}
	return c.run(ctx, db, identity, func(tx *sql.Tx) (CommandResult, error) {
		return CreateProductCenterVersionInTransaction(ctx, tx, identity, permit, input)
	}, func() (CommandResult, error) {
		return CreateProductCenterVersion(ctx, db, identity, c.fresh(db, identity, permit), input)
	})
}
func (c lightweightChainCommands) EditLightweightVersionPlan(ctx context.Context, db *sql.DB, identity CommandIdentity, permit AuthorizationPermit, input LightweightVersionPlanEdit) (CommandResult, error) {
	if c.registry == nil {
		return EditLightweightVersionPlan(ctx, db, identity, permit, input)
	}
	return c.run(ctx, db, identity, func(tx *sql.Tx) (CommandResult, error) {
		return EditLightweightVersionPlanInTransaction(ctx, tx, identity, permit, input)
	}, func() (CommandResult, error) {
		return EditLightweightVersionPlan(ctx, db, identity, c.fresh(db, identity, permit), input)
	})
}
func (c lightweightChainCommands) CreateLightweightVersionPlanItem(ctx context.Context, db *sql.DB, identity CommandIdentity, versionPermit, requestViewPermit, requestDecisionPermit, planningPermit AuthorizationPermit, input LightweightVersionPlanItemCreate) (CommandResult, error) {
	if c.registry == nil {
		return CreateLightweightVersionPlanItem(ctx, db, identity, versionPermit, requestViewPermit, requestDecisionPermit, planningPermit, input)
	}
	return c.run(ctx, db, identity, func(tx *sql.Tx) (CommandResult, error) {
		return CreateLightweightVersionPlanItemInTransaction(ctx, tx, identity, versionPermit, requestViewPermit, requestDecisionPermit, planningPermit, input)
	}, func() (CommandResult, error) {
		return CreateLightweightVersionPlanItem(ctx, db, identity, c.fresh(db, identity, versionPermit), c.fresh(db, identity, requestViewPermit), c.fresh(db, identity, requestDecisionPermit), c.fresh(db, identity, planningPermit), input)
	})
}
func (c lightweightChainCommands) EditLightweightVersionPlanItem(ctx context.Context, db *sql.DB, identity CommandIdentity, permit AuthorizationPermit, input LightweightVersionPlanItemEdit) (CommandResult, error) {
	if c.registry == nil {
		return EditLightweightVersionPlanItem(ctx, db, identity, permit, input)
	}
	return c.run(ctx, db, identity, func(tx *sql.Tx) (CommandResult, error) {
		return EditLightweightVersionPlanItemInTransaction(ctx, tx, identity, permit, input)
	}, func() (CommandResult, error) {
		return EditLightweightVersionPlanItem(ctx, db, identity, c.fresh(db, identity, permit), input)
	})
}
func (c lightweightChainCommands) ConfirmLightweightVersionPlan(ctx context.Context, db *sql.DB, identity CommandIdentity, versionPermit, planningPermit AuthorizationPermit, input LightweightVersionPlanConfirm) (CommandResult, error) {
	if c.registry == nil {
		return ConfirmLightweightVersionPlan(ctx, db, identity, versionPermit, planningPermit, input)
	}
	return c.run(ctx, db, identity, func(tx *sql.Tx) (CommandResult, error) {
		return ConfirmLightweightVersionPlanInTransaction(ctx, tx, identity, versionPermit, planningPermit, input)
	}, func() (CommandResult, error) {
		return ConfirmLightweightVersionPlan(ctx, db, identity, c.fresh(db, identity, versionPermit), c.fresh(db, identity, planningPermit), input)
	})
}
func (c lightweightChainCommands) HandoffPlanningItem(ctx context.Context, db *sql.DB, identity CommandIdentity, planningPermit, requestPermit AuthorizationPermit, input PlanningHandoffInput, target PlanningHandoffTarget) (CommandResult, error) {
	if c.registry == nil {
		return HandoffPlanningItem(ctx, db, identity, planningPermit, requestPermit, input, target)
	}
	return c.run(ctx, db, identity, func(tx *sql.Tx) (CommandResult, error) {
		return HandoffPlanningItemInTransaction(ctx, tx, identity, planningPermit, requestPermit, input, target)
	}, func() (CommandResult, error) {
		return HandoffPlanningItem(ctx, db, identity, c.fresh(db, identity, planningPermit), c.fresh(db, identity, requestPermit), input, target)
	})
}
