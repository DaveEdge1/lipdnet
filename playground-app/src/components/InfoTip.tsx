// Small "?" help marker next to a field label. Shows its text on hover and on
// keyboard focus (accessible), positioned in-flow with CSS. Deliberately not an
// Angular-Material-style tooltip — plain, self-contained, theme-consistent.
interface Props {
  text?: string
}

export function InfoTip({ text }: Props) {
  if (!text) return null
  return (
    <span className="infotip" tabIndex={0} role="note" aria-label={text}>
      <span className="infotip-mark" aria-hidden="true">?</span>
      <span className="infotip-bubble" role="tooltip">{text}</span>
    </span>
  )
}
