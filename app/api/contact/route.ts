import { NextRequest, NextResponse } from 'next/server';
import { getUserFromToken } from '@/lib/auth';
import prisma from '@/lib/prisma';

export async function POST(req: NextRequest) {
  try {
    const userId = await getUserFromToken();
    if (!userId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { subject, message } = await req.json();

    if (!subject || !message) {
      return NextResponse.json({ error: 'Subject and message are required' }, { status: 400 });
    }

    const contactMessage = await prisma.contactMessage.create({
      data: {
        subject,
        message,
        userId
      }
    });

    return NextResponse.json({ success: true, message: contactMessage });
  } catch (error) {
    console.error('Error submitting contact message:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
