import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { App } from './App';
import { SessionProvider } from './auth/session';
import { LanguageProvider } from './i18n';
import { applyTheme, readTheme } from './theme';
import '@fontsource/ibm-plex-sans/400.css';
import '@fontsource/ibm-plex-sans/600.css';
import '@fontsource/ibm-plex-mono/400.css';
import '@fontsource/ibm-plex-mono/600.css';
import '@fontsource/barlow-condensed/600.css';
import './tokens.css';
import './styles.css';

applyTheme(readTheme());

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BrowserRouter>
      <LanguageProvider>
        <SessionProvider>
          <App />
        </SessionProvider>
      </LanguageProvider>
    </BrowserRouter>
  </StrictMode>,
);
