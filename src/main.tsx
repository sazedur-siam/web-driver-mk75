import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import './styles.css';
import { installChunkReload } from './ui/lazyParts';
import { initPwa } from './ui/pwa';

initPwa();
installChunkReload();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
