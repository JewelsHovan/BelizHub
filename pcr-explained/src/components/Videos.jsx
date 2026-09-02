import { useState } from 'react';
import { VIDEOS } from '../data/videos.js';
import s from './Videos.module.css';

function Card({ v }) {
  const [playing, setPlaying] = useState(false);
  const url = `https://www.youtube.com/watch?v=${v.id}`;
  return (
    <li className={s.card}>
      {playing ? (
        <div className={s.frame}>
          <iframe src={`https://www.youtube-nocookie.com/embed/${v.id}?autoplay=1&rel=0`} title={v.title} allow="autoplay; encrypted-media; picture-in-picture" allowFullScreen loading="lazy" />
        </div>
      ) : (
        <button type="button" className={s.thumb} onClick={() => setPlaying(true)} aria-label={`Play: ${v.title}`}>
          <img src={`https://i.ytimg.com/vi/${v.id}/mqdefault.jpg`} alt="" loading="lazy" />
          <span className={s.play} aria-hidden="true">▶</span>
        </button>
      )}
      <div className={s.meta}>
        <a className={s.title} href={url} target="_blank" rel="noopener noreferrer">{v.title}</a>
        <div className={s.by}>{v.channel}{v.minutes ? ` · ${v.minutes} min` : ''}</div>
        <p className={s.shows}>{v.shows}</p>
      </div>
    </li>
  );
}

/** Verified YouTube videos, filtered by topic tags. Thumbnails only until the viewer chooses to play. */
export default function Videos({ topics, label = 'Watch the steps' }) {
  const list = topics ? VIDEOS.filter((v) => v.topics.some((t) => topics.includes(t))) : VIDEOS;
  if (!list.length) return null;
  return (
    <section className={s.wrap} aria-label={label}>
      <h3 className={s.h}>{label}</h3>
      <ul className={s.list}>{list.map((v) => <Card key={v.id} v={v} />)}</ul>
    </section>
  );
}
