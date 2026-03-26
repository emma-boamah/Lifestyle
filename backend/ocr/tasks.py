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


@shared_task(bind=True)
def ocr_targeted_crop(self, file_path, page_num, rect):
    """
    Runs OCR on a specific crop of a PDF page.
    
    Args:
        file_path (str): Path to original PDF.
        page_num (int): 1-indexed page number.
        rect (dict): {x, y, width, height} in OCR pixels (150 DPI).
    """
    if not os.path.exists(file_path):
        return {'error': 'File not found'}

    try:
        self.update_state(state='PROCESSING', meta={'status': f'Cropping page {page_num}...'})
        
        # Convert specific page
        images = convert_from_path(
            file_path, 
            first_page=page_num, 
            last_page=page_num, 
            dpi=150, 
            use_cropbox=True
        )
        
        if not images:
            return {'error': 'Failed to convert page'}
            
        img = images[0]
        
        # Define crop (ensure integers)
        rx, ry, rw, rh = int(rect['x']), int(rect['y']), int(rect['width']), int(rect['height'])
        
        # Image crop (box is left, upper, right, lower)
        # Pad slightly to give OCR context
        pad = 2
        crop_box = (
            max(0, rx - pad), 
            max(0, ry - pad), 
            min(img.width, rx + rw + pad), 
            min(img.height, ry + rh + pad)
        )
        img_crop = img.crop(crop_box)
        
        # OCR
        self.update_state(state='PROCESSING', meta={'status': 'Running targeted OCR...'})
        reader = easyocr.Reader(['en'], gpu=False)
        img_array = np.array(img_crop)
        results = reader.readtext(img_array)
        
        if not results:
            return {'text': '', 'blocks': []}

        # Open doc for style detection if possible
        doc = fitz.open(file_path)
        pdf_page = doc[page_num - 1]
        scale_x = pdf_page.rect.width / img.width
        scale_y = pdf_page.rect.height / img.height

        blocks = []
        for bbox, text, conf in results:
            # Adjust bbox back to full page coordinates
            # bbox is relative to crop
            clean_bbox = [[int(pt[0] + crop_box[0]), int(pt[1] + crop_box[1])] for pt in bbox]
            
            x_coords = [pt[0] for pt in clean_bbox]
            y_coords = [pt[1] for pt in clean_bbox]
            bx = min(x_coords)
            by = min(y_coords)
            bw = max(x_coords) - bx
            bh = max(y_coords) - by

            # Detect style (use detect_style_in_rect existing logic)
            pdf_rect = fitz.Rect(
                bx * scale_x + pdf_page.rect.x0,
                by * scale_y + pdf_page.rect.y0,
                (bx + bw) * scale_x + pdf_page.rect.x0,
                (by + bh) * scale_y + pdf_page.rect.y0
            )
            bg_rgb, fg_rgb, font_size = detect_style_in_rect(pdf_page, pdf_rect)
            
            blocks.append({
                'text': text,
                'confidence': float(conf),
                'rect': {'x': bx, 'y': by, 'width': bw, 'height': bh},
                'fg_color': '#{:02x}{:02x}{:02x}'.format(int(fg_rgb[0] * 255), int(fg_rgb[1] * 255), int(fg_rgb[2] * 255)),
                'bg_color': '#{:02x}{:02x}{:02x}'.format(int(bg_rgb[0] * 255), int(bg_rgb[1] * 255), int(bg_rgb[2] * 255)),
                'font_size': font_size * (150 / 72)
            })

        doc.close()
        return {'blocks': blocks}

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
    Applies edits to a PDF natively using PyMuPDF (burn-in text and redacting background).
    
    Args:
        file_path (str): Path to the source PDF.
        changes (list): List of dicts with keys: page, x_percent, y_percent, etc.
    """
    if not os.path.exists(file_path):
        return {'error': 'File not found'}

    try:
        self.update_state(state='PROCESSING', meta={'status': 'Opening PDF for native editing...'})
        
        # Open PDF with PyMuPDF
        doc = fitz.open(file_path)
        
        # 1. Group changes by page
        changes_by_page = {}
        for change in changes:
            p_idx = change.get('page', 1) - 1 # 0-indexed
            if p_idx not in changes_by_page:
                changes_by_page[p_idx] = []
            changes_by_page[p_idx].append(change)

        # 2. Process each modified page
        for p_idx, page_changes in changes_by_page.items():
            if p_idx >= len(doc):
                continue
                
            self.update_state(
                state='PROCESSING', 
                meta={'status': f'Applying edits to page {p_idx + 1}...'}
            )
            
            page = doc[p_idx]
            
            # Register custom font if available
            font_path = os.path.join(os.path.dirname(os.path.dirname(__file__)), 'assets/fonts/Inter-Regular.ttf')
            has_custom_font = os.path.exists(font_path)
            if has_custom_font:
                page.insert_font(fontname="inter", fontfile=font_path)

            pdf_w = page.rect.width
            pdf_h = page.rect.height
            
            # CRITICAL: PDF pages don't always start at (0,0), especially if they've been cropped!
            x0 = page.rect.x0
            y0 = page.rect.y0

            # Pass A: Redaction (Erasing old text)
            for change in page_changes:
                if change.get('is_new'):
                    continue
                
                # Use percentage-based original box for perfect scaling
                orig_box_pct = change.get('original_box_percent')
                if orig_box_pct and len(orig_box_pct) == 4:
                    # Expand the redaction area by 2 pixels in every direction
                    # to ensure all 'ink' from the scan is removed.
                    ox = x0 + (orig_box_pct[0] * pdf_w) - 2
                    oy = y0 + (orig_box_pct[1] * pdf_h) - 2
                    ow = (orig_box_pct[2] * pdf_w) + 4
                    oh = (orig_box_pct[3] * pdf_h) + 4
                    
                    # Get background color
                    bg_color_hex = change.get('bg_color')
                    if bg_color_hex and bg_color_hex != 'transparent':
                        bg_hex = bg_color_hex.lstrip('#')
                        bg_rgb = tuple(int(bg_hex[i:i+2], 16)/255.0 for i in (0, 2, 4))
                    else:
                        bg_rgb = (1, 1, 1) # Default to white
                        
                    # Add redaction annotation (removes underlying selectable text)
                    rect = fitz.Rect(ox, oy, ox + ow, oy + oh)
                    page.add_redact_annot(rect, fill=bg_rgb)
            
            # Apply all redactions for the page
            page.apply_redactions()

            # Pass B: Insert new/modified text
            for change in page_changes:
                tx = x0 + (change.get('x_percent', 0) * pdf_w)
                ty = y0 + (change.get('y_percent', 0) * pdf_h)
                tw = change.get('w_percent', 0) * pdf_w
                th = change.get('h_percent', 0) * pdf_h
                
                text_content = change.get('text', '')
                
                if 'font_size_percent' in change:
                    target_fontsize = change['font_size_percent'] * pdf_h
                else:
                    target_fontsize = change.get('font_size', 16)
                
                fill_color_hex = change.get('fill_color', '#000000')
                fg_hex = fill_color_hex.lstrip('#')
                fg_rgb = tuple(int(fg_hex[i:i+2], 16)/255.0 for i in (0, 2, 4))

                bg_color_hex = change.get('bg_color')
                
                # If there's a specific background color set for NEW text, draw a rect
                if change.get('is_new') and bg_color_hex and bg_color_hex != 'transparent':
                    bg_hex = bg_color_hex.lstrip('#')
                    bg_rgb = tuple(int(bg_hex[i:i+2], 16)/255.0 for i in (0, 2, 4))
                    rect = fitz.Rect(tx, ty, tx + tw, ty + th)
                    page.draw_rect(rect, color=None, fill=bg_rgb)
                
                align_str = change.get('text_align', 'left').lower()
                align = fitz.TEXT_ALIGN_LEFT
                if align_str == 'center':
                    align = fitz.TEXT_ALIGN_CENTER
                elif align_str == 'right':
                    align = fitz.TEXT_ALIGN_RIGHT
                
                # Logic: Is it a header or a paragraph?
                is_paragraph = "\n" in text_content or len(text_content) > 60
                
                font_kwargs = {}
                if has_custom_font:
                    font_kwargs['fontname'] = "inter"
                else:
                    font_kwargs['fontname'] = "helv"

                if not is_paragraph:
                    # HEADER PRECISION: No box, no clipping.
                    page.insert_text(
                        (tx, ty + (target_fontsize * 0.8)), 
                        text_content,
                        fontsize=target_fontsize,
                        color=fg_rgb,
                        **font_kwargs
                    )
                else:
                    # PARAGRAPH WRAPPING: Use a box with a safety buffer.
                    target_rect = fitz.Rect(
                        tx - 2, 
                        ty - (target_fontsize * 0.1), 
                        tx + tw + 4, 
                        ty + th + (target_fontsize * 0.4)
                    )
                    
                    page.insert_textbox(
                        target_rect, 
                        text_content, 
                        fontsize=target_fontsize, 
                        color=fg_rgb,
                        align=align,
                        **font_kwargs
                    )

        output_path = file_path.replace('.pdf', '_edited.pdf')
        
        self.update_state(state='PROCESSING', meta={'status': 'Saving final PDF natively...'})
        
        # Save modifications cleanly
        doc.save(output_path, garbage=4, deflate=True)
        doc.close()
        
        return {'output_path': output_path, 'filename': os.path.basename(output_path)}

    except Exception as e:
        import traceback
        return {'error': str(e), 'traceback': traceback.format_exc()}
