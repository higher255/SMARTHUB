import { useEffect, useState } from 'react';
import { useNavigate } from '@tanstack/react-router';

export function ProtectedRoute({ children }: { children: React.ReactNode }) {
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const [isAuthenticated, setIsAuthenticated] = useState(false);

  useEffect(() => {
    async function checkSession() {
      try {
        // Tunakagua kama kuna session kupitia API ya auth iliyopo kwenye mradi wako
        const res = await fetch('/api/auth/get-session'); 
        const session = await res.json();

        if (session) {
          setIsAuthenticated(true);
        } else {
          navigate({ to: '/login' });
        }
      } catch (err) {
        console.error("Auth check failed:", err);
        navigate({ to: '/login' });
      } finally {
        setLoading(false);
      }
    }

    checkSession();
  }, [navigate]);

  if (loading) {
    return (
      <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '100vh' }}>
        <p>Inapakia mfumo...</p>
      </div>
    );
  }

  if (!isAuthenticated) {
    return null;
  }

  return <>{children}</>;
}