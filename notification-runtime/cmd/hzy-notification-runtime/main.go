package main

import (
	"context"
	"flag"
	"fmt"
	"log"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"

	"github.com/huizhi-yun/notification-runtime/internal/config"
	"github.com/huizhi-yun/notification-runtime/internal/server"
	"github.com/huizhi-yun/notification-runtime/internal/updater"
	"github.com/huizhi-yun/notification-runtime/internal/version"
)

func main() {
	update := flag.Bool("update", false, "check and apply runtime update")
	showVersion := flag.Bool("version", false, "print version")
	flag.Parse()

	cfg := config.Load()
	if *showVersion {
		fmt.Println(version.Version)
		return
	}
	if *update {
		if err := updater.CheckAndApply(context.Background(), cfg.Update); err != nil {
			log.Fatal(err)
		}
		return
	}

	addr := cfg.Host + ":" + cfg.Port
	runtimeServer := server.New(cfg)
	httpServer := &http.Server{
		Addr:              addr,
		Handler:           runtimeServer.Handler(),
		ReadHeaderTimeout: cfg.HTTP.ReadHeaderTimeout,
	}

	go func() {
		log.Printf("hzy-notification-runtime version=%s addr=%s auth=%s", version.Version, addr, cfg.Auth.Mode)
		if err := httpServer.ListenAndServe(); err != nil && err != http.ErrServerClosed {
			log.Fatal(err)
		}
	}()

	stop := make(chan os.Signal, 1)
	signal.Notify(stop, syscall.SIGINT, syscall.SIGTERM)
	<-stop

	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	if err := httpServer.Shutdown(ctx); err != nil {
		log.Fatal(err)
	}
}
