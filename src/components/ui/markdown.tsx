"use client"

import ReactMarkdown from "react-markdown"
import remarkGfm from "remark-gfm"
import { cn } from "@/lib/utils"

interface MarkdownProps {
  children: string
  className?: string
}

export function Markdown({ children, className }: MarkdownProps) {
  return (
    <div className={cn("prose prose-neutral dark:prose-invert max-w-none", className)}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
        // Headings
        h1: ({ children }) => (
          <h1 className="text-2xl font-serif font-semibold tracking-tight mt-8 mb-4 first:mt-0">
            {children}
          </h1>
        ),
        h2: ({ children }) => (
          <h2 className="text-xl font-serif font-semibold tracking-tight mt-6 mb-3 first:mt-0">
            {children}
          </h2>
        ),
        h3: ({ children }) => (
          <h3 className="text-lg font-serif font-medium tracking-tight mt-5 mb-2 first:mt-0">
            {children}
          </h3>
        ),
        h4: ({ children }) => (
          <h4 className="text-base font-medium mt-4 mb-2 first:mt-0">
            {children}
          </h4>
        ),

        // Paragraphs
        p: ({ children }) => (
          <p className="leading-relaxed mb-4 last:mb-0">{children}</p>
        ),

        // Lists
        ul: ({ children }) => (
          <ul className="list-disc list-outside ml-5 mb-4 space-y-1.5">{children}</ul>
        ),
        ol: ({ children }) => (
          <ol className="list-decimal list-outside ml-5 mb-4 space-y-1.5">{children}</ol>
        ),
        li: ({ children }) => (
          <li className="leading-relaxed pl-1">{children}</li>
        ),

        // Blockquote
        blockquote: ({ children }) => (
          <blockquote className="border-l-2 border-primary/40 pl-4 my-4 italic text-muted-foreground">
            {children}
          </blockquote>
        ),

        // Code
        code: ({ className, children, ...props }) => {
          const isInline = !className
          if (isInline) {
            return (
              <code className="px-1.5 py-0.5 rounded bg-muted font-mono text-sm" {...props}>
                {children}
              </code>
            )
          }
          return (
            <code className={cn("font-mono text-sm", className)} {...props}>
              {children}
            </code>
          )
        },
        pre: ({ children }) => (
          <pre className="bg-muted/50 rounded-lg p-4 overflow-x-auto mb-4 text-sm">
            {children}
          </pre>
        ),

        // Links
        a: ({ href, children }) => (
          <a
            href={href}
            target="_blank"
            rel="noopener noreferrer"
            className="text-primary underline underline-offset-2 hover:text-primary/80 transition-colors"
          >
            {children}
          </a>
        ),

        // Strong and emphasis
        strong: ({ children }) => (
          <strong className="font-semibold">{children}</strong>
        ),
        em: ({ children }) => (
          <em className="italic">{children}</em>
        ),

        // Horizontal rule
        hr: () => <hr className="my-6 border-border/60" />,

        // Tables
        table: ({ children }) => (
          <div className="overflow-x-auto mb-4">
            <table className="w-full border-collapse text-sm">{children}</table>
          </div>
        ),
        thead: ({ children }) => (
          <thead className="border-b border-border">{children}</thead>
        ),
        tbody: ({ children }) => <tbody>{children}</tbody>,
        tr: ({ children }) => (
          <tr className="border-b border-border/40 last:border-0">{children}</tr>
        ),
        th: ({ children }) => (
          <th className="text-left font-medium p-2 bg-muted/30">{children}</th>
        ),
        td: ({ children }) => (
          <td className="p-2">{children}</td>
        ),
      }}
    >
        {children}
      </ReactMarkdown>
    </div>
  )
}
