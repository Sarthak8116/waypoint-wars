import type { Metadata, Viewport } from 'next';
import { Outfit, Space_Mono } from 'next/font/google';
import './globals.css';
import { RoomProvider } from '@/lib/RoomProvider';

/**
 * Outfit for everything — a heavy geometric sans, toy-like at 900 weight.
 * Space Mono for timers and room codes ONLY; nothing else is monospaced.
 * No serifs anywhere in the product.
 */
const outfit = Outfit({
  subsets: ['latin'],
  weight: ['500', '600', '800', '900'],
  variable: '--font-outfit',
  display: 'swap',
});

const spaceMono = Space_Mono({
  subsets: ['latin'],
  weight: ['700'],
  variable: '--font-mono',
  display: 'swap',
});

export const metadata: Metadata = {
  title: 'Waypoint Wars',
  description: 'A real-world historical scavenger hunt through Pittsburgh.',
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  // The map and camera views must not zoom-bounce while walking.
  maximumScale: 1,
  themeColor: '#1a1147',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${outfit.variable} ${spaceMono.variable}`}>
      <body>
        <RoomProvider>{children}</RoomProvider>
      </body>
    </html>
  );
}
