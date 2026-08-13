// Texto digitado (separado por espaço/vírgula, com ou sem #) -> array limpo.
export function parseHashtags(text) {
  return (text || '')
    .split(/[\s,]+/)
    .map((t) => t.replace(/^#/, '').trim().toLowerCase())
    .filter(Boolean);
}
