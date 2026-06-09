export type Row = {
  ['رقم الصفحة']: number;
  ['رقم النص']: number;
}

declare global {
  interface Window {
    pdfjsLib: PDFJs;
  }
}

export type LineRow = Row & {
  ['الشخصية']: string;
  ['النص']: string;
  ['النبرة']: string;
  ['المكان']: string;
  ['الخلفية الصوتية']: string;
  ['رقم الصفحة']: number;
  ['رقم النص']: number;
}

export type ForeignNameRow = Row & {
  ['اللغة']: string;
  ['الإسم بالعربي']: string;
  ['الإسم باللغة الأجنبية']: string;
  ['الرابط الأول']: string;
  ['الرابط الثاني']: string;
  ['الرابط الثالث']: string;
}

export enum SESSION_MODES {
  NAMES = 'names',
  LINES = 'lines'
}

export type Sheet<T extends Row> = T[];

export type SheetFile<T extends Row> = {
  pdfFilename: string;
  sheet: Sheet<T>;
}

export type Summary = string;

export type PDFJs = typeof import('pdfjs-dist');

export type Message = {
  role: "system" | "user" | "assistant";
  content: string | Array<{
    type: "text";
    text: string;
  } | {
    type: "image_url";
    image_url: {
      url: string;
    };
  }>;
}

export enum SESSION_STAGES {
  IDLE = 'IDLE',
  READY = 'READY',
  SCANNING = 'SCANNING',
  EXTRACTING = 'EXTRACTING'
}

export type SessionProgress<T> = {
  stage: SESSION_STAGES;
  cursor: number;
  progress: number;
  details: T;
}

export type Session = {
  id: string;
  filename: string;
  createdAt: number;
  mode?: SESSION_MODES;
  status?: "processing" | "completed" | "error";
};

enum SESSION_STATUS {
  NOT_STARTED = "Not Started",
  PROCESSING = "Processing",
  COMPLETED = "Completed",
  FAILED = "Failed"
}

interface SessionDocument {
  mimeType: string;
  filename: string;
}

interface SessionSheet {
  filename: string;
  data: string;
}

interface _Session {
  id: string;
  createdAt: string;
  mode: SESSION_MODES;
  status: SESSION_STATUS;
  document: SessionDocument;
  sheet: SessionSheet;
}