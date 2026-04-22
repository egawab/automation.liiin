import { NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { getUserFromToken, unauthorized } from '@/lib/auth';

// DEBUG ENDPOINT: Check if posts exist in the database
// Visit: /api/debug-posts in your browser while logged in
export async function GET() {
  try {
    const userId = await getUserFromToken();
    if (!userId) return unauthorized();

    // Count ALL saved posts for this user
    const totalCount = await prisma.savedPost.count({
      where: { userId }
    });

    // Get the 5 most recent posts
    const recentPosts = await prisma.savedPost.findMany({
      where: { userId },
      orderBy: { savedAt: 'desc' },
      take: 5,
      select: {
        id: true,
        postUrl: true,
        postAuthor: true,
        keyword: true,
        likes: true,
        comments: true,
        savedAt: true,
        visited: true
      }
    });

    // Also check how many users exist and what their IDs are
    const users = await prisma.user.findMany({
      select: { id: true, email: true, linkedInProfileId: true },
      take: 5
    });

    // Count posts per user (to detect userId mismatch)
    const postsByUser = await prisma.savedPost.groupBy({
      by: ['userId'],
      _count: { id: true }
    });

    return NextResponse.json({
      diagnostic: true,
      currentUserId: userId,
      totalSavedPosts: totalCount,
      recentPosts,
      registeredUsers: users.map(u => ({ id: u.id, email: u.email, linkedInProfileId: u.linkedInProfileId })),
      postsPerUser: postsByUser.map(p => ({ userId: p.userId, count: p._count.id }))
    }, { status: 200 });
  } catch (error: any) {
    return NextResponse.json({ error: error.message, stack: error.stack }, { status: 500 });
  }
}
