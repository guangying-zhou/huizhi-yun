import 'dotenv/config';
import { startDataRuntime } from './runtime.js';
try {
    const runtime = await startDataRuntime();
    const shutdown = async () => {
        await runtime.stop();
        process.exit(0);
    };
    process.once('SIGINT', shutdown);
    process.once('SIGTERM', shutdown);
}
catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`[hzy-data-runtime] failed to start: ${message}`);
    process.exit(1);
}
