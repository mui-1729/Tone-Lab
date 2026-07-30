import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Tone Lab",
  description: "参考音と自分のギター音を比較する音作り支援ツール",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="ja">
      <body>{children}</body>
    </html>
  );
}
