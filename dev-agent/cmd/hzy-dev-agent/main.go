package main

import (
	"context"
	"errors"
	"fmt"
	"log"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"

	"github.com/huizhi-yun/dev-agent/internal/config"
	"github.com/huizhi-yun/dev-agent/internal/server"
	"github.com/huizhi-yun/dev-agent/internal/version"
)

func main() {
	if len(os.Args) > 1 && (os.Args[1] == "--version" || os.Args[1] == "version") {
		fmt.Printf("hzy-dev-agent %s (%s, %s)\n", version.Version, version.Commit, version.BuiltAt)
		return
	}

	cfg, err := config.Load()
	if err != nil {
		log.Fatalf("[hzy-dev-agent] load config failed: %v", err)
	}

	runtime := server.New(cfg)
	httpServer := &http.Server{
		Addr:              cfg.Server.Addr(),
		Handler:           runtime,
		ReadHeaderTimeout: 10 * time.Second,
	}

	errCh := make(chan error, 1)
	go func() {
		log.Printf("[hzy-dev-agent] listening on %s", cfg.Server.Addr())
		errCh <- httpServer.ListenAndServe()
	}()

	signalCh := make(chan os.Signal, 1)
	signal.Notify(signalCh, syscall.SIGINT, syscall.SIGTERM)

	select {
	case err := <-errCh:
		if err != nil && !errors.Is(err, http.ErrServerClosed) {
			log.Fatalf("[hzy-dev-agent] server stopped: %v", err)
		}
	case <-signalCh:
		ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
		defer cancel()
		if err := httpServer.Shutdown(ctx); err != nil {
			log.Fatalf("[hzy-dev-agent] shutdown failed: %v", err)
		}
	}
}
