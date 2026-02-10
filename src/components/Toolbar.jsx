import { useState } from 'react';
import {
    Type, Pen, Image, Square, Pencil, Highlighter, Download, Save, Share2,
    MousePointer, Hand, ZoomIn, ZoomOut, ChevronLeft, ChevronRight,
    Undo, Redo, Printer, Loader, Pipette
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
    fileName,
    activeObject,
    onUpdateObject,
    defaultStyle,
    setDefaultStyle,
    onExport
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
        { id: 'picker', icon: Pipette, label: 'Pick Color' },
        { id: 'image', icon: Image, label: 'Image' },
        { id: 'shape', icon: Square, label: 'Shape' }
    ];

    const handleExport = async () => {
        if (onExport) {
            onExport();
            return;
        }

        // Fallback (should not be reached if onExport is passed)
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
            <div style={{ marginLeft: 'auto', display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
                {/* Style Controls */}
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginRight: '1rem' }}>

                    {/* Text Color Group */}
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.25rem', padding: '0.25rem', border: '1px solid #ddd', borderRadius: '4px' }}>
                        <div className="color-picker-wrapper" title={`Text Color: ${activeObject?.fill || defaultStyle?.fill || '#000000'}`}>
                            <Type size={16} />
                            <input
                                type="color"
                                value={activeObject?.fill || defaultStyle?.fill || '#000000'}
                                onChange={(e) => {
                                    const val = e.target.value;
                                    if (onUpdateObject && activeObject) onUpdateObject({ fill: val });
                                    if (setDefaultStyle) setDefaultStyle(prev => ({ ...prev, fill: val }));
                                }}
                                style={{ width: '24px', height: '24px', padding: 0, border: 'none', background: 'none' }}
                            />
                        </div>
                    </div>

                    {/* Background Color Group */}
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.25rem', padding: '0.25rem', border: '1px solid #ddd', borderRadius: '4px' }}>
                        <div className="color-picker-wrapper" title={`Highlight/Background Color: ${activeObject?.backgroundColor === 'transparent' ? 'Transparent' : (activeObject?.backgroundColor || defaultStyle?.backgroundColor || '#ffffff')}`}>
                            <Highlighter size={16} />
                            <input
                                type="color"
                                value={activeObject?.backgroundColor === 'transparent' ? '#ffffff' : (activeObject?.backgroundColor || defaultStyle?.backgroundColor || '#ffffff')}
                                onChange={(e) => {
                                    const val = e.target.value;
                                    if (onUpdateObject && activeObject) onUpdateObject({ backgroundColor: val });
                                    if (setDefaultStyle) setDefaultStyle(prev => ({ ...prev, backgroundColor: val }));
                                }}
                                style={{ width: '24px', height: '24px', padding: 0, border: 'none', background: 'none' }}
                            />
                        </div>
                    </div>
                </div>

                <div className="toolbar-divider" style={{ marginRight: '0.5rem' }}></div>

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
