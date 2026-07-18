"use client";
import { useEffect, useState, useMemo } from 'react';
import { useSearchParams, useRouter, usePathname } from 'next/navigation';
import {
  Box,
  Button,
  Container,
  VStack,
  HStack,
  Progress,
  Input,
  Field,
  Spinner,
  Table,
  Text,
  RadioCard,
  Badge,
  Drawer,
  Portal,
  CloseButton
} from '@chakra-ui/react';
import { Toaster, toaster } from '@/components/ui/toaster';
import { FileUpload, Icon } from '@chakra-ui/react';
import { LuDownload, LuUpload } from 'react-icons/lu';
import Timer from '@/components/ui/timer';
import { ForeignNameRow, LineRow, PDFJs, Session, SESSION_MODES, SESSION_STAGES } from '@/lib/types';
import { filterSimilarEnglishNames } from '@/lib/utils';
import PDFViewer from '@/components/ui/pdf-viewer';
import nextJsVersion from 'next/package.json';
import Script from 'next/script';
import Sidebar from '@/components/Sidebar';
import React from 'react';
import { HistoryDrawer } from '@/components/ui/history-drawer';
import { useDocumentsStore } from '@/lib/stores/documentsStore'
import { useSessionsStore } from '@/lib/stores/sessionsStore';

export const dynamic = "force-dynamic";

const draftFiles = new Map<string, File>();

export default function Home() {
  const [file, setFile] = useState<File | null>(null);
  const [isUploading, setIsUploading] = useState(false);
  const [startPage, setStartPage] = useState(1);
  const [totalPages, setTotalPages] = useState(0);
  const [endPage, setEndPage] = useState(0);
  const [isDone, setIsDone] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const [isUnsavedSession, setIsUnsavedSession] = useState(false);
  const [sheetUrl, setSheetUrl] = useState<string | null>(null);
  const [pdfViewerCursor, setPdfViewerCursor] = useState(1);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [currentProgress, setProgress] = useState<number>(0);
  const [progressLabel, setProgressLabel] = useState<string | null>(null);
  const [progressDetails, setProgressDetails] = useState<LineRow[] | ForeignNameRow[] | null>(null);
  const [sessionCost, setSessionCost] = useState<number>(0);
  const [selectedMode, setSelectedMode] = useState<SESSION_MODES | null>(SESSION_MODES.NAMES);
  const [pdfJs, setPdfJs] = useState<PDFJs | null>(null);
  const [isOpen, setIsOpen] = useState(false);
  const documentsStore = useDocumentsStore();
  const sessionsStore = useSessionsStore();

  const searchParams = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();

  // Sync URL with sessionId state
  useEffect(() => {
    const params = new URLSearchParams(searchParams.toString());
    const currentUrlSessionId = params.get('sessionId');

    if (sessionId) {
      if (currentUrlSessionId !== sessionId) {
        params.set('sessionId', sessionId);
        router.push(`${pathname}?${params.toString()}`, { scroll: false });
      }
    } else if (currentUrlSessionId) {
      params.delete('sessionId');
      const newUrl = params.toString() ? `${pathname}?${params.toString()}` : pathname;
      router.push(newUrl, { scroll: false });
    }
  }, [sessionId, pathname, router, searchParams]);

  const modes = [
    { value: SESSION_MODES.NAMES, title: "الأسماء" },
    { value: SESSION_MODES.LINES, title: "الجمل" }
  ]


  // Rehydrate session once page is fully loaded.
  useEffect(() => {

    if (!sessionId || !pdfJs) return;

    (async () => {
      const sessionDocument = await documentsStore.getOneDocument(sessionId);
      setFile(sessionDocument);
    })();

  }, [])

  // Update File data when its loaded
  useEffect(() => {
    (async () => {
      if (!file) return;
      const pdf = await pdfJs?.getDocument({ data: await file.arrayBuffer() }).promise;
      if (!pdf) return;
      setTotalPages(pdf.numPages);
      setEndPage(pdf.numPages);
      document.title = `فراغ استوديو | ${file.name.replace(".pdf", "")}`
    })()
  }, [file])

  useEffect(() => {
    if (!sessionId) return;

    let active = true;

    const poll = async () => {
      if (!active) return;

      if (!isProcessing) return;

      try {
        const request = await fetch(`/api/sessions/${sessionId}/progress`);
        const { stage, cursor, progress, details, cost } = await request.json();

        if (stage === SESSION_STAGES.READY) {
          setProgressLabel(null);
          setProgress(0);
          setProgressDetails(null);
          setSessionCost(0);
        } else {
          setPdfViewerCursor(cursor);
          setProgress(progress);
          if (typeof cost === 'number') setSessionCost(cost);
        }

        if (stage === SESSION_STAGES.SCANNING) {
          setProgressLabel("جاري مسح ملف الـ PDF");
        }

        if (stage === SESSION_STAGES.EXTRACTING) {
          setProgressLabel("جاري إستخراج النص");
          const parsedDetails = JSON.parse(details);
          // Apply filter for duplicate English names if in NAMES mode
          const filteredDetails = selectedMode === SESSION_MODES.NAMES
            ? filterSimilarEnglishNames(parsedDetails)
            : parsedDetails;
          setProgressDetails(filteredDetails);
        }

        if (isDone) {
          setIsDone(true);
        }

      } catch (error) {
        console.error("Polling error:", error);
      }

      setTimeout(poll, 1000); // Schedule next poll
    };

    poll();

    return () => {
      active = false; // Cleanup: stop polling on unmount or sessionId change
    };

  }, [sessionId, isUploading, isProcessing]);

  const handleFileChange = async (details: { acceptedFiles: File[] }) => {
    const newDocument = details.acceptedFiles[0];
    if (!newDocument || !pdfJs) return;

    if (newDocument && pdfJs) {

      try {

        setIsUploading(true);


        const newSession = await sessionsStore.createSession({ filename: newDocument.name });

        setSessionId(newSession.id);

        documentsStore.cacheDocument(newSession.id, newDocument);

        setFile(newDocument);
        setIsUnsavedSession(true);
        setIsUploading(false);

      } catch (error) {
        if (error instanceof Error) {
          toaster.create({
            title: 'خطأ في إنشاء الجلسة',
            description: error.message,
            type: 'error',
            duration: 3000,
          });
        }
      }
    }
  };

  const handleConvert = async () => {

    if (!sessionId) return;

    // updateSessionStatus(sessionId, 'processing')

    if (!file) {
      toaster.create({
        title: 'No file selected',
        type: 'error',
        duration: 3000,
      });
      return;
    }

    if (currentProgress > 0 && !isProcessing && !isDone) {
      toaster.create({
        title: 'جاري استئناف التفريغ...',
        type: 'info',
        duration: 3000
      });
    }


    try {
      const document = await documentsStore.getOneDocument(sessionId);
      if (!document) {
        toaster.create({ title: 'الملف غير موجود', type: 'error', duration: 3000 });
        return;
      }
      const formData = new FormData();
      formData.append('file', document);
      const { sessionId: newSessionId } = await fetch(`/api/sessions`, {
        method: "POST",
        body: formData
      }).then(res => res.json());
      draftFiles.delete(sessionId);
    } catch (error) {
      if (error instanceof Error) {
        toaster.create({
          title: 'خطأ في إنشاء الجلسة',
          description: error.message,
          type: 'error',
          duration: 3000,
        });
      }
    }

    setIsUploading(true);

    // const { sessionId: newSessionId } = await fetch(`/api/sessions`, 
    //   { method: "POST" }).then(res => res.json());

    try {
      setIsProcessing(true);
      const formData = new FormData();
      formData.append('file', file);

      const request = await fetch(
        `/api/sessions/${sessionId}?startPage=${startPage}&endPage=${endPage}&mode=${selectedMode}`,
        {
          method: 'POST',
          body: formData
        }
      );

      // Once execution starts, it's considered saved
      setIsUnsavedSession(false);

      // Try to parse response
      let response;
      try {
        response = await request.json();
      } catch {
        toaster.create({
          title: 'استجابة غير صحيحة',
          description: 'الخادم أرسل بيانات غير صحيحة',
          type: 'error',
          duration: 5000
        });
        return;
      }

      // Check if request was successful
      if (request.ok) {
        setSheetUrl(response.sheetUrl);
        setIsDone(true);
        updateSessionStatus(sessionId, 'completed')
        toaster.create({
          title: `تم تفريغ كتاب "${file.name.replace('.pdf', '')}" بنجاح!`,
          description: `اضغط على زر "تحميل الملف" لتنزيل الملف`,
          type: 'success',
          duration: 3000
        });
      } else {
        // Check for server errors (5xx)
        if (request.status >= 500) {
          updateSessionStatus(sessionId, 'error')
          toaster.create({
            title: 'خطأ في الخادم',
            description: 'تأكد من اتصالك بالانترنت أو اعد المحاولة لاحقا',
            type: 'error',
            duration: 5000
          });
          return;
        }

        // Check for specific error types
        const { type } = response;

        if (type === 'EXCEEDED_QUOTA') {
          updateSessionStatus(sessionId, 'error')
          toaster.create({
            title: 'الحد اليومي للتفريغ قد تم تجاوزه',
            description: 'الحد اليومي للتفريغ هو 500 صفحة في اليوم',
            type: 'error',
            duration: 3000
          });
        } else if (type === 'GEMINI_INVALID_INPUT') {
          updateSessionStatus(sessionId, 'error')
          toaster.create({
            title: 'لا يمكن معالجة هذا الكتاب',
            description: 'استخدم هذا الموقع لحل المشكلة: https://www.ilovepdf.com/repair-pdf',
            type: 'error',
            duration: 20000
          });
        } else {
          updateSessionStatus(sessionId, 'error')
          toaster.create({
            title: 'خطأ أثناء التفريغ',
            description: response.details || 'حدث خطأ غير متوقع',
            type: 'error',
            duration: 5000
          });
        }
      }

    } catch (error: unknown) {
      updateSessionStatus(sessionId, 'error')
      if (error instanceof Error) {
        // Network error
        if (error.message.includes('fetch') || error.message.includes('Network')) {
          toaster.create({
            title: 'فقدان الاتصال',
            description: 'تحقق من اتصالك بالإنترنت',
            type: 'error',
            duration: 5000
          });
        }
        // Other errors
        else {
          updateSessionStatus(sessionId, 'error')
          toaster.create({
            title: 'حدث خطأ',
            description: error.message,
            type: 'error',
            duration: 3000
          });
        }
      }
    } finally {
      setIsUploading(false);
      setIsProcessing(false);
      setProgressLabel(null);
    }
  };

  const handleDownload = async () => {
    if (!sessionId) {
      toaster.create({
        title: 'لا يوجد جلسة حالية',
        type: 'error',
        duration: 3000
      });
      return;
    }

    const downloadUrl = `/api/sessions/${sessionId}`;

    const link = document.createElement('a');
    link.href = downloadUrl;
    link.click();

    toaster.create({
      title: 'تم بدء التنزيل',
      description: 'متصفحك لا يدعم نافذة الحفظ المباشرة، فتم استخدام التنزيل العادي',
      type: 'info',
      duration: 4000,
    });
  };


  const resetLocalState = () => {
    setFile(null);
    setSessionId(null);
    setIsProcessing(false);
    setIsUploading(false);
    setIsDone(false);
    setSheetUrl(null);
    setProgress(0);
    setProgressLabel(null);
    setProgressDetails(null);
    setSessionCost(0);
    setTotalPages(0);
    setStartPage(1);
    setEndPage(0);
    setPdfViewerCursor(1);
    setIsUnsavedSession(false);
  };

  const handleReset = async () => {
    // If current session is a draft, clean it from the Map too
    if (sessionId && draftFiles.has(sessionId)) {
      draftFiles.delete(sessionId);
      setSessions(prev => prev.filter(s => s.id !== sessionId));
    }

    resetLocalState();
    setSelectedMode(SESSION_MODES.NAMES);
  };

  const handleDeleteSession = async (id: string) => {
    if (draftFiles.has(id)) {
      draftFiles.delete(id);
      setSessions(prev => prev.filter(s => s.id !== id));
      if (id === sessionId) resetLocalState();
      toaster.create(
        { title: `تم مسح جلسة ${file?.name}`, type: 'success', duration: 3000 });
      return;
    }
    try {
      const res = await fetch(`/api/sessions/${id}`, { method: 'DELETE' });
      if (!res.ok) throw new Error('Failed to delete session');

      setSessions(prev => {
        console.log(prev);
        return prev.filter(s => s.id !== id)
      });

      if (id === sessionId) {
        handleReset();
      }

      toaster.create({
        title: 'تم مسح الجلسة بنجاح',
        type: 'success',
        duration: 3000
      });
    } catch (error) {
      console.error('Delete failed:', error);
      toaster.create({
        title: 'خطأ في مسح الجلسة',
        type: 'error',
        duration: 3000
      });
    }
  };

  const handleSelectSession = async (id: string) => {
    const params = new URLSearchParams(searchParams.toString());
    const currentSessionId = params.get('sessionId');

    if (currentSessionId == id) {
      params.delete('sessionId');
      handleReset();
      return;
    }
    resetLocalState();

    const draftFil = draftFiles.get(id)
    if (draftFil) {
      try {
        const pdf = await pdfJs!.getDocument({ data: await draftFil.arrayBuffer() }).promise;
        setFile(draftFil);
        setSessionId(id);
        setTotalPages(pdf.numPages);
        setEndPage(pdf.numPages);
        setIsUnsavedSession(true);
        pdf.destroy();

      } catch (error) {
        toaster.create({
          title: 'خطأ في تحميل الملف',
          type: 'error',
          duration: 3000
        });
        return;
      }
    }


    setSessionId(id);
    console.log('Select a session', id);
  };



  return (
    <HStack gap={2} alignItems="stretch" width="100%" minH="100vh" bg="black" >
      <Box flex="1" overflowY={{ base: 'auto', lg: 'hidden' }} height={{ base: 'auto', lg: '100vh' }} minH="100vh">
        <Container fluid height={{ base: 'auto', lg: '100vh' }} width={'100%'} display="flex" flexDirection="column" p={{ base: 4, md: 4 }}>
          <HStack
            width={'100%'}
            justifyContent={'flex-start'}>
            <HistoryDrawer
              sessionId={sessionId}
              sessions={sessionsStore.getAllSessions()}
              onSelectSession={handleSelectSession}
              onDeleteSession={handleDeleteSession}
              onNewSession={handleReset} />
          </HStack>
          <Script
            src="/pdfjs-5.4.530-dist/build/pdf.mjs"
            type="module"
            async
            onLoad={() => {
              const pdfjs = (window as any).pdfjsLib;
              pdfjs.GlobalWorkerOptions.workerSrc = "/pdfjs-5.4.530-dist/build/pdf.worker.mjs";
              setPdfJs(pdfjs);
            }}
          />
          <Toaster />
          <HStack
            width={'100%'}
            gap={{ base: 4, md: 10 }}
            alignItems={'stretch'}
            flexDirection={{ base: 'column', lg: 'row' }}
            flex="1"
            minH={{ base: 'auto', lg: 0 }}
          >
            <VStack
              gap={5}
              width={{ base: '100%', lg: '40vh' }}
              flexShrink={0}
              justifyContent={'space-between'}
            >
              {file == null && <FileUpload.Root
                accept={["application/pdf"]}
                alignItems="stretch"
                flexGrow={1}
                maxFiles={1}
                onFileChange={handleFileChange}
                width={'100%'}
                height={{ base: '40vh', md: '50vh', lg: '65vh' }}
              >
                <FileUpload.HiddenInput />
                <FileUpload.Dropzone flexGrow={1}>
                  {isUploading && <VStack>
                    <Spinner></Spinner>
                    <Text>جاري رفع الكتاب ...</Text>
                  </VStack>}
                  {!isUploading && <>
                    <Icon size="md" color="fg.muted">
                      <LuUpload />
                    </Icon>
                    <FileUpload.DropzoneContent>
                      <Box>قم برفع الملف هنا</Box>
                    </FileUpload.DropzoneContent>
                  </>}
                </FileUpload.Dropzone>
              </FileUpload.Root>}
              {file != null && <PDFViewer engine={pdfJs} file={file} cursor={pdfViewerCursor}></PDFViewer>}
              {file != null && <Button colorPalette={'blue'} onClick={handleConvert} loading={isUploading} variant="surface" width={'100%'}>
                {(currentProgress > 0 && !isProcessing && !isDone) ? "استئناف التفريغ" : "فرغ النص"}
              </Button>}
              {/* {file != null && !isProcessing && <Button colorPalette={'gray'} onClick={handleReset} loading={isUploading} variant="outline" width={'100%'}>
                رفع كتاب آخر
              </Button>} */}
              {totalPages > 0 &&
                <HStack
                  dir="rtl"
                  gap={5}
                  width={'100%'}
                  justifyContent={'space-between'}
                  flexDirection={{ base: 'column', md: 'row' }}
                >
                  <Field.Root flex={1} width={{ base: '100%', md: 'auto' }}>
                    <Field.Label>
                      صفحة البداية
                    </Field.Label>
                    <Input type="number" min="1" max={totalPages} value={startPage} disabled={isProcessing} onFocus={(e) => setPdfViewerCursor(Number(e.target.value))} onChange={(e) => (setStartPage(Number(e.target.value)), setPdfViewerCursor(Number(e.target.value)))} />
                  </Field.Root>
                  <Field.Root flex={1} width={{ base: '100%', md: 'auto' }}>
                    <Field.Label>
                      صفحة النهاية
                    </Field.Label>
                    <Input type="number" min="1" max={totalPages} value={endPage} disabled={isProcessing} onBlur={e => setPdfViewerCursor(Number(startPage))} onFocus={(e) => setPdfViewerCursor(Number(e.target.value))} onChange={(e) => (setEndPage(Number(e.target.value)), setPdfViewerCursor(Number(e.target.value)))} />
                  </Field.Root>
                </HStack>
              }
              <RadioCard.Root value={selectedMode} width="100%">
                <HStack align="stretch" flexDirection={{ base: 'column', sm: 'row' }} paddingBottom={4}>
                  {modes.map((mode) => (
                    <RadioCard.Item key={mode.value} value={mode.value} flex="1" cursor={"pointer"}>
                      <RadioCard.ItemHiddenInput />
                      <RadioCard.ItemControl onClick={() => setSelectedMode(mode.value)}>
                        <RadioCard.ItemText textAlign={"center"}>{mode.title}</RadioCard.ItemText>
                      </RadioCard.ItemControl>
                    </RadioCard.Item>
                  ))}
                </HStack>
              </RadioCard.Root>
            </VStack>
            <VStack gap={5} flex={1} width={{ base: '100%', lg: 'auto' }} minH={{ base: 'auto', lg: 0 }} overflowY={{ base: 'visible', lg: 'hidden' }}>
              <Box
                flex={{ base: 'none', lg: 1 }}
                minH={{ base: '50vh', lg: 0 }}
                maxH={{ base: '60vh', lg: 'none' }}
                height={{ base: '50vh', lg: 'auto' }}
                width={'100%'}
                p={{ base: 2, md: 4, lg: 5 }}
                border={"2px dashed"}
                borderColor={"gray.800"}
                borderRadius={5}
                overflow="auto"
                css={{ '&::-webkit-scrollbar': { display: 'none' }, scrollbarWidth: 'none' }}
              >
                {progressDetails !== null && <Table.ScrollArea
                  height={'auto'} width={'auto'} p={0}>
                  <Table.Root striped dir="rtl" stickyHeader>
                    {selectedMode === SESSION_MODES.NAMES && <Table.Header>
                      <Table.Row>
                        <Table.ColumnHeader>رقم الصفحة</Table.ColumnHeader>
                        <Table.ColumnHeader>رقم النص</Table.ColumnHeader>
                        <Table.ColumnHeader>الإسم بالعربي</Table.ColumnHeader>
                        <Table.ColumnHeader>الإسم باللغة الأجنبية</Table.ColumnHeader>
                        <Table.ColumnHeader>اللغة</Table.ColumnHeader>
                        <Table.ColumnHeader>الرابط الأول</Table.ColumnHeader>
                        <Table.ColumnHeader>الرابط الثاني</Table.ColumnHeader>
                        <Table.ColumnHeader>الرابط الثالث</Table.ColumnHeader>
                      </Table.Row>
                    </Table.Header>}
                    {selectedMode === SESSION_MODES.LINES && <Table.Header>
                      <Table.Row>
                        <Table.ColumnHeader>رقم الصفحة</Table.ColumnHeader>
                        <Table.ColumnHeader>رقم النص</Table.ColumnHeader>
                        <Table.ColumnHeader>المتحدث</Table.ColumnHeader>
                        <Table.ColumnHeader>العبارة</Table.ColumnHeader>
                        <Table.ColumnHeader>النبرة</Table.ColumnHeader>
                        <Table.ColumnHeader>المكان</Table.ColumnHeader>
                        <Table.ColumnHeader>الخلفية الصوتية</Table.ColumnHeader>
                      </Table.Row>
                    </Table.Header>}
                    {selectedMode === SESSION_MODES.NAMES && <Table.Body>
                      {(progressDetails as ForeignNameRow[]).map((row, index) => (
                        <Table.Row key={index}>
                          <Table.Cell minWidth={{ base: '6rem', md: '8rem' }} whiteSpace={"wrap"}>{row['رقم الصفحة']}</Table.Cell>
                          <Table.Cell minWidth={{ base: '6rem', md: '8rem' }} whiteSpace={"wrap"}>{row['رقم النص']}</Table.Cell>
                          <Table.Cell minWidth={{ base: '8rem', md: '12rem' }} whiteSpace={"wrap"}>{row['الإسم بالعربي']}</Table.Cell>
                          <Table.Cell minWidth={{ base: '8rem', md: '12rem' }} whiteSpace={"wrap"}>{row['الإسم باللغة الأجنبية']}</Table.Cell>
                          <Table.Cell minWidth={{ base: '8rem', md: '12rem' }} whiteSpace={"wrap"}>{row['اللغة']}</Table.Cell>
                          <Table.Cell minWidth={{ base: '8rem', md: '12rem' }} whiteSpace={"wrap"}>{row['الرابط الأول']}</Table.Cell>
                          <Table.Cell minWidth={{ base: '8rem', md: '12rem' }} whiteSpace={"wrap"}>{row['الرابط الثاني']}</Table.Cell>
                          <Table.Cell minWidth={{ base: '8rem', md: '12rem' }} whiteSpace={"wrap"}>{row['الرابط الثالث']}</Table.Cell>
                        </Table.Row>
                      ))}
                    </Table.Body>}
                    {selectedMode === SESSION_MODES.LINES && <Table.Body>
                      {(progressDetails as LineRow[]).map((row: LineRow, index) => (
                        <Table.Row key={index}>
                          <Table.Cell minWidth={{ base: '6rem', md: '8rem' }} whiteSpace={"wrap"}>{row['رقم الصفحة']}</Table.Cell>
                          <Table.Cell minWidth={{ base: '6rem', md: '8rem' }} whiteSpace={"wrap"}>{row['رقم النص']}</Table.Cell>
                          <Table.Cell minWidth={{ base: '8rem', md: '12rem' }} whiteSpace={"wrap"}>{row['المتحدث']}</Table.Cell>
                          <Table.Cell minWidth={{ base: '12rem', md: '20vw' }} whiteSpace={"wrap"}>{row['العبارة']}</Table.Cell>
                          <Table.Cell minWidth={{ base: '8rem', md: '10vw' }} whiteSpace={"wrap"}>{row['النبرة']}</Table.Cell>
                          <Table.Cell minWidth={{ base: '6rem', md: '5vw' }} whiteSpace={"wrap"}>{row['المكان']}</Table.Cell>
                          <Table.Cell minWidth={{ base: '8rem', md: '7vw' }} whiteSpace={"wrap"}>{row['الخلفية الصوتية']}</Table.Cell>
                        </Table.Row>
                      ))}
                    </Table.Body>}
                  </Table.Root>
                </Table.ScrollArea>}
              </Box>
              {(totalPages > 0 || isDone || (progressDetails && (progressDetails as any[]).length > 0)) &&
                <HStack
                  gap={5}
                  width={'100%'}
                  flexShrink={0}
                  flexDirection={{ base: 'column-reverse', xl: 'row' }}
                  justifyContent={{ base: 'center', md: 'space-between' }}
                >
                  <VStack alignItems={'flex-start'} width={{ base: '100%', md: 'auto' }}>
                    <Progress.Root width={{ base: '100%', md: 'md' }} max={100} value={isDone ? 100 : currentProgress} colorPalette={isDone ? "green" : "blue"}>
                      <HStack gap="5">
                        <Progress.Track flex="1">
                          <Progress.Range />
                        </Progress.Track>
                        <Progress.ValueText>{isDone ? 100 : currentProgress}%</Progress.ValueText>
                      </HStack>
                    </Progress.Root>
                    <HStack fontSize={{ base: 'xs', md: 'sm' }} color="gray.500">
                      {progressLabel && <Spinner size={'sm'} />}
                      {progressLabel}
                    </HStack>
                    {sessionCost > 0 && (
                      <Text fontSize={{ base: 'xs', md: 'sm' }} color="gray.400">
                        التكلفة: ${sessionCost.toFixed(4)}
                      </Text>
                    )}
                  </VStack>
                  <HStack dir="rtl" gap={5} flexDirection={{ base: 'column', sm: 'row' }} width={{ base: '100%', md: 'auto' }}>
                    <Button variant="surface" onClick={handleDownload} width={{ base: '100%', sm: 'auto' }}>
                      <span>تنزيل الجدول</span>
                      <Icon size="md" color="fg.muted">
                        <LuDownload />
                      </Icon>
                    </Button>
                    <Timer running={isProcessing}></Timer>
                  </HStack>
                </HStack>
              }
            </VStack>
          </HStack>
        </Container>
      </Box>
    </HStack>
  );
} 
