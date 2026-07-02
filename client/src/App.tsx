import { useEffect, useState } from 'react';
import type { AuthState } from './auth/auth';
import { loadAuth, saveAuth } from './auth/auth';
import { AuthPanel } from './auth/AuthPanel';
import { CreateRequestPage } from './pages/CreateRequestPage';
import { RequestDetailPage } from './pages/RequestDetailPage';
import { RequestListPage } from './pages/RequestListPage';

function useHashRoute(): string {
  const [hash, setHash] = useState(window.location.hash);
  useEffect(() => {
    const onChange = () => setHash(window.location.hash);
    window.addEventListener('hashchange', onChange);
    return () => window.removeEventListener('hashchange', onChange);
  }, []);
  return hash.replace(/^#/, '') || '/';
}

export default function App() {
  const [auth, setAuth] = useState<AuthState>(loadAuth);
  const route = useHashRoute();

  function applyAuth(next: AuthState) {
    saveAuth(next);
    setAuth(next);
  }

  const detailMatch = /^\/requests\/([0-9a-f-]{36})$/i.exec(route);
  let page: React.ReactNode;
  if (route === '/create') {
    page = <CreateRequestPage auth={auth} />;
  } else if (detailMatch) {
    page = <RequestDetailPage auth={auth} requestId={detailMatch[1]} />;
  } else {
    page = <RequestListPage auth={auth} />;
  }

  return (
    <>
      <header className="app-header">
        <a className="app-title" href="#/">
          Согласование контента
        </a>
        <AuthPanel auth={auth} onChange={applyAuth} />
      </header>
      <main>{page}</main>
    </>
  );
}
