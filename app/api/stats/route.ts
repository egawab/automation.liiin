import { NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { getUserFromToken, unauthorized } from '@/lib/auth';

export async function GET() {
    const userId = await getUserFromToken();
    if (!userId) return unauthorized();

    try {
        const today = new Date();
        today.setHours(0, 0, 0, 0);

        const commentsToday = await prisma.log.count({
            where: {
                userId,
                action: { contains: 'COMMENT' },
                timestamp: { gte: today }
            }
        });

        const postsScanned = await prisma.log.count({
            where: {
                userId,
                action: { contains: 'SEARCH' }
            }
        });

        return NextResponse.json({
            commentsToday,
            postsScanned: postsScanned * 10,
            profileViews: 0
        });
    } catch (error) {
        console.error('Stats error:', error);
        return NextResponse.json({ error: 'Failed to fetch stats' }, { status: 500 });
    }
}
