import type { Metadata } from "next";
import "./globals.css";
import "./recording.css";
import "./range.css";
import "./session.css";
import "./blind.css";
import "./dashboard.css";
import "./live.css";

export const metadata: Metadata = {
  title: "Tone Lab 2.0 — ギター音の比較と調整支援",
  description: "参考音の準備、ブラウザ録音、反復調整、ブラインドA/B、聴感評価集計、演奏中のリアルタイム比較までを完結できる音作り支援ツール。",
  applicationName: "Tone Lab 2.0",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="ja">
      <body>{children}</body>
    </html>
  );
}
