import { useCallback, useEffect, useRef, useState } from 'react';
import { CLIENT_ID, SCOPE } from '../config.js';

const STORAGE_KEY = 'drive_auth_token';
// Folga de segurança: trata o token como expirado um pouco antes do
// prazo real, pra nunca tentar usar um token que vence "no caminho".
const EXPIRY_SKEW_MS = 60_000;
// Dispara a renovação silenciosa esse tanto de tempo antes do vencimento.
const REFRESH_MARGIN_MS = 5 * 60_000;

function loadStoredAuth() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const { access_token, expires_at } = JSON.parse(raw);
    if (!access_token || !expires_at) return null;
    if (Date.now() > expires_at - EXPIRY_SKEW_MS) {
      localStorage.removeItem(STORAGE_KEY);
      return null;
    }
    return { access_token, expires_at };
  } catch {
    return null;
  }
}

function storeToken(access_token, expires_in) {
  const expires_at = Date.now() + expires_in * 1000;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ access_token, expires_at }));
  } catch {
    // localStorage indisponível (ex.: modo privado) — segue sem persistir.
  }
  return expires_at;
}

// Dá ao app acesso à pasta compartilhada do Drive, sem exigir que os
// usuários façam login em nenhuma conta. O token concedido é guardado no
// localStorage (com seu prazo de validade) para que, enquanto continuar
// válido, o app reabra já autorizado — sem mostrar a tela de boas-vindas
// nem pedir autorização de novo. Um pouco antes de vencer, o token é
// renovado sozinho em segundo plano (prompt: 'none' funciona sem abrir
// aba/popup quando já há consentimento concedido). Quando não há token
// salvo válido, o acesso só é pedido a partir de um gesto do usuário
// (clique no botão de autorizar ou no obturador), via ensureToken() —
// nunca automaticamente ao carregar a página, pois isso abre uma
// aba/popup do Google que falha sem sessão salva.
// Retorna { token, ensureToken }.
export function useDriveAuth() {
  const initialAuthRef = useRef(undefined);
  if (initialAuthRef.current === undefined) {
    initialAuthRef.current = loadStoredAuth();
  }

  const [token, setToken] = useState(initialAuthRef.current?.access_token ?? null);
  const [ready, setReady] = useState(false);
  const [authorizing, setAuthorizing] = useState(false);
  const tokenRef = useRef(null);
  const tokenClientRef = useRef(null);
  const pendingRef = useRef([]);
  const expiresAtRef = useRef(initialAuthRef.current?.expires_at ?? null);

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
            expiresAtRef.current = storeToken(resp.access_token, resp.expires_in);
            setToken(resp.access_token);
            resolvers.forEach((r) => r(resp.access_token));
          },
          // Dispara quando o usuário fecha a aba/popup de login sem concluir
          // (ou o navegador bloqueia o popup): sem isso, o callback normal
          // nunca roda e o botão "Entrar" fica travado em "Autorizando…".
          error_callback: (err) => {
            console.error('Login com o Google cancelado ou falhou:', err);
            setAuthorizing(false);
            const resolvers = pendingRef.current;
            pendingRef.current = [];
            resolvers.forEach((r) => r(null));
          },
        });
        setReady(true);
      } else {
        setTimeout(tick, 150);
      }
    };
    tick();
    return () => {
      cancelled = true;
    };
  }, []);

  // Renova o token em segundo plano pouco antes dele vencer, sem exigir
  // nenhuma ação do usuário. Reagenda a si mesmo a cada renovação bem-
  // sucedida, já que ela atualiza expiresAtRef e muda `token`.
  useEffect(() => {
    if (!ready || !token || !expiresAtRef.current) return;
    const delay = Math.max(expiresAtRef.current - REFRESH_MARGIN_MS - Date.now(), 0);
    const timer = setTimeout(() => {
      tokenClientRef.current?.requestAccessToken({ prompt: 'none' });
    }, delay);
    return () => clearTimeout(timer);
  }, [ready, token]);

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
