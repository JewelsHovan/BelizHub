// Reagent glyphs, 44×44. Colours are literal so they survive any CSS-module scoping.
const svgProps = { viewBox: '0 0 44 44', 'aria-hidden': 'true', width: 44, height: 44 };

export const GLYPHS = {
  helix: (p) => (
    <svg {...svgProps} {...p}>
      <path d="M11 4c24 12 0 24 24 36" fill="none" stroke="#1B2430" strokeWidth="3" strokeLinecap="round" />
      <path d="M33 4C9 16 33 28 9 40" fill="none" stroke="#7A8797" strokeWidth="3" strokeLinecap="round" />
      <path d="M15 10h14M13 22h18M15 34h14" stroke="#C9D0D8" strokeWidth="2" />
    </svg>
  ),
  primer: (p) => (
    <svg {...svgProps} {...p}>
      <path d="M5 16h24" stroke="#6A4C9C" strokeWidth="5" strokeLinecap="round" />
      <path d="M27 10l9 6-9 6z" fill="#6A4C9C" />
      <path d="M39 30H15" stroke="#B8336A" strokeWidth="5" strokeLinecap="round" />
      <path d="M17 24l-9 6 9 6z" fill="#B8336A" />
    </svg>
  ),
  pol: (p) => (
    <svg {...svgProps} {...p}>
      <path d="M8 24c0-10 7-16 15-16 9 0 15 5 15 12 0 5-4 6-4 10 0 3 3 4 3 7 0 3-6 4-14 4C13 41 8 34 8 24z" fill="#C98A1B" />
      <path d="M4 27h36" stroke="#fff" strokeWidth="3" strokeLinecap="round" />
    </svg>
  ),
  dntp: (p) => (
    <svg {...svgProps} {...p}>
      <circle cx="8" cy="22" r="4" fill="#C98A1B" /><circle cx="17" cy="22" r="4" fill="#C98A1B" /><circle cx="26" cy="22" r="4" fill="#C98A1B" />
      <path d="M12 22h1M21 22h1" stroke="#1B2430" />
      <path d="M33 15l7 4-2 8h-9l-2-8z" fill="#7A8797" />
      <rect x="31" y="4" width="8" height="8" rx="2" fill="#1B2430" />
    </svg>
  ),
  mg: (p) => (
    <svg {...svgProps} {...p}>
      <circle cx="22" cy="22" r="15" fill="#2F6FB5" />
      <text x="22" y="26" textAnchor="middle" fontFamily="IBM Plex Sans,system-ui" fontSize="11" fontWeight="600" fill="#fff">Mg²⁺</text>
    </svg>
  ),
  buffer: (p) => (
    <svg {...svgProps} {...p}>
      <path d="M17 5h10v11l9 19a3 3 0 0 1-3 4H11a3 3 0 0 1-3-4l9-19z" fill="none" stroke="#1B2430" strokeWidth="2.5" strokeLinejoin="round" />
      <path d="M12 30h20" stroke="#2F6FB5" strokeWidth="6" strokeLinecap="round" />
    </svg>
  ),
  water: (p) => (
    <svg {...svgProps} {...p}>
      <path d="M22 5c6 9 11 15 11 21a11 11 0 0 1-22 0c0-6 5-12 11-21z" fill="#D8E5F4" stroke="#2F6FB5" strokeWidth="2" />
    </svg>
  ),
  plus: (p) => (
    <svg {...svgProps} {...p}>
      <circle cx="22" cy="22" r="15" fill="none" stroke="#7A8797" strokeWidth="2" strokeDasharray="3 3" />
      <path d="M22 14v16M14 22h16" stroke="#7A8797" strokeWidth="3" strokeLinecap="round" />
    </svg>
  ),
};

export default function Glyph({ name, ...p }) {
  const G = GLYPHS[name];
  return G ? G(p) : null;
}
