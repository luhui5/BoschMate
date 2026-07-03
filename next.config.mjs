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
}

// redirects 与 static export 不兼容；开发模式下保留重定向行为
if (process.env.NODE_ENV === "development") {
  nextConfig.redirects = async () => [
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
}

export default nextConfig
