import os
from django.http import JsonResponse
from django.views.decorators.csrf import csrf_exempt
from django.conf import settings
from celery.result import AsyncResult
from .tasks import ocr_process_pdf


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
            'file_url': file_url,
            'file_name': uploaded_file.name
        })
    
    return JsonResponse({'error': 'Invalid request. POST with file required.'}, status=400)


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
