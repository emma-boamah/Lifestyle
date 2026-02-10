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
        
        # Convert PDF pages to images (requires poppler-utils installed on OS)
        images = convert_from_path(file_path, dpi=150)
        
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

            # Get the corresponding PDF page for color detection
            if i < len(doc):
                pdf_page = doc[i]
                # Calculate scale factors: PDF points / Image pixels
                scale_x = pdf_page.rect.width / img.width
                scale_y = pdf_page.rect.height / img.height
            else:
                pdf_page = None
                scale_x = 1.0
                scale_y = 1.0

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

                # Detect Colors
                fg_color = '#000000' # Default Black
                bg_color = '#ffffff' # Default White
                
                if pdf_page:
                    # Convert image rect to PDF rect
                    pdf_rect = fitz.Rect(
                        rect_x * scale_x,
                        rect_y * scale_y,
                        (rect_x + rect_w) * scale_x,
                        (rect_y + rect_h) * scale_y
                    )
                    
                    # Detect colors
                    bg_rgb, fg_rgb = detect_colors_in_rect(pdf_page, pdf_rect)
                    
                    # Convert to Hex
                    fg_color = '#{:02x}{:02x}{:02x}'.format(
                        int(fg_rgb[0] * 255), int(fg_rgb[1] * 255), int(fg_rgb[2] * 255)
                    )
                    bg_color = '#{:02x}{:02x}{:02x}'.format(
                        int(bg_rgb[0] * 255), int(bg_rgb[1] * 255), int(bg_rgb[2] * 255)
                    )

                page_data['text_blocks'].append({
                    'id': f'page{i+1}_block{len(page_data["text_blocks"])}',
                    'text': text,
                    'confidence': float(conf),
                    'bbox': clean_bbox,
                    'fg_color': fg_color,
                    'bg_color': bg_color,
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


def detect_colors_in_rect(page, rect):
    """
    Returns (background_rgb, foreground_rgb) tuples (0.0-1.0).
    Defaulting to (White, Black) if nothing is found.
    """
    bg = (1, 1, 1)  # White
    fg = (0, 0, 0)  # Black
    
    try:
        # Get text dictionary in the area to find font color
        text_dict = page.get_text("dict", clip=rect)
        for block in text_dict.get("blocks", []):
            for line in block.get("lines", []):
                for span in line.get("spans", []):
                    # PyMuPDF colors are integers; convert to RGB tuple
                    color_int = span.get('color', 0)
                    fg = fitz.sRGB_to_pdf(color_int)
                    return bg, fg
    except Exception:
        pass
    return bg, fg


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
        
        # 1. Convert PDF to images (using same DPI as OCR to match coordinates)
        # We use 150 DPI as established in ocr_process_pdf
        images = convert_from_path(file_path, dpi=150)
        
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
