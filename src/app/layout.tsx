import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Timoniere",
  description: "Timoni editoriali condivisi per riviste",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="it" suppressHydrationWarning>
      <body suppressHydrationWarning>{children}</body>
    </html>
  );
}
