import type { Metadata, Viewport } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'Waypoint Wars',
  description: 'A real-world historical scavenger hunt through Pittsburgh.',
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  // The map and camera views must not zoom-bounce while walking.
  maximumScale: 1,
  themeColor: '#0b1020',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
