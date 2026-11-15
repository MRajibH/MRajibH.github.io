/** @type {import('next').NextConfig} */
const nextConfig = {
    output: "export",
    // /about/ -> out/about/index.html, which Cloudflare Pages and GitHub Pages both serve.
    trailingSlash: true,
    images: {
        unoptimized: true,
    },
    // No basePath needed for custom domain (rajib.uk)
    basePath: "",
};

export default nextConfig;
