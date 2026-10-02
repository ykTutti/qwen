const TYPES: { re: RegExp; color: string; fold: string; label: string }[] = [
  { re: /\.(md|markdown)$/i, color: '#4f7cff', fold: '#a9c0ff', label: 'M' },
  { re: /\.pptx?$/i, color: '#f0703c', fold: '#f8b89d', label: 'P' },
  { re: /\.docx?$/i, color: '#2f6fed', fold: '#9dbaf6', label: 'W' },
  { re: /\.(xlsx?|csv)$/i, color: '#1f9d55', fold: '#8fd0aa', label: 'X' },
  { re: /\.pdf$/i, color: '#e5484d', fold: '#f2a4a6', label: 'PDF' },
  { re: /\.html?$/i, color: '#7c5cf0', fold: '#c3b3fa', label: '</>' },
  { re: /^design\.json$/i, color: '#0f9f8f', fold: '#8fd8cd', label: '◇' },
];
const FALLBACK = { color: '#8a8f98', fold: '#c5c8cd', label: '' };

export const isMarkdownFile = (name: string) => TYPES[0].re.test(name);

export function FileIcon({ name, size = 32 }: { name: string; size?: number }) {
  const t = TYPES.find((x) => x.re.test(name)) ?? FALLBACK;
  return (
    <svg className="file-card-icon" width={size} height={size} viewBox="0 0 32 32" aria-hidden="true">
      <path d="M7 3h12.5L26 9.5V27a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2z" fill={t.color} />
      <path d="M19.5 3v4.5a2 2 0 0 0 2 2H26z" fill={t.fold} />
      {t.label === 'M' ? (
        <path d="M9.5 22v-7l2.75 3.25L15 15v7M18.5 15v6.5M16.5 19.5l2 2.5 2-2.5" fill="none" stroke="#fff" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
      ) : t.label ? (
        <text x="15.5" y="22.5" textAnchor="middle" fill="#fff" fontSize={t.label.length > 1 ? 7 : 10} fontWeight="700" fontFamily="Arial, sans-serif">{t.label}</text>
      ) : null}
    </svg>
  );
}
