import fitz
import os
import sys

# Test 1: Original behavior (before fix)
doc = fitz.open()
page = doc.new_page(width=500, height=500)

text = "This is a sentence i want to edit. I want to get precisely 'burn in' at the end."

# This was the problematic exact bounding box where an 'I' might drop
rect_strict = fitz.Rect(50, 50, 50 + 250, 50 + 50)  

# Test with strict bounds
page.insert_textbox(rect_strict, text + " [Strict]", fontsize=11, fontname="helv")

# This is the new bounding box with a buffer matching tasks.py
fontsize = 11
rect_buffered = fitz.Rect(50, 150, 50 + 250 + (fontsize * 0.5), 150 + 50 + (fontsize * 0.3))

page.insert_textbox(rect_buffered, text + " [Buffered]", fontsize=11, fontname="helv")

output_path = "/var/www/lifestyle/test_fitz_fix.pdf"
doc.save(output_path)
doc.close()

# Let's extract and verify the text ourselves using fitz instead of pdftotext
doc = fitz.open(output_path)
for page in doc:
    print(page.get_text())
doc.close()
