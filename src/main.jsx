import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.jsx'

console.log('Main.jsx: Initializing React app...');
const container = document.getElementById('root');
console.log('Main.jsx: Container element:', container);

if (container) {
  const root = createRoot(container);
  root.render(
    <StrictMode>
      <App />
    </StrictMode>,
  );
  console.log('Main.jsx: Render called');
} else {
  console.error('Main.jsx: Root container NOT FOUND!');
}
