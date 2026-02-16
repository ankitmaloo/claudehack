import React, { useMemo, useEffect, useRef } from 'react';
import { cn } from '@/lib/utils';

interface SafeRendererProps {
  htmlContent: string;
  className?: string;
  allowScripts?: boolean;
  onCopyAttempt?: () => void;
}

/**
 * SafeRenderer - Double Iframe Security Pattern
 *
 * Outer Iframe: Acts as a firewall with strict CSP (no network, no scripts)
 * Inner Iframe: Contains the actual content with sandbox="" (fully locked)
 *
 * This prevents:
 * - XSS attacks from LLM-generated content
 * - Data exfiltration via img/script/fetch
 * - Form submissions to external servers
 * - Access to parent window or cookies
 */
export const SafeRenderer = ({
  htmlContent,
  className,
  allowScripts = false,
  onCopyAttempt
}: SafeRendererProps) => {
  const frameRef = useRef<HTMLIFrameElement>(null);

  // Sanitize the content - basic escaping for the srcdoc context
  const sanitizedContent = useMemo(() => {
    // Don't double-escape, but ensure basic safety
    return htmlContent
      .replace(/<!--/g, '&lt;!--')  // Prevent HTML comment injection
      .replace(/-->/g, '--&gt;');
  }, [htmlContent]);

  // Inner iframe srcdoc - the actual content, fully sandboxed
  const innerSrcDoc = useMemo(() => {
    return `<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <style>
    *, *::before, *::after { box-sizing: border-box; }
    html, body {
      margin: 0;
      padding: 16px;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      font-size: 14px;
      line-height: 1.6;
      color: #1a1a1a;
      background: #fff;
    }
    img { max-width: 100%; height: auto; }
    pre {
      background: #f5f5f5;
      padding: 12px;
      border-radius: 4px;
      overflow-x: auto;
      font-family: 'SF Mono', Monaco, 'Cascadia Code', monospace;
      font-size: 13px;
    }
    code {
      background: #f0f0f0;
      padding: 2px 6px;
      border-radius: 3px;
      font-family: 'SF Mono', Monaco, 'Cascadia Code', monospace;
      font-size: 0.9em;
    }
    pre code { background: transparent; padding: 0; }
    a { color: #0066cc; }
    table { border-collapse: collapse; width: 100%; }
    th, td { border: 1px solid #ddd; padding: 8px; text-align: left; }
    th { background: #f5f5f5; }
    blockquote {
      margin: 16px 0;
      padding-left: 16px;
      border-left: 4px solid #ddd;
      color: #666;
    }
  </style>
</head>
<body>${sanitizedContent}</body>
</html>`;
  }, [sanitizedContent]);

  // Outer iframe srcdoc - the firewall layer
  // Uses strict CSP to block all network requests and scripts
  const outerSrcDoc = useMemo(() => {
    const innerSandbox = allowScripts ? 'sandbox="allow-scripts"' : 'sandbox=""';

    // Escape the inner srcdoc for embedding
    const escapedInner = innerSrcDoc
      .replace(/&/g, '&amp;')
      .replace(/"/g, '&quot;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');

    return `<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; frame-src 'self';">
  <style>
    *, *::before, *::after { box-sizing: border-box; }
    html, body, iframe {
      margin: 0;
      padding: 0;
      width: 100%;
      height: 100%;
      border: 0;
      overflow: hidden;
    }
    iframe {
      display: block;
    }
  </style>
</head>
<body>
  <iframe
    srcdoc="${escapedInner}"
    ${innerSandbox}
    style="width: 100%; height: 100%; border: 0;"
  ></iframe>
</body>
</html>`;
  }, [innerSrcDoc, allowScripts]);

  // Listen for copy events to warn the user
  useEffect(() => {
    if (!onCopyAttempt) return;

    const handleCopy = () => {
      onCopyAttempt();
    };

    document.addEventListener('copy', handleCopy);
    return () => document.removeEventListener('copy', handleCopy);
  }, [onCopyAttempt]);

  // Outer sandbox permissions:
  // - allow-same-origin: Required for srcdoc iframes to work properly
  // - No allow-scripts: Scripts are blocked at this layer
  // - No allow-forms: Form submissions blocked
  // - No allow-popups: Can't open new windows
  // - No allow-top-navigation: Can't navigate parent
  const outerSandbox = 'allow-same-origin';

  return (
    <iframe
      ref={frameRef}
      srcDoc={outerSrcDoc}
      sandbox={outerSandbox}
      className={cn(
        'w-full h-full border-0 bg-white rounded-lg',
        className
      )}
      title="Sandboxed Content"
    />
  );
};

/**
 * SafeRendererWithWarning - Adds copy warning UI
 */
export const SafeRendererWithWarning = ({
  htmlContent,
  className,
  allowScripts = false
}: SafeRendererProps) => {
  const [showWarning, setShowWarning] = React.useState(false);

  const handleCopyAttempt = () => {
    setShowWarning(true);
    setTimeout(() => setShowWarning(false), 3000);
  };

  return (
    <div className={cn('relative', className)}>
      <SafeRenderer
        htmlContent={htmlContent}
        allowScripts={allowScripts}
        onCopyAttempt={handleCopyAttempt}
        className="w-full h-full"
      />

      {showWarning && (
        <div className="absolute top-2 right-2 bg-amber-500 text-white text-sm px-3 py-2 rounded-md shadow-lg animate-in fade-in slide-in-from-top-2">
          ⚠️ Be careful when copying AI-generated content
        </div>
      )}
    </div>
  );
};

export default SafeRenderer;
