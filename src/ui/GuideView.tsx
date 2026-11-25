import { useMemo, useState } from 'react';
import manual from '../../MANUAL.md?raw';
import readme from '../../README.md?raw';
import { renderGuide } from './guide';

const DOCS = [
  { id: 'manual', title: 'User manual', md: manual },
  { id: 'readme', title: 'About', md: readme },
] as const;
type DocId = (typeof DOCS)[number]['id'];

/** In-app reader for the user manual and README (bundled at build time, works offline). */
export function GuideView({ onClose, initial = 'manual' }: { onClose: () => void; initial?: DocId }) {
  const [doc, setDoc] = useState<DocId>(initial);
  const { html, toc } = useMemo(() => renderGuide(DOCS.find((d) => d.id === doc)!.md), [doc]);
  const [active, setActive] = useState<string | null>(null);

  const go = (id: string) => {
    document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    setActive(id);
  };

  return (
    <main className="guide-wrap">
      <div className="row">
        <button onClick={onClose}>← Back</button>
        <div className="seg" role="tablist" aria-label="Document">
          {DOCS.map((d) => (
            <button
              key={d.id}
              role="tab"
              aria-selected={doc === d.id}
              className={doc === d.id ? 'on' : ''}
              onClick={() => {
                setDoc(d.id);
                setActive(null);
                window.scrollTo({ top: 0 });
              }}
            >
              {d.title}
            </button>
          ))}
        </div>
      </div>
      <div className="guide-grid">
        <nav className="guide-toc card" aria-label="Contents">
          <details open={typeof window === 'undefined' || window.innerWidth > 820}>
            <summary>Contents</summary>
            <ul>
              {toc.map((t) => (
                <li key={t.id} className={`d${t.depth}${active === t.id ? ' on' : ''}`}>
                  <a
                    href={`#${t.id}`}
                    onClick={(e) => {
                      e.preventDefault();
                      go(t.id);
                    }}
                  >
                    {t.text}
                  </a>
                </li>
              ))}
            </ul>
          </details>
        </nav>
        <article
          className="guide card"
          // README is bundled project content (not user input), rendered by marked.
          key={doc}
          dangerouslySetInnerHTML={{ __html: html }}
          onClick={(e) => {
            const a = (e.target as HTMLElement).closest('a');
            const href = a?.getAttribute('href');
            if (href?.startsWith('#')) {
              e.preventDefault();
              go(href.slice(1));
            } else if (href?.endsWith('/MANUAL.md') || href?.endsWith('/README.md')) {
              // Links between the two docs switch tabs here instead of opening GitHub.
              e.preventDefault();
              setDoc(href.endsWith('/MANUAL.md') ? 'manual' : 'readme');
              setActive(null);
              window.scrollTo({ top: 0 });
            }
          }}
        />
      </div>
    </main>
  );
}
