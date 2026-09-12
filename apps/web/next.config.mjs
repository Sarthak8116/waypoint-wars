/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Shared workspace packages ship as TypeScript source, not built JS.
  transpilePackages: ['@ww/shared', '@ww/hunt-engine', '@ww/game'],
};
export default nextConfig;
