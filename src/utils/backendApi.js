/**
 * Saves PDF changes to the backend.
 * 
 * @param {string} serverFilename - The filename on the server (from upload response)
 * @param {Array} changes - Array of change objects (page, x, y, w, h, text, etc.)
 * @returns {Promise<string>} - The task ID
 */
export async function savePdfChanges(serverFilename, changes) {
    const response = await fetch('/api/save/', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
        },
        body: JSON.stringify({
            filename: serverFilename,
            changes: changes
        })
    });

    if (!response.ok) {
        const text = await response.text();
        try {
            const err = JSON.parse(text);
            throw new Error(err.error || 'Save failed');
        } catch (e) {
            throw new Error(`Save failed with status ${response.status}`);
        }
    }

    const data = await response.json();
    return data.task_id;
}

/**
 * Polls a task status until it completes or fails.
 * 
 * @param {string} taskId - The ID of the task to poll
 * @param {Function} onProgress - Optional callback for progress updates
 * @returns {Promise<Object>} - The final result (e.g. { output_path: ... })
 */
export async function pollTaskStatus(taskId, onProgress) {
    const maxAttempts = 300; // 10 minutes (2s interval)
    let attempts = 0;

    return new Promise((resolve, reject) => {
        const intervalId = setInterval(async () => {
            attempts++;
            try {
                const response = await fetch(`/api/tasks/${taskId}/status/`);
                if (!response.ok) throw new Error('Failed to fetch status');

                const data = await response.json();

                if (data.state === 'SUCCESS') {
                    clearInterval(intervalId);
                    if (data.result && !data.result.error) {
                        resolve(data.result);
                    } else {
                        reject(new Error(data.result?.error || 'Task failed'));
                    }
                } else if (data.state === 'FAILURE') {
                    clearInterval(intervalId);
                    reject(new Error(data.error || 'Task failed'));
                } else if (data.state === 'PROCESSING') {
                    if (onProgress && data.meta) {
                        onProgress(data.meta.status);
                    }
                }

                if (attempts >= maxAttempts) {
                    clearInterval(intervalId);
                    reject(new Error('Task timed out'));
                }

            } catch (err) {
                // Network errors are ignored to keep polling, but infinite errors will eventually timeout
                console.warn('Polling error:', err);
            }
        }, 2000);
    });
}
