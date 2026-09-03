import { NextRequest, NextResponse } from "next/server";
import { getRedis } from "@/lib/redis";

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ sessionId: string }> }
) {
  const { sessionId } = await params;

  if (!sessionId) {
    return NextResponse.json({ error: "No sessionId provided" }, { status: 400 });
  }

  const sheetData = await getRedis().get(`${sessionId}/sheet`);
  const stateData = await getRedis().get(`${sessionId}/state`);
  const progressData = await getRedis().get(`${sessionId}/progress`);
  const metadataRaw = await getRedis().hget('sessions:metadata', sessionId);

  if (!progressData) {
    return NextResponse.json({ error: "Session not found - status/route.ts" }, { status: 404 });
  }

  const sheet = sheetData ? JSON.parse(sheetData) : null;
  const state = stateData ? JSON.parse(stateData) : {};
  const progress = progressData ? JSON.parse(progressData) : null;
  const metadata = metadataRaw ? JSON.parse(metadataRaw) : { status: "idle", filename: "unknown.pdf" };

  return NextResponse.json({
    pdfFilename: sheet?.pdfFilename || metadata.filename,
    sheet: sheet?.sheet || [],
    processedPages: state?.processedPages || [],
    mode: state?.mode || "NAMES",
    stage: progress?.stage || "IDLE",
    progress: progress?.progress || 0,
    cost: progress?.cost || 0,
    status: metadata.status || "idle"
  }, { status: 200 });
}
