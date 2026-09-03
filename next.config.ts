import type { NextConfig } from 'next';

const githubPages = process.env.GITHUB_PAGES === 'true';
const githubPagesBasePath = githubPages
  ? (process.env.GITHUB_PAGES_BASE_PATH ?? '/cafe-2035-huila')
  : '';

const nextConfig: NextConfig = githubPages
  ? {
      output: 'export',
      basePath: githubPagesBasePath,
      assetPrefix: githubPagesBasePath,
      trailingSlash: true,
    }
  : {};

export default nextConfig;
