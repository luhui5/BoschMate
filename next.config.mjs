/** @type {import('next').NextConfig} */
const nextConfig = {
  output: "export",
  trailingSlash: true,
  typescript: {
    ignoreBuildErrors: true,
  },
  images: {
    unoptimized: true,
  },
  async redirects() {
    return [
      {
        source: "/project/:id",
        destination: "/?project=:id",
        permanent: false,
      },
      {
        source: "/project",
        has: [{ type: "query", key: "id", value: "(?<projectId>.*)" }],
        destination: "/?project=:projectId",
        permanent: false,
      },
    ]
  },
}

export default nextConfig
