import type { Metadata, Viewport } from 'next';
import { Pixelify_Sans, Nunito } from 'next/font/google';
import './globals.css';
import { Toaster } from '@/components/ui/toaster';
import { PwaProvider } from '@/components/pwa/pwa-provider';

const pixelifySans = Pixelify_Sans({
  subsets: ['latin'],
  weight: ['500', '700'],
  variable: '--font-pixelify',
});

const nunito = Nunito({
  subsets: ['latin'],
  weight: ['500', '600', '700'],
  variable: '--font-nunito',
});

export const viewport: Viewport = {
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#5fb336' },
    { media: '(prefers-color-scheme: dark)', color: '#101c33' },
  ],
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover',
};

export const metadata: Metadata = {
  title: 'Minecraft Pixel Art Generator',
  description: 'Ultimate Edition: Convert images into block art and Sponge Schematics.',
  applicationName: 'MC PixelArt',
  manifest: '/manifest.webmanifest',
  appleWebApp: {
    capable: true,
    statusBarStyle: 'default',
    title: 'MC PixelArt',
  },
  icons: {
    icon: [
      { url: '/icon.svg', type: 'image/svg+xml' },
      { url: '/pwa-192x192.png', sizes: '192x192', type: 'image/png' },
      { url: '/pwa-512x512.png', sizes: '512x512', type: 'image/png' },
    ],
    apple: [{ url: '/apple-touch-icon.png', sizes: '180x180', type: 'image/png' }],
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className={`${pixelifySans.variable} ${nunito.variable}`}>
      <body className="font-body antialiased">
        {children}
        <PwaProvider />
        <Toaster />
      </body>
    </html>
  );
}
