import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    /**
     * `worker_threads`, not child processes.
     *
     * `@colyseus/testing` imports `@colyseus/tools`, which pulls in `@pm2/io`,
     * which calls `process.send({...})` at module load. In vitest's default
     * `forks` pool that IPC channel belongs to the test runner, and an
     * unexpected object on it kills the worker before a single test reports
     * (`ERR_INVALID_ARG_TYPE` out of tinypool). In a worker thread
     * `process.send` is undefined, so the transport never engages.
     */
    pool: 'threads',
    /**
     * `@colyseus/testing`'s `boot()` binds a fixed port (2568), so two files
     * booting a server at the same time would collide. Serialising the files
     * costs a second and removes a whole class of flaky failures.
     */
    fileParallelism: false,
    testTimeout: 20_000,
    hookTimeout: 20_000,
  },
});
