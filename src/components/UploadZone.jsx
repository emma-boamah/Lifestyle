import { useState } from 'react';
import { Cloud, Upload, Loader } from 'lucide-react';
import { useNavigate } from 'react-router-dom';

export default function UploadZone() {
    const [isDragging, setIsDragging] = useState(false);
    const [isUploading, setIsUploading] = useState(false);
    const navigate = useNavigate();

    const handleDragOver = (e) => {
        e.preventDefault();
        setIsDragging(true);
    };

    const handleDragLeave = () => {
        setIsDragging(false);
    };

    const handleDrop = (e) => {
        e.preventDefault();
        setIsDragging(false);

        const files = e.dataTransfer.files;
        if (files.length > 0) {
            handleFileUpload(files[0]);
        }
    };

    const handleFileSelect = (e) => {
        const files = e.target.files;
        if (files.length > 0) {
            handleFileUpload(files[0]);
        }
    };

    const handleFileUpload = async (file) => {
        // Validate file type
        if (file.type === 'application/pdf') {
            setIsUploading(true);
            console.log('Uploading:', file.name);

            try {
                // Create FormData for file upload
                const formData = new FormData();
                formData.append('file', file);

                // POST to Django backend
                const response = await fetch('/api/upload/', {
                    method: 'POST',
                    body: formData,
                });

                console.log('Upload response status:', response.status);
                const contentType = response.headers.get('content-type');
                console.log('Upload response content-type:', contentType);

                if (!response.ok) {
                    const text = await response.text();
                    console.error('Upload error response:', text);
                    try {
                        const error = JSON.parse(text);
                        throw new Error(error.error || 'Upload failed');
                    } catch (e) {
                        throw new Error(`Upload failed with status ${response.status}`);
                    }
                }

                const data = await response.json();

                setIsUploading(false);
                navigate('/editor', {
                    state: {
                        fileName: data.file_name,
                        fileUrl: data.file_url,
                        taskId: data.task_id
                    }
                });
            } catch (error) {
                console.error('Upload error:', error);
                setIsUploading(false);
                alert('Upload failed: ' + error.message);
            }
        } else {
            alert('Please upload a PDF file');
        }
    };

    return (
        <div className="upload-section">
            <h1>Edit your PDFs with ease</h1>
            <p>Professional tools for image-heavy documents.</p>

            <div
                className={`upload-zone ${isDragging ? 'drag-over' : ''}`}
                onDragOver={handleDragOver}
                onDragLeave={handleDragLeave}
                onDrop={handleDrop}
                onClick={() => document.getElementById('file-input').click()}
            >
                <Cloud className="upload-icon" size={64} />
                <div className="upload-text">Drag and drop your files here</div>
                <div className="upload-subtext">Optimized for fast processing of image-heavy PDF files</div>

                <button className="btn btn-primary" style={{ marginTop: '1rem' }} disabled={isUploading}>
                    {isUploading ? <Loader size={20} /> : <Upload size={20} />}
                    {isUploading ? 'Uploading...' : 'Select PDF File'}
                </button>

                <div className="upload-limit">Supported formats: pdf, Max 500MB</div>

                <input
                    id="file-input"
                    type="file"
                    accept=".pdf"
                    onChange={handleFileSelect}
                    style={{ display: 'none' }}
                />
            </div>
        </div>
    );
}
