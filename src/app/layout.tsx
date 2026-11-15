import type { Metadata } from "next";
import localFont from "next/font/local";
import "./globals.css";

const geistSans = localFont({
  src: "./fonts/GeistVF.woff",
  variable: "--font-geist-sans",
  weight: "100 900",
});
const geistMono = localFont({
  src: "./fonts/GeistMonoVF.woff",
  variable: "--font-geist-mono",
  weight: "100 900",
});

const title = "Muhammad Rajib Hawlader | Senior Software Engineer";
const description =
  "Senior Software Engineer building secure connectivity, network-management and AI-enabled products. Python, JavaScript, DevSecOps, LLM integration.";

export const metadata: Metadata = {
  metadataBase: new URL("https://rajib.uk"),
  title,
  description,
  alternates: { canonical: "/" },
  openGraph: {
    type: "profile",
    url: "/",
    siteName: "rajib.uk",
    title,
    description,
    images: [{ url: "/profile.jpg", width: 240, height: 240, alt: "Muhammad Rajib Hawlader" }],
  },
  twitter: {
    card: "summary",
    title,
    description,
    images: ["/profile.jpg"],
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className="dark">
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased`}
      >
        {children}
      </body>
    </html>
  );
}
