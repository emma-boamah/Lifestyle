"""
ocr_editor_backend.py

This module handles the image processing required to edit text in scanned documents.
It uses OpenCV for removing original text (inpainting) and Pillow for high-quality
text overlay.
"""

import cv2
import numpy as np
from PIL import Image, ImageDraw, ImageFont
import os

def clean_background_region(image_cv, x, y, w, h):
    """
    Erases text from a specific region using Navier-Stokes inpainting.
    """
    # Create a mask for the region to be cleaned
    mask = np.zeros(image_cv.shape[:2], dtype=np.uint8)
    
    # We expand the box slightly (pad) to ensure we catch edge pixels of the text
    pad = 3
    
    # Ensure coordinates are within image bounds
    y1 = max(0, y - pad)
    y2 = min(image_cv.shape[0], y + h + pad)
    x1 = max(0, x - pad)
    x2 = min(image_cv.shape[1], x + w + pad)
    
    # Set the region in the mask to white (255)
    mask[y1:y2, x1:x2] = 255
    
    # Apply inpainting
    # radius=3 is typically good for text removal
    inpainted_img = cv2.inpaint(image_cv, mask, 3, cv2.INPAINT_NS)
    
    return inpainted_img

def process_pil_image(pil_image, edits):
    """
    Process a single PIL image: erase old text and draw new text.
    Returns a new PIL image.
    """
    # 1. Convert PIL (RGB) to OpenCV (BGR)
    img_array = np.array(pil_image)
    # Handle RGB vs RGBA
    if img_array.shape[2] == 4:
        img_cv = cv2.cvtColor(img_array, cv2.COLOR_RGBA2BGR)
    else:
        img_cv = cv2.cvtColor(img_array, cv2.COLOR_RGB2BGR)

    # 2. Pass 1: Erase old text (Inpainting)
    for edit in edits:
        # Use 'original_box' if available (from resize), else use current x,y,w,h
        if 'original_box' in edit:
            x, y, w, h = edit['original_box']
        else:
            x = int(edit.get('x', 0))
            y = int(edit.get('y', 0))
            w = int(edit.get('w', 0))
            h = int(edit.get('h', 0))
            
        img_cv = clean_background_region(img_cv, int(x), int(y), int(w), int(h))

    # 3. Convert back to PIL (BGR -> RGB) for text drawing
    img_cv = cv2.cvtColor(img_cv, cv2.COLOR_BGR2RGB)
    pil_img_out = Image.fromarray(img_cv)
    draw = ImageDraw.Draw(pil_img_out)

    # 4. Setup Font
    # Point to a specific .ttf file for production environment
    # Assuming standard structure: /var/www/lifestyle/static/fonts/arial.ttf
    font_path = os.path.join(os.path.dirname(os.path.dirname(os.path.dirname(__file__))), "static", "fonts", "arial.ttf")
    
    try:
        base_font = ImageFont.truetype(font_path, 20)
    except IOError:
        # Fallback if specific font is not found
        base_font = ImageFont.load_default()

    # 5. Pass 2: Overlay new text
    for edit in edits:
        x = int(edit.get('x', 0))
        y = int(edit.get('y', 0))
        text_content = edit.get('text', '')
        font_size = int(edit.get('font_size', 20))
        
        try:
            font = ImageFont.truetype(font_path, font_size)
        except:
            font = base_font

        # Draw the text (Black color for now, can be parameterized)
        draw.text((x, y), text_content, fill="black", font=font)
        
    return pil_img_out