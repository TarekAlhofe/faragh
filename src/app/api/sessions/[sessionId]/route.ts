import { NextRequest, NextResponse } from "next/server";
import { ForeignNameRow, LineRow, SESSION_MODES, SESSION_STAGES, SessionProgress, SheetFile } from "@/lib/types";
import { useSpeakerLinesExtractor, useForeignNamesExtractor, useScanner } from "@/lib/serverHooks";
import { convertToXLSX, filterSimilarEnglishNames, limitConcurrency, normalizeEnglishName, parallelReading } from "@/lib/utils";
import { getRedis } from "@/lib/redis";
import fs from "fs/promises";
import path from "path";

async function updateSessionStatus(sessionId: string, status: string) {
  const raw = await getRedis().hget('sessions:metadata', sessionId);
  if (!raw) return;

  const meta = JSON.parse(raw);
  meta.status = status;

  await getRedis().hset('sessions:metadata', sessionId, JSON.stringify(meta));
}

async function validateLink(url: string, signal?: AbortSignal): Promise<string> {
  try {
    const response = await fetch(url, { method: "HEAD", signal });
    return response.ok ? url : "Not Found";
  } catch (error: any) {
    // Return "Not Found" for abort errors as well
    if (error.name === "AbortError") {
      throw error; // Re-throw abort errors to propagate up
    }
    return "Not Found";
  }
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ sessionId: string }> }
) {

  const signal = req.signal;

  // Check if already aborted
  if (signal.aborted) {
    return new NextResponse("Client connection aborted", { status: 499 });
  }

  const { sessionId } = await params;
  const formData = await req.formData();
  const file = formData.get("file") as File;
  let processedPages: number[] = [];

  console.log(`[POST] file:`, file.name);
  console.log(`[POST] file:`, file);

  const cachedSheet = await getRedis().get(`${sessionId}/sheet`);
  const cachedState = await getRedis().get(`${sessionId}/state`);
  if (cachedState) {
    try {
      processedPages = JSON.parse(cachedState).processedPages || [];
    } catch { }
  }

  // console.log(`[POST] existingSheet:`, existingSheet);
  // console.log(`[POST] existingState:`, existingState);

  if (!file) return NextResponse.json({ error: "No file uploaded" }, { status: 400 });

  // Save PDF locally for persistence
  const storageDir = path.join(process.cwd(), "storage", "pdfs");
  await fs.mkdir(storageDir, { recursive: true });
  const pdfPath = path.join(storageDir, `${sessionId}.pdf`);
  const fileArrayBuffer = await file.arrayBuffer();
  await fs.writeFile(pdfPath, Buffer.from(fileArrayBuffer));

  console.log(`[POST] pdfPath:`, pdfPath);
  console.log(`[POST] fileArrayBuffer:`, fileArrayBuffer.byteLength);

  try {
    // Check abort signal before starting processing
    signal.throwIfAborted();

    const startPage = parseInt(
      req.nextUrl.searchParams.get("startPage") || "1",
      10
    );
    const endPage = parseInt(req.nextUrl.searchParams.get("endPage") || "1", 10);
    const mode: SESSION_MODES = req.nextUrl.searchParams.get("mode") as SESSION_MODES || SESSION_MODES.NAMES;

    console.log(`\n=== POST REQUEST START ===`);
    console.log(`[POST] sessionId: ${sessionId}`);
    console.log(`[POST] mode: ${mode}`);
    console.log(`[POST] pages: ${startPage}-${endPage}`);

    // Update session metadata and index it
    await getRedis().hset('sessions:metadata', sessionId, JSON.stringify({
      filename: file.name,
      createdAt: Date.now(),
      status: "processing"
    }));

    await getRedis().sadd('sessions:index', sessionId);

    const totalPages = endPage - startPage + 1;
    const contentType = req.headers.get("content-type") || "";
    const sessionProgress: SessionProgress<{}> = { stage: SESSION_STAGES.IDLE, cursor: 1, progress: 0, details: [] }

    await getRedis().set(
      `${sessionId}/progress`,
      JSON.stringify(sessionProgress)
    );

    if (!contentType.includes("multipart/form-data")) {
      return NextResponse.json(
        { error: "Unsupported Media Type" },
        { status: 415 }
      );
    }

    const [images, numberOfPages, scan] = await useScanner(file, 1.2);
    const scanStartPage = mode === SESSION_MODES.LINES ? Math.max(1, startPage - 3) : startPage;
    const scanEndPage = mode === SESSION_MODES.LINES ? Math.min(numberOfPages, endPage + 3) : endPage;
    const scannedPages: number[] = [];
    const pagesToScan = [];
    for (let pageNum = scanStartPage; pageNum <= scanEndPage; pageNum++) {
      if (!images(pageNum)) {
        pagesToScan.push(pageNum);
      }
    }

    await limitConcurrency(10, pagesToScan.map(pageNum => async () => {
      signal.throwIfAborted();
      await scan(pageNum);
      scannedPages.push(pageNum);
      await getRedis().set(`${sessionId}/progress`, JSON.stringify({
        stage: "SCANNING",
        cursor: pageNum,
        progress: Math.floor((scannedPages.length / pagesToScan.length) * 100),
        details: ""
      }));
    }));

    if (!mode) return NextResponse.json({ error: "NO mode Selected" }, { status: 400 });

    if (mode === SESSION_MODES.NAMES) {

      const sheet = JSON.parse(cachedSheet ?? "[]") as ForeignNameRow[];
      const [sheetFile, extract] = await useForeignNamesExtractor(sheet, { readingMemoryLimit: 1 });
      const seenNames = new Set<string>();

      const pagesToProcess = [];
      for (let i = startPage; i <= endPage; i++) {
        if (!processedPages.includes(i)) pagesToProcess.push(i);
      }

      await limitConcurrency(5, pagesToProcess.map(i => async () => {
        signal.throwIfAborted();
        const image = images(i) as string;
        const lines = await extract(i, image, sheetFile);
        const validateLines = await Promise.all(
          lines.map(async line => {
            if (line["الرابط الأول"]) line["الرابط الأول"] = await validateLink(line["الرابط الأول"], signal);
            if (line["الرابط الثاني"]) line["الرابط الثاني"] = await validateLink(line["الرابط الثاني"], signal);
            if (line["الرابط الثالث"]) line["الرابط الثالث"] = await validateLink(line["الرابط الثالث"], signal);
            return line;
          })
        );

        const uniqueLines = validateLines.filter((line) => {
          const englishName = line["الإسم باللغة الأجنبية"] ?? "";
          const normalized = normalizeEnglishName(englishName);
          if (!normalized) return true;
          if (seenNames.has(normalized)) return false;
          seenNames.add(normalized);
          return true;
        });

        if (mode === SESSION_MODES.NAMES) {
          const sheetFile: SheetFile<ForeignNameRow> = { pdfFilename: file.name, sheet: [] };
          sheetFile.sheet.push(...uniqueLines);
        }

        processedPages.push(i);

        // Update Redis
        await getRedis().set(`${sessionId}/state`, JSON.stringify({ processedPages, mode }), "EX", 60 * 60 * 5);
        if (uniqueLines.length > 0) {
          await getRedis().set(`${sessionId}/sheet`, JSON.stringify(sheetFile), "EX", 60 * 60 * 5);
        }
        await getRedis().set(`${sessionId}/progress`, JSON.stringify({
          stage: "EXTRACTING",
          cursor: i,
          progress: Math.round(((processedPages.length / totalPages) * 100)),
          details: JSON.stringify(uniqueLines)
        }));
      }));

      // Final save of the full sheet and state with mode
      const finalSheet = JSON.stringify(sheetFile);
      await getRedis().set(`${sessionId}/state`, JSON.stringify({ processedPages, mode }), "EX", 60 * 60 * 5);
      await getRedis().set(`${sessionId}/sheet`, finalSheet, "EX", 60 * 60 * 5);

    }

    if (mode === SESSION_MODES.LINES) {

      const sheet = JSON.parse(cachedSheet ?? "[]") as LineRow[];
      const cachedSpeakers = await getRedis().get(`${sessionId}/speakers`) || "";
      const [sheetFile, currentSpeakers, extractFromImage] = await useSpeakerLinesExtractor(sheet, cachedSpeakers, numberOfPages, { readingMemoryLimit: 5 });
      const pagesToProcess = [];
      for (let i = startPage; i <= endPage; i++) {
        if (!processedPages.includes(i)) pagesToProcess.push(i);
      }
      // Process pages sequentially in ascending order to maintain correct memory propagation
      pagesToProcess.sort((a, b) => a - b);

      let currentSpeakersState = currentSpeakers;
      for (const i of pagesToProcess) {
        signal.throwIfAborted();
        const { lines, updatedSpeakers } = await extractFromImage(i, images, currentSpeakersState);
        currentSpeakersState = updatedSpeakers;
        processedPages.push(i);
        await getRedis().set(`${sessionId}/state`, JSON.stringify({ processedPages, mode }), "EX", 60 * 60 * 5);
        await getRedis().set(`${sessionId}/sheet`, JSON.stringify(sheetFile), "EX", 60 * 60 * 5);
        await getRedis().set(`${sessionId}/speakers`, currentSpeakersState, "EX", 60 * 60 * 5);
        await getRedis().set(`${sessionId}/progress`, JSON.stringify({
          stage: "EXTRACTING",
          cursor: i,
          progress: Math.round(((processedPages.length / totalPages) * 100)),
          details: JSON.stringify(lines)
        }));
      }

      await getRedis().set(`${sessionId}/state`, JSON.stringify({ processedPages, mode }), "EX", 60 * 60 * 5);
      await getRedis().set(`${sessionId}/sheet`, JSON.stringify(sheetFile), "EX", 60 * 60 * 5);
    }

    const protocol = req.nextUrl.protocol;
    const host = req.headers.get("host") || req.nextUrl.host;
    const sheetUrl = `${protocol}//${host}/api/sessions/${sessionId}`;

    await updateSessionStatus(sessionId, 'completed')

    return NextResponse.json({ sheetUrl }, { status: 200 });

  } catch (error: any) {
    // Handle client abort
    if (error.name === "AbortError") {
      console.log(`[POST] Client connection aborted for sessionId: ${sessionId}`);
      await updateSessionStatus(sessionId, 'error')
      await getRedis().set(`${sessionId}/state`, JSON.stringify({ processedPages }), "EX", 60 * 60 * 5);
      return new NextResponse("Client connection aborted", { status: 499 });
    }

    if (error.type === "GEMINI_INVALID_INPUT") {
      return NextResponse.json({ type: "GEMINI_INVALID_INPUT" }, { status: 400 });
    }
    const protocol = req.nextUrl.protocol;
    const host = req.headers.get("host") || req.nextUrl.host;
    const sheetUrl = `${protocol}//${host}/api/sessions/${sessionId}`;

    return NextResponse.json({
      error: "An error occurred",
      details: error instanceof Error
        ? error.message
        : error,
      sheetUrl
    }, { status: 500 });

  }

}

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ sessionId: string }> }
) {
  const { sessionId } = await params;

  if (!sessionId) {
    return new Response(JSON.stringify({ error: "No sessionId provided" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  const sheetFileContent = await getRedis().get(`${sessionId}/sheet`);

  if (!sheetFileContent) {
    return new Response(JSON.stringify({ error: "Sheet not found" }), {
      status: 404,
      headers: { "Content-Type": "application/json" },
    });
  }

  let sheetFile: ForeignNameRow[];
  try {
    sheetFile = JSON.parse(sheetFileContent) as ForeignNameRow[];
  } catch (error: unknown) {
    return new Response(JSON.stringify({ error: "Invalid JSON data" }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }

  const xlsxBuffer = convertToXLSX(sheetFile);

  return new Response(new Uint8Array(xlsxBuffer), {
    status: 200,
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="${encodeURIComponent(
        "test.xlsx"
      )}"`,
    },
  });
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ sessionId: string }> }
) {

  const { sessionId } = await params;

  if (!sessionId) {
    return NextResponse.json({ error: "No sessionId provided" }, { status: 400 });
  }

  // Delete storage
  await getRedis().del(`${sessionId}/progress`);
  await getRedis().del(`${sessionId}/sheet`);
  await getRedis().del(`${sessionId}/state`);
  await getRedis().del(`${sessionId}/speakers`);

  // Remove from index
  await getRedis().srem('sessions:index', sessionId);
  await getRedis().hdel('sessions:metadata', sessionId);

  return NextResponse.json({ success: true }, { status: 200 });
}