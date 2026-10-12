import React from 'react';
// A doorway and a folded wing: a quiet, personal mark, readable at small sizes.
export function EmpireMark({ size = 24, className = '', ...props }) {
  return <svg className={className} width={size} height={size} viewBox="0 0 48 48" fill="none" aria-hidden="true" {...props}><path d="M10 38V23a14 14 0 0 1 28 0v15M16 38V24a8 8 0 0 1 16 0v14" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/><path d="M24 34 12 19l12 7 12-7-12 15Zm0 0v8M7 42h34" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" strokeLinecap="round"/></svg>;
}
export function NoxMark({ size = 24, ...props }) {
  return <svg width={size} height={size} viewBox="0 0 32 32" fill="none" aria-hidden="true" {...props}><path d="M8 24V8l16 16V8M5 28h22" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/><path d="M24 4a12 12 0 1 0 4 20" stroke="currentColor" strokeWidth=".8" opacity=".55"/></svg>;
}
