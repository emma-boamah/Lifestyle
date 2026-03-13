from celery import shared_task
import easyocr
from pdf2image import convert_from_path
import numpy as np
import os
import fitz  # PyMuPDF
from .ocr_editor_backend import process_pil_image


@shared_task(bind=True)
def ocr_process_pdf(self, file_path):
    """
    Celery task to process a PDF file using EasyOCR.
    
    Args:
        file_path (str): Absolute path to the uploaded PDF file.
        
    Returns:
        dict: Structured data containing text, confidence scores, and bounding boxes per page.
    """
    if not os.path.exists(file_path):
        return {'error': f'File not found: {file_path}'}

    try:
        # Update task state to PROCESSING
        self.update_state(state='PROCESSING', meta={'status': 'Initializing OCR engine...'})
        
        # Initialize EasyOCR Reader
        # Note: 'gpu=False' is safer for standard servers; set to True if you have CUDA setup.
        reader = easyocr.Reader(['en'], gpu=False)

        # Update state
        self.update_state(state='PROCESSING', meta={'status': 'Converting PDF to images...'})
        
        # Convert PDF pages to images (using CropBox to match visible coordinates)
        images = convert_from_path(file_path, dpi=150, use_cropbox=True)
        
        output = {
            'page_count': len(images),
            'pages': []
        }

        # Open PDF with PyMuPDF for color detection
        doc = fitz.open(file_path)

        for i, img in enumerate(images):
            # Update progress
            self.update_state(
                state='PROCESSING', 
                meta={'status': f'Processing page {i + 1} of {len(images)}...'}
            )
            
            # Convert PIL image to numpy array for EasyOCR
            img_array = np.array(img)
            
            # Run OCR - detail=1 returns [bbox, text, confidence]
            results = reader.readtext(img_array)
            
            page_data = {
                'page_number': i + 1,
                'width': img.width,
                'height': img.height,
                'text_blocks': []
            }

            # Get the corresponding PDF page for color detection and native text
            if i < len(doc):
                pdf_page = doc[i]
                # Calculate scale factors: PDF points / Image pixels
                scale_x = pdf_page.rect.width / img.width
                scale_y = pdf_page.rect.height / img.height
                
                # Extract native text spans for alignment
                native_dict = pdf_page.get_text("dict")
                native_spans = []
                for b in native_dict.get("blocks", []):
                    if b["type"] == 0:  # Text block
                        for l in b.get("lines", []):
                            for s in l.get("spans", []):
                                native_spans.append(s)
            else:
                pdf_page = None
                scale_x = 1.0
                scale_y = 1.0
                native_spans = []

            for bbox, text, conf in results:
                # Clean up data for JSON serialization (numpy ints/floats to python native)
                # bbox is a list of 4 points: [[x1,y1], [x2,y2], [x3,y3], [x4,y4]]
                clean_bbox = [[int(pt[0]), int(pt[1])] for pt in bbox]
                
                # Calculate bounding box rectangle from polygon points
                x_coords = [pt[0] for pt in clean_bbox]
                y_coords = [pt[1] for pt in clean_bbox]
                
                rect_x = min(x_coords)
                rect_y = min(y_coords)
                rect_w = max(x_coords) - rect_x
                rect_h = max(y_coords) - rect_y

                # Detect Colors and potentially refine coordinates from native text
                fg_color = '#000000' # Default Black
                bg_color = '#ffffff' # Default White
                font_size = rect_h * 0.8 # Default fallback
                text_align = 'left'
                
                # REFINEMENT: Match OCR text with native PDF spans
                matched_span = None
                if native_spans:
                    # Match based on spatial overlap and text content similarity
                    # We look for a native span that roughly overlaps with our OCR rect
                    ocr_rect_pdf = fitz.Rect(
                        rect_x * scale_x, 
                        rect_y * scale_y, 
                        (rect_x + rect_w) * scale_x, 
                        (rect_y + rect_h) * scale_y
                    )
                    
                    best_overlap = 0
                    for span in native_spans:
                        span_rect = fitz.Rect(span["bbox"])
                        intersect = ocr_rect_pdf & span_rect
                        if not intersect.is_empty:
                            overlap = intersect.width * intersect.height
                            if overlap > best_overlap:
                                # String overlap check (fuzzy-ish)
                                if span["text"].strip() in text or text in span["text"].strip():
                                    best_overlap = overlap
                                    matched_span = span

                if matched_span:
                    # USE NATIVE COORDINATES (converted back to OCR pixels)
                    # This provides pixel-perfect alignment for existing text
                    # We must subtract the page origin (x0, y0) because the image is the CropBox area
                    s_bbox = matched_span["bbox"]
                    rect_x = (s_bbox[0] - pdf_page.rect.x0) / scale_x
                    rect_y = (s_bbox[1] - pdf_page.rect.y0) / scale_y
                    rect_w = (s_bbox[2] - s_bbox[0]) / scale_x
                    rect_h = (s_bbox[3] - s_bbox[1]) / scale_y
                    
                    # Use native style
                    font_size = matched_span.get('size', 12) * (150 / 72)
                    color_int = matched_span.get('color', 0)
                    fg_rgb = fitz.sRGB_to_pdf(color_int)
                    fg_color = '#{:02x}{:02x}{:02x}'.format(
                        int(fg_rgb[0] * 255), int(fg_rgb[1] * 255), int(fg_rgb[2] * 255)
                    )
                    
                    # Sample background around the native rect
                    bg_rgb, _, _ = detect_style_in_rect(pdf_page, fitz.Rect(s_bbox))
                    bg_color = '#{:02x}{:02x}{:02x}'.format(
                        int(bg_rgb[0] * 255), int(bg_rgb[1] * 255), int(bg_rgb[2] * 255)
                    )
                elif pdf_page:
                    # Fallback to current detect_style_in_rect if no direct span match
                    # We must add the page origin as rect_x/y are relative to the image (CropBox)
                    pdf_rect = fitz.Rect(
                        rect_x * scale_x + pdf_page.rect.x0,
                        rect_y * scale_y + pdf_page.rect.y0,
                        (rect_x + rect_w) * scale_x + pdf_page.rect.x0,
                        (rect_y + rect_h) * scale_y + pdf_page.rect.y0
                    )
                    
                    bg_rgb, fg_rgb, detected_font_size = detect_style_in_rect(pdf_page, pdf_rect)
                    
                    fg_color = '#{:02x}{:02x}{:02x}'.format(
                        int(fg_rgb[0] * 255), int(fg_rgb[1] * 255), int(fg_rgb[2] * 255)
                    )
                    bg_color = '#{:02x}{:02x}{:02x}'.format(
                        int(bg_rgb[0] * 255), int(bg_rgb[1] * 255), int(bg_rgb[2] * 255)
                    )
                    font_size = detected_font_size * (150 / 72)

                page_data['text_blocks'].append({
                    'id': f'page{i+1}_block{len(page_data["text_blocks"])}',
                    'text': text,
                    'confidence': float(conf),
                    'bbox': clean_bbox,
                    'fg_color': fg_color,
                    'bg_color': bg_color,
                    'font_size': font_size,
                    'text_align': text_align,
                    # Simplified rectangle for easier positioning
                    'rect': {
                        'x': rect_x,
                        'y': rect_y,
                        'width': rect_w,
                        'height': rect_h
                    }
                })
            
            output['pages'].append(page_data)
        
        doc.close()

        return output

    except Exception as e:
        return {'error': str(e)}


def detect_style_in_rect(page, rect):
    """
    Returns (background_rgb, foreground_rgb, font_size) tuples.
    Defaulting to (White, Black, 12pt) if nothing is found.
    """
    bg = (1, 1, 1)  # White
    fg = (0, 0, 0)  # Black
    font_size = 12
    
    try:
        # Get text dictionary in the area to find font color and size
        text_dict = page.get_text("dict", clip=rect)
        for block in text_dict.get("blocks", []):
            if block["type"] != 0: continue # 0 is text block
            for line in block.get("lines", []):
                for span in line.get("spans", []):
                    # PyMuPDF colors are integers; convert to RGB tuple
                    color_int = span.get('color', 0)
                    fg = fitz.sRGB_to_pdf(color_int)
                    font_size = span.get('size', 12)
                    return bg, fg, font_size
    except Exception:
        pass
    return bg, fg, font_size


@shared_task(bind=True)
def apply_pdf_changes(self, file_path, changes):
    """
    Applies edits to a PDF by converting to images, inpainting, and overlaying text.
    
    Args:
        file_path (str): Path to the source PDF.
        changes (list): List of dicts with keys: page, x, y, w, h, text.
    """
    if not os.path.exists(file_path):
        return {'error': 'File not found'}

    try:
        self.update_state(state='PROCESSING', meta={'status': 'Converting PDF to images...'})
        
        # 1. Convert PDF to images (using same DPI and CropBox as OCR to match coordinates)
        images = convert_from_path(file_path, dpi=150, use_cropbox=True)
        
        # 2. Group changes by page
        changes_by_page = {}
        for change in changes:
            p_idx = change.get('page', 0) - 1
            if p_idx not in changes_by_page:
                changes_by_page[p_idx] = []
            changes_by_page[p_idx].append(change)

        processed_images = []

        # 3. Process each page
        for i, img in enumerate(images):
            self.update_state(
                state='PROCESSING', 
                meta={'status': f'Applying edits to page {i + 1}...'}
            )
            
            if i in changes_by_page:
                # Apply edits using OpenCV/Pillow backend
                edited_img = process_pil_image(img, changes_by_page[i])
                processed_images.append(edited_img)
            else:
                # No changes for this page, keep original
                processed_images.append(img)

        # Save to a new file to preserve original
        output_path = file_path.replace('.pdf', '_edited.pdf')
        
        self.update_state(state='PROCESSING', meta={'status': 'Saving final PDF...'})
        
        if processed_images:
            processed_images[0].save(
                output_path, 
                save_all=True, 
                append_images=processed_images[1:],
                resolution=150.0
            )
        
        return {'output_path': output_path, 'filename': os.path.basename(output_path)}

    except Exception as e:
        return {'error': str(e)}
