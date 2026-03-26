import { NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { getUserFromToken, unauthorized } from '@/lib/auth';

const STARTER_PACKS = {
  marketing: {
    name: 'B2B Marketing & Growth',
    keywords: [
      {
        keyword: '#DigitalMarketing',
        targetReach: 5000,
        comments: [
          'Great insights on digital marketing trends! The shift towards AI-driven personalization is exactly what we are seeing too. Thanks for sharing. 🚀',
          'Completely agree with this perspective. Marketing is evolving so fast, and staying adaptable is the only way to win. Would love to hear your thoughts on how video content fits into this!',
          'This is a masterclass in modern marketing strategy. Saving this for reference, brilliant breakdown! 👏'
        ]
      },
      {
        keyword: 'Growth Hacking',
        targetReach: 10000,
        comments: [
          'Growth isn\'t just about hacks, it\'s about sustainable systems. This post nails that distinction perfectly. Great read! 📈',
          'So much value in this post! The framework you mapped out here is incredibly actionable for any early-stage startup trying to scale.',
          'Love this approach to growth. It\'s refreshing to see strategies focused on genuine retention rather than just top-of-funnel vanity metrics. Spot on! 🔥'
        ]
      },
      {
        keyword: '#SEO',
        targetReach: 1000,
        comments: [
          'SEO is definitely playing a long game. Posts like this remind me why foundational technical SEO never goes out of style despite all the algorithm updates. 💡',
          'Excellent summary of the current search landscape. The focus on user intent over pure keyword density is where the real wins are right now.',
          'Such a valuable breakdown! This is exactly the kind of deep-dive SEO content that provides real, actionable value. Thanks for putting this together.'
        ]
      }
    ]
  },
  tech: {
    name: 'Tech & Software Engineering',
    keywords: [
      {
        keyword: '#SoftwareEngineering',
        targetReach: 5000,
        comments: [
          'Really interesting take on software architecture. Clean code and maintainability always pay off in the long run. Thanks for sharing your experience! 💻',
          'This perfectly captures the realities of engineering at scale. The trade-offs you mentioned between speed and technical debt are so relatable. Great post!',
          'Fantastic technical breakdown. I\'ve sent this to my team, there are some great architectural lessons here for us to apply. 🚀'
        ]
      },
      {
        keyword: 'Artificial Intelligence',
        targetReach: 10000,
        comments: [
          'The pace of AI advancement is staggering. Posts like this help cut through the hype and focus on real-world utility. Fascinating read! 🤖',
          'Couldn\'t agree more. The intersection of AI and practical daily workflows is where the true revolution is happening. Great insights here.',
          'A very balanced and thoughtful perspective on AI\'s trajectory. It’s refreshing to read something grounding rather than just hype. Thank you! 🧠'
        ]
      },
      {
        keyword: '#WebDevelopment',
        targetReach: 1000,
        comments: [
          'Frontend trends come and go, but strong fundamentals like you\'ve outlined here are permanent. Love the detailed code examples! ⚡',
          'This is such a clean and elegant solution to a very common frontend problem. Definitely bookmarking this for my next project. 👏',
          'Great dive into modern web dev! The focus on performance and bundle size is exactly what more developers need to be prioritizing.'
        ]
      }
    ]
  }
};

export async function POST(req: Request) {
    const userId = await getUserFromToken();
    if (!userId) return unauthorized();

    try {
        const body = await req.json();
        const packType = body.pack as keyof typeof STARTER_PACKS;
        
        if (!packType || !STARTER_PACKS[packType]) {
            return NextResponse.json({ error: 'Invalid starter pack type' }, { status: 400 });
        }

        const pack = STARTER_PACKS[packType];
        
        // 1. Create Keywords and capture their generated IDs
        const keywordPromises = pack.keywords.map(kw => 
            prisma.keyword.create({
                data: {
                    userId,
                    keyword: kw.keyword,
                    targetReach: kw.targetReach,
                    active: true,
                    matches: 0
                }
            })
        );
        
        const createdKeywords = await Promise.all(keywordPromises);

        // 2. Map the created keyword IDs back to their corresponding comments and create them
        const commentPromises: any[] = [];
        
        createdKeywords.forEach((dbKeyword, index) => {
            const originalKwData = pack.keywords[index];
            originalKwData.comments.forEach(commentText => {
                commentPromises.push(
                    prisma.comment.create({
                        data: {
                            userId,
                            text: commentText,
                            category: pack.name,
                            timesUsed: 0,
                            keywordId: dbKeyword.id
                        }
                    })
                );
            });
        });

        await Promise.all(commentPromises);

        return NextResponse.json({ 
            success: true, 
            message: `Loaded ${pack.name} Starter Pack with ${createdKeywords.length} keywords and ${commentPromises.length} comments.` 
        });

    } catch (error) {
        console.error('Starter Pack error:', error);
        return NextResponse.json({ error: 'Failed to load starter pack' }, { status: 500 });
    }
}
