import type { Metadata } from "next";
import { Noto_Sans } from "next/font/google";
import { ThemeProvider } from "next-themes";
import {
  JsonLd,
  buildOrganization,
  buildWebSite,
} from "@shamwari/ui/lib/jsonld";
import "./globals.css";

const notoSans = Noto_Sans({
  variable: "--font-noto-sans",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: {
    default: "Shamwari AI Platform",
    template: "%s | Shamwari AI Platform",
  },
  description:
    "Developer and business portal — API keys, usage dashboards, billing, and documentation for Shamwari AI.",
  metadataBase: new URL("https://platform.shamwari.ai"),
  openGraph: {
    type: "website",
    siteName: "Shamwari AI Platform",
    locale: "en_US",
    title: "Shamwari AI Platform",
    description:
      "Developer and business portal — API keys, usage dashboards, billing, and documentation for Shamwari AI.",
    url: "https://platform.shamwari.ai",
  },
  twitter: {
    card: "summary_large_image",
    title: "Shamwari AI Platform",
    description:
      "Developer and business portal — API keys, usage dashboards, billing, and documentation for Shamwari AI.",
  },
};

const nyuchiOrg = buildOrganization({
  name: "Nyuchi Africa",
  url: "https://nyuchi.africa",
  description:
    "Zimbabwean tech company building open source, community-based platforms for Africa.",
  founder: { name: "Bryan Fawcett" },
});

const platformSite = buildWebSite({
  name: "Shamwari AI Platform",
  url: "https://platform.shamwari.ai",
  description:
    "Developer and business portal — API keys, usage dashboards, billing, and documentation for Shamwari AI.",
  publisher: { name: "Nyuchi Africa", url: "https://nyuchi.africa" },
  inLanguage: ["en"],
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
        <JsonLd data={platformSite} />
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
