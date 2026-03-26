import os
import json
from django.http import JsonResponse
from django.views.decorators.csrf import csrf_exempt
from django.conf import settings
from celery.result import AsyncResult
from .tasks import ocr_process_pdf, apply_pdf_changes, ocr_targeted_crop


@csrf_exempt
def upload_pdf(request):
    """
    Handle PDF file upload and trigger OCR processing.
    
    POST /api/upload/
    - Accepts multipart form data with 'file' field
    - Returns JSON with task_id for polling
    """
    if request.method == 'POST' and request.FILES.get('file'):
        uploaded_file = request.FILES['file']
        
        # Validate file type
        if not uploaded_file.name.lower().endswith('.pdf'):
            return JsonResponse({'error': 'Only PDF files are allowed'}, status=400)
        
        # Save file to uploads directory
        file_name = f"{os.urandom(8).hex()}_{uploaded_file.name}"
        file_path = os.path.join(settings.MEDIA_ROOT, 'uploads', file_name)
        
        # Ensure directory exists
        os.makedirs(os.path.dirname(file_path), exist_ok=True)
        
        # Write file to disk
        with open(file_path, 'wb+') as destination:
            for chunk in uploaded_file.chunks():
                destination.write(chunk)
        
        # Trigger Celery task
        task = ocr_process_pdf.delay(file_path)
        
        # Return task ID and file URL for immediate preview
        file_url = f"{settings.MEDIA_URL}uploads/{file_name}"
        
        return JsonResponse({
            'task_id': task.id,
            'server_filename': file_name, # Frontend needs this to save later
            'file_url': file_url,
            'file_name': uploaded_file.name
        })
    
    return JsonResponse({'error': 'Invalid request. POST with file required.'}, status=400)


@csrf_exempt
def save_pdf_edits(request):
    """
    Apply edits to a previously uploaded PDF.
    
    POST /api/save/
    Body: {
        "filename": "server_filename_from_upload.pdf",
        "changes": [{ "page": 1, "x": 10, "y": 10, "w": 100, "h": 20, "text": "New Text" }]
    }
    """
    if request.method == 'POST':
        try:
            data = json.loads(request.body)
            filename = data.get('filename')
            changes = data.get('changes', [])
            
            if not filename or not changes:
                return JsonResponse({'error': 'Missing filename or changes'}, status=400)

            file_path = os.path.join(settings.MEDIA_ROOT, 'uploads', filename)
            
            # Trigger the modification task
            task = apply_pdf_changes.delay(file_path, changes)
            
            return JsonResponse({'task_id': task.id})
            
        except json.JSONDecodeError:
            return JsonResponse({'error': 'Invalid JSON'}, status=400)
            
    return JsonResponse({'error': 'POST required'}, status=405)


def task_status(request, task_id):
    """
    Poll this endpoint to check the status of an OCR Celery task.
    
    GET /api/tasks/<task_id>/status/
    
    Returns:
        - state: 'PENDING', 'PROCESSING', 'SUCCESS', or 'FAILURE'
        - result: OCR data when state is SUCCESS
        - meta: Progress info when state is PROCESSING
    """
    task_result = AsyncResult(task_id)
    
    response = {
        'state': task_result.state,
        'task_id': task_id,
    }

    if task_result.state == 'PENDING':
        response['meta'] = {'status': 'Task is waiting to be processed...'}
    elif task_result.state == 'PROCESSING':
        response['meta'] = task_result.info if task_result.info else {'status': 'Processing...'}
    elif task_result.state == 'SUCCESS':
        # task_result.result contains the return value of the Celery task (the OCR data)
        response['result'] = task_result.result
    elif task_result.state == 'FAILURE':
        response['error'] = str(task_result.result)
        
    return JsonResponse(response)


@csrf_exempt
def targeted_ocr(request):
    """
    Perform OCR on a specific rectangular area of a PDF page.
    
    POST /api/ocr/targeted/
    Body: {
        "filename": "server_filename.pdf",
        "page": 1,
        "rect": {"x": 10, "y": 10, "w": 100, "h": 20}
    }
    """
    if request.method == 'POST':
        try:
            data = json.loads(request.body)
            filename = data.get('filename')
            page_num = data.get('page')
            rect = data.get('rect')
            
            if not all([filename, page_num, rect]):
                return JsonResponse({'error': 'Missing filename, page, or rect'}, status=400)

            file_path = os.path.join(settings.MEDIA_ROOT, 'uploads', filename)
            
            if not os.path.exists(file_path):
                return JsonResponse({'error': 'File not found'}, status=404)

            # Trigger the targeted OCR task
            task = ocr_targeted_crop.delay(file_path, page_num, rect)
            
            return JsonResponse({'task_id': task.id})
            
        except json.JSONDecodeError:
            return JsonResponse({'error': 'Invalid JSON'}, status=400)
            
    return JsonResponse({'error': 'POST required'}, status=405)


@csrf_exempt
def preview_pdf_edits(request):
    """
    Renders a live preview of edits for a single page and returns base64 image.
    
    POST /api/preview/
    """
    import base64
    import fitz
    if request.method == 'POST':
        try:
            data = json.loads(request.body)
            filename = data.get('filename')
            changes = data.get('changes', [])
            page_num = data.get('page', 1)
            
            if not filename:
                return JsonResponse({'error': 'Missing filename'}, status=400)

            file_path = os.path.join(settings.MEDIA_ROOT, 'uploads', filename)
            if not os.path.exists(file_path):
                return JsonResponse({'error': 'File not found'}, status=404)
                
            doc = fitz.open(file_path)
            p_idx = page_num - 1
            if p_idx >= len(doc):
                doc.close()
                return JsonResponse({'error': 'Invalid page number'}, status=400)
                
            page = doc[p_idx]
            
            # Apply edits to this page only
            page_changes = [c for c in changes if c.get('page', 1) - 1 == p_idx]
            
            # --- Start apply edits logic ---
            font_path = os.path.join(os.path.dirname(os.path.dirname(__file__)), 'assets/fonts/Inter-Regular.ttf')
            has_custom_font = os.path.exists(font_path)
            if has_custom_font:
                page.insert_font(fontname="inter", fontfile=font_path)

            pdf_w = page.rect.width
            pdf_h = page.rect.height
            x0 = page.rect.x0
            y0 = page.rect.y0

            # Pass A: Redaction
            for change in page_changes:
                if change.get('is_new'): continue
                orig_box_pct = change.get('original_box_percent')
                if orig_box_pct and len(orig_box_pct) == 4:
                    ox = x0 + (orig_box_pct[0] * pdf_w) - 2
                    oy = y0 + (orig_box_pct[1] * pdf_h) - 2
                    ow = (orig_box_pct[2] * pdf_w) + 4
                    oh = (orig_box_pct[3] * pdf_h) + 4
                    bg_color_hex = change.get('bg_color')
                    if bg_color_hex and bg_color_hex != 'transparent':
                        bg_hex = bg_color_hex.lstrip('#')
                        bg_rgb = tuple(int(bg_hex[i:i+2], 16)/255.0 for i in (0, 2, 4))
                    else:
                        bg_rgb = (1, 1, 1)
                    rect = fitz.Rect(ox, oy, ox + ow, oy + oh)
                    page.add_redact_annot(rect, fill=bg_rgb)
            
            page.apply_redactions()

            # Pass B: Insert new text
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
                if change.get('is_new') and bg_color_hex and bg_color_hex != 'transparent':
                    bg_hex = bg_color_hex.lstrip('#')
                    bg_rgb = tuple(int(bg_hex[i:i+2], 16)/255.0 for i in (0, 2, 4))
                    rect = fitz.Rect(tx, ty, tx + tw, ty + th)
                    page.draw_rect(rect, color=None, fill=bg_rgb)
                
                align_str = change.get('text_align', 'left').lower()
                align = fitz.TEXT_ALIGN_LEFT
                if align_str == 'center': align = fitz.TEXT_ALIGN_CENTER
                elif align_str == 'right': align = fitz.TEXT_ALIGN_RIGHT
                
                is_paragraph = "\n" in text_content or len(text_content) > 60
                font_kwargs = {}
                if has_custom_font: font_kwargs['fontname'] = "inter"
                else: font_kwargs['fontname'] = "helv"

                if not is_paragraph:
                    page.insert_text((tx, ty + (target_fontsize * 0.8)), text_content, fontsize=target_fontsize, color=fg_rgb, **font_kwargs)
                else:
                    target_rect = fitz.Rect(tx - 2, ty - (target_fontsize * 0.1), tx + tw + 4, ty + th + (target_fontsize * 0.4))
                    page.insert_textbox(target_rect, text_content, fontsize=target_fontsize, color=fg_rgb, align=align, **font_kwargs)
            # --- End apply edits logic ---
            
            # Render to image
            pix = page.get_pixmap(matrix=fitz.Matrix(2, 2))
            img_bytes = pix.tobytes("png")
            img_base64 = base64.b64encode(img_bytes).decode('utf-8')
            
            doc.close()
            return JsonResponse({'image': f"data:image/png;base64,{img_base64}"})
            
        except Exception as e:
            import traceback
            return JsonResponse({'error': str(e), 'traceback': traceback.format_exc()}, status=500)
            
    return JsonResponse({'error': 'POST required'}, status=405)
