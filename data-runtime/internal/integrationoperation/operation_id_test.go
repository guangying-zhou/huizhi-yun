package integrationoperation

import (
	"errors"
	"strings"
	"testing"
)

type failingReader struct{}

func (failingReader) Read([]byte) (int, error) {
	return 0, errors.New("entropy unavailable")
}

func TestGenerateOperationIDUsesUUIDv4Bits(t *testing.T) {
	bytes := []byte{0x00, 0x01, 0x02, 0x03, 0x04, 0x05, 0x06, 0x07, 0x08, 0x09, 0x0a, 0x0b, 0x0c, 0x0d, 0x0e, 0x0f}
	got, err := GenerateOperationID(strings.NewReader(string(bytes)))
	want := "00010203-0405-4607-8809-0a0b0c0d0e0f"
	if err != nil || got != want {
		t.Fatalf("GenerateOperationID() = (%q, %v), want %q", got, err, want)
	}
	if err := ValidateOperationID(got); err != nil {
		t.Fatalf("generated ID rejected: %v", err)
	}
}

func TestOperationIDValidation(t *testing.T) {
	valid := []string{
		"550e8400-e29b-41d4-a716-446655440000",
		"ffffffff-ffff-4fff-bfff-ffffffffffff",
	}
	for _, value := range valid {
		if !IsValidOperationID(value) {
			t.Errorf("valid UUIDv4 rejected: %q", value)
		}
	}
	invalid := []string{
		"",
		"550e8400-e29b-11d4-a716-446655440000",
		"550e8400-e29b-41d4-c716-446655440000",
		"550E8400-E29B-41D4-A716-446655440000",
		"aims:project:PRJ-1:2026-07",
		"20260710120000",
	}
	for _, value := range invalid {
		if err := ValidateOperationID(value); !errors.Is(err, ErrInvalidOperationID) {
			t.Errorf("ValidateOperationID(%q) error = %v, want ErrInvalidOperationID", value, err)
		}
	}
}

func TestGenerateOperationIDRejectsMissingOrInsufficientEntropy(t *testing.T) {
	if _, err := GenerateOperationID(nil); err == nil {
		t.Fatal("nil reader unexpectedly accepted")
	}
	if _, err := GenerateOperationID(strings.NewReader("short")); err == nil {
		t.Fatal("short reader unexpectedly accepted")
	}
	if _, err := GenerateOperationID(failingReader{}); err == nil {
		t.Fatal("reader failure unexpectedly accepted")
	}
}
