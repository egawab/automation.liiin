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

        // Find user
        const user = await prisma.user.findUnique({ where: { email } });
        if (!user) {
            return NextResponse.json({ error: 'Invalid credentials' }, { status: 401 });
        }

        // Check password
        const isValid = await bcrypt.compare(password, user.password);
        if (!isValid) {
            return NextResponse.json({ error: 'Invalid credentials' }, { status: 401 });
        }

        // Create session token
        const token = jwt.sign({ userId: user.id, email: user.email }, JWT_SECRET, { expiresIn: '7d' });

        // Ensure user has default settings
        const settings = await prisma.settings.findUnique({ where: { userId: user.id } });
        if (!settings) {
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
        }

        // Create response with cookie
        const response = NextResponse.json({ success: true, userId: user.id });
        response.cookies.set('auth_token', token, {
            httpOnly: true,
            secure: process.env.NODE_ENV === 'production',
            sameSite: 'strict',
            maxAge: 60 * 60 * 24 * 7
        });

        return response;
    } catch (error) {
        console.error('Login error:', error);
        return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
    }
}
