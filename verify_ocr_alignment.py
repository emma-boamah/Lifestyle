import os
import sys
import fitz  # PyMuPDF

# Add backend to path
sys.path.append(os.path.join(os.getcwd(), 'backend'))

from ocr.tasks import detect_style_in_rect

def test_detect_style_in_rect():
    print("Testing detect_style_in_rect...")
    
    # Mock Page
    class MockPage:
        def __init__(self):
            self.rect = fitz.Rect(0, 0, 500, 500)
        
        def get_text(self, mode, clip=None):
            if mode == "dict":
                return {
                    "blocks": [
                        {
                            "type": 0,
                            "lines": [
                                {
                                    "spans": [
                                        {
                                            "text": "Correct Style",
                                            "bbox": (50, 50, 150, 70),
                                            "size": 18.5,
                                            "color": 16711680, # Red in some conversion? fitz uses int.
                                            "font": "Helvetica-Bold"
                                        }
                                    ]
                                }
                            ]
                        }
                    ]
                }
            return {}

    page = MockPage()
    rect = fitz.Rect(40, 40, 160, 80) # Overlapping rect
    
    bg, fg, font_size = detect_style_in_rect(page, rect)
    
    print(f"Results: BG={bg}, FG={fg}, Font_Size={font_size}")
    
    # Check if font size was captured
    assert font_size == 18.5, f"Expected 18.5, got {font_size}"
    # Check if FG was captured (16711680 is 0xFF0000 -> Red)
    # fitz.sRGB_to_pdf(16711680) -> (1, 0, 0)
    assert fg == (1, 0, 0), f"Expected (1, 0, 0), got {fg}"
    
    print("✅ detect_style_in_rect test passed!")

def test_span_matching_logic():
    print("\nTesting span matching logic (conceptual)...")
    # This part tests the logic imported from tasks.py if we could isolate it, 
    # but since it's inside ocr_process_pdf, we will just verify detect_style_in_rect for now
    # as it's the core of the refinement.
    print("Note: Span matching is integrated in ocr_process_pdf.")

if __name__ == "__main__":
    try:
        test_detect_style_in_rect()
        print("\nAll automated tests passed!")
    except Exception as e:
        print(f"\n❌ Test failed: {e}")
        sys.exit(1)
