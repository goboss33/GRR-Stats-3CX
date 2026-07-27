/** @type {import('next').NextConfig} */
const nextConfig = {
  output: 'standalone',

  // En-têtes de sécurité HTTP de base (conservateurs — pas de CSP stricte ici
  // pour ne pas casser les scripts/styles inline de Next).
  async headers() {
    return [
      {
        source: '/:path*',
        headers: [
          { key: 'X-Frame-Options', value: 'SAMEORIGIN' },
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          { key: 'X-DNS-Prefetch-Control', value: 'on' },
        ],
      },
    ];
  },

  // La page statistiques V1 a été retirée au profit de /statistics-v2.
  // Redirection temporaire (307) pour préserver les favoris existants.
  async redirects() {
    return [
      {
        source: '/statistics',
        destination: '/statistics-v2',
        permanent: false,
      },
    ];
  },

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
