/** @type {import('next').NextConfig} */
const nextConfig = {
  // The whole UI is one static page in /public; serve it at the root.
  async rewrites() {
    return { beforeFiles: [{ source: '/', destination: '/index.html' }] }
  },
  async headers() {
    return [
      { source: '/api/:path*', headers: [{ key: 'Cache-Control', value: 'no-store' }] },
      { source: '/index.html', headers: [{ key: 'Cache-Control', value: 'no-cache' }] },
    ]
  },
}
module.exports = nextConfig
