import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'Voting Power Tracker',
  description: 'Track ERC20Votes delegation power over time',
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

