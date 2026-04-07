import { NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { getUserFromToken, unauthorized } from '@/lib/auth';

export async function GET() {
    try {
        const userId = await getUserFromToken();
        if (!userId) return unauthorized();

        let settings = await prisma.settings.findUnique({
            where: { userId }
        });

        if (!settings) {
            settings = await prisma.settings.create({
                data: {
                    userId,
                    maxCommentsPerDay: 50,
                    maxProfileViewsPerDay: 100,
                    minLikes: 10,
                    minComments: 2,
                    minDelayMins: 15,
                    maxDelayMins: 45,
                    systemActive: false,
                    linkedinSessionCookie: '',
                    searchOnlyMode: true
                }
            });
        }

        return NextResponse.json(settings);
    } catch (error) {
        console.error('Settings GET error:', error);
        return NextResponse.json({ 
            error: 'Failed to fetch settings', 
            details: error instanceof Error ? error.message : String(error) 
        }, { status: 500 });
    }
}

export async function POST(req: Request) {
    try {
        // Support both cookie auth (dashboard) and extension token auth (auto-pause)
        let userId = await getUserFromToken();
        if (!userId) {
            userId = req.headers.get('x-extension-token');
        }
        if (!userId) return unauthorized();

        const data = await req.json();

        const settings = await prisma.settings.upsert({
            where: { userId },
            update: data,
            create: { ...data, userId }
        });

        return NextResponse.json(settings);
    } catch (error) {
        console.error('Settings POST error:', error);
        return NextResponse.json({ 
            error: 'Failed to update settings',
            details: error instanceof Error ? error.message : String(error)
        }, { status: 500 });
    }
}

export async function PUT(req: Request) {
    // Alias PUT to POST for compatibility
    return POST(req);
}
