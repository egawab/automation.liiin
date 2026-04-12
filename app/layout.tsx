import './globals.css';
import { ToastProvider } from '@/components/ui/Toast';

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
    <html lang="en">
      <body>
        {children}
        <ToastProvider />
      </body>
    </html>
  );
}
