package wizbiztool

import (
	"errors"
	"github.com/go-sql-driver/mysql"
)

// gateError carries only source-defined classifications, never a driver error,
// SQL statement, object identifier, connection value, or credential.
type gateError struct {
	base   error
	check  string
	object string
}

func (e gateError) Error() string {
	return e.base.Error() + " [check=" + e.check + ",object=" + e.object + "]"
}
func (e gateError) Unwrap() error                        { return e.base }
func gateFailure(base error, check, object string) error { return gateError{base, check, object} }
func gateObject(table string) string {
	switch table {
	case "altoc_customer":
		return "customer"
	case "altoc_contact":
		return "contact"
	case "altoc_contract":
		return "contract"
	case "finance_bank_account":
		return "bank_account"
	case "finance_legal_entity":
		return "legal_entity"
	default:
		return "registered_table"
	}
}

func planGateFailure(err error, check string) error {
	var classified gateError
	if errors.As(err, &classified) {
		return err
	}
	for _, base := range []error{ErrTarget, ErrProfile, ErrSourceBinding, ErrRuntimeBuild, ErrDependency, ErrConflict, ErrInput} {
		if errors.Is(err, base) {
			return gateFailure(base, check, "plan_gate")
		}
	}
	return gateFailure(ErrTarget, check, "plan_gate")
}

func writeFailure(err error, check, object string) error {
	class := "other"
	var dbError *mysql.MySQLError
	if errors.As(err, &dbError) {
		switch dbError.Number {
		case 1048, 1364:
			class = "required_field"
		case 1062:
			class = "duplicate"
		case 1451, 1452:
			class = "foreign_key"
		case 1264, 1265, 1406:
			class = "field_range"
		case 1142, 1143:
			class = "permission"
		case 1054, 1146:
			class = "schema"
		case 1213, 1205:
			class = "concurrency"
		default:
			class = "database"
		}
	}
	return gateFailure(ErrWrite, check+"_"+class, object)
}
