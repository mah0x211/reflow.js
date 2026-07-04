/**
 * @file Lightweight HTML element start-tag scanner.
 *
 * HTMLRewriter does not report source positions, so this scanner pre-collects
 * element open-tag byte ranges to drive line/column and snippet generation in
 * errors. The detailed scan contract is documented on scanElementRanges.
 */

/**
 * @typedef {{ start: number, end: number, tagName: string }} ElementRange
 */

const RAW_CONTENT_TAGS = new Set(['script', 'style', 'textarea', 'title']);

/**
 * Scan an HTML string and return every element OPEN-tag byte range in document
 * order, matching exactly the elements HTMLRewriter surfaces via its element
 * handler. The Nth element event corresponds to the Nth range, and the two are
 * sanity-checked by tag name.
 *
 * Output: [{ start, end, tagName }, ...] for open tags only (closing tags,
 * text, and comments are not included).
 *
 * While scanning it skips comments (<!-- ... -->), doctype / markup decls
 * (<! ... >), processing instructions (<? ... ?>), closing tags (</tag>), and
 * the raw-text body of script / style / textarea / title up to the matching
 * close tag (matching HTMLRewriter's raw-text handling). A '>' inside a quoted
 * attribute value ("..." / '...') is not treated as the end of the tag.
 *
 * @param {string} html
 * @returns {ElementRange[]}
 */
export function scanElementRanges(html) {
    /** @type {ElementRange[]} */
    const ranges = [];
    const len = html.length;
    let i = 0;

    while (i < len) {
        if (html.charCodeAt(i) !== 0x3c) { // not '<'
            i++;
            continue;
        }

        // Comment: <!-- ... -->
        if (html.startsWith('<!--', i)) {
            const closeIdx = html.indexOf('-->', i + 4);
            if (closeIdx === -1) break;
            i = closeIdx + 3;
            continue;
        }

        // Doctype / other <! ...>
        if (html.charCodeAt(i + 1) === 0x21) { // '!'
            const closeIdx = html.indexOf('>', i + 2);
            if (closeIdx === -1) break;
            i = closeIdx + 1;
            continue;
        }

        // Processing instruction / XML decl: <?...?>
        if (html.charCodeAt(i + 1) === 0x3f) { // '?'
            const closeIdx = html.indexOf('?>', i + 2);
            if (closeIdx === -1) break;
            i = closeIdx + 2;
            continue;
        }

        // Closing tag: </tagname>
        if (html.charCodeAt(i + 1) === 0x2f) { // '/'
            const closeIdx = html.indexOf('>', i + 2);
            if (closeIdx === -1) break;
            i = closeIdx + 1;
            continue;
        }

        // Element start tag candidate
        const nameStart = i + 1;
        if (!isTagNameStartChar(html.charCodeAt(nameStart))) {
            // Stray '<' — skip and continue
            i++;
            continue;
        }

        // Parse tag name
        let nameEnd = nameStart;
        while (nameEnd < len && isTagNameChar(html.charCodeAt(nameEnd))) nameEnd++;
        const tagName = html.slice(nameStart, nameEnd).toLowerCase();

        // Scan to end of the opening tag, respecting quoted attribute values
        let j = nameEnd;
        let quote = 0;
        let tagCloseIdx = -1;
        while (j < len) {
            const ch = html.charCodeAt(j);
            if (quote) {
                if (ch === quote) quote = 0;
            } else if (ch === 0x22 || ch === 0x27) { // " or '
                quote = ch;
            } else if (ch === 0x3e) { // '>'
                tagCloseIdx = j;
                break;
            }
            j++;
        }
        if (tagCloseIdx === -1) break;

        const end = tagCloseIdx + 1;
        // A self-closing marker <br/> still ends at '>' — HTMLRewriter reports it
        // as a regular element event, so we do not distinguish it here.
        ranges.push({ start: i, end, tagName });

        // Skip over raw-content element body until matching close tag
        if (RAW_CONTENT_TAGS.has(tagName)) {
            const closingRe = new RegExp(`</${escapeRegex(tagName)}\\s*>`, 'i');
            closingRe.lastIndex = end;
            const match = closingRe.exec(html.slice(end));
            if (!match) {
                i = len;
            } else {
                i = end + match.index + match[0].length;
            }
            continue;
        }

        i = end;
    }

    return ranges;
}

/**
 * @param {number} ch
 * @returns {boolean}
 */
function isTagNameStartChar(ch) {
    return (ch >= 0x41 && ch <= 0x5a) || (ch >= 0x61 && ch <= 0x7a); // A-Z / a-z
}

/**
 * @param {number} ch
 * @returns {boolean}
 */
function isTagNameChar(ch) {
    return (
        (ch >= 0x41 && ch <= 0x5a) || // A-Z
        (ch >= 0x61 && ch <= 0x7a) || // a-z
        (ch >= 0x30 && ch <= 0x39) || // 0-9
        ch === 0x2d ||                // -
        ch === 0x5f ||                // _
        ch === 0x3a                   // :
    );
}

/**
 * @param {string} s
 * @returns {string}
 */
function escapeRegex(s) {
    return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
