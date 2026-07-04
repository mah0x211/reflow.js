/**
 * @file Snippet generation and offset-to-line/column conversion.
 *
 * HTMLRewriter does not provide source positions, so offsets are tracked
 * separately (the element-start ranges are collected upstream by the scanner).
 * This module turns a byte offset into human-readable line/column numbers
 * (offsetToLineCol) and builds a context snippet with a caret marker
 * (makeSnippet).
 */

/**
 * Convert a byte offset into 1-based line and column:
 *   line   = (number of '\n' before offset) + 1
 *   column = offset - (position of the last '\n' before offset)
 * (column is 1-based; column 1 is the first character after a newline.)
 * @param {string} source
 * @param {number} offset
 * @returns {{ line: number, column: number }}
 */
export function offsetToLineCol(source, offset) {
    if (offset < 0) offset = 0;
    if (offset > source.length) offset = source.length;
    const before = source.slice(0, offset);
    let line = 1;
    let lastNewline = -1;
    for (let i = 0; i < before.length; i++) {
        if (before.charCodeAt(i) === 0x0a) {
            line++;
            lastNewline = i;
        }
    }
    const column = offset - lastNewline;
    return { line, column };
}

/**
 * Build a printable snippet: `contextLines` (default 2) lines before and after
 * the highlight range, line numbers right-aligned in a gutter ("NN | "), and a
 * line of carets ("^^^") under the start line marking the [start, end) range.
 * The marker spans to the end of the line when the range crosses lines.
 *
 * @param {string} source
 * @param {number} start   byte offset of the highlight start
 * @param {number} end     byte offset of the highlight end (exclusive)
 * @param {number} [contextLines=2]
 * @returns {string}
 */
export function makeSnippet(source, start, end, contextLines = 2) {
    if (start < 0) start = 0;
    if (end > source.length) end = source.length;
    if (end < start) end = start;

    const { line: startLine, column: startCol } = offsetToLineCol(source, start);
    const { line: endLine } = offsetToLineCol(source, end);

    const lines = source.split('\n');
    const firstLine = Math.max(1, startLine - contextLines);
    const lastLine = Math.min(lines.length, endLine + contextLines);

    const gutterWidth = String(lastLine).length;

    const out = [];
    for (let n = firstLine; n <= lastLine; n++) {
        const numStr = String(n).padStart(gutterWidth, ' ');
        /* c8 ignore next 2 */
        if (n < 1 || n > lines.length) continue;
        const content = lines[n - 1];
        out.push(`${numStr} | ${content}`);
        if (n === startLine) {
            const highlightStart = startCol - 1;
            const highlightLen = n === endLine
                ? Math.max(1, end - start)
                : Math.max(1, content.length - highlightStart);
            const gutterPad = ' '.repeat(gutterWidth) + ' | ';
            const caretPad = ' '.repeat(highlightStart);
            const caret = '^'.repeat(highlightLen);
            out.push(`${gutterPad}${caretPad}${caret}`);
        }
    }
    return out.join('\n');
}
