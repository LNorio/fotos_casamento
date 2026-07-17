// Chips de hashtag p/ filtrar a galeria (client-side).
export default function HashtagFilter({ tags, active, onSelect }) {
  if (!tags.length) return null;
  return (
    <div className="chips">
      <button
        className={`chip ${!active ? 'on' : ''}`}
        onClick={() => onSelect(null)}
      >
        Tudo
      </button>
      {tags.map((t) => (
        <button
          key={t}
          className={`chip ${active === t ? 'on' : ''}`}
          onClick={() => onSelect(t)}
        >
          #{t}
        </button>
      ))}
    </div>
  );
}
