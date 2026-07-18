import fs from 'fs/promises';
import path from 'path';
import '@ungap/with-resolvers';
import { ForeignNameRow, LineRow, Row } from '@/lib/types';
import { ReadingMemory, tryCall } from "./utils";

import { callAI, getAI, handleConversation } from "./ai";
import { CostTracker, extractUsageFromResult } from "./utils";
import { fromBuffer } from 'pdf2pic';
import countPages from 'page-count';
import { Scanner } from './scanner';

export async function useScanner(
  pdf: File,
  scale: number = 1
): Promise<[
  (pageNumber?: number) => Record<number, string> | string, // get images cache or specific cached image
  number,
  (pageNumber: number) => Promise<string> // render page to image and cache it
]> {
  const imagesCache: Record<number, string> = {};
  const pdfBuffer = Buffer.from(await new Response(pdf).arrayBuffer());
  const numberOfPages = await countPages(pdfBuffer, 'pdf');

  return [
    (pageNumber?: number) =>
      pageNumber === undefined ? imagesCache : imagesCache[pageNumber],

    numberOfPages,

    async (pageNumber: number) => {

      const scanner = fromBuffer(pdfBuffer, {
        density: 72 * scale,
        width: 600 * scale,
        height: 800 * scale,
        format: 'png',
      });


      const imageBuffer = await scanner(pageNumber, { responseType: 'buffer' });

      if (!imageBuffer?.buffer || !Buffer.isBuffer(imageBuffer.buffer) || imageBuffer.buffer.length === 0) {
        throw new Error(`Invalid rendered buffer for page ${pageNumber}`);
      }

      const buffer = imageBuffer?.buffer;
      if (!buffer) {
        throw new Error(`Failed to render page ${pageNumber} to image`);
      }

      const base64 = Buffer.from(buffer).toString('base64');

      imagesCache[pageNumber] = base64;

      console.log({
        size: imageBuffer.size,
        mime: "image/png",
      });

      return base64;
    },
  ];
}

export async function useSpeakerLinesExtractor(
  sessionId: string,
  startingSheet: LineRow[],
  startingSpeakers: string,
  numberOfPages: number,
  { readingMemoryLimit, costTracker }: { readingMemoryLimit: number; costTracker?: CostTracker } = { readingMemoryLimit: 10 }
): Promise<[
  LineRow[],
  string,
  (
    key: number,
    images: (pageNumber?: number) => Record<number, string> | string,
    currentSpeakers: string
  ) => Promise<{ lines: LineRow[]; updatedSpeakers: string }>
]> {
  const conversation: ReadingMemory = new ReadingMemory(readingMemoryLimit ?? 1);
  const sheet: LineRow[] = startingSheet;
  const speakerInstructionsTemplate = await fs.readFile(path.join('src/lib/prompts', 'charactering.md'), 'utf-8');
  const sheetifyInstructionsTemplate = await fs.readFile(path.join('src/lib/prompts', 'sheetify.md'), 'utf-8');

  async function extract(
    key: number,
    images: (pageNumber?: number) => Record<number, string> | string,
    currentSpeakers: string
  ): Promise<{ lines: LineRow[]; updatedSpeakers: string }> {
    // Step 1: Speaker Identification with surrounding page window [key - 3, key + 3]
    const speakerInstructions = speakerInstructionsTemplate.replace('{{speakers}}', currentSpeakers);
    const scanner = new Scanner(sessionId);
    
    const contentParts: any[] = [];
    for (let p = Math.max(1, key - 3); p <= Math.min(numberOfPages, key + 3); p++) {
      const img = images(p) as string;
      if (img) {
        const textContent = await scanner.scanImage(p, img);
        contentParts.push({
          type: "text",
          text: `[Page ${p}]${p === key ? ' (This is the target page to extract speakers for)' : ''}\n${textContent}`
        });
      }
    }
    contentParts.push({
      type: "text",
      text: `الرجاء تحليل الصفحة المستهدفة (الصفحة رقم ${key}) واستخراج المتحدثين الفاعلين فيها، مستعيناً بالصفحات السابقة واللاحقة المرفقة كالسياق.`
    });

    const charMessages: any[] = [
      { role: "system", content: speakerInstructions },
      {
        role: 'user',
        content: contentParts,
      }
    ];

    const charConfig = {
      response_format: {
        type: "json_schema",
        json_schema: {
          name: "speakers_schema",
          strict: true,
          schema: {
            type: "object",
            required: ["characters"],
            properties: {
              characters: {
                type: "array",
                items: {
                  type: "object",
                  required: ["الاسم", "الوصف", "التصنيف"],
                  properties: {
                    "الاسم": { type: "string" },
                    "الوصف": { type: "string" },
                    "التصنيف": { type: "string", enum: ["رئيسية", "ثانوية", "مساندة/جماعية"] }
                  },
                  additionalProperties: false
                }
              }
            },
            additionalProperties: false
          }
        }
      }
    } as const;

    const speakerModels = [
      "google/gemini-3.5-flash",
      "google/gemini-3.1-flash-lite",
      "google/gemini-2.5-pro",
      "google/gemini-2.5-flash"
    ] as const;
    let charResult: any;
    for (const m of speakerModels) {
      try {
        charResult = await tryCall(async () => {
          return await getAI().chat.completions.create({
            model: m,
            messages: charMessages,
            ...charConfig,
          });
        });
        const usageInfo = extractUsageFromResult(charResult);
        if (usageInfo && costTracker) costTracker.track(usageInfo.model, usageInfo.usage);
        break;
      } catch (err) {
        console.warn(`Model ${m} speaker extraction failed, trying next if available`, err);
        if (m === speakerModels[speakerModels.length - 1]) throw err;
      }
    }

    let updatedSpeakers = currentSpeakers;
    const charMessageContent = charResult?.choices?.[0]?.message?.content;

    if (charMessageContent) {
      try {
        const parsedChars = JSON.parse(charMessageContent);
        if (parsedChars && Array.isArray(parsedChars.characters)) {
          updatedSpeakers = parsedChars.characters
            .map((c: any) => `${c["الاسم"]}: ${c["الوصف"]}. (${c["التصنيف"]})`)
            .join("\n");
        }
      } catch (err) {
        console.error("Failed to parse speakers list JSON output:", err);
      }
    }

    // Step 2: Utterances Extraction (uses target page only)
    const targetImage = images(key) as string;
    const targetText = await scanner.scanImage(key, targetImage);
    const sheetifyInstructions = sheetifyInstructionsTemplate.replace('{{speakers}}', updatedSpeakers);
    const messages: any[] = [
      { role: "system", content: sheetifyInstructions }
    ];

    if (sheet.length > 0) {
      messages.push({
        role: "user",
        content: `Here are the results from previous pages for context (to maintain consistency and avoid duplicates):\n${JSON.stringify(sheet.slice(-50))}`
      });
      messages.push({
        role: "assistant",
        content: "Understood. I will use this context to maintain consistency and avoid duplicates in the new extraction."
      });
    }

    messages.push({
      role: 'user',
      content: [
        {
          type: "text",
          text: "Please extract the data from this page according to the instructions:\n\n" + targetText
        }
      ],
    });

    const config = {
      response_format: {
        type: "json_schema",
        json_schema: {
          name: "results_schema",
          strict: true,
          schema: {
            type: "object",
            required: ["results"],
            properties: {
              results: {
                type: "array",
                items: {
                  type: "object",
                  required: [
                    "المتحدث",
                    "العبارة",
                    "النبرة",
                    "المكان",
                    "الخلفية الصوتية",
                  ],
                  properties: {
                    "المتحدث": { type: "string" },
                    "العبارة": { type: "string" },
                    "النبرة": { type: "string" },
                    "المكان": { type: "string" },
                    "الخلفية الصوتية": { type: "string" },
                  },
                  additionalProperties: false
                }
              }
            },
            additionalProperties: false
          }
        }
      }
    } as const;

    const sheetifyModels = [
      "google/gemini-3.5-flash",
      "google/gemini-3.1-flash-lite",
    ] as const;

    let result: any;
    for (const m of sheetifyModels) {
      try {
        result = await tryCall(async () => {
          return await getAI().chat.completions.create({
            model: m,
            messages: messages,
            ...config,
          });
        });
        const usageInfo = extractUsageFromResult(result);
        if (usageInfo && costTracker) costTracker.track(usageInfo.model, usageInfo.usage);
        break;
      } catch (err) {
        console.warn(`Model ${m} lines extraction failed, trying next if available`, err);
        if (m === sheetifyModels[sheetifyModels.length - 1]) throw err;
      }
    }
    const responseObject = handleConversation(result, conversation);

    const lines: LineRow[] = responseObject.map(
      (line: Omit<LineRow, "رقم النص" | "رقم الصفحة">, index: number) => ({
        ...line,
        ["رقم الصفحة"]: key,
        ["رقم النص"]: index + 1,
      })
    );

    try {
      sheet.push(...lines.sort((a, b) => (a['رقم الصفحة'] - b['رقم الصفحة']) || (a['رقم النص'] - b['رقم النص'])));
    } catch (err) {
      console.error(
        "Failed to parse assistant response:",
        responseObject,
        err
      );
    }

    return { lines, updatedSpeakers };

  }

  return [sheet, startingSpeakers, extract] as const;
}

export async function useForeignNamesExtractor(sessionId: string, cachedSheet: ForeignNameRow[], { readingMemoryLimit, costTracker }: { readingMemoryLimit: number; costTracker?: CostTracker } = { readingMemoryLimit: 10 }): Promise<[ForeignNameRow[], (key: number, image: string, previousResults?: any[]) => Promise<ForeignNameRow[]>]> {
  const conversation: ReadingMemory = new ReadingMemory(readingMemoryLimit ?? 1);
  const sheet: ForeignNameRow[] = cachedSheet;
  const instructions = await fs.readFile(path.join('src/lib/prompts', 'foreign-name-extraction.md'), 'utf-8');

  async function extract(key: number, image: string, previousResults: any[] = []): Promise<ForeignNameRow[]> {
    const scanner = new Scanner(sessionId);
    const targetText = await scanner.scanImage(key, image);

    const messages: any[] = [
      { role: "system", content: instructions }
    ];

    if (previousResults.length > 0) {
      messages.push({
        role: "user",
        content: `Here are the results from previous pages for context (to maintain consistency and avoid duplicates):\n${JSON.stringify(previousResults.slice(-50))}`
      });
      messages.push({
        role: "assistant",
        content: "Understood. I will use this context to maintain consistency and avoid duplicates in the new extraction."
      });
    }

    messages.push({
      role: 'user',
      content: [
        {
          type: "text",
          text: "Please extract the names from this page according to the instructions:\n\n" + targetText
        }
      ],
    });

    const config = {
      response_format: {
        type: "json_schema",
        json_schema: {
          name: "results_schema",
          strict: true,
          schema: {
            type: "object",
            required: ["results"],
            properties: {
              results: {
                type: "array",
                items: {
                  type: "object",
                  required: [
                    "الإسم بالعربي",
                    "الإسم باللغة الأجنبية",
                    "اللغة"
                  ],
                  properties: {
                    "الإسم بالعربي": { type: "string" },
                    "الإسم باللغة الأجنبية": { type: "string" },
                    "اللغة": { type: "string" },
                  },
                  additionalProperties: false
                }
              }
            },
            additionalProperties: false
          }
        }
      }
    } as const;

    const model = "google/gemini-3.5-flash";

    const result = await tryCall(async () => {
      return await getAI().chat.completions.create({
        model,
        messages: messages,
        ...config,
      });
    });
    const usageInfo = extractUsageFromResult(result);
    if (usageInfo && costTracker) costTracker.track(usageInfo.model, usageInfo.usage);
    const responseObject = handleConversation(result, conversation);

    const lines: ForeignNameRow[] = responseObject.map(
      (line: Omit<ForeignNameRow, "رقم النص" | "رقم الصفحة">, index: number) => {
        const name = line["الإسم باللغة الأجنبية"];
        const nameParts = name.split(' ');
        const namePartOne = encodeURIComponent(nameParts[0]);
        const namePartTwo = encodeURIComponent(nameParts[1]);

        return {
          ...line,
          ["رقم الصفحة"]: key,
          ["رقم النص"]: index + 1,
          ["الرابط الأول"]: `https://youglish.com/pronounce/${encodeURIComponent(name)}`,
          ["الرابط الثاني"]: namePartOne ? `https://youglish.com/pronounce/${namePartOne}` : "",
          ["الرابط الثالث"]: namePartTwo ? `https://youglish.com/pronounce/${namePartTwo}` : "",
        }

      }
    );

    if (responseObject.length === 0) return [];

    try {
      sheet.push(...lines);
    } catch (err) {
      console.error(
        "Failed to parse assistant response:",
        responseObject,
        err
      );
    }

    return lines;

  }

  return [sheet, extract] as const;
}