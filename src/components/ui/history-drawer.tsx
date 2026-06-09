import { Box, Button, CloseButton, Drawer, Portal } from "@chakra-ui/react";
import { useState } from "react";
import Sidebar from "../Sidebar";
import React from "react";
import type { Session } from '@/lib/types';

// Move this OUTSIDE of Home()
export const HistoryDrawer = React.memo(({
    sessionId,
    sessions,
    onSelectSession,
    onDeleteSession,
    onNewSession
}: {
    sessionId: string | null;
    sessions: Promise<Session[]>;
    onSelectSession: (id: string) => void;
    onDeleteSession: (id: string) => void;
    onNewSession: () => void;
}) => {
    const [isOpen, setIsOpen] = useState(false);

    return (
        <Drawer.Root
            open={isOpen}
            onOpenChange={(e) => setIsOpen(e.open)}
            placement={{ mdDown: "bottom", md: "start" }}
        >
            <Drawer.Trigger asChild>
                <Button variant="solid" size="sm" width={{ base: "100%", md: "fit-content" }} marginY={4}>
                    السجلات
                </Button>
            </Drawer.Trigger>
            <Portal>
                <Drawer.Backdrop />
                <Drawer.Positioner>
                    <Drawer.Content
                        display="flex"
                        flexDirection="column"
                        w={{ base: "100vw", md: "320px" }}
                        maxW={{ base: "100vw", md: "320px" }}
                        h={{ base: "70vh", md: "100vh" }}
                        borderTopRadius={{ base: "16px", md: "0px" }}
                    >
                        <Box flex={1} overflow="auto" minH={0}>
                            <Sidebar
                                currentSessionId={sessionId}
                                sessions={sessions}
                                onSelectSession={onSelectSession}
                                onDeleteSession={onDeleteSession}
                                onNewSession={onNewSession}
                            />
                        </Box>
                        <Drawer.CloseTrigger asChild>
                            <CloseButton size="sm" position="absolute" top={2} insetEnd={2} />
                        </Drawer.CloseTrigger>
                    </Drawer.Content>
                </Drawer.Positioner>
            </Portal>
        </Drawer.Root>
    );
});

HistoryDrawer.displayName = 'HistoryDrawer';