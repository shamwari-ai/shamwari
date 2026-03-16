import type { Metadata } from "next";
import { Noto_Sans } from "next/font/google";
import { ThemeProvider } from "next-themes";
import {
  JsonLd,
  buildOrganization,
  buildWebApplication,
} from "@shamwari/ui/lib/jsonld";
import "./globals.css";

const notoSans = Noto_Sans({
  variable: "--font-noto-sans",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: { default: "Shamwari AI", template: "%s | Shamwari AI" },
  description:
    "AI that actually works for Africa — small enough to run locally, smart enough to be useful, culturally grounded.",
  metadataBase: new URL("https://shamwari.ai"),
  openGraph: {
    type: "website",
    siteName: "Shamwari AI",
    locale: "en_US",
    title: "Shamwari AI",
    description:
      "AI that actually works for Africa — small enough to run locally, smart enough to be useful, culturally grounded.",
    url: "https://shamwari.ai",
  },
  twitter: {
    card: "summary_large_image",
    title: "Shamwari AI",
    description:
      "AI that actually works for Africa — small enough to run locally, smart enough to be useful, culturally grounded.",
  },
};

const nyuchiOrg = buildOrganization({
  name: "Nyuchi Africa",
  url: "https://nyuchi.africa",
  description:
    "Zimbabwean tech company building open source, community-based platforms for Africa.",
  founder: { name: "Bryan Fawcett" },
});

const shamwariApp = buildWebApplication({
  name: "Shamwari AI",
  url: "https://shamwari.ai",
  description:
    "AI that actually works for Africa — small enough to run locally, smart enough to be useful, culturally grounded.",
  applicationCategory: "Artificial Intelligence",
  operatingSystem: "Web, Android, iOS",
  inLanguage: ["en", "sn", "nd"],
  provider: { name: "Nyuchi Africa", url: "https://nyuchi.africa" },
});

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body className={`${notoSans.variable} font-sans antialiased`}>
        <JsonLd data={nyuchiOrg} />
        <JsonLd data={shamwariApp} />
        <ThemeProvider
          attribute="class"
          defaultTheme="system"
          enableSystem
          disableTransitionOnChange
        >
          {children}
        </ThemeProvider>
      </body>
    </html>
  );
}
