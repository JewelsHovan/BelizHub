import { SRC } from '../data/sources.js';

export default function Sources({ keys, label = 'Sources' }) {
  const list = (keys || Object.keys(SRC)).map((k) => SRC[k]).filter(Boolean);
  return (
    <ul className="sources">
      <li>{label}</li>
      {list.map((s) => (
        <li key={s.u}>
          <a href={s.u} target="_blank" rel="noopener noreferrer">{s.t}</a>
        </li>
      ))}
    </ul>
  );
}
