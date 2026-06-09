import fs from 'fs/promises';
import path from 'path';
import '@ungap/with-resolvers';
import { ForeignNameRow, LineRow, Row } from '@/lib/types';
import { ReadingMemory, tryCall } from "./utils";

import { callAI, getAI, handleConversation } from "./ai";
import { fromBuffer } from 'pdf2pic';
import countPages from 'page-count';

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

export async function useCharacterLinesExtractor(startingSheet: LineRow[], { readingMemoryLimit }: { readingMemoryLimit: number } = { readingMemoryLimit: 10 }): Promise<[LineRow[], (key: number, image: string, previousResults?: any[]) => Promise<LineRow[]>]> {
  const conversation: ReadingMemory = new ReadingMemory(readingMemoryLimit ?? 1);
  const sheet: LineRow[] = startingSheet;
  const instructions = await fs.readFile(path.join('src/lib/prompts', 'sheetify.md'), 'utf-8');

  async function extract(key: number, image: string): Promise<LineRow[]> {

    const messages: any[] = [
      { role: "system", content: instructions }
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
          type: "image_url",
          image_url: {
            url: `data:image/jpeg;base64,${image}`,
          }
        },
        {
          type: "text",
          text: "Please extract the data from this page according to the instructions."
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
                    "الشخصية",
                    "النص",
                    "النبرة",
                    "المكان",
                    "الخلفية الصوتية",
                  ],
                  properties: {
                    "الشخصية": { type: "string" },
                    "النص": { type: "string" },
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

    // Fallback between flash and flash-lite models on failure
    const models = ["google/gemini-2.5-flash", "google/gemini-2.5-flash-lite"] as const;
    let result: any;
    for (const m of models) {
      try {
        result = await tryCall(async () => {
          return await getAI().chat.completions.create({
            model: m,
            messages: messages,
            ...config,
          });
        });
        break;
      } catch (err) {
        console.warn(`Model ${m} failed, trying next if available`, err);
        if (m === models[models.length - 1]) throw err;
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

    return lines;

  }

  return [sheet, extract] as const;
}

export async function useForeignNamesExtractor(cachedSheet: ForeignNameRow[], { readingMemoryLimit }: { readingMemoryLimit: number } = { readingMemoryLimit: 10 }): Promise<[ForeignNameRow[], (key: number, image: string, previousResults?: any[]) => Promise<ForeignNameRow[]>]> {
  const conversation: ReadingMemory = new ReadingMemory(readingMemoryLimit ?? 1);
  const sheet: ForeignNameRow[] = cachedSheet;
  const instructions = await fs.readFile(path.join('src/lib/prompts', 'foreign-name-extraction.md'), 'utf-8');

  async function extract(key: number, image: string, previousResults: any[] = []): Promise<ForeignNameRow[]> {

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
          type: "image_url",
          image_url: {
            url: `data:image/png;base64,${image}`,
          }
        },
        {
          type: "text",
          text: "Please extract the names from this page according to the instructions."
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

    const model = "google/gemini-2.5-flash";

    const result = await tryCall(async () => {
      return await getAI().chat.completions.create({
        model,
        messages: messages,
        ...config,
      });
    });
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