import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // `@colyseus/testing`'s `boot()` binds a fixed port (2568), so two files
    // booting a server at the same time would collide. Serialising the files
    // costs a second and removes a whole class of flaky failures.
    fileParallelism: false,
    testTimeout: 20_000,
    hookTimeout: 20_000,
  },
});
