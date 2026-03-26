import { NextResponse } from 'next/server';
import { getUserFromToken, unauthorized } from '@/lib/auth';
import { headers } from 'next/headers';

export async function GET() {
    try {
        const userId = await getUserFromToken();
        if (!userId) return unauthorized();

        // Build the platform URL from the request headers
        const headersList = await headers();
        const host = headersList.get('host') || 'localhost:3000';
        const protocol = headersList.get('x-forwarded-proto') || 'http';
        const platformUrl = `${protocol}://${host}`;

        return NextResponse.json({
            userId,
            platformUrl,
            status: 'ok'
        });
    } catch (error) {
        console.error('Connect API error:', error);
        return NextResponse.json({ error: 'Failed to get connection info' }, { status: 500 });
    }
}
