package server

import (
	"errors"
	"net/http"
	"testing"

	"github.com/huizhi-yun/data-runtime/internal/httperror"
)

func TestDecodeConsoleDirectoryProjectCodeAcceptsNamespacedCode(t *testing.T) {
	for _, value := range []string{"huizhi-yun/account", "huizhi-yun%2Faccount"} {
		code, err := decodeConsoleDirectoryProjectCode(value)
		if err != nil {
			t.Fatal(err)
		}
		if code != "huizhi-yun/account" {
			t.Fatalf("value=%q code=%q", value, code)
		}
	}
}

func TestDecodeConsoleDirectoryProjectCodeRejectsInvalidPath(t *testing.T) {
	for _, value := range []string{"", "%2Faccount", "huizhi-yun%2F", "huizhi-yun%2F%2Faccount", "huizhi-yun%2F..%2Faccount"} {
		_, err := decodeConsoleDirectoryProjectCode(value)
		var httpErr httperror.Error
		if !errors.As(err, &httpErr) || httpErr.Status != http.StatusBadRequest || httpErr.Code != "directory_project_code_invalid" {
			t.Fatalf("value=%q err=%T %v", value, err, err)
		}
	}
}
