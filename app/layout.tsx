import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'Paulo Fonseca | 10% Delegatoooor Kickback Program',
  description: 'An Arbitrum DAO governance experiment: delegate rewards shared with token holders',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}

