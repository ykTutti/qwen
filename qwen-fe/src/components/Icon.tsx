import type { CSSProperties } from 'react';
import { spriteSvg } from '../assets/sprite';
import { logoSrc, wordmarkSrc } from '../assets/logo';

if (typeof document !== 'undefined') {
  let holder = document.getElementById('qw-sprite');
  if (!holder) {
    holder = document.createElement('div');
    holder.id = 'qw-sprite';
    document.body.prepend(holder);
  }
  holder.innerHTML = spriteSvg;
}

const linePaths: Record<string, string> = {
  check: 'M5 12.5l4.5 4.5L19 7.5',
  trash: 'M4 7h16M9.5 7V4.5h5V7M6.5 7l1 13h9l1-13',
  pin: 'M9 4h6l-1 6 3 3H7l3-3zM12 13v7',
  refresh: 'M19.5 12a7.5 7.5 0 1 1-2.2-5.3M19.5 4.5v4h-4',
  share: 'M4 12v7h16v-7M12 3.5v11M7.5 8l4.5-4.5L16.5 8',
  like: 'M7 11v9H4v-9zM7 11l4-7a2 2 0 0 1 3 2l-1 4h6a2 2 0 0 1 2 2.3l-1.3 6A2 2 0 0 1 17.7 20H7',
  dislike: 'M17 13V4h3v9zM17 13l-4 7a2 2 0 0 1-3-2l1-4H5a2 2 0 0 1-2-2.3l1.3-6A2 2 0 0 1 6.3 4H17',
  arrowDown: 'M12 5v14M6 13l6 6 6-6',
  download: 'M12 4v11M7 10l5 5 5-5M4 20h16',
  code: 'M8 7l-5 5 5 5M16 7l5 5-5 5M13.5 4l-3 16',
  collapse: 'M10 4v6H4M14 20v-6h6',
  stop: 'M8 8h8v8H8z',
  logout: 'M15 4h4v16h-4M10 8l-4 4 4 4M6 12h10',
  user: 'M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM4 20a8 8 0 0 1 16 0',
  lock: 'M6 11h12v9H6zM8.5 11V8a3.5 3.5 0 0 1 7 0v3M12 14.5v2',
  pen: 'M4 20l4.5-1L19 8.5 15.5 5 5 15.5zM13.5 7l3.5 3.5',
  target: 'M9 4H4v5M4 15v5h5M15 4h5v5M12 12l8 3-3.5 1.5L15 20z',
  comment: 'M4 5h16v11H9l-5 4zM8 9h8M8 12h5',
  chatAdd: 'M4 5h16v11H9l-5 4zM12 8v5M9.5 10.5h5',
  eye: 'M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12zM12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6z',
  eyeOff: 'M3 3l18 18M10.6 5.6A9.9 9.9 0 0 1 12 5.5c6 0 9.5 6.5 9.5 6.5a17 17 0 0 1-3 3.8M6.6 6.6C3.9 8.3 2.5 12 2.5 12S6 18.5 12 18.5c1.8 0 3.3-.5 4.6-1.3M9.9 9.9a3 3 0 0 0 4.2 4.2',
  settings: 'M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z',
};

const fillIcons: Record<string, { viewBox: string; d: string; evenOdd?: boolean }> = {
  answerCopy: {
    viewBox: '0 0 1024 1024',
    d: 'M832 64a96 96 0 0 1 96 96v480a96 96 0 0 1-96 96H704v128a96 96 0 0 1-96 96H192a96 96 0 0 1-96-96V384a96 96 0 0 1 96-96h128V160a96 96 0 0 1 96-96zM192 352a32 32 0 0 0-32 32v480a32 32 0 0 0 32 32h416a32 32 0 0 0 32-32V384a32 32 0 0 0-32-32zm224-224a32 32 0 0 0-32 32v128h224a96 96 0 0 1 96 96v288h128a32 32 0 0 0 32-32V160a32 32 0 0 0-32-32z',
  },
  answerChevron: {
    viewBox: '0 0 20 20',
    d: 'M7.475 14.558 12.033 10 7.475 5.442a.625.625 0 1 1 .884-.884l5 5a.625.625 0 0 1 0 .884l-5 5a.625.625 0 0 1-.884-.884',
  },
  answerRegenerate: {
    viewBox: '0 0 16 16',
    d: 'M14.949 9.059q-.06.44-.177.857a7 7 0 0 1-.524 1.327.243.243 0 0 1-.406.037l-2.273-2.877a.25.25 0 0 1 .196-.405h2.207q0-2.472-1.749-4.221T8 2.027q-2.475 0-4.223 1.75Q2.027 5.527 2.027 8q0 2.475 1.75 4.223 1.75 1.75 4.223 1.75 2.475 0 4.223-1.75l.746.746Q10.911 15.03 8 15.028q-2.91 0-4.97-2.059Q.973 10.911.973 8q0-2.91 2.059-4.97Q5.089.973 8 .973q2.91 0 4.97 2.059Q15.027 5.089 15.027 8q0 .536-.08 1.059',
  },
  answerMore: {
    viewBox: '0 0 16 16',
    d: 'M14 8a1 1 0 1 1-2 0 1 1 0 0 1 2 0M4 8a1 1 0 1 1-2 0 1 1 0 0 1 2 0m5 0a1 1 0 1 1-2 0 1 1 0 0 1 2 0',
  },
  answerLike: {
    viewBox: '0 0 16 16',
    d: 'M2.5 14.049h8.77q1.002 0 1.766-.647t.93-1.634l.832-4.97q.115-.686-.335-1.217-.45-.53-1.145-.53h-2.522q.015-.148.12-.755.264-1.51.264-2.052 0-.945-1.172-1.543Q8.848.109 7.92.62q-.5.274-1.046 1.808-.783 2.202-1.663 2.622l-.736-.001H2.5q-.621 0-1.06.44Q1 5.928 1 6.55v5.999q0 .621.44 1.06.439.44 1.06.44m9.89-1.41q-.485.41-1.12.41H5V6.05h.314a.5.5 0 0 0 .18-.034q.916-.353 1.544-1.433.34-.583.78-1.82.418-1.176.585-1.268.464-.255 1.15.095.627.32.627.653 0 .456-.249 1.88-.137.79-.137.963 0 .523.32.827a.5.5 0 0 0 .344.137h2.86q.232 0 .382.176.15.177.112.406l-.833 4.97q-.105.626-.59 1.036M4 6.05H2.5q-.5 0-.5.5v5.999q0 .5.5.5H4z',
    evenOdd: true,
  },
  answerLikeActive: {
    viewBox: '0 0 16 16',
    d: 'M4 13.949H2.5q-.621 0-1.06-.44Q1 13.07 1 12.45V6.45q0-.621.44-1.06.439-.44 1.06-.44H4zm1 0h6.27q1.002 0 1.766-.647t.93-1.634l.832-4.97q.115-.686-.335-1.217-.45-.53-1.145-.53h-2.522q.015-.148.12-.755.264-1.51.264-2.052 0-.945-1.172-1.543Q8.848.009 7.92.52q-.5.274-1.046 1.808-.783 2.202-1.663 2.622H5z',
    evenOdd: true,
  },
  answerDislike: {
    viewBox: '0 0 16 16',
    d: 'M2.5 2h8.77q1.002 0 1.766.647.764.646.93 1.634l.832 4.97q.115.687-.335 1.218t-1.145.53h-2.522q.015.148.12.755.264 1.508.264 2.051 0 .945-1.172 1.543-1.16.592-2.087.08-.5-.275-1.046-1.808Q6.092 11.42 5.212 11H2.5q-.621 0-1.06-.44Q1 10.122 1 9.5v-6q0-.621.44-1.06Q1.878 2 2.5 2M4 3H2.5Q2 3 2 3.5v6q0 .5.5.5H4zm1 7V3h6.27q.635 0 1.12.41.484.41.589 1.036l.833 4.971q.038.229-.112.406t-.382.177l-2.86-.001a.5.5 0 0 0-.344.137q-.32.304-.32.827 0 .174.137.963.25 1.423.25 1.88 0 .331-.628.651-.686.35-1.15.096-.167-.092-.586-1.268-.44-1.236-.779-1.82-.628-1.08-1.544-1.432a.5.5 0 0 0-.18-.034z',
    evenOdd: true,
  },
  answerDislikeActive: {
    viewBox: '0 0 16 16',
    d: 'M4 2H2.5q-.621 0-1.06.44Q1 2.878 1 3.5v6q0 .621.44 1.06.439.44 1.06.44H4zm1 9V2h6.27q1.002 0 1.766.647t.93 1.634l.832 4.97q.115.687-.335 1.218t-1.145.53h-2.522q.015.148.12.755.264 1.508.264 2.051 0 .945-1.172 1.543-1.16.592-2.087.08-.5-.275-1.046-1.808Q6.092 11.42 5.212 11z',
    evenOdd: true,
  },
  answerShare: {
    viewBox: '0 0 1024 1024',
    d: 'M512 119.168c0-49.024 59.264-73.6 93.952-38.976l360.32 360.384a55.04 55.04 0 0 1 0 77.888l-360.32 360.32C571.264 913.536 512 888.96 512 839.936v-167.04c-126.08 8.96-220.096 70.592-284.544 133.568a595.5 595.5 0 0 0-96.96 124.544c-2.048 3.648-3.52 6.4-4.48 8.32l-1.088 1.92-.192.448-2.88 4.672A32 32 0 0 1 64 927.552c0-190.08 40.768-349.568 122.048-462.336C262.464 359.168 373.12 296.768 512 288.576V119.104zm64 200.32a32 32 0 0 1-32 32c-134.08 0-236.288 54.336-306.048 151.168-55.424 76.864-91.328 182.208-104.384 311.744 14.08-17.216 30.4-35.456 49.088-53.76C260.224 684.864 379.776 607.552 544 607.552a32 32 0 0 1 32 32v178.752l338.752-338.752L576 140.8v178.752z',
  },
  answerReport: {
    viewBox: '0 0 16 16',
    d: 'M7.967 2.06q.882 0 1.31.77l4.968 8.942q.417.75-.018 1.489T12.934 14H3q-.858 0-1.293-.74-.435-.739-.019-1.488L6.655 2.83q.429-.772 1.312-.772M3 13h9.934a.47.47 0 0 0 .43-.246.47.47 0 0 0 .007-.497l-4.967-8.94a.47.47 0 0 0-.437-.258.47.47 0 0 0-.437.257l-4.968 8.941a.47.47 0 0 0 .007.497.47.47 0 0 0 .43.246m5.467-7v4h-1V6zm0 5v1h-1v-1z',
  },
};

interface IconProps {
  name: string;
  size?: number;
  className?: string;
  style?: CSSProperties;
}

export function Icon({ name, size = 16, className, style }: IconProps) {
  const cls = `qw-icon${className ? ` ${className}` : ''}`;
  const fill = fillIcons[name];
  if (fill) {
    return (
      <svg width={size} height={size} viewBox={fill.viewBox} fill="none" className={cls} style={style} aria-hidden="true">
        <path fill="currentColor" fillRule={fill.evenOdd ? 'evenodd' : undefined} d={fill.d} />
      </svg>
    );
  }
  if (name === 'answerDelete') {
    return (
      <svg width={size} height={size} viewBox="0 0 16 16" fill="none" className={cls} style={style} aria-hidden="true">
        <path stroke="currentColor" strokeLinejoin="round" d="M3.124 4.25h9.75v8.25a1.5 1.5 0 0 1-1.5 1.5h-6.75a1.5 1.5 0 0 1-1.5-1.5V4.25ZM1.25 4.25h13.5M5.75 2h4.5" />
      </svg>
    );
  }
  if (name === 'plus') {
    return (
      <svg width={size} height={size} viewBox="0 0 16 16" fill="none" className={cls} style={style} aria-hidden="true">
        <path fill="currentColor" stroke="currentColor" strokeWidth={0.457} d="M7.5 8.5V15h1V8.5H15v-1H8.5V1h-1v6.5H1v1z" />
      </svg>
    );
  }
  if (linePaths[name]) {
    return (
      <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.6}
        strokeLinecap="round" strokeLinejoin="round" className={cls} style={style} aria-hidden="true">
        <path d={linePaths[name]} />
      </svg>
    );
  }
  const id = name.includes('pcicon-') ? name : `qwpcicon-${name}`;
  return (
    <svg width={size} height={size} fill="currentColor" className={cls} style={style} aria-hidden="true">
      <use href={`#${id}`} />
    </svg>
  );
}

export function Wordmark({ height = 20 }: { height?: number }) {
  return <img src={wordmarkSrc} alt="千问" style={{ height, width: 'auto', display: 'block' }} />;
}

export function LogoMark({ size = 48 }: { size?: number }) {
  return <img src={logoSrc} width={size} height={size} alt="千问" style={{ display: 'block' }} />;
}
