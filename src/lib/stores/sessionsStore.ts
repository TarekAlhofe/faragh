import { create } from 'zustand'
import { Session } from '../types'

export interface SessionsStoreState {
    sessionsCache: Record<string, Session>
    cacheSession: (sessionId: string, session: Session) => void
    getOneSession: (sessionId: string) => Promise<Session | null>
    clearSession: (sessionId: string) => void
    fetchOneSession: (sessionId: string) => Promise<Session | null>
    fetchAllSessions: () => Promise<Session[] | null>
    getAllSessions: () => Promise<Session[]>
    cacheSessions: (sessions: Session[]) => void
    createSession: (session: Omit<Session, 'id' | 'createdAt'>) => Promise<Session>
}

export const useSessionsStore = create<SessionsStoreState>((set, get) => ({
    sessionsCache: {},
    fetchOneSession: async (sessionId: string) => {
        const sessionRequest = await fetch(`/api/sessions/${sessionId}`);
        if (!sessionRequest.ok) return null;
        const sessionResponse = await sessionRequest.json();
        return sessionResponse;
    },
    cacheSession: (sessionId: string, session: Session) => {
        set(({ sessionsCache }) => ({
            sessionsCache: { ...sessionsCache, [sessionId]: session }
        }))
    },
    cacheSessions: (sessions: Session[]) => {
        set(({ sessionsCache }) => ({
            sessionsCache: sessions.reduce((acc: Record<string, Session>, session: Session) => {
                acc[session.id] = session;
                return acc;
            }, {})
        }))
    },
    getOneSession: async (sessionId: string) => {
        const session = get().sessionsCache[sessionId];
        if (!session) {
            const session = await get().fetchOneSession(sessionId);
            if (session) get().cacheSession(sessionId, session);
            return session;
        }
        return session;
    },
    clearSession: (sessionId: string) => {
        const { sessionsCache } = get()
        delete sessionsCache[sessionId]
        set({ sessionsCache })
    },
    fetchAllSessions: async () => {
        const sessionsRequest = await fetch(`/api/sessions`);
        if (!sessionsRequest.ok) return null;
        const sessionsResponse = await sessionsRequest.json();
        const sessions = sessionsResponse.sessions || [];
        return sessions;
    },
    getAllSessions: async () => {
        const { sessionsCache } = get()
        if (Object.keys(sessionsCache).length > 0) return Object.values(sessionsCache);
        const sessions = await get().fetchAllSessions();
        if (sessions) {
            set(({ sessionsCache }) => ({
                sessionsCache: sessions.reduce((acc: Record<string, Session>, session: Session) => {
                    acc[session.id] = session;
                    return acc;
                }, {})
            }))
        }
        return sessions ?? [];
    },
    createSession: async (session: Omit<Session, 'id' | 'createdAt'>) => {
        const response = await fetch("/api/sessions", {
            method: "POST",
            headers: {
                "Content-Type": "application/json"
            },
        });
        if (!response.ok) throw new Error("Failed to create session");
        const data = await response.json();
        const newSession: Session = { ...session, id: data.sessionId, createdAt: Date.now() };
        get().cacheSession(data.sessionId, newSession);
        return newSession;
    }
}))