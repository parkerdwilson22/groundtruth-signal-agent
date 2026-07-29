import type { Metadata } from 'next';
import { Inter, IBM_Plex_Mono, Space_Grotesk } from 'next/font/google';
import './globals.css';

const inter = Inter({ variable: '--font-sans-gt', subsets: ['latin'] });
const mono = IBM_Plex_Mono({
  variable: '--font-mono-gt',
  subsets: ['latin'],
  weight: ['400', '500'],
});
const display = Space_Grotesk({
  variable: '--font-display-gt',
  subsets: ['latin'],
  weight: ['500', '600'],
});

export const metadata: Metadata = {
  title: 'GroundTruth Signal Agent',
  description: 'Real estate drone-shoot prospecting agent for GroundTruth.',
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html
      lang="en"
      className={`${inter.variable} ${mono.variable} ${display.variable} h-full antialiased`}
    >
      <body className="min-h-full font-sans">{children}</body>
    </html>
  );
}
