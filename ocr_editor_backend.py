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
    
    Why Inpainting? 
    Scanned documents often have noise, grain, or off-white backgrounds. 
    Drawing a pure white rectangle looks like a 'patch'. Inpainting uses 
    surrounding pixels to fill the void, making it look natural.
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

def process_scanned_image(image_path, edits, output_path):
    """
    Applies text edits to a scanned image and saves the result.

    Args:
        image_path (str): Path to the source image (scanned page).
        edits (list): A list of dictionaries. Each dict should contain:
            - 'original_box': [x, y, w, h] (The area to erase)
            - 'new_box': [x, y, w, h] (Where to draw new text - usually same as original unless moved)
            - 'text': str (The new text content)
            - 'font_size': int (The font size from frontend)
        output_path (str): Where to save the final image/PDF.
    """
    
    # 1. Load the image using OpenCV
    img_cv = cv2.imread(image_path)
    if img_cv is None:
        raise ValueError(f"Could not load image: {image_path}")

    # 2. Pass 1: Erase old text (Inpainting)
    for edit in edits:
        # We use the ORIGINAL box for erasure to ensure we remove the old pixels
        # regardless of how the user resized the new box.
        ox, oy, ow, oh = edit['original_box']
        img_cv = clean_background_region(img_cv, ox, oy, ow, oh)

    # 3. Convert from OpenCV (BGR) to Pillow (RGB)
    img_cv = cv2.cvtColor(img_cv, cv2.COLOR_BGR2RGB)
    pil_img = Image.fromarray(img_cv)
    draw = ImageDraw.Draw(pil_img)

    # 4. Pass 2: Overlay new text
    # Attempt to load a standard font. 
    # In production, point this to a specific .ttf file in your static assets.
    # Using an absolute path ensures reliability in production environments
    font_path = os.path.join(os.path.dirname(__file__), "static", "fonts", "arial.ttf")
    try:
        # You might need to adjust this path based on your OS or project structure
        base_font = ImageFont.truetype(font_path, 20)
    except IOError:
        # Fallback if arial is not found
        base_font = ImageFont.load_default()

    for edit in edits:
        nx, ny, nw, nh = edit['new_box']
        text_content = edit.get('text', '')
        font_size = int(edit.get('font_size', 20))
        
        try:
            font = ImageFont.truetype(font_path, font_size)
        except:
            font = base_font

        # Draw the text
        # Pillow draws text from the top-left corner (nx, ny).
        draw.text((nx, ny), text_content, fill="black", font=font)

    # 5. Save the result
    # If output path ends in .pdf, Pillow handles the conversion automatically
    pil_img.save(output_path, resolution=100.0)
    
    return output_path