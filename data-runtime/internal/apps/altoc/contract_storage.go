package altoc

import (
	"context"
	"fmt"
	"regexp"
	"strings"
)

type contractStorageKey struct{}
type ContractStorage struct{ audit, events string }

// NewContractStorage accepts only local Registry identifiers, never HTTP fields.
func NewContractStorage(audit, events string) (ContractStorage, error) {
	valid := regexp.MustCompile("^`[A-Za-z_][A-Za-z0-9_]{0,63}`$")
	if !valid.MatchString(audit) || !valid.MatchString(events) || audit == events {
		return ContractStorage{}, fmt.Errorf("invalid registered Altoc contract tables")
	}
	return ContractStorage{strings.Trim(audit, "`"), strings.Trim(events, "`")}, nil
}
func (s ContractStorage) Context(ctx context.Context) (context.Context, error) {
	if s.audit == "" || s.events == "" {
		return nil, fmt.Errorf("Altoc contract storage uninitialized")
	}
	return context.WithValue(ctx, contractStorageKey{}, s), nil
}
func contractPhysicalTable(ctx context.Context, logical string) string {
	s, ok := ctx.Value(contractStorageKey{}).(ContractStorage)
	if !ok {
		return logical
	}
	switch logical {
	case "audit_log":
		return s.audit
	case "domain_event_outbox":
		return s.events
	default:
		return logical
	}
}
