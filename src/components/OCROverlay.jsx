import { useState } from 'react';

/**
 * OCROverlay component renders extracted text blocks as editable overlays
 * positioned over the PDF page.
 * 
 * @param {Object} props
 * @param {Object} props.pageData - OCR data for the current page
 * @param {number} props.zoom - Current zoom level (percentage)
 * @param {Object} props.editedBlocks - Map of block IDs to edited text
 * @param {Function} props.onTextChange - Callback when text is edited
 * @param {string} props.activeTool - Currently selected tool
 */
export default function OCROverlay({
    pageData,
    zoom,
    editedBlocks = {},
    onTextChange,
    activeTool
}) {
    const [selectedBlock, setSelectedBlock] = useState(null);

    if (!pageData || !pageData.text_blocks) {
        return null;
    }

    const scale = zoom / 100;

    // Calculate scale factor from OCR image dimensions to displayed size
    // The PDF is rendered at the specified zoom, OCR was done at 150 DPI
    const dpiScale = 72 / 150; // PDF default is 72 DPI, we OCR'd at 150 DPI

    const handleBlockClick = (e, block) => {
        if (activeTool === 'select' || activeTool === 'text') {
            e.stopPropagation();
            setSelectedBlock(block.id);
        }
    };

    const handleTextEdit = (blockId, newText) => {
        if (onTextChange) {
            onTextChange(blockId, newText);
        }
    };

    return (
        <div
            className="ocr-overlay"
            style={{
                position: 'absolute',
                top: 0,
                left: 0,
                width: `${pageData.width * dpiScale * scale}px`,
                height: `${pageData.height * dpiScale * scale}px`,
                pointerEvents: activeTool === 'select' || activeTool === 'text' ? 'auto' : 'none',
            }}
        >
            {pageData.text_blocks.map((block) => {
                const isSelected = selectedBlock === block.id;
                const isEditable = isSelected && activeTool === 'text';
                const displayText = editedBlocks[block.id] ?? block.text;

                return (
                    <div
                        key={block.id}
                        className={`ocr-text-block ${isSelected ? 'selected' : ''}`}
                        style={{
                            position: 'absolute',
                            left: `${block.rect.x * dpiScale * scale}px`,
                            top: `${block.rect.y * dpiScale * scale}px`,
                            width: `${block.rect.width * dpiScale * scale}px`,
                            minHeight: `${block.rect.height * dpiScale * scale}px`,
                            fontSize: `${Math.max(10, block.rect.height * dpiScale * scale * 0.8)}px`,
                            lineHeight: 1.1,
                            padding: '2px',
                            backgroundColor: isSelected ? 'rgba(99, 102, 241, 0.1)' : 'transparent',
                            border: isSelected ? '2px solid var(--color-primary)' : '1px solid transparent',
                            borderRadius: '2px',
                            cursor: activeTool === 'text' ? 'text' : 'pointer',
                            outline: 'none',
                            overflow: 'hidden',
                            wordBreak: 'break-word',
                            color: 'transparent', // Hide text, overlay on existing
                            textShadow: isSelected ? '0 0 0 #000' : 'none', // Show text when selected
                        }}
                        onClick={(e) => handleBlockClick(e, block)}
                        contentEditable={isEditable}
                        suppressContentEditableWarning={true}
                        onBlur={(e) => {
                            if (isEditable) {
                                handleTextEdit(block.id, e.target.innerText);
                            }
                        }}
                        onKeyDown={(e) => {
                            if (e.key === 'Escape') {
                                setSelectedBlock(null);
                            }
                        }}
                        title={`Confidence: ${(block.confidence * 100).toFixed(1)}%`}
                    >
                        {displayText}
                    </div>
                );
            })}
        </div>
    );
}
