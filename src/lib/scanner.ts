import { getRedis } from './redis';

export class Scanner {
  private sessionId: string;

  constructor(sessionId: string) {
    this.sessionId = sessionId;
  }

  /**
   * Scans a base64 image using Google Cloud Vision OCR, caching the result in Redis.
   * 
   * @param pageNumber The page number of the PDF
   * @param base64Image The base64 encoded string of the image
   * @returns The extracted text
   */
  async scanImage(pageNumber: number, base64Image: string): Promise<string> {
    const key = `session:${this.sessionId}:${pageNumber}:content`;
    const redis = getRedis();
    
    try {
      // 1. Check Redis cache first
      const cachedText = await redis.get(key);
      if (cachedText !== null) {
        return cachedText;
      }
    } catch (error) {
      console.warn("Failed to check Redis cache, proceeding to Vision API...", error);
    }

    // 2. Not in cache, call Google Cloud Vision API
    const apiKey = process.env.GOOGLE_VISION_API_KEY;
    if (!apiKey) {
      throw new Error("GOOGLE_VISION_API_KEY is not set in environment variables");
    }

    const response = await fetch(`https://vision.googleapis.com/v1/images:annotate?key=${apiKey}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        requests: [
          {
            image: {
              content: base64Image
            },
            features: [
              {
                type: 'DOCUMENT_TEXT_DETECTION'
              }
            ]
          }
        ]
      })
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Google Vision API error: ${response.status} - ${errorText}`);
    }

    const data = await response.json();
    const textAnnotations = data.responses?.[0]?.textAnnotations;
    
    // The first element contains the entire text block from Vision API
    const fullText = textAnnotations && textAnnotations.length > 0 ? textAnnotations[0].description : ' ';

    try {
      // 3. Cache the extracted text back to Redis
      await redis.set(key, fullText);
    } catch (error) {
      console.warn("Failed to set Redis cache for OCR text", error);
    }

    return fullText;
  }
}
