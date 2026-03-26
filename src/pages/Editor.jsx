import { useState, useEffect, useRef } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { FileText, Loader, Save } from 'lucide-react';
import { Document, Page, pdfjs } from 'react-pdf';
import * as fabric from 'fabric';
import Sidebar from '../components/Sidebar';
import Toolbar from '../components/Toolbar';
import PropertiesPanel from '../components/PropertiesPanel';
import { savePdfChanges, pollTaskStatus, previewPdfChanges } from '../utils/backendApi';

// Add new API helper for targeted OCR
const startTargetedOcr = async (filename, page, rect) => {
    const response = await fetch('/api/ocr/targeted/', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ filename, page, rect })
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || 'Failed to start targeted OCR');
    return data.task_id;
};

console.log('Editor.jsx: Loading component...');
console.log('Editor.jsx: Fabric object:', fabric);

// Set up the worker (vital for performance)
// Using a more robust worker URL strategy
pdfjs.GlobalWorkerOptions.workerSrc = `https://unpkg.com/pdfjs-dist@${pdfjs.version}/build/pdf.worker.min.mjs`;

export default function Editor() {
    console.log('Editor: Rendering...');
    const navigate = useNavigate();
    const location = useLocation();

    // Helper to extract changes
    const getChangesFromCanvas = () => {
        if (!fabricCanvasRef.current) return [];
        const canvas = fabricCanvasRef.current;
        const changes = [];

        canvas.getObjects().forEach((obj, index) => {
            // Only handle text objects (OCR blocks or user-added text)
            if (obj.type !== 'i-text' && obj.type !== 'text' && obj.type !== 'textbox') return;

            if (obj.ocrBlockId && obj.originalState && obj.ocrScale) {
                // Scenario 1: Modified OCR Block
                // Fabric.js setZoom() stores coordinates in logical (un-zoomed) space.
                // obj.left/top are in PDF points. We convert back to OCR pixel units.
                const { x: scaleX, y: scaleY } = obj.ocrScale;

                // Simple coordinate conversion as origin is now top-left
                const currentX = (obj.left / scaleX) - 1; // Nudge 1 pixel left to be safe
                const currentY = obj.top / scaleY;
                const currentW = (obj.width * obj.scaleX) / scaleX;
                const currentH = (obj.height * obj.scaleY) / scaleY;

                const isMoved = Math.abs(currentX - obj.originalState.x) > 2 || Math.abs(currentY - obj.originalState.y) > 2;
                // CRITICAL FIX: fabric.Textbox organically recalculates its own height based on fonts.
                // We must ONLY flag a block strictly if the user dragged the width specifically, or else it triggers 
                // a false positive for EVERY SINGLE BLOCK on the page!
                // Add a tolerance check. 
                // If the difference is roughly our 10px buffer, don't treat it as a 'User Resize'
                const bufferTolerance = 12 / scaleX; 
                const isResized = Math.abs(currentW - obj.originalState.w) > bufferTolerance;
                const isTextChanged = obj.text !== obj.originalState.text;

                if (isMoved || isResized || isTextChanged) {
                    changes.push({
                        id: obj.ocrBlockId,
                        page: currentPage,
                        x: isMoved ? currentX : obj.originalState.x,
                        y: isMoved ? currentY : obj.originalState.y,
                        w: isResized ? currentW : obj.originalState.w,
                        h: isResized ? currentH : obj.originalState.h,

                        // NEW PERCENTAGE-BASED COORDINATES
                        x_percent: (isMoved ? obj.left : (obj.originalState.x * scaleX)) / pageDimensions.width,
                        y_percent: (isMoved ? obj.top : (obj.originalState.y * scaleY)) / pageDimensions.height,
                        w_percent: (isResized ? (obj.width * obj.scaleX) : (obj.originalState.w * scaleX)) / pageDimensions.width,
                        h_percent: (isResized ? (obj.height * obj.scaleY) : (obj.originalState.h * scaleY)) / pageDimensions.height,
                        font_size_percent: obj.fontSize / pageDimensions.height,

                        original_box_percent: [
                            (obj.originalState.x * scaleX) / pageDimensions.width,
                            (obj.originalState.y * scaleY) / pageDimensions.height,
                            (obj.originalState.w * scaleX) / pageDimensions.width,
                            (obj.originalState.h * scaleY) / pageDimensions.height
                        ],

                        text: obj.text,
                        font_size: obj.fontSize / scaleY,
                        fill_color: obj.fill || '#000000',
                        bg_color: (obj.backgroundColor && obj.backgroundColor !== 'transparent') ? obj.backgroundColor : null,
                        text_align: obj.textAlign || 'left',
                        original_box: [obj.originalState.x, obj.originalState.y, obj.originalState.w, obj.originalState.h]
                    });
                }
            } else if (!obj.ocrBlockId) {
                // Scenario 2: New User-Added Text
                // Convert from PDF points to OCR pixel units
                let scaleX = 72 / 150;
                let scaleY = 72 / 150;

                if (currentPageOcrData && pageDimensions) {
                    scaleX = pageDimensions.width / currentPageOcrData.width;
                    scaleY = pageDimensions.height / currentPageOcrData.height;
                }

                changes.push({
                    id: `new_${currentPage}_${index}`,
                    page: currentPage,
                    x: obj.left / scaleX,
                    y: obj.top / scaleY,
                    w: (obj.width * obj.scaleX) / scaleX,
                    h: (obj.height * obj.scaleY) / scaleY,

                    // NEW PERCENTAGE-BASED COORDINATES
                    x_percent: obj.left / pageDimensions.width,
                    y_percent: obj.top / pageDimensions.height,
                    w_percent: (obj.width * obj.scaleX) / pageDimensions.width,
                    h_percent: (obj.height * obj.scaleY) / pageDimensions.height,
                    font_size_percent: obj.fontSize / pageDimensions.height,

                    text: obj.text,
                    font_size: obj.fontSize / scaleY,
                    fill_color: obj.fill || '#000000',
                    bg_color: (obj.backgroundColor && obj.backgroundColor !== 'transparent') ? obj.backgroundColor : null,
                    text_align: obj.textAlign || 'left',
                    is_new: true
                });
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
        console.log('Editor: Saving changes:', changes);

        if (changes.length === 0) {
            alert('No changes detected. Please edit or move text before saving.');
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

    // Handle Live Preview
    const handlePreview = async (page) => {
        const changes = getChangesFromCanvas();
        if (changes.length === 0) {
            alert('No changes to preview.');
            return;
        }

        const serverFilename = location.state?.serverFilename || fileName;
        if (!serverFilename) {
            alert('No server file attached. Cannot generate preview.');
            return;
        }

        setIsPreviewLoading(true);
        setIsPreviewOpen(true);
        try {
            const b64Image = await previewPdfChanges(serverFilename, page, changes);
            setPreviewImageBase64(b64Image);
        } catch (error) {
            alert('Preview failed: ' + error.message);
            setIsPreviewOpen(false);
        } finally {
            setIsPreviewLoading(false);
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

    // PDF Load Status
    const [isPdfLoaded, setIsPdfLoaded] = useState(false);
    const [pdfError, setPdfError] = useState(null);

    // Preview Status
    const [isPreviewOpen, setIsPreviewOpen] = useState(false);
    const [previewImageBase64, setPreviewImageBase64] = useState(null);
    const [isPreviewLoading, setIsPreviewLoading] = useState(false);

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
        console.log('Editor: OCR Polling check:', { taskId, isPdfLoaded, fileUrl, hasOcrData: !!ocrData });
        if (!taskId || !isPdfLoaded || ocrData) return;

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
    }, [taskId, isPdfLoaded, fileUrl]); // Added fileUrl just in case

    const onDocumentLoadSuccess = ({ numPages }) => {
        setNumPages(numPages);
        setIsPdfLoaded(true);
        setPdfError(null);
    };

    const onDocumentLoadError = (error) => {
        console.error('PDF load error:', error);
        setPdfError(error.message || 'Failed to load PDF file.');
        setIsPdfLoaded(false);
        setIsProcessing(false);
    };

    const onPageLoadSuccess = (page) => {
        const viewport = page.getViewport({ scale: 1 });
        setPageDimensions({ width: viewport.width, height: viewport.height });

        // Auto-scale to fit container nicely (browser-like behavior)
        const container = document.querySelector('.canvas-area');
        if (container && zoom === 100) {
            // We want the PDF to take up a substantial portion of the screen width 
            // accounting for sidebar and padding. 0.8 is a good comfortable margin.
            const targetWidth = container.clientWidth * 0.8;
            const newScale = targetWidth / viewport.width;
            
            // Convert to percentage and cap reasonably between 100% and 250%
            let newZoom = Math.round(newScale * 100);
            newZoom = Math.max(100, Math.min(newZoom, 250)); 
            
            setZoom(newZoom);
        }
    };

    const onPageRenderSuccess = (page) => {
        // Use the actual rendered viewport to get the most accurate dimensions
        const viewport = page.getViewport({ scale: zoom / 100 });
        console.log('Editor: Page rendered. Dimensions:', { width: viewport.width, height: viewport.height });

        // Re-confirm base dimensions just in case
        const baseViewport = page.getViewport({ scale: 1 });
        if (!pageDimensions || pageDimensions.width !== baseViewport.width) {
            setPageDimensions({ width: baseViewport.width, height: baseViewport.height });
        }
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
        const CANVAS_PADDING = 40; // Add breathing room for selection handles

        const width = (pageDimensions.width * scale) + (CANVAS_PADDING * 2);
        const height = (pageDimensions.height * scale) + (CANVAS_PADDING * 2);

        // Dispose previous instance to prevent memory leaks
        if (fabricCanvasRef.current) {
            fabricCanvasRef.current.dispose();
        }

        // Create canvas with scaled dimensions and padding to match screen size
        const canvas = new fabric.Canvas(canvasElRef.current, {
            width,
            height,
            backgroundColor: 'transparent',
        });

        // Set zoom to match the PDF scaling
        canvas.setZoom(scale);
        
        // Offset the viewport to account for the CSS padding shift.
        // This makes logical points (0,0) perfectly match the PDF corner!
        canvas.setViewportTransform([scale, 0, 0, scale, CANVAS_PADDING, CANVAS_PADDING]);

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

        // Clip to Page constraints
        canvas.on('object:moving', (e) => {
            const obj = e.target;
            const w = obj.width * obj.scaleX;
            const h = obj.height * obj.scaleY;

            // Restrict from leaving page completely. Need at least 20 logical pixels inside
            const minLeft = -w + 20;
            const maxLeft = pageDimensions.width - 20;
            const minTop = -h + 20;
            const maxTop = pageDimensions.height - 20;

            if (obj.left < minLeft) obj.left = minLeft;
            if (obj.left > maxLeft) obj.left = maxLeft;
            if (obj.top < minTop) obj.top = minTop;
            if (obj.top > maxTop) obj.top = maxTop;
        });

        // Add Listeners for Changes to sync with React state
        const syncChanges = () => {
            const currentChanges = getChangesFromCanvas();

            setEditedBlocks(prev => {
                const newMap = { ...prev };

                // Get all block IDs on the CURRENT page from the canvas
                const currentPageBlockIds = new Set();
                canvas.getObjects().forEach(obj => {
                    if (obj.ocrBlockId) currentPageBlockIds.add(obj.ocrBlockId);
                });

                // 1. Remove entries for the current page that are NO LONGER changed
                // (This handles the case where a user reverts a change)
                Object.keys(newMap).forEach(id => {
                    if (currentPageBlockIds.has(id)) {
                        delete newMap[id];
                    }
                });

                // 2. Add current changes
                currentChanges.forEach(change => {
                    newMap[change.id] = change.text;
                });

                return newMap;
            });
        };

        canvas.on('object:modified', syncChanges);
        canvas.on('text:changed', syncChanges);
        canvas.on('changed', syncChanges);
        canvas.on('object:added', syncChanges);
        canvas.on('object:removed', syncChanges);

        // Text Tool: Add new Textbox on click (consistent with OCR blocks)
        canvas.on('mouse:down', (opt) => {
            // Only act when the text tool is active
            if (activeToolRef.current !== 'text') return;

            // Don't add a new textbox if the user clicked on an existing object
            if (opt.target) return;

            const pointer = canvas.getPointer(opt.e);
            const zoom = canvas.getZoom();

            const newText = new fabric.Textbox('Type here...', {
                left: pointer.x,
                top: pointer.y,
                width: 200 / zoom,
                fontSize: 16 / zoom,
                fontFamily: 'DejaVu Sans',
                lineHeight: 1.0,
                charSpacing: 0,
                padding: 0,
                fill: defaultStyle?.fill || '#000000',
                backgroundColor: defaultStyle?.backgroundColor === 'transparent' ? 'transparent' : (defaultStyle?.backgroundColor || 'transparent'),
                opacity: 1,
                editable: true,
                selectable: true,
                evented: true,
                borderColor: '#2196F3',
                cornerColor: '#2196F3',
                cornerSize: 8,
                transparentCorners: false,
                lockRotation: true,
                originX: 'left',
                originY: 'top',
                // No ocrBlockId — this marks it as a user-added object for getChangesFromCanvas
            });

            canvas.add(newText);
            canvas.setActiveObject(newText);
            // Enter editing mode immediately so the user can start typing
            newText.enterEditing();
            newText.selectAll();
            canvas.requestRenderAll();
        });

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
                // IMPORTANT: include custom properties in serialization
                canvasStates.current[currentPage] = fabricCanvasRef.current.toJSON(['ocrBlockId', 'originalState', 'ocrScale']);
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
            canvas.defaultCursor = 'default';
            canvas.selection = true;
        } else if (tool === 'highlight') {
            canvas.isDrawingMode = true;
            canvas.freeDrawingBrush = new fabric.PencilBrush(canvas);
            canvas.freeDrawingBrush.color = 'rgba(255, 255, 0, 0.5)';
            canvas.freeDrawingBrush.width = 20;
            canvas.defaultCursor = 'default';
            canvas.selection = true;
        } else if (tool === 'picker') {
            // Picker Tool: 
            canvas.isDrawingMode = false;
            canvas.defaultCursor = 'crosshair';
            canvas.hoverCursor = 'crosshair';
            canvas.selection = false;
            canvas.forEachObject(obj => {
                obj.selectable = false;
                obj.evented = false;
            });
        } else if (tool === 'text') {
            // Text Tool: Click on empty area adds a new Textbox
            canvas.isDrawingMode = false;
            canvas.defaultCursor = 'text';
            canvas.hoverCursor = 'text';
            canvas.selection = true;
        } else if (tool === 'manual-ocr') {
            canvas.isDrawingMode = false;
            canvas.defaultCursor = 'crosshair';
            canvas.hoverCursor = 'crosshair';
            canvas.selection = false;
            canvas.forEachObject(obj => {
                obj.selectable = false;
                obj.evented = false;
            });
        } else {
            canvas.isDrawingMode = false;
            canvas.defaultCursor = 'default';
            canvas.hoverCursor = 'move';
            canvas.selection = true;
        }

        // 2. Update Interactivity of ALL Text Blocks based on Tool
        canvas.getObjects().forEach(obj => {
            // Handle both OCR blocks and user-added text objects
            if (obj.type === 'textbox' || obj.type === 'i-text' || obj.type === 'text') {
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
                        editable: false,
                        hoverCursor: 'move'
                    });
                } else {
                    // Drawing/Others: Text is non-interactive
                    obj.set({
                        selectable: false,
                        evented: false,
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

        // 1. Calculate Scale Factors relative to base page dimensions (NOT zoomed canvas)
        const scaleX = pageDimensions.width / currentPageOcrData.width;
        const scaleY = pageDimensions.height / currentPageOcrData.height;

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
                padding: 2,
                splitByGrapheme: false,
                width: (block.rect.width * scaleX) + 10,
                height: block.rect.height * scaleY,
                // USE THE ACTUAL DETECTED FONT SIZE FROM OCR
                fontSize: block.font_size * scaleY,
                fontFamily: 'DejaVu Sans',
                lineHeight: 1.0,
                charSpacing: 0,
                textAlign: block.text_align || 'left',
                // Visibility Logic
                opacity: 0,
                // Use detected colors or defaults
                fill: block.fg_color || '#000000',
                backgroundColor: block.bg_color || 'rgba(255, 255, 255, 1)',
                // Match the backend's middle anchoring strategy visually
                originX: 'left',
                originY: 'top',
                top: block.rect.y * scaleY,

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
                const { x: sX, y: sY } = textObj.ocrScale;
                const cX = textObj.left / sX;
                const cY = textObj.top / sY;
                const cW = (textObj.width * textObj.scaleX) / sX;
                const cH = (textObj.height * textObj.scaleY) / sY;

                const isModified = Math.abs(cX - textObj.originalState.x) > 1 ||
                    Math.abs(cY - textObj.originalState.y) > 1 ||
                    Math.abs(cW - textObj.originalState.w) > 1 ||
                    Math.abs(cH - textObj.originalState.h) > 1 ||
                    textObj.text !== textObj.originalState.text;

                textObj.set({ opacity: isModified ? 1 : 0 });
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
                <div className="editor-header" style={{ position: 'relative', zIndex: 100 }}>
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
                    style={{ position: 'relative', zIndex: 90 }}
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
                    onSave={handleSaveChanges}
                    onPreview={handlePreview}
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
                            <div className="pdf-viewer-container" style={{ position: 'relative', display: 'inline-block' }}>
                                <Document
                                    file={fileUrl}
                                    onLoadSuccess={onDocumentLoadSuccess}
                                    onLoadError={onDocumentLoadError}
                                    loading={<div className="pdf-loading">Loading PDF Viewer...</div>}
                                    error={<div className="pdf-error">{pdfError || 'Failed to load PDF file.'}</div>}
                                >
                                    <div style={{ position: 'relative' }}>
                                        <Page
                                            pageNumber={currentPage}
                                            scale={zoom / 100}
                                            renderTextLayer={false}
                                            renderAnnotationLayer={false}
                                            onLoadSuccess={onPageLoadSuccess}
                                            onRenderSuccess={onPageRenderSuccess}
                                            className="pdf-page"
                                        />

                                        {/* Fabric.js Drawing Overlay */}
                                        {/* Ensuring dimensions exactly match the rendered Page size but extended by padding offset */}
                                        {pageDimensions && (() => {
                                            const CANVAS_PADDING = 40;
                                            return (
                                                <div style={{
                                                    position: 'absolute',
                                                    top: -CANVAS_PADDING,
                                                    left: -CANVAS_PADDING,
                                                    width: `${pageDimensions.width * (zoom / 100) + CANVAS_PADDING * 2}px`,
                                                    height: `${pageDimensions.height * (zoom / 100) + CANVAS_PADDING * 2}px`,
                                                    zIndex: 20,
                                                    pointerEvents: (activeTool === 'pen' || activeTool === 'highlight' || activeTool === 'text' || activeTool === 'select' || activeTool === 'picker') ? 'auto' : 'none'
                                                }}>
                                                    <canvas ref={canvasElRef} />
                                                </div>
                                            );
                                        })()}
                                    </div>
                                </Document>
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

            {/* Live Preview Modal */}
            {isPreviewOpen && (
                <div style={{
                    position: 'fixed',
                    inset: 0,
                    backgroundColor: 'rgba(0,0,0,0.8)',
                    zIndex: 9999,
                    display: 'flex',
                    flexDirection: 'column',
                    alignItems: 'center',
                    justifyContent: 'center',
                    padding: '2rem'
                }}>
                    <div style={{
                        background: 'white',
                        padding: '1rem',
                        borderRadius: '8px',
                        display: 'flex',
                        flexDirection: 'column',
                        width: '90%',
                        maxWidth: '1200px',
                        maxHeight: '90vh'
                    }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '1rem', alignItems: 'center' }}>
                            <h3 style={{ margin: 0, fontWeight: 600 }}>Live Burn-In Preview</h3>
                            <button 
                                onClick={() => { setIsPreviewOpen(false); setPreviewImageBase64(null); }}
                                style={{ background: '#f3f4f6', border: 'none', padding: '0.5rem 1rem', borderRadius: '4px', cursor: 'pointer', fontWeight: 600 }}
                            >
                                Close
                            </button>
                        </div>
                        <div style={{ flex: 1, overflow: 'auto', background: '#e5e7eb', display: 'flex', justifyContent: 'center', alignItems: 'flex-start', padding: '1rem' }}>
                            {isPreviewLoading ? (
                                <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '100%', minHeight: '300px' }}>
                                    <Loader size={48} className="spin" style={{ color: 'var(--color-primary)' }} />
                                    <p style={{ marginTop: '1rem', fontWeight: 500, color: '#4b5563' }}>Generating Live Preview...</p>
                                </div>
                            ) : (
                                previewImageBase64 && <img src={previewImageBase64} alt="PDF Preview" style={{ boxShadow: '0 4px 6px -1px rgba(0, 0, 0, 0.1)', maxWidth: '100%', height: 'auto' }} />
                            )}
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}
