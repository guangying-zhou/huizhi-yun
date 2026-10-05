package integrationoperation

import (
	"fmt"
	"strings"
)

// WithOutboxTables binds trusted Registry identifiers. This is not a request or
// SQL API: callers must resolve the complete immutable mapping before creation.
func WithOutboxTables(tables OutboxTables) RepositoryOption {
	return func(r *Repository) error {
		if err := tables.Validate(); err != nil {
			return err
		}
		copy := tables
		r.outboxTables = &copy
		return nil
	}
}

func (r *Repository) sql(query string) string { return mapOutboxSQL(query, r.outboxTables) }

// mapOutboxSQL substitutes only complete identifier tokens in static repository
// SQL. String literals and comments are opaque, including escaped quotes. The
// default repository preserves its SQL byte for byte.
func mapOutboxSQL(query string, tables *OutboxTables) string {
	if tables == nil {
		return query
	}
	names := map[string]string{
		"integration_operation":                        tables.Operation(),
		"integration_operation_attempt":                tables.Attempt(),
		"service_command_receipt":                      tables.Receipt(),
		"integration_operation_dead_letter_actionable": tables.DeadLetterActionable(),
	}
	return mapRepositoryIdentifiers(query, names)
}

func mapRepositoryIdentifiers(query string, names map[string]string) string {
	var out strings.Builder
	for i := 0; i < len(query); {
		start := i
		c := query[i]
		switch {
		case c == '\'' || c == '"' || c == '`':
			i++
			for i < len(query) {
				if query[i] == '\\' && c != '`' && i+1 < len(query) {
					i += 2
					continue
				}
				if query[i] == c {
					i++
					if i < len(query) && query[i] == c {
						i++
						continue
					}
					break
				}
				i++
			}
			if c == '`' && i > start+1 && query[i-1] == '`' {
				if mapped, ok := names[query[start+1:i-1]]; ok {
					out.WriteString(mapped)
					continue
				}
			}
		case c == '#' || (c == '-' && i+2 < len(query) && query[i+1] == '-' && query[i+2] <= ' '):
			for i < len(query) && query[i] != '\n' {
				i++
			}
		case c == '/' && i+1 < len(query) && query[i+1] == '*':
			i += 2
			for i < len(query) && !(query[i-1] == '*' && query[i] == '/') {
				i++
			}
			if i < len(query) {
				i++
			}
		case outboxSQLIdentifierByte(c):
			i++
			for i < len(query) && outboxSQLIdentifierByte(query[i]) {
				i++
			}
			if mapped, ok := names[query[start:i]]; ok {
				out.WriteString(mapped)
				continue
			}
		default:
			i++
		}
		out.WriteString(query[start:i])
	}
	return out.String()
}

func outboxSQLIdentifierByte(c byte) bool {
	return c >= 'a' && c <= 'z' || c >= 'A' && c <= 'Z' || c >= '0' && c <= '9' || c == '_' || c == '$' || c >= 128
}

// WithReceiptOutboxTables keeps receipt storage in the same Registry mapping as
// its corresponding operation repository without changing receipt validation.
func WithReceiptOutboxTables(tables OutboxTables) ReceiptRepositoryOption {
	return func(r *ReceiptRepository) error {
		if r.receiptTable != "" {
			return fmt.Errorf("receipt mapping options are mutually exclusive")
		}
		if err := tables.Validate(); err != nil {
			return err
		}
		copy := tables
		r.outboxTables = &copy
		return nil
	}
}

// WithReceiptTable binds the only table used by an owning command inbox.
// It does not imply dependencies on outbound scheduling tables.
func WithReceiptTable(registeredTable string) ReceiptRepositoryOption {
	return func(r *ReceiptRepository) error {
		if !outboxIdentifier.MatchString(registeredTable) || r.outboxTables != nil {
			return fmt.Errorf("invalid or conflicting registered receipt table")
		}
		r.receiptTable = registeredTable
		return nil
	}
}
func (r *ReceiptRepository) sql(query string) string {
	if r.receiptTable != "" {
		return mapRepositoryIdentifiers(query, map[string]string{"service_command_receipt": r.receiptTable})
	}
	return mapOutboxSQL(query, r.outboxTables)
}

// SQL rewrites the four outbox identifiers in static SQL to the physical tables
// bound to this trusted context. Domain code that writes outbox rows outside the
// Repository must run its statements through this: in a unified database the
// same logical name belongs to several domains, so an unmapped statement would
// silently reach another domain's table. A context without a resolved mapping,
// which is the legacy per-application database, returns the query unchanged.
func (t TrustedContext) SQL(query string) string { return mapOutboxSQL(query, t.OutboxTables) }
