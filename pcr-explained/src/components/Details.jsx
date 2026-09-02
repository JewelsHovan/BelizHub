export default function Details({ summary, children, className, open }) {
  return (
    <details className={className} open={open}>
      <summary>{summary}</summary>
      <div className="body">{children}</div>
    </details>
  );
}
