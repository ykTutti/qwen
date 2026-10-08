import { StrictMode, useCallback, useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import { api } from './api/client';
import { ConfigProvider } from './config';
import { LogoMark } from './components/Icon';
import { PreviewPage } from './components/PreviewPage';
import type { AppConfig } from './types';
import './styles.css';

function Bootstrap() {
  const [config, setConfig] = useState<AppConfig>();
  const [error, setError] = useState('');

  const load = useCallback(() => {
    setError('');
    api.config().then(setConfig).catch((e: Error) => setError(e.message));
  }, []);

  useEffect(load, [load]);

  if (config) {
    return (
      <ConfigProvider value={config}>
        <App />
      </ConfigProvider>
    );
  }
  return (
    <div className="boot">
      <LogoMark size={40} />
      {error ? (
        <>
          <p>{error}</p>
          <button className="btn-primary" onClick={load}>重试</button>
        </>
      ) : (
        <p>加载中…</p>
      )}
    </div>
  );
}

const sharedMatch = location.pathname.match(/^\/preview\/s\/([^/]+)\/?$/);
const previewMatch = location.pathname.match(/^\/preview\/([^/]+)\/?$/);
const previewTarget = sharedMatch
  ? { share: decodeURIComponent(sharedMatch[1]) }
  : previewMatch
    ? { conversationId: decodeURIComponent(previewMatch[1]) }
    : null;

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    {previewTarget ? <PreviewPage target={previewTarget} /> : <Bootstrap />}
  </StrictMode>,
);
