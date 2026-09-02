import { useState } from 'react';
import { QUIZ } from '../data/quiz.js';
import Sources from './Sources.jsx';
import s from './Review.module.css';

export default function Review() {
  const [answers, setAnswers] = useState({});
  const answered = Object.keys(answers).length;
  const score = Object.entries(answers).filter(([i, j]) => QUIZ[i].a === j).length;
  return (
    <>
      <h1>Check what stuck.</h1>
      <p className="lede">Ten questions, each with the reasoning. Then the full source list for going deeper.</p>
      <div className="stat">
        {answered ? <span><b>{score}</b> of {answered} correct{answered === QUIZ.length ? ', all done' : ''}</span> : <span>Pick an answer to see the reasoning.</span>}
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
              {done && <div className={s.expl}>{q.e}</div>}
            </div>
          );
        })}
      </div>
      <h2>All sources</h2>
      <p className="note">Manufacturer pages and reviews for practical values; primary papers for mechanism and history. DOI links resolve through doi.org.</p>
      <Sources label="All sources" />
    </>
  );
}
