import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "한섬누리 | 주문통합",
  description:
    "판매처별 주문 엑셀을 하나의 발주서로 합치고 운송장번호를 원본 양식에 반영하세요.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="ko">
      <body>{children}</body>
    </html>
  );
}
