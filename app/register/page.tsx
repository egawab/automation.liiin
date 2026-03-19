'use client';

import { Suspense } from 'react';
import { useSearchParams } from 'next/navigation';
import LoginPage from '../login/page';

/**
 * Registration Page Wrapper
 * This prevents 404 when users navigate directly to /register.
 * It uses the existing LoginPage component but forces it into 'register' mode.
 */
export default function RegisterPage() {
    return (
        <Suspense fallback={<div className="min-h-screen bg-[#0a0a0a] flex items-center justify-center">
            <div className="w-8 h-8 border-2 border-white/20 border-t-white rounded-full animate-spin" />
        </div>}>
            <LoginPage />
        </Suspense>
    );
}
