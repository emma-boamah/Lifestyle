"""
ocr_editor_backend.py

This module handles the image processing required to edit text in scanned documents.
It uses Pillow to:
  1. Erase old text by filling original regions with the background color.
  2. Draw new/replacement text at the target position.
"""

import numpy as np
from PIL import Image, ImageDraw, ImageFont
import os


def _get_font(font_size):
    """
    Get a font at the specified size. Tries common font paths in order.
    """
    font_candidates = [
        # Project-local font
        os.path.join(os.path.dirname(os.path.dirname(os.path.dirname(__file__))), "static", "fonts", "arial.ttf"),
        # System fonts (Linux)
        "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf",
        "/usr/share/fonts/truetype/freefont/FreeSans.ttf",
        "/usr/share/fonts/truetype/liberation/LiberationSans-Regular.ttf",
    ]
    
    for path in font_candidates:
        if os.path.exists(path):
            try:
                return ImageFont.truetype(path, font_size)
            except IOError:
                continue
    
    # Ultimate fallback
    return ImageFont.load_default()


def _hex_to_rgb(hex_color):
    """Convert hex color string to RGB tuple."""
    if not hex_color or not hex_color.startswith('#'):
        return (0, 0, 0)
    hex_color = hex_color.lstrip('#')
    if len(hex_color) != 6:
        return (0, 0, 0)
    return tuple(int(hex_color[i:i+2], 16) for i in (0, 2, 4))


def _sample_background_color(pil_image, x, y, w, h):
    """
    Sample the dominant background color around a text region.
    Takes pixels from the edges of the region to estimate the background.
    Returns an RGB tuple.
    """
    img_w, img_h = pil_image.size
    pixels = []
    
    # Sample pixels from a thin border around the region
    pad = 2
    x1 = max(0, x - pad)
    y1 = max(0, y - pad)
    x2 = min(img_w - 1, x + w + pad)
    y2 = min(img_h - 1, y + h + pad)
    
    # Sample top edge
    for sx in range(x1, x2, 2):
        if 0 <= y1 < img_h:
            pixels.append(pil_image.getpixel((sx, y1))[:3])
    # Sample bottom edge
    for sx in range(x1, x2, 2):
        if 0 <= y2 < img_h:
            pixels.append(pil_image.getpixel((sx, y2))[:3])
    # Sample left edge
    for sy in range(y1, y2, 2):
        if 0 <= x1 < img_w:
            pixels.append(pil_image.getpixel((x1, sy))[:3])
    # Sample right edge
    for sy in range(y1, y2, 2):
        if 0 <= x2 < img_w:
            pixels.append(pil_image.getpixel((x2, sy))[:3])
    
    if not pixels:
        return (255, 255, 255)  # Default white
    
    # Robust median sampling:
    # Instead of bright pixel thresholds (which fail on tinted documents),
    # we take all sampled pixels, sort them, and take the median.
    # We can also trim extreme values (dark text, bright noise) for better accuracy.
    pixels_arr = np.array(pixels)
    if len(pixels_arr) > 10:
        # Sort by brightness (sum of RGB)
        brightness = np.sum(pixels_arr, axis=1)
        sorted_indices = np.argsort(brightness)
        sorted_pixels = pixels_arr[sorted_indices]
        
        # Trim the darkest 20% (likely text) and brightest 5% (noise)
        low_idx = int(len(sorted_pixels) * 0.20)
        high_idx = int(len(sorted_pixels) * 0.95)
        trimmed_pixels = sorted_pixels[low_idx:high_idx]
        
        if len(trimmed_pixels) > 0:
            median_color = tuple(int(v) for v in np.median(trimmed_pixels, axis=0))
        else:
            median_color = tuple(int(v) for v in np.median(pixels_arr, axis=0))
    else:
        median_color = tuple(int(v) for v in np.median(pixels_arr, axis=0))
        
    return median_color


def process_pil_image(pil_image, edits):
    """
    Process a single PIL image: erase old text and draw new text.
    Returns a new PIL image.
    
    Each edit dict can have:
        - x, y, w, h: Position/size in OCR pixel coordinates (150 DPI)
        - text: The new text content
        - font_size: Font size in OCR pixel units
        - original_box: [x, y, w, h] of the original text region to erase
        - is_new: If True, this is user-added text (skip erasing)
        - fill_color: Hex color for text (default: #000000)
        - bg_color: Hex color for background fill behind text
        - text_align: Alignment ('left', 'center', 'right'). Default: 'left'
    """
    # Work on a copy
    pil_img_out = pil_image.copy()
    if pil_img_out.mode == 'RGBA':
        pil_img_out = pil_img_out.convert('RGB')
    
    draw = ImageDraw.Draw(pil_img_out)

    # Pass 1: Erase old text regions with background color fill
    for edit in edits:
        # Skip erasing for new user-added text
        if edit.get('is_new', False):
            continue
        
        # Determine the region to erase (original_box = old position)
        if 'original_box' in edit:
            ox, oy, ow, oh = [int(v) for v in edit['original_box']]
        else:
            ox = int(edit.get('x', 0))
            oy = int(edit.get('y', 0))
            ow = int(edit.get('w', 0))
            oh = int(edit.get('h', 0))
        
        # Determine the fill color: use provided bg_color if available, else sample
        bg_color_hex = edit.get('bg_color')
        if bg_color_hex:
            bg_sampled = _hex_to_rgb(bg_color_hex)
        else:
            bg_sampled = _sample_background_color(pil_img_out, ox, oy, ow, oh)
        
        # Erase by filling with background color (pad minimally to avoid over-erasing adjacent lines)
        pad = 1
        x1 = max(0, ox - pad)
        y1 = max(0, oy - pad)
        x2 = ox + ow + pad
        y2 = oy + oh + pad
        draw.rectangle([x1, y1, x2, y2], fill=bg_sampled)

    # Pass 2: Draw new/replacement text
    for edit in edits:
        x = int(edit.get('x', 0))
        y = int(edit.get('y', 0))
        w = int(edit.get('w', 0))
        h = int(edit.get('h', 0))
        text_content = edit.get('text', '')
        font_size = int(edit.get('font_size', 16))
        
        # Get colors
        fill_color = edit.get('fill_color', '#000000')
        bg_color = edit.get('bg_color', None)
        
        # Get font with size correction
        font_size = max(8, font_size)
        font = _get_font(font_size)
        
        # Alignment handling
        text_align = edit.get('text_align', 'left').lower()
        
        # For any modified text block, fill the target area with background first IF provided
        if bg_color and bg_color != 'transparent':
            bg_rgb = _hex_to_rgb(bg_color)
            draw.rectangle([x, y, x + w, y + h], fill=bg_rgb)
        
        # Draw the text
        text_rgb = _hex_to_rgb(fill_color)
        
        # 1. Best-Fit Font Scaling:
        # If text is too wide OR too tall for the box, reduce font size until it fits
        def check_fit(f, t, target_w, target_h):
            # getbbox returns (left, top, right, bottom)
            bbox = f.getbbox(t)
            if not bbox: return True
            tw = bbox[2] - bbox[0]
            th = bbox[3] - bbox[1]
            return tw <= target_w and th <= target_h

        while not check_fit(font, text_content, w, h) and font_size > 6:
            font_size -= 1
            font = _get_font(font_size)
            
        # 2. Alignment Anchor logic:
        # We always center vertically in the box for visual consistency
        # Precise vertical centering using bbox
        bbox = font.getbbox(text_content)
        if bbox:
            text_height = bbox[3] - bbox[1]
            # middle-middle anchor "mm" aligns the font's middle-line with our center_y
            center_y = y + (h / 2)
        else:
            center_y = y + (h / 2)
        
        if text_align == 'center':
            draw_pos = (x + (w / 2), center_y)
            anchor_point = "mm" # Middle-middle
        elif text_align == 'right':
            draw_pos = (x + w, center_y)
            anchor_point = "rm" # Right-middle
        else: # Default left
            draw_pos = (x, center_y)
            anchor_point = "lm" # Left-middle
        
        # Draw the text using the calculated anchor
        draw.text(draw_pos, text_content, fill=text_rgb, font=font, anchor=anchor_point)
        
    return pil_img_out