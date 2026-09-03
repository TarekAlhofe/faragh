import { create } from 'zustand'

export interface DocumentsStoreState {
    documentsCache: Record<string, File | undefined>
    cacheDocument: (sessionId: string, document: File) => void
    getOneDocument: (sessionId: string) => Promise<File | null>
    removeDocument: (sessionId: string) => void
    fetchDocument: (sessionId: string) => Promise<File | null>
}

export const useDocumentsStore = create<DocumentsStoreState>((set, get) => ({
    documentsCache: {},
    fetchDocument: async (sessionId: string) => {
        const documentRequest = await fetch(`/api/sessions/${sessionId}/pdf`);
        if (!documentRequest.ok) return null;
        const documentResponse = await documentRequest.blob();
        const documentFile = new File([documentResponse], "documentResponse", { type: 'application/pdf' });
        get().cacheDocument(sessionId, documentFile);
        return documentFile;
    },
    cacheDocument: (sessionId: string, document: File) => {
        set(({ documentsCache }) => ({
            documentsCache: { ...documentsCache, [sessionId]: document }
        }))
    },
    getOneDocument: async (sessionId: string) => {
        const document = get().documentsCache[sessionId];
        return document ?? await get().fetchDocument(sessionId);
    },
    removeDocument: (sessionId: string) => {
        const { documentsCache } = get()
        set({ documentsCache: { ...documentsCache, [sessionId]: undefined } })
    },
}))