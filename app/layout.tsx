import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Sainz.ai",
  description: "Escaner nutricional inteligente de Sainz.ai con Gemini"
};

export default function RootLayout({
  children
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
