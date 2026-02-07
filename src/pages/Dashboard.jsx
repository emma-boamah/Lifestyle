import Header from '../components/Header';
import UploadZone from '../components/UploadZone';
import RecentFiles from '../components/RecentFiles';

export default function Dashboard() {
    return (
        <div className="fade-in">
            <Header />

            <div className="container">
                <UploadZone />
                <RecentFiles />
            </div>

            <footer className="footer">
                <div className="container">
                    <div className="footer-content">
                        <div>© 2024 PDFEdit. All rights reserved.</div>
                        <div className="footer-links">
                            <a href="#" className="footer-link">Privacy Policy</a>
                            <a href="#" className="footer-link">Terms of Service</a>
                            <a href="#" className="footer-link">Help Center</a>
                        </div>
                    </div>
                </div>
            </footer>
        </div>
    );
}
