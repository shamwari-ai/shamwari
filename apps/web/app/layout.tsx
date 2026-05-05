import type { Metadata } from "next";
import Script from "next/script";
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
        <Script id="intercom-settings" strategy="afterInteractive">
          {`window.intercomSettings = { api_base: "https://api-iam.intercom.io", app_id: "f1vga504" };`}
        </Script>
        <Script id="intercom-loader" strategy="afterInteractive">
          {`(function(){var w=window;var ic=w.Intercom;if(typeof ic==="function"){ic('reattach_activator');ic('update',w.intercomSettings);}else{var d=document;var i=function(){i.c(arguments);};i.q=[];i.c=function(args){i.q.push(args);};w.Intercom=i;var l=function(){var s=d.createElement('script');s.type='text/javascript';s.async=true;s.src='https://widget.intercom.io/widget/f1vga504';var x=d.getElementsByTagName('script')[0];x.parentNode.insertBefore(s,x);};if(document.readyState==='complete'){l();}else if(w.attachEvent){w.attachEvent('onload',l);}else{w.addEventListener('load',l,false);}}})();`}
        </Script>
      </body>
    </html>
  );
}
