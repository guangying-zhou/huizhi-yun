// Custom mocks for native Node.js modules to satisfy Rollup/Nitro build requirements
// These are only used during production builds for Cloudflare Pages

// Mock for @resvg/resvg-js
export class Resvg {
  constructor() {}
  render() {
    return {
      asPng: () => new Uint8Array()
    }
  }
}

// Mock for better-sqlite3
export class Database {
  constructor() {
    return new Proxy(this, {
      get: () => () => ({})
    })
  }
}

// Mock for process (to avoid stdout/stderr and env expansion errors)
const mockProcess = {
  env: {
    NODE_ENV: "production",
    // Add other necessary env vars if needed, or leave it to expand correctly
  },
  stdout: {
    write: () => {},
    on: () => {},
    once: () => {},
    emit: () => {},
  },
  stderr: {
    write: () => {},
    on: () => {},
    once: () => {},
    emit: () => {},
  },
  cwd: () => "/",
  platform: "linux",
  nextTick: (fn) => {
    if (typeof fn === 'function') {
      setTimeout(fn, 0);
    }
  },
  on: () => {},
  once: () => {},
  off: () => {},
};

export const process = mockProcess;
export const env = mockProcess.env;

// Satisfy different import styles
export default mockProcess;
