import { Clock, ChevronRight } from 'lucide-react';
import { Link } from 'react-router-dom';

export default function RecentFiles() {
    const recentFiles = [
        {
            id: 1,
            name: 'Architecture_Portfolio...',
            timestamp: 'Edited 2 hours ago',
            color: '#F5D5C8',
            thumbnail: '/placeholder-arch.png'
        },
        {
            id: 2,
            name: 'Project_Manual_Final...',
            timestamp: 'Edited yesterday',
            color: '#E8B77D',
            thumbnail: '/placeholder-manual.png'
        },
        {
            id: 3,
            name: 'Marketing_Deck_v2.pdf',
            timestamp: 'Edited 3 days ago',
            color: '#5A7A7A',
            thumbnail: '/placeholder-marketing.png'
        },
        {
            id: 4,
            name: 'Client_Proposal_Draft...',
            timestamp: 'Edited Oct 12',
            color: '#F5C5B8',
            thumbnail: '/placeholder-proposal.png'
        }
    ];

    return (
        <div className="recent-files">
            <div className="recent-files-header">
                <h2>Recent Files</h2>
                <a href="#" className="view-all">
                    View all
                    <ChevronRight size={16} />
                </a>
            </div>

            <div className="files-grid">
                {recentFiles.map((file) => (
                    <Link to="/editor" key={file.id} className="file-card">
                        <div className="file-thumbnail" style={{ backgroundColor: file.color }}>
                            <div style={{
                                width: '80%',
                                height: '90%',
                                background: 'white',
                                borderRadius: '4px',
                                boxShadow: '0 4px 12px rgba(0,0,0,0.15)',
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'center',
                                fontSize: '12px',
                                color: '#999',
                                padding: '1rem'
                            }}>
                                PDF Preview
                            </div>
                        </div>
                        <div className="file-info">
                            <div className="file-name">{file.name}</div>
                            <div className="file-meta">
                                <Clock size={14} />
                                <span>{file.timestamp}</span>
                            </div>
                        </div>
                    </Link>
                ))}
            </div>
        </div>
    );
}
