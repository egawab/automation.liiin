import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  reactStrictMode: true,
  eslint: {
    ignoreDuringBuilds: true,
  },
  typescript: {
    ignoreBuildErrors: false,
  },
  // Allow access to remote image placeholder.
  images: {
    remotePatterns: [
      {
        protocol: 'https',
        hostname: 'picsum.photos',
        port: '',
        pathname: '/**', // This allows any path under the hostname
      },
    ],
  },
  transpilePackages: ['motion'],
  // Ensure extension download is served with correct headers (no stale cache)
  async headers() {
    return [
      {
        source: '/nexora-extension.zip',
        headers: [
          { key: 'Content-Type', value: 'application/zip' },
          { key: 'Content-Disposition', value: 'attachment; filename="nexora-extension.zip"' },
          { key: 'Cache-Control', value: 'no-cache, no-store, must-revalidate' },
        ],
      },
      {
        source: '/UPDATEFI.zip',
        headers: [
          { key: 'Content-Type', value: 'application/zip' },
          { key: 'Content-Disposition', value: 'attachment; filename="nexora-extension.zip"' },
          { key: 'Cache-Control', value: 'no-cache, no-store, must-revalidate' },
        ],
      },
      {
        source: '/LinkedInExtension.zip',
        headers: [
          { key: 'Content-Type', value: 'application/zip' },
          { key: 'Content-Disposition', value: 'attachment; filename="nexora-extension.zip"' },
          { key: 'Cache-Control', value: 'no-cache, no-store, must-revalidate' },
        ],
      },
      {
        source: '/finalextension.zip',
        headers: [
          { key: 'Content-Type', value: 'application/zip' },
          { key: 'Content-Disposition', value: 'attachment; filename="finalextension.zip"' },
        ],
      },
    ];
  },
  webpack: (config, { dev }) => {
    // HMR is disabled in AI Studio via DISABLE_HMR env var.
    // Do not modify—file watching is disabled to prevent flickering during agent edits.
    if (dev && process.env.DISABLE_HMR === 'true') {
      config.watchOptions = {
        ignored: /.*/,
      };
    }
    return config;
  },
};

export default nextConfig;
