'use client';

import React, { useState, useEffect } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { motion } from 'motion/react';
import { MessageSquare, PenTool, Mail, Lock, Sparkles, ArrowRight, Shield } from 'lucide-react';
import { showToast } from '@/components/ui/Toast';
import NexoraLogo from '@/components/ui/NexoraLogo';

export default function LoginPage() {
    const router = useRouter();
    const searchParams = useSearchParams();
    // Default to registration mode when coming from "Get Started" / signup links (?mode=register)
    const initialIsLogin = searchParams.get('mode') !== 'register';
    const [isLogin, setIsLogin] = useState(initialIsLogin);
    const [email, setEmail] = useState('');
    const [password, setPassword] = useState('');
    const [error, setError] = useState('');
    const [loading, setLoading] = useState(false);

    // Sync isLogin when URL changes (e.g., user navigates to /login?mode=register)
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
                credentials: 'include' // Important: include cookies
            });

            const data = await res.json();

            if (!res.ok) {
                throw new Error(data.error || 'Something went wrong');
            }

            showToast.success(isLogin ? 'Welcome back!' : 'Account created successfully!');
            
            // Use window.location to ensure cookies are properly set before navigation
            window.location.href = '/dashboard';
        } catch (err: any) {
            setError(err.message);
            showToast.error(err.message);
        } finally {
            setLoading(false);
        }
    };

    return (
        <div className="min-h-screen flex items-center justify-center p-4 relative overflow-hidden bg-[#0a0a0a]">
            {/* Elegant Dark Background */}
            <div className="absolute inset-0 -z-10">
                {/* Subtle grid pattern */}
                <div className="absolute inset-0 bg-[url('data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iNjAiIGhlaWdodD0iNjAiIHhtbG5zPSJodHRwOi8vd3d3LnczLm9yZy8yMDAwL3N2ZyI+PGRlZnM+PHBhdHRlcm4gaWQ9ImdyaWQiIHdpZHRoPSI2MCIgaGVpZ2h0PSI2MCIgcGF0dGVyblVuaXRzPSJ1c2VyU3BhY2VPblVzZSI+PHBhdGggZD0iTSAxMCAwIEwgMCAwIDAgMTAiIGZpbGw9Im5vbmUiIHN0cm9rZT0icmdiYSgyNTUsMjU1LDI1NSwwLjAyKSIgc3Ryb2tlLXdpZHRoPSIxIi8+PC9wYXR0ZXJuPjwvZGVmcz48cmVjdCB3aWR0aD0iMTAwJSIgaGVpZ2h0PSIxMDAlIiBmaWxsPSJ1cmwoI2dyaWQpIi8+PC9zdmc+')] opacity-30" />
                {/* Subtle radial gradient */}
                <div className="absolute inset-0 bg-gradient-radial from-zinc-900/50 via-[#0a0a0a] to-[#0a0a0a]" />
            </div>

            <motion.div
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.6, ease: [0.22, 1, 0.36, 1] }}
                className="w-full max-w-6xl"
            >
                <div className="flex flex-col md:flex-row overflow-hidden rounded-2xl border border-zinc-800/50 bg-zinc-900/40 backdrop-blur-xl shadow-2xl shadow-black/50">
                    {/* Left Side: Premium Value Prop */}
                    <motion.div
                        initial={{ opacity: 0, x: -20 }}
                        animate={{ opacity: 1, x: 0 }}
                        transition={{ duration: 0.6, delay: 0.2, ease: [0.22, 1, 0.36, 1] }}
                        className="w-full md:w-1/2 p-12 lg:p-16 bg-zinc-900/60 border-r border-zinc-800/50 hidden md:flex flex-col justify-center relative overflow-hidden"
                    >
                        {/* Subtle background accent */}
                        <div className="absolute top-0 right-0 w-64 h-64 bg-zinc-800/30 rounded-full blur-3xl -z-10" />
                        
                        {/* Logo */}
                        <Link href="/" className="inline-block mb-16 group">
                            <NexoraLogo size="lg" showText={true} />
                        </Link>

                        <h1 className="text-4xl lg:text-5xl font-bold tracking-tight mb-6 text-white leading-tight">
                            Your AI Agent
                            <br />
                            <span className="text-zinc-400">is waiting.</span>
                        </h1>
                        <p className="text-zinc-400 mb-16 text-lg leading-relaxed font-light">
                            Start growing your LinkedIn presence on autopilot in just 2 minutes.
                        </p>

                        <div className="space-y-8">
                            {[
                                {
                                    icon: MessageSquare,
                                    title: 'Smart Comment Engine',
                                    description: 'Borrow reach from influencers by adding value to their posts'
                                },
                                {
                                    icon: PenTool,
                                    title: 'Auto-Generated Posts',
                                    description: 'Thought leadership content based on real trends and your brand'
                                },
                                {
                                    icon: Sparkles,
                                    title: 'Full Autopilot',
                                    description: 'Set it once and let AI handle your LinkedIn engagement 24/7'
                                }
                            ].map((feature, idx) => (
                                <div key={idx} className="flex gap-4 group">
                                    <div className="w-12 h-12 rounded-xl bg-zinc-800/50 border border-zinc-700/50 flex items-center justify-center flex-shrink-0 group-hover:bg-zinc-800 group-hover:border-zinc-600/50 transition-all duration-300">
                                        <feature.icon className="text-zinc-400 w-5 h-5 group-hover:text-zinc-300 transition-colors" />
                                    </div>
                                    <div>
                                        <h3 className="font-semibold text-white mb-1.5">{feature.title}</h3>
                                        <p className="text-sm text-zinc-500 leading-relaxed font-light">
                                            {feature.description}
                                        </p>
                                    </div>
                                </div>
                            ))}
                        </div>
                    </motion.div>

                    {/* Right Side: Premium Form */}
                    <motion.div
                        initial={{ opacity: 0, x: 20 }}
                        animate={{ opacity: 1, x: 0 }}
                        transition={{ duration: 0.6, delay: 0.3, ease: [0.22, 1, 0.36, 1] }}
                        className="w-full md:w-1/2 p-8 md:p-12 lg:p-16 flex flex-col justify-center bg-zinc-900/60"
                    >
                        {/* Mobile Logo */}
                        <Link href="/" className="inline-block md:hidden mb-8 group">
                            <NexoraLogo size="md" showText={true} />
                        </Link>

                        <div className="mb-10">
                            <h2 className="text-3xl lg:text-4xl font-bold text-white mb-3">
                                {isLogin ? 'Welcome back' : 'Get started'}
                            </h2>
                            <p className="text-zinc-400 font-light">
                                {isLogin
                                    ? 'Sign in to check on your agent and LinkedIn growth'
                                    : 'Create your account and start growing today'}
                            </p>
                        </div>

                        <form onSubmit={handleSubmit} className="space-y-6">
                            {/* Premium Email Input */}
                            <div className="space-y-2">
                                <label className="block text-sm font-medium text-zinc-300">
                                    Email Address
                                </label>
                                <div className="relative">
                                    <div className="absolute left-4 top-1/2 -translate-y-1/2 text-zinc-500">
                                        <Mail className="w-5 h-5" />
                                    </div>
                                    <input
                                        type="email"
                                        required
                                        value={email}
                                        onChange={(e) => setEmail(e.target.value)}
                                        placeholder="name@company.com"
                                        className="w-full pl-12 pr-4 py-3.5 bg-zinc-800/50 border border-zinc-700/50 rounded-xl text-white placeholder:text-zinc-500 focus:outline-none focus:ring-2 focus:ring-white/20 focus:border-zinc-600 transition-all duration-200"
                                    />
                                </div>
                                {error && error.toLowerCase().includes('email') && (
                                    <p className="text-sm text-red-400 font-light">{error}</p>
                                )}
                            </div>

                            {/* Premium Password Input */}
                            <div className="space-y-2">
                                <div className="flex items-center justify-between">
                                    <label className="block text-sm font-medium text-zinc-300">
                                        Password
                                    </label>
                                    {isLogin && (
                                        <a
                                            href="#"
                                            className="text-sm text-zinc-400 hover:text-white transition-colors font-light"
                                        >
                                            Forgot password?
                                        </a>
                                    )}
                                </div>
                                <div className="relative">
                                    <div className="absolute left-4 top-1/2 -translate-y-1/2 text-zinc-500">
                                        <Lock className="w-5 h-5" />
                                    </div>
                                    <input
                                        type="password"
                                        required
                                        value={password}
                                        onChange={(e) => setPassword(e.target.value)}
                                        placeholder="••••••••"
                                        className="w-full pl-12 pr-4 py-3.5 bg-zinc-800/50 border border-zinc-700/50 rounded-xl text-white placeholder:text-zinc-500 focus:outline-none focus:ring-2 focus:ring-white/20 focus:border-zinc-600 transition-all duration-200"
                                    />
                                </div>
                                {error && error.toLowerCase().includes('password') && (
                                    <p className="text-sm text-red-400 font-light">{error}</p>
                                )}
                            </div>

                            {/* Premium Button */}
                            <button
                                type="submit"
                                disabled={loading}
                                className="group relative w-full py-3.5 bg-white hover:bg-zinc-100 text-black font-semibold rounded-xl transition-all duration-200 flex items-center justify-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed overflow-hidden"
                            >
                                {loading ? (
                                    <div className="flex items-center gap-2">
                                        <div className="w-5 h-5 border-2 border-black/20 border-t-black rounded-full animate-spin" />
                                        <span>Processing...</span>
                                    </div>
                                ) : (
                                    <>
                                        <span>{isLogin ? 'Sign In' : 'Create Account'}</span>
                                        <ArrowRight className="w-5 h-5 group-hover:translate-x-1 transition-transform" />
                                    </>
                                )}
                            </button>
                        </form>

                        {/* Toggle Auth Mode */}
                        <div className="mt-8 text-center">
                            <p className="text-sm text-zinc-400 font-light">
                                {isLogin ? "Don't have an account? " : 'Already have an account? '}
                                <button
                                    type="button"
                                    onClick={() => {
                                        setIsLogin(!isLogin);
                                        setError('');
                                    }}
                                    className="font-semibold text-white hover:text-zinc-300 transition-colors"
                                >
                                    {isLogin ? 'Sign up' : 'Sign in'}
                                </button>
                            </p>
                        </div>

                        {/* Terms */}
                        {!isLogin && (
                            <div className="mt-8 pt-6 border-t border-zinc-800/50">
                                <div className="flex items-start gap-3">
                                    <Shield className="w-4 h-4 text-zinc-500 mt-0.5 flex-shrink-0" />
                                    <p className="text-xs text-zinc-500 leading-relaxed font-light">
                                        By creating an account, you agree to our{' '}
                                        <a href="#" className="text-zinc-400 hover:text-white transition-colors underline">
                                            Terms of Service
                                        </a>{' '}
                                        and{' '}
                                        <a href="#" className="text-zinc-400 hover:text-white transition-colors underline">
                                            Privacy Policy
                                        </a>
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
