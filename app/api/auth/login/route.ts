import { NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { JWT_SECRET } from '@/lib/auth';

// ── Neon cold-start resilience ────────────────────────────────────────────────
// Neon serverless databases auto-suspend after inactivity. The first request
// during a cold start fails with P1001/P1002 before the DB finishes waking up.
// A single transparent retry after 1.5s resolves ~99% of cold-start failures.
const NEON_COLD_START_CODES = ['P1001', 'P1002'];
function isNeonColdStart(err: any) {
    return NEON_COLD_START_CODES.includes(err?.code) ||
        (typeof err?.message === 'string' && err.message.includes("Can't reach database server"));
}
function sleep(ms: number) { return new Promise(r => setTimeout(r, ms)); }

async function doLogin(email: string, password: string) {
    const user = await prisma.user.findUnique({ where: { email } });
    if (!user) return { error: 'Invalid credentials', status: 401 };

    const isValid = await bcrypt.compare(password, user.password);
    if (!isValid) return { error: 'Invalid credentials', status: 401 };

    const token = jwt.sign({ userId: user.id, email: user.email }, JWT_SECRET, { expiresIn: '7d' });

    // Ensure user has default settings
    const settings = await prisma.settings.findUnique({ where: { userId: user.id } });
    if (!settings) {
        try {
            await prisma.settings.create({
                data: {
                    userId: user.id,
                    maxCommentsPerDay: 50,
                    maxProfileViewsPerDay: 100,
                    minLikes: 10,
                    maxLikes: 10000,
                    minComments: 2,
                    maxComments: 1000,
                    minDelayMins: 15,
                    maxDelayMins: 45,
                    systemActive: false,
                    linkedinSessionCookie: '',
                    platformUrl: '',
                    searchOnlyMode: true,
                    autoEnrich: false,
                    autoDelete: false,
                    deleteThreshold: 10,
                }
            });
        } catch (settingsErr: any) {
            // Orphan user from a previous failed register — surface schema drift clearly
            if (settingsErr?.code === 'P2022') {
                return {
                    error: 'Database schema is out of date. Run RUN_THIS_ON_NEON.sql in Neon SQL Editor, then login again.',
                    status: 500
                };
            }
            throw settingsErr;
        }
    }

    return { token, userId: user.id };
}

export async function POST(req: Request) {
    try {
        const { email, password } = await req.json();

        if (!email || !password) {
            return NextResponse.json({ error: 'Email and password are required' }, { status: 400 });
        }

        let result: any;
        try {
            result = await doLogin(email, password);
        } catch (firstErr: any) {
            if (isNeonColdStart(firstErr)) {
                // Neon is waking up — wait 1.5s and retry once transparently
                console.warn('[Login] Neon cold-start detected, retrying in 1.5s...', firstErr.code || firstErr.message);
                await sleep(1500);
                result = await doLogin(email, password);
            } else {
                throw firstErr;
            }
        }

        // Logical errors (wrong credentials, etc.)
        if (result.error) {
            return NextResponse.json({ error: result.error }, { status: result.status });
        }

        // Success
        const response = NextResponse.json({ success: true, userId: result.userId });
        response.cookies.set('auth_token', result.token, {
            httpOnly: true,
            secure: true,
            sameSite: 'strict',
            maxAge: 60 * 60 * 24 * 7
        });
        return response;

    } catch (error: any) {
        console.error('❌ Login API Error:', error);
        const isDbMissing = !process.env.DATABASE_URL;
        const msg = isDbMissing ? 'MISSING_DATABASE_URL' : error.message;

        return NextResponse.json({
            error: isDbMissing
                ? 'CRITICAL: Database environment variable is missing in Vercel!'
                : 'Internal login error',
            details: {
                diagnostic_msg: msg,
                prisma_code: error.code,
                meta: error.meta,
                timestamp: new Date().toISOString()
            }
        }, { status: 500 });
    }
}
