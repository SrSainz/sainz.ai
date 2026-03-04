import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "SainzCal AI",
  description: "Food scanner and calorie tracker powered by Gemini"
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
