import { useCallback, useEffect, useRef, useState } from 'react';
import { CLIENT_ID, SCOPE } from '../config.js';

// Dá ao app acesso à pasta compartilhada do Drive, sem exigir que os
// usuários façam login em nenhuma conta. O token é obtido em segundo
// plano (silencioso) assim que o app carrega; se ainda não houver
// consentimento salvo no navegador, ensureToken() pede o acesso a
// partir de um gesto do usuário (ex.: o próprio clique no obturador).
// Retorna { token, ensureToken }.
export function useDriveAuth() {
  const [token, setToken] = useState(null);
  const [ready, setReady] = useState(false);
  const [authorizing, setAuthorizing] = useState(false);
  const tokenRef = useRef(null);
  const tokenClientRef = useRef(null);
  const pendingRef = useRef([]);

  useEffect(() => {
    tokenRef.current = token;
  }, [token]);

  useEffect(() => {
    let cancelled = false;
    const tick = () => {
      if (cancelled) return;
      if (window.google?.accounts?.oauth2) {
        tokenClientRef.current = window.google.accounts.oauth2.initTokenClient({
          client_id: CLIENT_ID,
          scope: SCOPE,
          callback: (resp) => {
            setAuthorizing(false);
            const resolvers = pendingRef.current;
            pendingRef.current = [];
            if (resp.error) {
              console.error('Falha ao acessar a pasta do Drive:', resp);
              resolvers.forEach((r) => r(null));
              return;
            }
            setToken(resp.access_token);
            resolvers.forEach((r) => r(resp.access_token));
          },
        });
        setReady(true);
        // Tenta liberar o acesso sem interromper o usuário com nenhuma tela.
        tokenClientRef.current.requestAccessToken({ prompt: 'none' });
      } else {
        setTimeout(tick, 150);
      }
    };
    tick();
    return () => {
      cancelled = true;
    };
  }, []);

  // Garante um token válido, pedindo acesso caso ainda não exista.
  // Deve ser chamado a partir de um gesto do usuário (clique) para que,
  // se necessário, o navegador permita abrir o popup de permissão — por
  // isso a tela mostra um botão de autorizar assim que a página carrega,
  // em vez de esperar a primeira captura.
  const ensureToken = useCallback(() => {
    if (tokenRef.current) return Promise.resolve(tokenRef.current);
    const client = tokenClientRef.current;
    if (!client) return Promise.resolve(null);
    return new Promise((resolve) => {
      pendingRef.current.push(resolve);
      setAuthorizing(true);
      client.requestAccessToken({ prompt: '' });
    });
  }, []);

  return { token, ready, authorizing, ensureToken };
}
