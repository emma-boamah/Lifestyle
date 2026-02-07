import { FileText } from 'lucide-react';
import { Link } from 'react-router-dom';

export default function Header() {
    return (
        <header className="header">
            <div className="container">
                <div className="header-content">
                    <Link to="/" className="logo">
                        <FileText className="logo-icon" size={28} />
                        <span>PDFEdit</span>
                    </Link>

                    <nav className="nav">
                        <Link to="/" className="nav-link">Home</Link>
                        <a href="#tools" className="nav-link">Tools</a>
                        <a href="#pricing" className="nav-link">Pricing</a>
                        <button className="btn btn-primary">Sign In</button>
                    </nav>
                </div>
            </div>
        </header>
    );
}
