package integrationoperation

import (
	"fmt"
	"regexp"
)

// OutboxTables is an immutable, local registry-derived mapping. It is never
// decoded from HTTP input. Only single quoted identifiers are accepted.
type OutboxTables struct{ operation, attempt, receipt, deadLetterActionable string }

var outboxIdentifier = regexp.MustCompile("^`[A-Za-z_][A-Za-z0-9_]{0,63}`$")

func NewOutboxTables(operation, attempt, receipt, deadLetterActionable string) (OutboxTables, error) {
	for _, name := range []string{operation, attempt, receipt, deadLetterActionable} {
		if !outboxIdentifier.MatchString(name) {
			return OutboxTables{}, fmt.Errorf("invalid registered outbox table")
		}
	}
	if operation == attempt || operation == receipt || attempt == receipt || operation == deadLetterActionable || attempt == deadLetterActionable || receipt == deadLetterActionable {
		return OutboxTables{}, fmt.Errorf("outbox tables must be distinct")
	}
	return OutboxTables{operation, attempt, receipt, deadLetterActionable}, nil
}
func (t OutboxTables) Operation() string            { return t.operation }
func (t OutboxTables) Attempt() string              { return t.attempt }
func (t OutboxTables) Receipt() string              { return t.receipt }
func (t OutboxTables) DeadLetterActionable() string { return t.deadLetterActionable }
func (t OutboxTables) Validate() error {
	_, err := NewOutboxTables(t.operation, t.attempt, t.receipt, t.deadLetterActionable)
	return err
}

// OperationTable preserves the legacy adapter path when no unified binding was
// supplied; an explicitly supplied invalid binding is always rejected.
func (c TrustedContext) OperationTable() (string, error) {
	if c.OutboxTables == nil {
		return "`integration_operation`", nil
	}
	if err := c.OutboxTables.Validate(); err != nil {
		return "", err
	}
	return c.OutboxTables.Operation(), nil
}
