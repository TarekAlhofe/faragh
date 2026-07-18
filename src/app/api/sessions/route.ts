import { NextRequest, NextResponse } from 'next/server';
import { SESSION_STAGES, SessionProgress } from '@/lib/types';
import { getRedis } from '@/lib/redis';

export async function POST(req: NextRequest) {
    const sessionId = Math.random().toString(36).substring(2, 15);

    const sessionProgress: SessionProgress<{}> = {
        stage: SESSION_STAGES.IDLE,
        cursor: 1,
        progress: 0,
        details: [],
        cost: 0
    };

    // Initialize session progress
    await getRedis().set(`${sessionId}/progress`, JSON.stringify(sessionProgress));

    return NextResponse.json({ sessionId });
}

export async function GET(req: NextRequest) {
    // Fetch all session IDs
    const sessionIds = await getRedis().smembers('sessions:index');

    // Fetch metadata for all sessions
    const metadataRecords = await getRedis().hgetall('sessions:metadata');

    const sessions = sessionIds
        .filter(id => !!metadataRecords[id]) // Only show sessions with metadata
        .map(id => {
            const meta = JSON.parse(metadataRecords[id]);
            return {
                id,
                ...meta
            };
        }).sort((a, b) => b.createdAt - a.createdAt); // Newest first

    return NextResponse.json({ sessions });
}