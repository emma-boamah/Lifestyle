import { useState } from 'react';
import { Plus } from 'lucide-react';

export default function Sidebar() {
    const [activePage, setActivePage] = useState(1);

    const pages = [
        { id: 1, thumbnail: '/page1-thumb.png' },
        { id: 2, thumbnail: '/page2-thumb.png' }
    ];

    return (
        <div className="editor-sidebar">
            <div className="sidebar-title">Document Pages</div>

            <div className="page-thumbnails">
                {pages.map((page) => (
                    <div
                        key={page.id}
                        className={`page-thumb ${activePage === page.id ? 'active' : ''}`}
                        onClick={() => setActivePage(page.id)}
                    >
                        <div style={{
                            width: '100%',
                            aspectRatio: '3/4',
                            background: 'white',
                            borderRadius: '4px',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            fontSize: '10px',
                            color: '#999'
                        }}>
                            Page {page.id}
                        </div>
                        <div className="page-number">Page {page.id}</div>
                    </div>
                ))}

                <button className="add-page-btn">
                    <Plus size={16} />
                </button>
            </div>
        </div>
    );
}
