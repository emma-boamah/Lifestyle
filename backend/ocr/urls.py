from django.urls import path
from . import views

urlpatterns = [
    path('upload/', views.upload_pdf, name='upload_pdf'),
    path('tasks/<str:task_id>/status/', views.task_status, name='task_status'),
    path('save/', views.save_pdf_edits, name='save_pdf_edits'),
]
