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

        // Create user with default settings
        const user = await prisma.user.create({
            data: {
                email,
                password: hashedPassword
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
            secure: process.env.NODE_ENV === 'production',
            sameSite: 'strict',
            maxAge: 60 * 60 * 24 * 7
        });

        return response;
    } catch (error: any) {
        console.error('Registration error:', error);
        
        // Detailed error logging for debugging
        if (error.code === 'P2002') {
            return NextResponse.json({ error: 'User already exists' }, { status: 400 });
        }
        
        if (error.code === 'P2003') {
            return NextResponse.json({ error: 'Database constraint error. Please contact support.' }, { status: 500 });
        }
        
        // Log the actual error for debugging
        console.error('Full error details:', {
            message: error.message,
            code: error.code,
            meta: error.meta,
            stack: error.stack
        });
        
        return NextResponse.json({ 
            error: 'Internal server error',
            details: process.env.NODE_ENV === 'development' ? error.message : undefined
        }, { status: 500 });
    }
}
