'use client';

import React, { useState, useEffect, Suspense } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { motion } from 'motion/react';
import { MessageSquare, PenTool, Sparkles, Mail, Lock, ArrowRight, Shield, Sun, Moon } from 'lucide-react';
import { showToast } from '@/components/ui/Toast';
import { useTheme } from '@/components/theme-provider';

function LoginFormFallback() {
    return (
        <div className="min-h-screen flex items-center justify-center p-4 bg-page">
            <div className="w-5 h-5 border-2 border-border-subtle border-t-apple-blue rounded-full animate-spin" />
        </div>
    );
}

function LoginForm() {
    const router = useRouter();
    const searchParams = useSearchParams();
    const initialIsLogin = searchParams.get('mode') !== 'register';
    const [isLogin, setIsLogin] = useState(initialIsLogin);
    const [email, setEmail] = useState('');
    const [password, setPassword] = useState('');
    const [error, setError] = useState('');
    const [loading, setLoading] = useState(false);
    const { theme, toggleTheme } = useTheme();

    useEffect(() => {
        setIsLogin(searchParams.get('mode') !== 'register');
    }, [searchParams]);

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        setError('');
        setLoading(true);

        try {
            const endpoint = isLogin ? '/api/auth/login' : '/api/auth/register';
            const res = await fetch(endpoint, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ email, password }),
                credentials: 'include'
            });

            console.log(`[Diagnostic] ${endpoint} Status: ${res.status}`);

            let data;
            try {
                data = await res.json();
            } catch (e) {
                console.error('[Diagnostic] Failed to parse API JSON response:', e);
                throw new Error('Server returned invalid response. Check Vercel Logs for database connection issues.');
            }

            if (!res.ok) {
                console.error('❌ API Error Details:', JSON.stringify(data, null, 2));
                if (data.details) {
                    console.error('🔍 Forensic Details (Expanded):', JSON.stringify(data.details, null, 2));
                    if (JSON.stringify(data.details).includes('DATABASE_URL')) {
                        console.error('💡 HINT: Go to Vercel Settings > Environment Variables and add DATABASE_URL!');
                    }
                }
                throw new Error(data.error || 'Something went wrong');
            }

            showToast.success(isLogin ? 'Welcome back!' : 'Account created successfully!');
            window.location.href = '/dashboard';
        } catch (err: any) {
            console.error('⚠️ Diagnostic Caught Error:', err.message);
            setError(err.message);
            showToast.error(err.message);
        } finally {
            setLoading(false);
        }
    };

    return (
        <div className="min-h-screen flex items-center justify-center p-4 bg-page relative">
            {/* Theme toggle - top right */}
            <button
                onClick={toggleTheme}
                className="absolute top-4 right-4 p-2 rounded-full bg-surface-hover hover:bg-surface-elevated transition-premium text-secondary hover:text-primary z-10"
                aria-label="Toggle theme"
            >
                {theme === 'dark' ? <Sun className="w-5 h-5" /> : <Moon className="w-5 h-5" />}
            </button>

            <motion.div
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.6, ease: [0.22, 1, 0.36, 1] }}
                className="w-full max-w-5xl"
            >
                <div className="flex flex-col md:flex-row overflow-hidden rounded-xl bg-surface-elevated border border-border-subtle apple-shadow-lg">
                    {/* Left Side: Value Prop */}
                    <motion.div
                        initial={{ opacity: 0, x: -20 }}
                        animate={{ opacity: 1, x: 0 }}
                        transition={{ duration: 0.6, delay: 0.2 }}
                        className="w-full md:w-1/2 p-10 lg:p-14 bg-surface hidden md:flex flex-col justify-center border-r border-border-subtle"
                    >
                        <Link href="/" className="inline-block mb-12">
                            <span className="text-primary text-xl font-semibold tracking-tight">Nexora</span>
                        </Link>

                        <h1 className="text-section-heading text-primary mb-4">
                            Your AI Agent
                            <br />
                            <span className="text-secondary">is waiting.</span>
                        </h1>
                        <p className="text-body text-secondary mb-12">
                            Start growing your LinkedIn presence on autopilot in just 2 minutes.
                        </p>

                        <div className="space-y-6">
                            {[
                                { icon: MessageSquare, title: 'Smart Comment Engine', desc: 'Borrow reach from influencers by adding value to their posts' },
                                { icon: PenTool, title: 'Auto-Generated Posts', desc: 'Thought leadership content based on real trends and your brand' },
                                { icon: Sparkles, title: 'Full Autopilot', desc: 'Set it once and let AI handle your LinkedIn engagement 24/7' },
                            ].map((f, idx) => (
                                <div key={idx} className="flex gap-3">
                                    <div className="w-9 h-9 rounded-full bg-surface-hover flex items-center justify-center flex-shrink-0">
                                        <f.icon className="text-secondary w-4 h-4" />
                                    </div>
                                    <div>
                                        <h3 className="text-caption-bold text-primary mb-0.5">{f.title}</h3>
                                        <p className="text-micro text-tertiary">{f.desc}</p>
                                    </div>
                                </div>
                            ))}
                        </div>
                    </motion.div>

                    {/* Right Side: Form */}
                    <motion.div
                        initial={{ opacity: 0, x: 20 }}
                        animate={{ opacity: 1, x: 0 }}
                        transition={{ duration: 0.6, delay: 0.3 }}
                        className="w-full md:w-1/2 p-8 md:p-10 lg:p-14 flex flex-col justify-center"
                    >
                        {/* Mobile Logo */}
                        <Link href="/" className="inline-block md:hidden mb-8">
                            <span className="text-primary text-lg font-semibold tracking-tight">Nexora</span>
                        </Link>

                        <div className="mb-8">
                            <h2 className="text-tile-heading text-primary mb-2">
                                {isLogin ? 'Welcome back' : 'Get started'}
                            </h2>
                            <p className="text-caption text-secondary">
                                {isLogin
                                    ? 'Sign in to check on your agent and LinkedIn growth'
                                    : 'Create your account and start growing today'}
                            </p>
                        </div>

                        <form onSubmit={handleSubmit} className="space-y-5">
                            {/* Email */}
                            <div className="space-y-1.5">
                                <label className="text-micro-bold text-secondary">Email Address</label>
                                <div className="relative">
                                    <div className="absolute left-3 top-1/2 -translate-y-1/2 text-tertiary">
                                        <Mail className="w-4 h-4" />
                                    </div>
                                    <input
                                        type="email"
                                        required
                                        value={email}
                                        onChange={(e) => setEmail(e.target.value)}
                                        placeholder="name@company.com"
                                        className="w-full pl-10 pr-4 py-3 bg-surface-hover rounded-lg text-primary text-caption placeholder:text-tertiary focus:outline-none focus:ring-2 focus:ring-apple-blue/40 border border-border-subtle hover:border-border-default transition-all"
                                    />
                                </div>
                                {error && error.toLowerCase().includes('email') && (
                                    <p className="text-micro text-error">{error}</p>
                                )}
                            </div>

                            {/* Password */}
                            <div className="space-y-1.5">
                                <div className="flex items-center justify-between">
                                    <label className="text-micro-bold text-secondary">Password</label>
                                    {isLogin && (
                                        <a href="#" className="text-micro text-apple-blue hover:underline">Forgot password?</a>
                                    )}
                                </div>
                                <div className="relative">
                                    <div className="absolute left-3 top-1/2 -translate-y-1/2 text-tertiary">
                                        <Lock className="w-4 h-4" />
                                    </div>
                                    <input
                                        type="password"
                                        required
                                        value={password}
                                        onChange={(e) => setPassword(e.target.value)}
                                        placeholder="••••••••"
                                        className="w-full pl-10 pr-4 py-3 bg-surface-hover rounded-lg text-primary text-caption placeholder:text-tertiary focus:outline-none focus:ring-2 focus:ring-apple-blue/40 border border-border-subtle hover:border-border-default transition-all"
                                    />
                                </div>
                                {error && error.toLowerCase().includes('password') && (
                                    <p className="text-micro text-error">{error}</p>
                                )}
                            </div>

                            {/* General Error */}
                            {error && !error.toLowerCase().includes('email') && !error.toLowerCase().includes('password') && (
                                <p className="text-micro text-error">{error}</p>
                            )}

                            {/* Submit — Apple Blue */}
                            <button
                                type="submit"
                                disabled={loading}
                                className="w-full py-3 bg-apple-blue hover:opacity-90 text-white text-body-emphasis rounded-lg transition-premium press-effect flex items-center justify-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
                            >
                                {loading ? (
                                    <div className="flex items-center gap-2">
                                        <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                                        <span>Processing...</span>
                                    </div>
                                ) : (
                                    <>
                                        <span>{isLogin ? 'Sign In' : 'Create Account'}</span>
                                        <ArrowRight className="w-4 h-4" />
                                    </>
                                )}
                            </button>
                        </form>

                        {/* Toggle */}
                        <div className="mt-6 text-center">
                            <p className="text-micro text-secondary">
                                {isLogin ? "Don't have an account? " : 'Already have an account? '}
                                <button
                                    type="button"
                                    onClick={() => { setIsLogin(!isLogin); setError(''); }}
                                    className="text-apple-blue hover:underline font-medium"
                                >
                                    {isLogin ? 'Sign up' : 'Sign in'}
                                </button>
                            </p>
                        </div>

                        {/* Terms */}
                        {!isLogin && (
                            <div className="mt-6 pt-5 border-t border-border-subtle">
                                <div className="flex items-start gap-2">
                                    <Shield className="w-3.5 h-3.5 text-tertiary mt-0.5 flex-shrink-0" />
                                    <p className="text-micro text-tertiary">
                                        By creating an account, you agree to our{' '}
                                        <a href="#" className="text-apple-blue hover:underline">Terms of Service</a>{' '}
                                        and{' '}
                                        <a href="#" className="text-apple-blue hover:underline">Privacy Policy</a>
                                    </p>
                                </div>
                            </div>
                        )}
                    </motion.div>
                </div>
            </motion.div>
        </div>
    );
}

export default function LoginPage() {
    return (
        <Suspense fallback={<LoginFormFallback />}>
            <LoginForm />
        </Suspense>
    );
}
