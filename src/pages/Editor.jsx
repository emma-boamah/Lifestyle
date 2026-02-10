import { useState, useEffect, useRef } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { FileText, Loader, Save } from 'lucide-react';
import { Document, Page, pdfjs } from 'react-pdf';
import * as fabric from 'fabric';
import Sidebar from '../components/Sidebar';
import Toolbar from '../components/Toolbar';
import PropertiesPanel from '../components/PropertiesPanel';
import { savePdfChanges, pollTaskStatus } from '../utils/backendApi';

console.log('Editor.jsx: Loading component...');
console.log('Editor.jsx: Fabric object:', fabric);

// Set up the worker (vital for performance)
pdfjs.GlobalWorkerOptions.workerSrc = `//unpkg.com/pdfjs-dist@${pdfjs.version}/build/pdf.worker.min.mjs`;

export default function Editor() {
    console.log('Editor: Rendering...');
    const navigate = useNavigate();
    const location = useLocation();

    // Helper to extract changes
    const getChangesFromCanvas = () => {
        if (!fabricCanvasRef.current) return [];
        const canvas = fabricCanvasRef.current;
        const changes = [];

        canvas.getObjects().forEach(obj => {
            if (obj.ocrBlockId && obj.originalState && obj.ocrScale) {
                const { x: scaleX, y: scaleY } = obj.ocrScale;
                const currentX = obj.left / scaleX;
                const currentY = obj.top / scaleY;
                const currentW = (obj.width * obj.scaleX) / scaleX;
                const currentH = (obj.height * obj.scaleY) / scaleY;

                const isMoved = Math.abs(currentX - obj.originalState.x) > 1 || Math.abs(currentY - obj.originalState.y) > 1;
                const isResized = Math.abs(currentW - obj.originalState.w) > 1 || Math.abs(currentH - obj.originalState.h) > 1;
                const isTextChanged = obj.text !== obj.originalState.text;

                if (isMoved || isResized || isTextChanged) {
                    const change = {
                        page: currentPage,
                        x: currentX,
                        y: currentY,
                        w: currentW,
                        h: currentH,
                        text: obj.text,
                        font_size: (obj.fontSize * obj.scaleY) / scaleY,
                        // Include original box for inpainting
                        original_box: [obj.originalState.x, obj.originalState.y, obj.originalState.w, obj.originalState.h]
                    };
                    changes.push(change);
                }
            }
        });
        return changes;
    };

    // Handle Backend Export (Burn-In)
    const handleBackendExport = async () => {
        const changes = getChangesFromCanvas();
        if (changes.length === 0) {
            alert('No changes to export. Downloading original...');
            return;
        }

        setIsProcessing(true);
        setProcessingStatus('Saving changes...');

        try {
            const serverFilename = location.state?.serverFilename || fileName;

            // 1. Submit Task
            const taskId = await savePdfChanges(serverFilename, changes);
            setProcessingStatus('Processing burn-in (this may take a moment)...');

            // 2. Poll for Completion
            const result = await pollTaskStatus(taskId, (status) => setProcessingStatus(status));

            // 3. Download Result
            if (result.output_path) {
                const editedFilename = result.filename;
                const fileDownloadUrl = `/media/uploads/${editedFilename}`;

                const link = document.createElement('a');
                link.href = fileDownloadUrl;
                link.download = editedFilename;
                document.body.appendChild(link);
                link.click();
                document.body.removeChild(link);
            }

        } catch (error) {
            console.error('Export failed:', error);
            alert('Export failed: ' + error.message);
        } finally {
            setIsProcessing(false);
            setProcessingStatus('');
        }
    };

    // Refactored Save Changes (Manual Save button)
    const handleSaveChanges = async () => {
        const changes = getChangesFromCanvas();
        if (changes.length === 0) {
            alert('No changes detected.');
            return;
        }

        try {
            const serverFilename = location.state?.serverFilename || fileName;
            const taskId = await savePdfChanges(serverFilename, changes);
            alert(`Changes saved! Task ID: ${taskId}`);
        } catch (error) {
            alert('Save failed: ' + error.message);
        }
    };

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

    // Fabric.js State
    const fabricCanvasRef = useRef(null);
    const canvasElRef = useRef(null);
    const canvasStates = useRef({}); // Store drawings per page
    const [activeObject, setActiveObject] = useState(null);
    // Default styles for new text or when no object is selected
    const [defaultStyle, setDefaultStyle] = useState({
        fill: '#000000',
        backgroundColor: 'transparent'
    });

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

    const handleObjectSelection = (e) => {
        const selection = e.selected ? e.selected[0] : null;
        setActiveObject(selection);
    };

    const onUpdateObject = (updates) => {
        if (!fabricCanvasRef.current) return;
        const canvas = fabricCanvasRef.current;
        const activeObj = canvas.getActiveObject();

        if (activeObj) {
            activeObj.set(updates);
            canvas.requestRenderAll();
            // Update state to reflect changes immediately in UI
            setActiveObject({ ...activeObj.toObject(), ...updates, type: activeObj.type });
        }
    };

    // Initialize Fabric Canvas
    useEffect(() => {
        if (!pageDimensions || !canvasElRef.current) return;

        const scale = zoom / 100;
        const width = pageDimensions.width * scale;
        const height = pageDimensions.height * scale;

        // Dispose previous instance to prevent memory leaks
        if (fabricCanvasRef.current) {
            fabricCanvasRef.current.dispose();
        }

        // Create canvas with scaled dimensions to match screen size
        const canvas = new fabric.Canvas(canvasElRef.current, {
            width,
            height,
            backgroundColor: 'transparent',
        });

        // Set zoom to match the PDF scaling
        // This ensures coordinates are stored relative to the original PDF size
        canvas.setZoom(scale);

        // Load saved state for this page if it exists
        if (canvasStates.current[currentPage]) {
            canvas.loadFromJSON(canvasStates.current[currentPage], () => {
                canvas.renderAll();
            });
        }

        // Add Event Listeners for Selection
        canvas.on('selection:created', handleObjectSelection);
        canvas.on('selection:updated', handleObjectSelection);
        canvas.on('selection:cleared', () => setActiveObject(null));

        fabricCanvasRef.current = canvas;

        // Re-apply current tool settings to the new canvas instance
        if (activeTool === 'pen') {
            canvas.isDrawingMode = true;
            canvas.freeDrawingBrush = new fabric.PencilBrush(canvas);
            canvas.freeDrawingBrush.color = 'red';
            canvas.freeDrawingBrush.width = 2;
        } else if (activeTool === 'highlight') {
            canvas.isDrawingMode = true;
            canvas.freeDrawingBrush = new fabric.PencilBrush(canvas);
            canvas.freeDrawingBrush.color = 'rgba(255, 255, 0, 0.5)';
            canvas.freeDrawingBrush.width = 20;
        } else {
            canvas.isDrawingMode = false;
        }

        return () => {
            // Save current page state before disposing
            if (fabricCanvasRef.current) {
                canvasStates.current[currentPage] = fabricCanvasRef.current.toJSON();
                fabricCanvasRef.current.dispose();
                fabricCanvasRef.current = null;
            }
        };
    }, [pageDimensions, zoom, currentPage]); // Re-run when these change

    // Track active tool in ref to access inside OCR effect without adding to dependencies (avoiding re-render)
    const activeToolRef = useRef(activeTool);
    useEffect(() => {
        activeToolRef.current = activeTool;
    }, [activeTool]);

    // Handle Tool Changes (Updates existing canvas)
    useEffect(() => {
        if (!fabricCanvasRef.current) return;
        const canvas = fabricCanvasRef.current;
        const tool = activeTool;

        // 1. Setup Drawing Mode
        if (tool === 'pen') {
            canvas.isDrawingMode = true;
            canvas.freeDrawingBrush = new fabric.PencilBrush(canvas);
            canvas.freeDrawingBrush.color = 'red';
            canvas.freeDrawingBrush.width = 2;
        } else if (tool === 'highlight') {
            canvas.isDrawingMode = true;
            canvas.freeDrawingBrush = new fabric.PencilBrush(canvas);
            canvas.freeDrawingBrush.color = 'rgba(255, 255, 0, 0.5)';
            canvas.freeDrawingBrush.width = 20;
        } else if (tool === 'picker') {
            // Picker Tool: 
            canvas.defaultCursor = 'crosshair';
            canvas.hoverCursor = 'crosshair';
            canvas.selection = false;
            canvas.forEachObject(obj => {
                obj.selectable = false;
                obj.evented = false;
            });
        } else {
            canvas.isDrawingMode = false;
        }

        // 2. Update Interactivity of Text Blocks based on Tool
        canvas.getObjects().forEach(obj => {
            if (obj.ocrBlockId) {
                if (tool === 'text') {
                    // Text Tool: Full editing
                    obj.set({
                        selectable: true,
                        evented: true,
                        editable: true,
                        hoverCursor: 'text'
                    });
                } else if (tool === 'select') {
                    // Select Tool: Move/Resize ONLY (no text content editing on single click)
                    obj.set({
                        selectable: true,
                        evented: true,
                        editable: false, // Prevents entering text edit mode easily
                        hoverCursor: 'move'
                    });
                } else {
                    // Drawing/Others: Text is distinct background
                    obj.set({
                        selectable: false,
                        evented: false, // Events pass through to canvas (for drawing)
                        editable: false,
                        hoverCursor: 'default'
                    });
                }
            }
        });

        canvas.requestRenderAll();
    }, [activeTool]);

    // Handle Color Picking Click
    const handleCanvasClick = (e) => {
        if (activeTool !== 'picker') return;

        // Find the PDF canvas
        // react-pdf renders a canvas with class 'react-pdf__Page__canvas'
        const pdfCanvas = document.querySelector('.react-pdf__Page__canvas');
        if (!pdfCanvas) return;

        const rect = pdfCanvas.getBoundingClientRect();
        const x = e.clientX - rect.left;
        const y = e.clientY - rect.top;

        // Check bounds
        if (x < 0 || y < 0 || x > rect.width || y > rect.height) return;

        // Extract color
        const ctx = pdfCanvas.getContext('2d');
        const pixel = ctx.getImageData(x, y, 1, 1).data;

        // Convert to Hex
        const toHex = (c) => {
            const hex = c.toString(16);
            return hex.length === 1 ? '0' + hex : hex;
        };
        const hexColor = `#${toHex(pixel[0])}${toHex(pixel[1])}${toHex(pixel[2])}`;

        console.log('Picked Color:', hexColor);

        // Apply Color:
        // Priority: Update Background Color (as per request)
        // If active object, update it. Else update default.
        if (activeObject) {
            onUpdateObject({ backgroundColor: hexColor });
            // Also update fill if it's black/default to provide visible contrast? No, stick to specific request.
        } else {
            setDefaultStyle(prev => ({ ...prev, backgroundColor: hexColor }));
        }

        // Switch back to select tool for convenience
        setActiveTool('select');
    };

    // Render OCR Text Blocks on Canvas
    useEffect(() => {
        if (!fabricCanvasRef.current || !currentPageOcrData || !pageDimensions) return;

        const canvas = fabricCanvasRef.current;

        // 1. Calculate Scale Factors
        const scaleX = canvas.width / currentPageOcrData.width;
        const scaleY = canvas.height / currentPageOcrData.height;

        // 2. Clear existing OCR objects
        const existingObjects = canvas.getObjects();
        existingObjects.forEach(obj => {
            if (obj.ocrBlockId) {
                canvas.remove(obj);
            }
        });

        // 3. Add Textboxes
        const tool = activeToolRef.current; // Use Ref to get current tool without dependency

        // Determine initial properties based on current tool
        const isTextTool = tool === 'text';
        const isSelectTool = tool === 'select';

        currentPageOcrData.text_blocks.forEach(block => {
            const textObj = new fabric.Textbox(block.text, {
                left: block.rect.x * scaleX,
                top: block.rect.y * scaleY,
                width: block.rect.width * scaleX,
                height: block.rect.height * scaleY,
                fontSize: (block.rect.height * scaleY) * 0.8,
                fontFamily: 'Arial',
                // Visibility Logic
                opacity: 0,
                // Use detected colors or defaults
                fill: block.fg_color || '#000000',
                backgroundColor: block.bg_color || 'rgba(255, 255, 255, 1)',

                // Interactivity Logic
                selectable: isTextTool || isSelectTool,
                evented: isTextTool || isSelectTool,
                editable: isTextTool,
                hoverCursor: isTextTool ? 'text' : (isSelectTool ? 'move' : 'default'),

                // Style
                borderColor: '#2196F3',
                cornerColor: '#2196F3',
                cornerSize: 8,
                transparentCorners: false,
                ocrBlockId: block.id,
                lockRotation: true
            });

            // Store original state
            textObj.originalState = {
                x: block.rect.x,
                y: block.rect.y,
                w: block.rect.width,
                h: block.rect.height,
                text: block.text
            };

            // Store scale factors
            textObj.ocrScale = { x: scaleX, y: scaleY };

            // Show text (and hide original) when selected
            textObj.on('selected', () => {
                textObj.set({ opacity: 1 });
                canvas.requestRenderAll();
            });

            // Handle deselection
            textObj.on('deselected', () => {
                if (textObj.text !== textObj.originalState.text) {
                    textObj.set({ opacity: 1 });
                } else {
                    textObj.set({ opacity: 0 });
                }
                canvas.requestRenderAll();
            });

            canvas.add(textObj);
        });

        canvas.requestRenderAll();
    }, [currentPageOcrData, pageDimensions, zoom]); // activeTool is NOT a dependency

    // Handle Save Changes
    // Old handleSaveChanges removed. Using the refactored one defined above.

    /* 
       Removed the previous useEffect that combined init and tool changes 
       to avoid duplicate logic and ensure correct cleanup order.
    */

    /*
    // Previous implementation replaced by the split effects above
    useEffect(() => {
        if (!pageDimensions || !canvasElRef.current) return;
 
        const scale = zoom / 100;
        const width = pageDimensions.width * scale;
        const height = pageDimensions.height * scale;
 
        // Dispose previous instance to prevent memory leaks
        if (fabricCanvasRef.current) {
            canvas.dispose();
            fabricCanvasRef.current = null;
        }
 
        const canvas = new fabric.Canvas(canvasElRef.current, {
            width,
            height,
            backgroundColor: 'transparent',
        });
 
        fabricCanvasRef.current = canvas;
 
        return () => {
            canvas.dispose();
            fabricCanvasRef.current = null;
        };
    }, [pageDimensions, zoom, currentPage]);
    */

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
                    <button
                        className="btn btn-primary"
                        onClick={handleSaveChanges}
                        style={{
                            display: 'flex',
                            alignItems: 'center',
                            gap: '0.5rem',
                            padding: '0.5rem 1rem'
                        }}
                    >
                        <Save size={18} />
                        Save Changes
                    </button>
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
                    activeObject={activeObject}
                    onUpdateObject={onUpdateObject}
                    defaultStyle={defaultStyle}
                    setDefaultStyle={setDefaultStyle}
                    onExport={handleBackendExport}
                />

                <div className="canvas-area" onClick={handleCanvasClick}>
                    <div className="canvas" style={{ position: 'relative', cursor: activeTool === 'picker' ? 'crosshair' : 'default' }}>
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

                                {/* Fabric.js Drawing Layer */}
                                {pageDimensions && (
                                    <div style={{
                                        position: 'absolute',
                                        top: 0,
                                        left: 0,
                                        zIndex: 20,
                                        pointerEvents: (activeTool === 'pen' || activeTool === 'highlight' || activeTool === 'text' || activeTool === 'select' || activeTool === 'picker') ? 'auto' : 'none'
                                    }}>
                                        <canvas ref={canvasElRef} />
                                    </div>
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

            <PropertiesPanel
                activeObject={activeObject}
                onUpdateObject={onUpdateObject}
            />
        </div>
    );
}
