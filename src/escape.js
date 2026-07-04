/**
 * @file HTML escaping helpers.
 *
 * Escaping is context-dependent (see escapeText and escapeAttr). Raw-HTML
 * output (x-html) and re-encoding of the original HTML are handled at the
 * render site in interpret.js.
 */

/**
 * Escape a value for HTML text context (element content / x-text output).
 * OWASP-recommended set; each char is turned into its entity:
 *   & -> &amp;   < -> &lt;   > -> &gt;   " -> &quot;   ' -> &#39;
 * @param {unknown} value
 * @returns {string}
 */
export function escapeText(value) {
    const s = String(value);
    let out = '';
    for (let i = 0; i < s.length; i++) {
        const ch = s.charCodeAt(i);
        switch (ch) {
            case 0x26: out += '&amp;'; break;   // &
            case 0x3c: out += '&lt;'; break;    // <
            case 0x3e: out += '&gt;'; break;    // >
            case 0x22: out += '&quot;'; break;  // "
            case 0x27: out += '&#39;'; break;   // '
            default: out += s[i];
        }
    }
    return out;
}

/**
 * Escape a value for a double-quoted HTML attribute value (x-bind:* output).
 * Attribute values are always double-quoted, so only these are encoded:
 *   & -> &amp;   < -> &lt;   > -> &gt;   " -> &quot;
 * (a single quote is safe inside double quotes and is left as-is.)
 * @param {unknown} value
 * @returns {string}
 */
export function escapeAttr(value) {
    const s = String(value);
    let out = '';
    for (let i = 0; i < s.length; i++) {
        const ch = s.charCodeAt(i);
        switch (ch) {
            case 0x26: out += '&amp;'; break;   // &
            case 0x3c: out += '&lt;'; break;    // <
            case 0x3e: out += '&gt;'; break;    // >
            case 0x22: out += '&quot;'; break;  // "
            default: out += s[i];
        }
    }
    return out;
}
