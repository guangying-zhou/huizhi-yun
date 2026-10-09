package wizbiztool

import (
	"errors"
	"github.com/go-sql-driver/mysql"
	"github.com/huizhi-yun/data-runtime/internal/httperror"
	"strings"
	"testing"
)

func TestVaultCreateFailureIsFixedAndRedacted(t *testing.T) {
	for _, tc := range []struct {
		err   error
		check string
	}{{&mysql.MySQLError{Number: 1142, Message: "SECRET personal account SQL"}, "create_permission"}, {&mysql.MySQLError{Number: 1146, Message: "SECRET"}, "create_schema"}, {&mysql.MySQLError{Number: 1213, Message: "SECRET"}, "create_database"}, {httperror.New(400, "dynamic_secret", "SECRET"), "create_input"}, {httperror.New(403, "dynamic_secret", "SECRET"), "create_authorization"}, {httperror.New(409, "dynamic_secret", "SECRET"), "create_conflict"}, {errors.New("SECRET"), "create_other"}} {
		err := vaultCreateFailure(tc.err)
		if !errors.Is(err, ErrVault) || err.Error() != "migration_vault_not_ready [check="+tc.check+",object=vault]" || strings.Contains(err.Error(), "SECRET") {
			t.Fatal("unsafe vault diagnostic")
		}
	}
}
