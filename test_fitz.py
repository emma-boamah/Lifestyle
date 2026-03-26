import fitz
import os

doc = fitz.open()
page = doc.new_page(width=500, height=500)

text = "This is a sentence i want to edit. I want to get precisely 'burn in' at the end."
rect = fitz.Rect(50, 50, 50 + 250, 50 + 50)  # Width 250, Height 50

# Test insert_textbox with constraints that might drop a word
page.insert_textbox(rect, text, fontsize=11, fontname="helv")

doc.save("/var/www/lifestyle/test_fitz.pdf")
doc.close()

import subprocess
subprocess.run(['pdftotext', '/var/www/lifestyle/test_fitz.pdf', '/var/www/lifestyle/test_fitz.txt'])
with open('/var/www/lifestyle/test_fitz.txt', 'r') as f:
    print(f.read())
