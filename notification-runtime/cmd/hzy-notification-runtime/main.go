package main

import (
	"log"
	"os"

	"github.com/huizhi-yun/notification-runtime/internal/runtimeapp"
)

func main() {
	if err := runtimeapp.Run(os.Args[1:], runtimeapp.NotificationRuntime); err != nil {
		log.Fatal(err)
	}
}
