import { useState } from 'react';
import { QUIZ } from '../data/quiz.js';
import Sources from './Sources.jsx';
import Videos from './Videos.jsx';
import Rich from './Rich.jsx';
import { useLocalState } from '../hooks/useLocalState.js';
import s from './Review.module.css';

export default function Review() {
  const [answers, setAnswers] = useLocalState('quiz', {});
  const [showAll, setShowAll] = useState(false);
  const answered = Object.keys(answers).length;
  const score = Object.entries(answers).filter(([i, j]) => QUIZ[i] && QUIZ[i].a === j).length;
  return (
    <>
      <h1>Check what stuck.</h1>
      <p className="lede">Ten questions, each with the reasoning. Then every video and every source, for going deeper.</p>
      <div className="stat">
        {answered ? <span><b>{score}</b> of {answered} correct{answered === QUIZ.length ? ', all done' : ''}</span> : <span>Pick an answer to see the reasoning. Your answers are saved on this device.</span>}
        {answered > 0 && <button className="btn small" onClick={() => setAnswers({})}>Start over</button>}
      </div>
      <div>
        {QUIZ.map((q, i) => {
          const picked = answers[i];
          const done = picked !== undefined;
          return (
            <div className={s.q} key={i}>
              <div className={s.qt}>{i + 1}. {q.q}</div>
              <div className={s.opts}>
                {q.o.map((o, j) => {
                  const cls = done ? (j === q.a ? s.right : j === picked ? s.wrong : '') : '';
                  return <button key={j} className={cls} disabled={done} onClick={() => setAnswers((a) => ({ ...a, [i]: j }))}>{o}</button>;
                })}
              </div>
              {done && <Rich as="div" className={s.expl} text={q.e} />}
            </div>
          );
        })}
      </div>
      <h2>All videos</h2>
      <p className="note">Every video was checked against YouTube before it was listed. Thumbnails load from YouTube; nothing plays until you press play.</p>
      <Videos label="From RNA to the analysed result" />
      <h2>All sources</h2>
      <p className="note">Manufacturer pages and guides for practical values; primary papers for mechanism, history and the analysis methods; MIQE for what a reported experiment must include. DOI links resolve through doi.org.</p>
      <button className="btn small" onClick={() => setShowAll((v) => !v)} aria-expanded={showAll}>{showAll ? 'Hide the list' : 'Show all sources'}</button>
      {showAll && <Sources label="All sources" />}
    </>
  );
}
