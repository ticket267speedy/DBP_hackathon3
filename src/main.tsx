import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router';
import App from './App';
import { AuthProvider } from './auth/AuthProvider';
import { HealthGate } from './health/HealthGate';
import './index.css';

const container = document.getElementById('root');
if (!container) throw new Error('No se encontró #root en index.html');

createRoot(container).render(
  <StrictMode>
    <BrowserRouter>
      <HealthGate>
        <AuthProvider>
          <App />
        </AuthProvider>
      </HealthGate>
    </BrowserRouter>
  </StrictMode>,
);
