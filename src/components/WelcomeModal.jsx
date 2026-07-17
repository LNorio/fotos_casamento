// Modal de boas-vindas exibida ao abrir o site: explica o app em poucas
// linhas e exige que o usuário autorize o acesso ao Google Drive antes
// de usar a câmera (sem opção de pular).
export default function WelcomeModal({ open, ready, authorizing, onAuthorize }) {
  if (!open) return null;

  return (
    <div className="welcome-overlay">
      <div className="welcome-card">
        <span className="brand-mark mono welcome-mark">◎</span>
        <h2 className="welcome-title">Bem-vindo(a) à Câmera · Galeria</h2>
        <p className="welcome-text">
          Tire fotos e vídeos direto do navegador, adicione hashtags e veja tudo
          organizado numa galeria compartilhada. As mídias são salvas
          automaticamente numa pasta do Google Drive.
        </p>
        <p className="welcome-text">
          Para continuar, autorize o acesso à pasta do Drive com sua conta
          Google.
        </p>
        <button className="welcome-btn" onClick={onAuthorize} disabled={!ready || authorizing}>
          {!ready ? 'Carregando…' : authorizing ? 'Autorizando…' : 'Entrar com o Google'}
        </button>
      </div>
    </div>
  );
}
