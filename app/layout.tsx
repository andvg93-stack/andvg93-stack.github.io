import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'Café 2035 · Huila',
  description:
    'Simulador educativo de la evolución estimada de la huella cafetera y la salud territorial del Huila entre 2026 y 2035.',
  manifest: '/manifest.webmanifest',
  icons: { icon: '/favicon.svg' },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="es">
      <body>{children}</body>
    </html>
  );
}
