import './globals.css';
import { Inter } from 'next/font/google';
import { ToastProvider } from '@/components/ui/Toast';
import { ThemeProvider } from '@/components/theme-provider';

const inter = Inter({ subsets: ['latin'] });

export const metadata = {
  title: 'Nexora – Your AI LinkedIn Presence',
  description: 'Elevate your professional brand with intelligent LinkedIn automation. AI-powered engagement, auto-generated posts, and 24/7 presence.',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body className={inter.className}>
        <ThemeProvider>
          <ToastProvider />
          {children}
        </ThemeProvider>
      </body>
    </html>
  );
}
