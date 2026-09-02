// Renders static, author-controlled copy that may contain <b> and <em>. Never pass user input here.
export default function Rich({ as: Tag = 'p', text, ...rest }) {
  return <Tag {...rest} dangerouslySetInnerHTML={{ __html: text }} />;
}
