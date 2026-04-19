import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '../auth/[...nextauth]/route';
import prisma from '@/lib/prisma';

export async function POST(req: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    if (!session || !session.user || !session.user.id) {
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
        userId: session.user.id
      }
    });

    return NextResponse.json({ success: true, message: contactMessage });
  } catch (error) {
    console.error('Error submitting contact message:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
