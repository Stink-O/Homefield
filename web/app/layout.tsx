import type { Metadata } from "next";
import { Outfit, JetBrains_Mono } from "next/font/google";
import { AppProvider } from "@/contexts/AppContext";
import { SessionProvider } from "next-auth/react";
import "./globals.css";

const outfit = Outfit({
  variable: "--font-outfit",
  subsets: ["latin"],
  display: "swap",
});

const jetbrainsMono = JetBrains_Mono({
  variable: "--font-jetbrains-mono",
  subsets: ["latin"],
  display: "swap",
});

export const metadata: Metadata = {
  title: "HomeField",
  description: "Private image generation studio",
  icons: {
    icon: "/favicon.ico",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body
        className={`${outfit.variable} ${jetbrainsMono.variable} antialiased`}
      >
        <SessionProvider>
          <AppProvider>{children}</AppProvider>
        </SessionProvider>
        <script
          dangerouslySetInnerHTML={{
            __html: `
              (function() {
                var stored = localStorage.getItem('theme');
                var theme;
                if (stored === 'light' || stored === 'dark') {
                  theme = stored;
                } else {
                  theme = window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
                }
                document.documentElement.setAttribute('data-theme', theme);
              })();
            `,
          }}
        />
        <script
          dangerouslySetInnerHTML={{
            __html: `
              (function() {
                if (localStorage.getItem('erudaEnabled') === 'true') {
                  var s = document.createElement('script');
                  s.src = 'https://cdn.jsdelivr.net/npm/eruda';
                  s.onload = function() { eruda.init(); };
                  document.head.appendChild(s);
                }
                if (localStorage.getItem('devOverlay') !== 'true') {
                  var style = document.createElement('style');
                  style.textContent = 'nextjs-portal { display: none !important; }';
                  document.head.appendChild(style);
                }
              })();
            `,
          }}
        />
      </body>
    </html>
  );
}
