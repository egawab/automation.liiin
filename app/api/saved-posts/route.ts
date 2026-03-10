import { NextRequest, NextResponse } from 'next/server';
import { PrismaClient } from '@prisma/client';
import { getUserFromToken, unauthorized } from '@/lib/auth';

const prisma = new PrismaClient();

// GET - Fetch saved posts for the user
export async function GET(request: NextRequest) {
  try {
    const userId = await getUserFromToken();
    if (!userId) return unauthorized();

    // Get query parameters for filtering
    const { searchParams } = new URL(request.url);
    const keyword = searchParams.get('keyword');
    const visited = searchParams.get('visited');

    // Build query
    const whereClause: any = { userId };
    
    if (keyword) {
      whereClause.keyword = keyword;
    }
    
    if (visited !== null) {
      whereClause.visited = visited === 'true';
    }

    // Fetch saved posts
    const posts = await prisma.savedPost.findMany({
      where: whereClause,
      orderBy: {
        savedAt: 'desc'
      }
    });

    return NextResponse.json(posts);

  } catch (error: any) {
    console.error('Error fetching saved posts:', error);
    return NextResponse.json({ error: 'Failed to fetch saved posts' }, { status: 500 });
  }
}

// DELETE - Remove a saved post
export async function DELETE(request: NextRequest) {
  try {
    const userId = await getUserFromToken();
    if (!userId) return unauthorized();
    const { searchParams } = new URL(request.url);
    const postId = searchParams.get('id');

    if (!postId) {
      return NextResponse.json({ error: 'Post ID required' }, { status: 400 });
    }

    // Delete the post (only if it belongs to the user)
    await prisma.savedPost.deleteMany({
      where: {
        id: postId,
        userId
      }
    });

    return NextResponse.json({ success: true });

  } catch (error: any) {
    console.error('Error deleting saved post:', error);
    return NextResponse.json({ error: 'Failed to delete post' }, { status: 500 });
  }
}

// PATCH - Mark post as visited
export async function PATCH(request: NextRequest) {
  try {
    const userId = await getUserFromToken();
    if (!userId) return unauthorized();
    const body = await request.json();
    const { postId, visited } = body;

    if (!postId) {
      return NextResponse.json({ error: 'Post ID required' }, { status: 400 });
    }

    // Update the post
    await prisma.savedPost.updateMany({
      where: {
        id: postId,
        userId
      },
      data: {
        visited: visited ?? true
      }
    });

    return NextResponse.json({ success: true });

  } catch (error: any) {
    console.error('Error updating saved post:', error);
    return NextResponse.json({ error: 'Failed to update post' }, { status: 500 });
  }
}
