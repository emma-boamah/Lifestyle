import { useState } from 'react';
import {
    Type, Pen, Image, Square, Pencil, Highlighter, Download, Save, Share2,
    MousePointer, Hand, ZoomIn, ZoomOut, ChevronLeft, ChevronRight,
    Undo, Redo, Printer, Loader
} from 'lucide-react';
import { exportEditedPdf, downloadOriginalPdf } from '../utils/pdfExport';

export default function Toolbar({
    activeTool,
    onToolChange,
    zoom,
    setZoom,
    currentPage,
    setCurrentPage,
    totalPages,
    ocrData,
    editedBlocks,
    fileUrl,
    fileName
}) {
    const [isExporting, setIsExporting] = useState(false);

    const tools = [
        { id: 'select', icon: MousePointer, label: 'Select' },
        { id: 'pan', icon: Hand, label: 'Pan' },
        { divider: true },
        { id: 'text', icon: Type, label: 'Text' },
        { id: 'pen', icon: Pen, label: 'Pen' },
        { id: 'pencil', icon: Pencil, label: 'Pencil' },
        { id: 'highlight', icon: Highlighter, label: 'Highlight' },
        { id: 'image', icon: Image, label: 'Image' },
        { id: 'shape', icon: Square, label: 'Shape' }
    ];

    const handleExport = async () => {
        if (!fileUrl || !fileName) {
            alert('No PDF loaded to export');
            return;
        }

        setIsExporting(true);
        try {
            const hasEdits = Object.keys(editedBlocks || {}).length > 0;

            if (hasEdits && ocrData) {
                // Export with edits
                await exportEditedPdf(fileUrl, ocrData, editedBlocks, fileName);
            } else {
                // Just download original
                await downloadOriginalPdf(fileUrl, fileName);
            }
        } catch (error) {
            alert('Export failed: ' + error.message);
        } finally {
            setIsExporting(false);
        }
    };

    const handleSave = () => {
        // For now, just show a message
        // In a full implementation, this would save to the backend
        const editCount = Object.keys(editedBlocks || {}).length;
        if (editCount > 0) {
            alert(`${editCount} text edit(s) saved locally. Click Export to download the modified PDF.`);
        } else {
            alert('No changes to save.');
        }
    };

    return (
        <div className="toolbar">
            {/* History */}
            <div className="toolbar-group">
                <button className="tool-btn" title="Undo"><Undo size={18} /></button>
                <button className="tool-btn" title="Redo"><Redo size={18} /></button>
            </div>

            <div className="toolbar-divider"></div>

            {/* Zoom & Navigation */}
            <div className="toolbar-group">
                <button className="tool-btn" onClick={() => setZoom(z => Math.max(25, z - 10))} title="Zoom Out">
                    <ZoomOut size={18} />
                </button>
                <span className="zoom-display">{zoom}%</span>
                <button className="tool-btn" onClick={() => setZoom(z => Math.min(200, z + 10))} title="Zoom In">
                    <ZoomIn size={18} />
                </button>
            </div>

            <div className="toolbar-divider"></div>

            <div className="toolbar-group">
                <button className="tool-btn" onClick={() => setCurrentPage(p => Math.max(1, p - 1))} disabled={currentPage <= 1}>
                    <ChevronLeft size={18} />
                </button>
                <span className="page-display">{currentPage} / {totalPages}</span>
                <button className="tool-btn" onClick={() => setCurrentPage(p => Math.min(totalPages, p + 1))} disabled={currentPage >= totalPages}>
                    <ChevronRight size={18} />
                </button>
            </div>

            <div className="toolbar-divider"></div>

            {/* Tools */}
            {tools.map((tool, idx) => {
                if (tool.divider) return <div key={idx} className="toolbar-divider"></div>;
                const Icon = tool.icon;
                return (
                    <button
                        key={tool.id}
                        className={`tool-btn ${activeTool === tool.id ? 'active' : ''}`}
                        onClick={() => onToolChange(tool.id)}
                        title={tool.label}
                    >
                        <Icon size={20} />
                    </button>
                );
            })}

            <div className="toolbar-divider"></div>

            {/* Actions */}
            <div style={{ marginLeft: 'auto', display: 'flex', gap: '0.5rem' }}>
                <button className="tool-btn" title="Print" onClick={() => window.print()}>
                    <Printer size={18} />
                </button>
                <button className="btn btn-secondary" onClick={handleSave}>
                    <Save size={18} />
                    Save
                </button>
                <button className="btn btn-secondary" title="Share">
                    <Share2 size={18} />
                    Share
                </button>
                <button
                    className="btn btn-primary"
                    onClick={handleExport}
                    disabled={isExporting || !fileUrl}
                    title={Object.keys(editedBlocks || {}).length > 0 ? 'Export with edits' : 'Download PDF'}
                >
                    {isExporting ? <Loader size={18} className="spin" /> : <Download size={18} />}
                    {isExporting ? 'Exporting...' : 'Export'}
                </button>
            </div>
        </div>
    );
}
