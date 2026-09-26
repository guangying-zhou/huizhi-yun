package enterprise

import (
	"context"
	"errors"
	"testing"
)

func TestViewCanonicalPreservesQuotedIdentity(t *testing.T) {
	a := "SELECT `Db`.`Table`.`ID` AS `ID`,`Db`.`Table`.`name` AS `name` FROM `Db`.`Table`"
	b := "select `Db`.`Table`.`ID` as `ID`, `Db`.`Table`.`name` as `name` from `Db`.`Table`"
	if viewCanonical(a) != viewCanonical(b) {
		t.Fatal("MySQL formatting changed view identity")
	}
	for _, changed := range []string{"SELECT `db`.`Table`.`ID` AS `ID`,`Db`.`Table`.`name` AS `name` FROM `Db`.`Table`", a + " WHERE 1=1", a + " UNION SELECT 1", "SELECT 'Secret'", "SELECT 'secret'"} {
		if viewCanonical(a) == viewCanonical(changed) {
			t.Fatal("different view accepted")
		}
	}
	if viewCanonical("SELECT 'Secret'") == viewCanonical("SELECT 'secret'") {
		t.Fatal("literal case folded")
	}
}

func TestCompatibilityViewsNilPoolFailsClosed(t *testing.T) {
	if _, err := PlanCompatibilityViews(context.Background(), nil, Binding{}, "aims", []string{"product_requests"}); !errors.Is(err, ErrCompatibilityView) {
		t.Fatal(err)
	}
	if err := VerifyCompatibilityViews(context.Background(), nil, Binding{}, "aims", []string{"product_requests"}); !errors.Is(err, ErrCompatibilityView) {
		t.Fatal(err)
	}
	if err := VerifyCompatibilityViewsTx(context.Background(), nil, Binding{}, "aims", []string{"product_requests"}); !errors.Is(err, ErrCompatibilityView) {
		t.Fatal(err)
	}
}
