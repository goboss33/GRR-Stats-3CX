/** @type {import('next').NextConfig} */
const nextConfig = {
  output: 'standalone',
  
  // Proxy API requests to FastAPI backend
  async rewrites() {
    return [
      {
        source: '/api/python/:path*',
        destination: `${process.env.BACKEND_URL || 'http://localhost:8000'}/api/:path*`,
      },
    ];
  },
};

export default nextConfig;
