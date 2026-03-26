import numpy as np
from PIL import Image, ImageDraw, ImageFont
import os
import sys

# Add backend to path
sys.path.append(os.path.join(os.getcwd(), 'backend'))

from ocr.ocr_editor_backend import process_pil_image

def test_erasure_precision():
    print("Testing erasure precision (omission fix)...")
    
    # Create an image with two lines of text very close to each other
    # Line 1 at y=50, height=20
    # Line 2 at y=75, height=20
    # Distance between blocks is 5 pixels (75 - (50+20))
    img = Image.new('RGB', (500, 200), color=(255, 255, 255))
    draw = ImageDraw.Draw(img)
    
    # Draw "Keep Me" line
    draw.text((50, 75), "Keep Me", fill=(0, 0, 0))
    
    edits = [
        {
            'x': 50, 'y': 50, 'w': 100, 'h': 20,
            'text': 'Edited',
            'font_size': 16,
            'original_box': [50, 50, 100, 20],
            'fill_color': '#000000'
        }
    ]
    
    result = process_pil_image(img, edits)
    
    # Check if "Keep Me" region (y=75) is still black
    # Sample a few pixels from the "Keep Me" text area
    found_content = False
    for py in range(75, 95):
        for px in range(50, 150):
            if result.getpixel((px, py))[:3] != (255, 255, 255):
                found_content = True
                break
        if found_content: break
        
    if found_content:
        print("✅ Erasure precision test passed: Adjacent text preserved.")
    else:
        print("❌ Erasure precision test failed: Adjacent text was erased!")
        return False
    return True

def test_font_scaling_height():
    print("\nTesting font scaling by height (overlap fix)...")
    
    img = Image.new('RGB', (500, 200), color=(255, 255, 255))
    
    # Very small box for large font size request
    edits = [
        {
            'x': 50, 'y': 50, 'w': 200, 'h': 10, # Height is only 10
            'text': 'Tall Text',
            'font_size': 40, # Requested font size is too big for h=10
            'is_new': True,
            'fill_color': '#000000'
        }
    ]
    
    result = process_pil_image(img, edits)
    
    # Verify that nothing was drawn outside the h=10 range + minimal grace
    # Check y=45 and y=65 (should be white)
    pixels_outside = 0
    for py in [40, 45, 65, 70]:
        for px in range(50, 250):
            if result.getpixel((px, py))[:3] != (255, 255, 255):
                pixels_outside += 1
                
    if pixels_outside < 10: # Allow some tiny anti-aliasing noise maybe, but not text
        print("✅ Font scaling height test passed: Text contained within box height.")
    else:
        print(f"❌ Font scaling height test failed: Text bled outside height ({pixels_outside} pixels found outside).")
        # Save image for debugging
        result.save("/tmp/fail_scaling.png")
        print("Saved failure image to /tmp/fail_scaling.png")
        return False
    return True

if __name__ == "__main__":
    success = test_erasure_precision()
    if success:
        success = test_font_scaling_height()
    
    if success:
        print("\nAll precision checks passed!")
        sys.exit(0)
    else:
        sys.exit(1)
