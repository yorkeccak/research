import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import { MissingKeysDialog } from "@/components/missing-keys-dialog";
import { OllamaProvider } from "@/lib/ollama-context";
import { Analytics } from '@vercel/analytics/next';
import { AuthInitializer } from "@/components/auth/auth-initializer";
import { QueryProvider } from "@/components/query-provider";
import { ThemeProvider } from "@/components/theme-provider";
import { logEnvironmentStatus } from "@/lib/env-validation";
const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  metadataBase: new URL(
    process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000"
  ),
  title: {
    default: "Patents by Valyu",
    template: "%s | Patents by Valyu",
  },
  description:
    "AI-powered analysis by Valyu. Real-time data, secure Python execution in Daytona sandboxes, and interactive visualizations for research and reporting.",
  applicationName: "Patents by Valyu",
  openGraph: {
    title: "Patents by Valyu",
    description:
      "AI-powered analysis by Valyu. Real-time data, secure Python execution in Daytona sandboxes, and interactive visualizations for research and reporting.",
    url: "/",
    siteName: "Patents by Valyu",
    images: [
      {
        url: "/valyu.png",
        width: 1200,
        height: 630,
        alt: "Patents by Valyu",
      },
    ],
    locale: "en_US",
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: "Patents by Valyu",
    description:
      "AI-powered analysis by Valyu. Real-time data, secure Python execution in Daytona sandboxes, and interactive visualizations for research and reporting.",
    images: ["/valyu.png"],
  },
  icons: {
    icon: "/favicon.ico",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  // Log environment status on server-side render
  if (typeof window === 'undefined') {
    logEnvironmentStatus();
  }
  
  return (
    <html lang="en" suppressHydrationWarning>
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased`}
      >
        <ThemeProvider
          attribute="class"
          defaultTheme="light"
          enableSystem
          disableTransitionOnChange
        >
          <QueryProvider>
            <AuthInitializer>
              <OllamaProvider>
                <MissingKeysDialog />
                {children}
                <Analytics />
              </OllamaProvider>
            </AuthInitializer>
          </QueryProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}