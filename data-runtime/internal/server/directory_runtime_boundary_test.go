package server

import "testing"

func TestDirectoryRuntimeInternalBoundaryAcceptsOnlyLoopback(t *testing.T) {
	for _, address := range []string{"127.0.0.1:43120", "[::1]:43120", "127.0.0.1"} {
		if !isLoopbackRemote(address) {
			t.Fatalf("expected loopback address to be accepted: %s", address)
		}
	}
	for _, address := range []string{"10.0.0.8:43120", "203.0.113.2:43120", "", "localhost:43120"} {
		if isLoopbackRemote(address) {
			t.Fatalf("expected non-IP remote address to be rejected: %s", address)
		}
	}
}
