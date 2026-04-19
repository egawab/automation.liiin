import { NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { JWT_SECRET } from '@/lib/auth';

export async function POST(req: Request) {
    try {
        const { email, password } = await req.json();

        if (!email || !password) {
            return NextResponse.json({ error: 'Email and password are required' }, { status: 400 });
        }

        // Check if user exists
        const existing = await prisma.user.findUnique({ where: { email } });
        if (existing) {
            return NextResponse.json({ error: 'User already exists' }, { status: 400 });
        }

        // Hash password
        const hashedPassword = await bcrypt.hash(password, 10);

        // Calculate 30-day trial period
        const trialLimit = new Date();
        trialLimit.setDate(trialLimit.getDate() + 30);

        // Create user with default settings
        const user = await prisma.user.create({
            data: {
                email,
                password: hashedPassword,
                subscriptionStatus: "TRIAL",
                trialEndsAt: trialLimit
            }
        });

        // Create default settings for new user
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
                platformUrl: '' // Auto-detected from environment
            }
        });

        // Auto-login: Create session token
        const token = jwt.sign({ userId: user.id, email: user.email }, JWT_SECRET, { expiresIn: '7d' });

        // Return success with auth cookie
        const response = NextResponse.json({ success: true, userId: user.id });
        response.cookies.set('auth_token', token, {
            httpOnly: true,
            secure: true,
            sameSite: 'strict',
            maxAge: 60 * 60 * 24 * 7
        });

        return response;
    } catch (error: any) {
        console.error('❌ Registration API Error:', error);
        
        // Expose errors for debugging on Vercel
        const errorDetails = {
            message: error.message,
            code: error.code,
            meta: error.meta,
            stack: process.env.NODE_ENV === 'development' ? error.stack : undefined
        };

        if (error.code === 'P2002') {
            return NextResponse.json({ error: 'User already exists', details: errorDetails }, { status: 409 });
        }
        
        return NextResponse.json({ 
            error: 'Internal registration error',
            details: errorDetails
        }, { status: 500 });
    }
}
