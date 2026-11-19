import type { MouseEvent, ReactElement, ReactNode } from 'react';
import { isTauri } from '@tauri-apps/api/core';
import { openUrl } from '@tauri-apps/plugin-opener';
import './ExternalLink.css';

const WEB_PROTOCOLS: readonly string[] = ['http:', 'https:'];

interface ExternalLinkProps {
  href?: string | undefined;
  children?: ReactNode;
}

function isWebUrl(href: string): boolean {
  try {
    return WEB_PROTOCOLS.includes(new URL(href).protocol);
  } catch {
    return false;
  }
}

export function ExternalLink({ href, children }: ExternalLinkProps): ReactElement {
  if (href === undefined || !isWebUrl(href)) {
    return <span>{children}</span>;
  }

  const targetUrl: string = href;

  function openInBrowser(event: MouseEvent<HTMLAnchorElement>): void {
    if (!isTauri()) {
      return;
    }
    // Ohne preventDefault würde das App-Fenster selbst zur Seite navigieren.
    event.preventDefault();
    openUrl(targetUrl).catch((error: unknown): void => {
      // Ein Link, der nicht aufgeht, fällt dem Benutzer selbst auf; ohne Session-Bezug gibt es keinen Ort für einen Satz.
      console.error('Link konnte nicht geöffnet werden', error);
    });
  }

  return (
    <a
      className="external-link"
      href={href}
      title={href}
      target="_blank"
      rel="noreferrer"
      onClick={openInBrowser}
      onAuxClick={openInBrowser}
    >
      {children}
    </a>
  );
}
