import { useState, useEffect } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { FileText, Loader } from 'lucide-react';
import { Document, Page, pdfjs } from 'react-pdf';
import Sidebar from '../components/Sidebar';
import Toolbar from '../components/Toolbar';
import PropertiesPanel from '../components/PropertiesPanel';
import OCROverlay from '../components/OCROverlay';

// Set up the worker (vital for performance)
pdfjs.GlobalWorkerOptions.workerSrc = `//unpkg.com/pdfjs-dist@${pdfjs.version}/build/pdf.worker.min.mjs`;

export default function Editor() {
    const navigate = useNavigate();
    const location = useLocation();

    // UI State
    const [zoom, setZoom] = useState(100);
    const [activeTool, setActiveTool] = useState('select');
    const [currentPage, setCurrentPage] = useState(1);

    // PDF State
    const [numPages, setNumPages] = useState(null);
    const [pageDimensions, setPageDimensions] = useState(null);

    // OCR State
    const [isProcessing, setIsProcessing] = useState(false);
    const [processingStatus, setProcessingStatus] = useState('');
    const [ocrData, setOcrData] = useState(null);
    const [editedBlocks, setEditedBlocks] = useState({});

    // Drawing State (for pen tool)
    const [annotations, setAnnotations] = useState([]);
    const [currentPath, setCurrentPath] = useState([]);
    const [isDrawing, setIsDrawing] = useState(false);

    // File info from navigation state
    const fileName = location.state?.fileName || 'Untitled.pdf';
    const fileUrl = location.state?.fileUrl;
    const taskId = location.state?.taskId;

    // Poll for OCR task status
    useEffect(() => {
        if (!taskId) return;

        setIsProcessing(true);
        setProcessingStatus('Starting OCR processing...');
        let attempts = 0;
        const maxAttempts = 300; // 10 minutes max (2s intervals)

        const pollStatus = async () => {
            try {
                attempts++;
                console.log(`Polling attempt ${attempts} for task ${taskId}`);

                const response = await fetch(`/api/tasks/${taskId}/status/`);

                if (!response.ok) {
                    throw new Error('Failed to fetch task status');
                }

                const data = await response.json();
                const status = data.state;

                if (status === 'PROCESSING' && data.meta) {
                    setProcessingStatus(data.meta.status || 'Processing...');
                }

                if (status === 'SUCCESS') {
                    setIsProcessing(false);
                    clearInterval(intervalId);

                    if (data.result && !data.result.error) {
                        setOcrData(data.result);
                        setProcessingStatus('');
                        console.log('OCR completed:', data.result);
                    } else {
                        console.error('OCR error:', data.result?.error);
                        setProcessingStatus('OCR failed: ' + (data.result?.error || 'Unknown error'));
                    }
                } else if (status === 'FAILURE') {
                    setIsProcessing(false);
                    clearInterval(intervalId);
                    setProcessingStatus('OCR failed: ' + (data.error || 'Unknown error'));
                }

                if (attempts >= maxAttempts) {
                    setIsProcessing(false);
                    clearInterval(intervalId);
                    setProcessingStatus('OCR timed out');
                }
            } catch (error) {
                console.error('Error polling task status:', error);
                // Don't stop polling on network errors, just log them
            }
        };

        const intervalId = setInterval(pollStatus, 2000);
        pollStatus(); // Initial poll

        return () => clearInterval(intervalId);
    }, [taskId]);

    const onDocumentLoadSuccess = ({ numPages }) => {
        setNumPages(numPages);
    };

    const onPageLoadSuccess = (page) => {
        const viewport = page.getViewport({ scale: 1 });
        setPageDimensions({ width: viewport.width, height: viewport.height });
    };

    // Get current page OCR data
    const currentPageOcrData = ocrData?.pages?.find(p => p.page_number === currentPage);

    // Handle text edits from OCR overlay
    const handleTextChange = (blockId, newText) => {
        setEditedBlocks(prev => ({
            ...prev,
            [blockId]: newText
        }));
    };

    // Drawing handlers for pen tool
    const handleMouseDown = (e) => {
        if (activeTool !== 'pen') return;
        setIsDrawing(true);
        const svg = e.target.closest('svg');
        if (!svg) return;
        const rect = svg.getBoundingClientRect();
        const scale = zoom / 100;
        const x = (e.clientX - rect.left) / scale;
        const y = (e.clientY - rect.top) / scale;
        setCurrentPath([{ x, y }]);
    };

    const handleMouseMove = (e) => {
        if (!isDrawing) return;
        const svg = e.target.closest('svg');
        if (!svg) return;
        const rect = svg.getBoundingClientRect();
        const scale = zoom / 100;
        const x = (e.clientX - rect.left) / scale;
        const y = (e.clientY - rect.top) / scale;
        setCurrentPath(prev => [...prev, { x, y }]);
    };

    const handleMouseUp = () => {
        if (!isDrawing) return;
        setIsDrawing(false);
        if (currentPath.length > 0) {
            setAnnotations(prev => [...prev, { page: currentPage, points: currentPath }]);
        }
        setCurrentPath([]);
    };

    const pointsToPath = (points) => {
        if (points.length === 0) return '';
        return points.map((p, i) => (i === 0 ? `M ${p.x} ${p.y}` : `L ${p.x} ${p.y}`)).join(' ');
    };

    return (
        <div className="editor-layout">
            <Sidebar />

            <div className="editor-main">
                <div className="editor-header">
                    <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
                        <button
                            onClick={() => navigate('/')}
                            style={{
                                background: 'transparent',
                                border: 'none',
                                cursor: 'pointer',
                                display: 'flex',
                                alignItems: 'center',
                                gap: '0.5rem',
                                color: 'var(--color-primary)',
                                fontSize: '1.25rem',
                                fontWeight: 600
                            }}
                        >
                            <FileText size={24} />
                            PDFEdit
                        </button>
                        <span className="editor-title">{fileName}</span>
                        {ocrData && (
                            <span style={{
                                fontSize: '0.75rem',
                                color: 'var(--color-success)',
                                background: 'rgba(16, 185, 129, 0.1)',
                                padding: '0.25rem 0.5rem',
                                borderRadius: '4px'
                            }}>
                                OCR Complete
                            </span>
                        )}
                    </div>
                </div>

                <Toolbar
                    activeTool={activeTool}
                    onToolChange={setActiveTool}
                    zoom={zoom}
                    setZoom={setZoom}
                    currentPage={currentPage}
                    setCurrentPage={setCurrentPage}
                    totalPages={numPages || ocrData?.page_count || 1}
                    ocrData={ocrData}
                    editedBlocks={editedBlocks}
                    fileUrl={fileUrl}
                    fileName={fileName}
                />

                <div className="canvas-area">
                    <div className="canvas" style={{ position: 'relative' }}>
                        {/* Processing overlay */}
                        {isProcessing && (
                            <div style={{
                                position: 'absolute',
                                inset: 0,
                                background: 'rgba(0,0,0,0.7)',
                                zIndex: 10,
                                display: 'flex',
                                flexDirection: 'column',
                                alignItems: 'center',
                                justifyContent: 'center',
                                color: 'white',
                                borderRadius: '4px'
                            }}>
                                <Loader size={48} className="spin" style={{ marginBottom: '1rem' }} />
                                <h3>Processing Document...</h3>
                                <p style={{ opacity: 0.8 }}>{processingStatus}</p>
                            </div>
                        )}

                        {/* PDF Viewer with OCR Overlay */}
                        {fileUrl ? (
                            <div style={{ position: 'relative' }}>
                                <Document
                                    file={fileUrl}
                                    onLoadSuccess={onDocumentLoadSuccess}
                                >
                                    <Page
                                        pageNumber={currentPage}
                                        scale={zoom / 100}
                                        renderTextLayer={false}
                                        renderAnnotationLayer={false}
                                        onLoadSuccess={onPageLoadSuccess}
                                    />
                                </Document>

                                {/* OCR Text Overlay */}
                                {currentPageOcrData && (
                                    <OCROverlay
                                        pageData={currentPageOcrData}
                                        zoom={zoom}
                                        editedBlocks={editedBlocks}
                                        onTextChange={handleTextChange}
                                        activeTool={activeTool}
                                    />
                                )}
                            </div>
                        ) : (
                            <div style={{
                                width: '100%',
                                minHeight: '800px',
                                background: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
                                borderRadius: '4px',
                                display: 'flex',
                                flexDirection: 'column',
                                alignItems: 'center',
                                justifyContent: 'center',
                                padding: '3rem',
                                color: 'white',
                                position: 'relative'
                            }}>
                                <h1 style={{ fontSize: '2rem', fontWeight: 700, marginBottom: '1rem' }}>
                                    No PDF Loaded
                                </h1>
                                <p style={{ maxWidth: '400px', lineHeight: 1.6, opacity: 0.9 }}>
                                    Upload a PDF from the dashboard to start editing.
                                </p>
                                <button
                                    className="btn btn-primary"
                                    onClick={() => navigate('/')}
                                    style={{ marginTop: '1.5rem' }}
                                >
                                    Go to Dashboard
                                </button>
                            </div>
                        )}
                    </div>
                </div>
            </div>

            <PropertiesPanel />
        </div>
    );
}
