import type { Metadata } from "next";
import "./globals.css";
import "./recording.css";
import "./range.css";
import "./session.css";
import "./blind.css";

export const metadata: Metadata = {
  title: "Tone Lab — ギター音の比較と調整支援",
  description: "参考音の比較区間を選び、録音と比較を繰り返し、ブラインドA/Bと5つの質感差から調整結果を確認できる音作り支援ツール。",
  applicationName: "Tone Lab",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="ja">
      <body>{children}</body>
    </html>
  );
}
