# Faragh

Faragh is a Next.js application for extracting structured data from Arabic PDF books. A user uploads a PDF, selects a page range, chooses an extraction mode, and Faragh returns an Excel file with the extracted results.

The app currently supports two modes:

- **Names mode**: extracts Arabic names, foreign names, language, and pronunciation/search links.
- **Lines mode**: extracts speaker/dialogue style data, including speaker, phrase, tone, place, and background sound.

## Tech Stack

- **Next.js 15** with the App Router
- **React 19**
- **TypeScript**
- **Chakra UI**
- **Redis** for session state, progress, cached OCR text, and generated sheets
- **Google Cloud Vision API** for OCR
- **OpenRouter** through the `openai` SDK for AI extraction
- **pdf2pic**, GraphicsMagick, and Ghostscript for rendering PDF pages to images
- **xlsx** for generating downloadable Excel files
- **Docker Compose** for running the app with Redis

## How The Project Works

1. The user opens the web app and uploads a PDF.
2. The frontend creates a session through `POST /api/sessions`.
3. The user selects a start page, end page, and extraction mode.
4. The frontend sends the PDF to `POST /api/sessions/[sessionId]`.
5. The backend renders selected PDF pages into images with `pdf2pic`.
6. Each rendered page is sent to Google Cloud Vision OCR.
7. OCR text is cached in Redis using keys like `session:[sessionId]:[page]:content`.
8. The extracted text is sent to the AI model through OpenRouter.
9. The AI response is parsed into structured rows.
10. Progress, partial results, cost, processed pages, and session metadata are saved in Redis.
11. The frontend polls `GET /api/sessions/[sessionId]/progress` every second.
12. When processing finishes, the user downloads the result from `GET /api/sessions/[sessionId]` as an `.xlsx` file.

PDF files are also saved locally under:

```bash
storage/pdfs
```

That allows the app to reload a previous session's PDF from:

```bash
GET /api/sessions/[sessionId]/pdf
```

## Project Structure

```text
faragh/
├── public/
│   └── pdfjs-5.4.530-dist/      # PDF.js browser files used by the frontend PDF viewer
├── src/
│   ├── app/
│   │   ├── api/
│   │   │   ├── assets/          # Vercel Blob upload helper route
│   │   │   └── sessions/        # Session, progress, PDF, and download API routes
│   │   ├── layout.tsx           # App layout
│   │   └── page.tsx             # Main upload/extraction UI
│   ├── components/
│   │   ├── Sidebar.tsx
│   │   └── ui/                  # Chakra UI helper components
│   └── lib/
│       ├── ai.ts                # OpenRouter/OpenAI SDK client
│       ├── redis.ts             # Redis connection
│       ├── scanner.ts           # Google Vision OCR scanner
│       ├── serverHooks.ts       # PDF rendering and extraction logic
│       ├── stores/              # Zustand frontend stores
│       ├── prompts/             # AI system prompts
│       ├── types.ts             # Shared TypeScript types
│       └── utils.ts             # XLSX, retry, filtering, and cost helpers
├── docker-compose.yml           # App + Redis development stack
├── Dockerfile                   # Production Docker image
├── Dockerfile.dev               # Development Docker image
├── package.json                 # npm scripts and dependencies
└── README.md
```

## Requirements

For local development without Docker:

- Node.js 20 or newer
- npm
- Redis running locally
- GraphicsMagick and Ghostscript installed on your machine
- Google Cloud Vision API key
- OpenRouter API key

For Docker development:

- Docker
- Docker Compose
- Google Cloud Vision API key
- OpenRouter API key

Docker is the easiest way to run this project because the image installs the native PDF/image dependencies automatically.

## Environment Variables

Create a `.env` file in the project root.

Example:

```env
OPEN_ROUTE=your_openrouter_api_key
GOOGLE_VISION_API_KEY=your_google_vision_api_key
REDIS_HOST=redis
REDIS_PORT=6379
PORT=8080
```

Important notes:

- `OPEN_ROUTE` is required by `src/lib/ai.ts`.
- `GOOGLE_VISION_API_KEY` is required by `src/lib/scanner.ts`.
- `REDIS_HOST=redis` is correct when running with Docker Compose.
- `REDIS_HOST=localhost` is usually correct when running the app locally and Redis is installed directly on your machine.
- The current Redis helper reads the port from `REDIS_URL`, falling back to `6379`. If you need a custom Redis port locally, set `REDIS_URL` to the port number.

Local non-Docker example:

```env
OPEN_ROUTE=your_openrouter_api_key
GOOGLE_VISION_API_KEY=your_google_vision_api_key
REDIS_HOST=localhost
REDIS_URL=6379
PORT=8080
```

## Install Dependencies

```bash
npm install
```

Use this when running the project directly on your machine.

## Run With Docker

The recommended development command is:

```bash
npm run docker
```

This runs:

```bash
docker compose up --build -w
```

What it does:

- Builds the app using `Dockerfile.dev`
- Starts the Next.js development server
- Starts a Redis container
- Maps the app to `http://localhost:8080` by default
- Watches local source files and syncs changes into the container
- Restarts or rebuilds when important config or package files change

Open the app at:

```text
http://localhost:8080
```

To use another port:

```bash
PORT=3000 npm run docker
```

On Windows PowerShell:

```powershell
$env:PORT=3000
npm run docker
```

Then open:

```text
http://localhost:3000
```

To stop Docker:

```bash
docker compose down
```

To stop Docker and remove the Redis volume:

```bash
docker compose down -v
```

Use `-v` only when you want to delete saved Redis session data.

## Run Locally Without Docker

Start Redis first.

Example with Docker Redis only:

```bash
docker run --name faragh-redis -p 6379:6379 redis:7-alpine
```

Then set `.env` for local Redis:

```env
REDIS_HOST=localhost
REDIS_URL=6379
PORT=8080
```

Install dependencies:

```bash
npm install
```

Start the development server:

```bash
npm run dev
```

Open:

```text
http://localhost:8080
```

The `dev` script runs:

```bash
next dev -H 0.0.0.0 --turbo
```

## npm Commands

### `npm run dev`

Starts the Next.js development server with Turbopack.

```bash
npm run dev
```

Use this for normal local development when Redis and native PDF/image dependencies are already available.

### `npm run docker`

Starts the full Docker Compose development environment.

```bash
npm run docker
```

Use this when you want the app and Redis to run together in containers.

### `npm run build`

Creates a production build.

```bash
npm run build
```

This runs:

```bash
next build
```

The Next config currently ignores ESLint errors during production builds.

### `npm run start`

Starts the compiled production app.

```bash
npm run start
```

Run `npm run build` before this command.

### `npm run lint`

Runs the lint command from `package.json`.

```bash
npm run lint
```

Note: this project uses Next.js 15, where `next lint` may require adjustment depending on your installed Next version. If this command fails, use the ESLint config in `eslint.config.mjs` with the current Next.js linting recommendation.

## Docker Files

### `Dockerfile.dev`

Used by `docker-compose.yml` for development.

It:

- Uses `node:20-bullseye`
- Installs native dependencies required by `canvas`, `pdf2pic`, GraphicsMagick, and Ghostscript
- Runs `npm install`
- Starts the app with `npm run dev`

### `Dockerfile`

Production image.

It:

- Uses `node:20-bullseye`
- Installs native PDF/image dependencies
- Runs `npm ci`
- Builds the Next.js app
- Starts the app with `npm start`

## API Routes

### `POST /api/sessions`

Creates a new session ID and initializes progress in Redis.

### `GET /api/sessions`

Returns saved sessions from Redis metadata.

### `POST /api/sessions/[sessionId]`

Processes an uploaded PDF for the selected page range and mode.

Query parameters:

- `startPage`: first page to process
- `endPage`: last page to process
- `mode`: `names` or `lines`

### `GET /api/sessions/[sessionId]`

Downloads the generated Excel sheet.

### `DELETE /api/sessions/[sessionId]`

Deletes Redis data for the session.

### `GET /api/sessions/[sessionId]/progress`

Returns current processing progress.

### `GET /api/sessions/[sessionId]/status`

Returns detailed session state, including processed pages, sheet rows, mode, stage, cost, and status.

### `GET /api/sessions/[sessionId]/pdf`

Returns the saved PDF for a session.

### `POST /api/assets`

Handles Vercel Blob PDF upload tokens. This route is present, but the main UI currently sends files directly to the session API.

## Redis Data

Faragh stores runtime state in Redis. Common keys include:

```text
[sessionId]/progress
[sessionId]/sheet
[sessionId]/state
[sessionId]/speakers
session:[sessionId]:[pageNumber]:content
sessions:index
sessions:metadata
```

Redis is used for:

- Session list and metadata
- Processing status
- Progress percentage
- Extracted rows
- Processed page tracking
- Speaker memory in lines mode
- OCR text caching

Some session keys use a 5-hour expiration when processing state is saved.

## Extraction Modes

### Names Mode

Names mode extracts:

- Page number
- Text number
- Arabic name
- Foreign name
- Language
- YouGlish link
- Howjsay link
- Forvo link

It also filters similar duplicate English names before displaying results.

### Lines Mode

Lines mode extracts:

- Page number
- Text number
- Speaker
- Phrase
- Tone
- Place
- Background sound

For this mode, the backend scans surrounding pages for speaker context and then extracts the target page lines.

## Troubleshooting

### App cannot connect to Redis

If using Docker, make sure `.env` contains:

```env
REDIS_HOST=redis
```

If running locally, use:

```env
REDIS_HOST=localhost
REDIS_URL=6379
```

### Google Vision API error

Check that:

- `GOOGLE_VISION_API_KEY` is set
- The key has access to Google Cloud Vision API
- Billing/API access is enabled in Google Cloud

### OpenRouter error

Check that:

- `OPEN_ROUTE` is set
- The OpenRouter key is valid
- The configured model is available in your OpenRouter account

The current extraction model is:

```text
deepseek/deepseek-v4-flash
```

### PDF rendering fails

Use Docker if possible. Local PDF rendering requires native tools such as GraphicsMagick and Ghostscript.

### Processing is slow

Large PDFs take time because each page must be rendered, OCR-scanned, and sent through AI extraction. Names mode processes extraction concurrently. Lines mode processes pages sequentially to preserve speaker context.

## Typical Development Workflow

1. Create or update `.env`.
2. Run the full stack:

```bash
npm run docker
```

3. Open:

```text
http://localhost:8080
```

4. Upload a PDF.
5. Select the page range.
6. Choose `الأسماء` for names or `الجمل` for lines.
7. Click the extraction button.
8. Watch progress in the table.
9. Download the generated Excel file.

## Notes For Contributors

- Main UI logic lives in `src/app/page.tsx`.
- Backend processing lives mostly in `src/app/api/sessions/[sessionId]/route.ts` and `src/lib/serverHooks.ts`.
- AI prompts live in `src/lib/prompts`.
- Redis connection settings live in `src/lib/redis.ts`.
- Shared row/session types live in `src/lib/types.ts`.
- Excel generation lives in `src/lib/utils.ts`.

