/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,

  // Shared workspace packages ship as TypeScript source, not built JS.
  transpilePackages: ['@ww/shared', '@ww/hunt-engine', '@ww/game'],

  webpack: (config) => {
    // Those packages are ESM and import with explicit `.js` extensions, which
    // is correct for Node ESM but points at files that only exist as `.ts`.
    // Teach the resolver the mapping instead of stripping extensions from the
    // source (which would break `node --experimental-strip-types` and tsx).
    config.resolve.extensionAlias = {
      ...config.resolve.extensionAlias,
      '.js': ['.ts', '.tsx', '.js'],
      '.mjs': ['.mts', '.mjs'],
    };
    return config;
  },

  turbopack: {
    resolveExtensions: ['.ts', '.tsx', '.js', '.jsx', '.mjs', '.json'],
  },
};

export default nextConfig;
