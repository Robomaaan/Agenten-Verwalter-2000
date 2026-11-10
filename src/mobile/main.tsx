import { StrictMode } from 'react';
import ReactDOM from 'react-dom/client';
import '@/styles/theme.css';
import '@/styles/syntax.css';
import { MobileApp } from '@/mobile/MobileApp';

const rootElement = document.getElementById('root');
if (rootElement === null) {
  throw new Error('Wurzelelement #root fehlt in mobile.html');
}

ReactDOM.createRoot(rootElement).render(
  <StrictMode>
    <MobileApp />
  </StrictMode>,
);
