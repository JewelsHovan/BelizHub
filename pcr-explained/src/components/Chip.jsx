export default function Chip({ status = '', children }) {
  return <span className={`chip ${status}`.trim()}>{children}</span>;
}
