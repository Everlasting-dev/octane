import { fileURLToPath } from "node:url"
import { dirname } from "node:path"

const __dirname = dirname(fileURLToPath(import.meta.url))
const isGithubPages = process.env.GITHUB_PAGES === "true"
const githubPagesBasePath = "/octane"
const basePath = isGithubPages ? githubPagesBasePath : ""

/** @type {import('next').NextConfig} */
const nextConfig = {
  // Static HTML/JS bundle so Electron can serve it offline (out/).
  output: "export",
  basePath: basePath || undefined,
  assetPrefix: basePath || undefined,
  trailingSlash: true,
  env: {
    NEXT_PUBLIC_BASE_PATH: basePath,
  },
  // Pin the workspace root so the sibling Electron app's lockfile is ignored.
  turbopack: {
    root: __dirname,
  },
  typescript: {
    ignoreBuildErrors: true,
  },
  images: {
    unoptimized: true,
  },
}

export default nextConfig
