import type { Metadata } from "next";
import "./globals.css";
import "./recording.css";
import "./range.css";
import "./session.css";
import "./blind.css";
import "./dashboard.css";

export const metadata: Metadata = {
  title: "Tone Lab — ギター音の比較と調整支援",
  description: "参考音と自分の録音を比較し、調整履歴、ブラインドA/B、聴感評価の集計から5つの質感差を検証できる音作り支援ツール。",
  applicationName: "Tone Lab",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="ja">
      <body>{children}</body>
    </html>
  );
}
