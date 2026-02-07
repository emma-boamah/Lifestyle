from celery import shared_task
import easyocr
from pdf2image import convert_from_path
import numpy as np
import os


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

            for bbox, text, conf in results:
                # Clean up data for JSON serialization (numpy ints/floats to python native)
                # bbox is a list of 4 points: [[x1,y1], [x2,y2], [x3,y3], [x4,y4]]
                clean_bbox = [[int(pt[0]), int(pt[1])] for pt in bbox]
                
                # Calculate bounding box rectangle from polygon points
                x_coords = [pt[0] for pt in clean_bbox]
                y_coords = [pt[1] for pt in clean_bbox]
                
                page_data['text_blocks'].append({
                    'id': f'page{i+1}_block{len(page_data["text_blocks"])}',
                    'text': text,
                    'confidence': float(conf),
                    'bbox': clean_bbox,
                    # Simplified rectangle for easier positioning
                    'rect': {
                        'x': min(x_coords),
                        'y': min(y_coords),
                        'width': max(x_coords) - min(x_coords),
                        'height': max(y_coords) - min(y_coords)
                    }
                })
            
            output['pages'].append(page_data)

        return output

    except Exception as e:
        return {'error': str(e)}
