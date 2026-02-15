/** @type {import('next').NextConfig} */
const nextConfig = {
    output: "export",
    images: {
        unoptimized: true,
    },
    // No basePath needed for custom domain (rajib.uk)
    basePath: "",
};

export default nextConfig;
