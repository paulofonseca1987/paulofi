/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  productionBrowserSourceMaps: false,
  // Disable source maps completely to avoid permission issues
  webpack: (config, { dev, isServer }) => {
    // Completely disable source maps
    config.devtool = false;
    
    if (!isServer) {
      config.resolve.fallback = {
        ...config.resolve.fallback,
        fs: false,
      };
    }
    
    // Disable source map generation in loaders
    config.module.rules.forEach((rule) => {
      if (rule.use && Array.isArray(rule.use)) {
        rule.use.forEach((use) => {
          if (use.loader && use.loader.includes('next-swc-loader')) {
            use.options = use.options || {};
            use.options.sourceMaps = false;
          }
        });
      }
    });
    
    return config;
  },
}

module.exports = nextConfig

