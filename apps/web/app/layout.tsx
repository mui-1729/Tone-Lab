import type { Metadata } from "next";
import "./globals.css";
import "./recording.css";
import "./range.css";

export const metadata: Metadata = {
  title: "Tone Lab — ギター音の比較と調整支援",
  description: "参考音の比較区間を選び、自分のギター音をファイルまたはブラウザ録音から比較して、5つの質感差、調整プラン、A/B試聴を表示する音作り支援ツール。",
  applicationName: "Tone Lab",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="ja">
      <body>{children}</body>
    </html>
  );
}
