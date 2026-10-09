package integrationoperation

import (
	"crypto/rand"
	"errors"
	"fmt"
	"io"
	"regexp"
)

var ErrInvalidOperationID = errors.New("invalid integration operation ID")

var operationIDPattern = regexp.MustCompile(`^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$`)

func NewOperationID() (string, error) {
	return GenerateOperationID(rand.Reader)
}

// GenerateOperationID creates an opaque UUIDv4 using only cryptographic random
// bytes from reader. It must not be replaced with timestamp or business-key
// derivation. Supplying a reader keeps generation deterministic in tests.
func GenerateOperationID(reader io.Reader) (string, error) {
	if reader == nil {
		return "", fmt.Errorf("operation ID random reader is required")
	}
	var value [16]byte
	if _, err := io.ReadFull(reader, value[:]); err != nil {
		return "", fmt.Errorf("generate operation ID: %w", err)
	}
	value[6] = value[6]&0x0f | 0x40
	value[8] = value[8]&0x3f | 0x80
	return fmt.Sprintf(
		"%08x-%04x-%04x-%04x-%012x",
		value[0:4],
		value[4:6],
		value[6:8],
		value[8:10],
		value[10:16],
	), nil
}

func ValidateOperationID(value string) error {
	if !operationIDPattern.MatchString(value) {
		return fmt.Errorf("%w: expected lowercase UUIDv4", ErrInvalidOperationID)
	}
	return nil
}

func IsValidOperationID(value string) bool {
	return ValidateOperationID(value) == nil
}
