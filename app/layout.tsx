import type { Metadata, Viewport } from 'next'
import { Geist, Geist_Mono } from 'next/font/google'
import './globals.css'

const geistSans = Geist({ variable: '--font-geist-sans', subsets: ['latin'] })
const geistMono = Geist_Mono({
  variable: '--font-geist-mono',
  subsets: ['latin'],
})
const siteUrl =
  process.env.NEXT_PUBLIC_SITE_URL ??
  (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : 'https://octane.local')
const publicBasePath = process.env.NEXT_PUBLIC_BASE_PATH ?? ''
const assetPath = (path: string) => `${publicBasePath}${path}`
const siteOrigin = new URL(siteUrl).origin
const absoluteAssetUrl = (path: string) => new URL(assetPath(path), siteOrigin).toString()

export const metadata: Metadata = {
  metadataBase: new URL(siteUrl),
  applicationName: 'Octane',
  title: {
    default: 'Octane',
    template: '%s | Octane',
  },
  description: 'Development-stage ECU telemetry log viewer for inspecting, comparing and tuning from CSV captures.',
  generator: 'Octane',
  manifest: assetPath('/manifest.webmanifest'),
  authors: [{ name: 'AK Everlasting Dev' }],
  keywords: ['Octane', 'ECU telemetry', 'EcuTek', 'CSV log analyzer', 'telemetry viewer'],
  category: 'utilities',
  appleWebApp: {
    capable: true,
    statusBarStyle: 'black-translucent',
    title: 'Octane',
  },
  formatDetection: {
    telephone: false,
  },
  openGraph: {
    title: 'Octane',
    description: 'Inspect, compare and tune from ECU telemetry logs directly in your browser.',
    url: '/',
    siteName: 'Octane',
    type: 'website',
    images: [
      {
        url: absoluteAssetUrl('/og-image.png'),
        width: 1200,
        height: 630,
        alt: 'Octane logo',
      },
    ],
  },
  twitter: {
    card: 'summary_large_image',
    title: 'Octane',
    description: 'Development-stage ECU telemetry log viewer for CSV captures.',
    images: [absoluteAssetUrl('/og-image.png')],
  },
  icons: {
    icon: [
      {
        url: assetPath('/icon-light-32x32.png'),
        sizes: '32x32',
        type: 'image/png',
        media: '(prefers-color-scheme: light)',
      },
      {
        url: assetPath('/icon-dark-32x32.png'),
        sizes: '32x32',
        type: 'image/png',
        media: '(prefers-color-scheme: dark)',
      },
      {
        url: assetPath('/icon.svg'),
        type: 'image/svg+xml',
      },
      {
        url: assetPath('/icon-192.png'),
        sizes: '192x192',
        type: 'image/png',
      },
      {
        url: assetPath('/icon-512.png'),
        sizes: '512x512',
        type: 'image/png',
      },
    ],
    shortcut: assetPath('/icon.svg'),
    apple: assetPath('/apple-icon.png'),
  },
}

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover',
  colorScheme: 'dark',
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#111827' },
    { media: '(prefers-color-scheme: dark)', color: '#0a0a0a' },
  ],
}

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode
}>) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} dark bg-background`}
    >
      <body className="font-sans antialiased">
        {children}
      </body>
    </html>
  )
}
