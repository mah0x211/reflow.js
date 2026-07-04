/**
 * @file Error classes for reflow.
 *
 * Every library-thrown error extends ReflowError. The hierarchy, the common
 * metadata properties, and the per-class roles are documented on each class
 * below.
 */

/**
 * Base class for every reflow error.
 *
 * Common metadata properties (absent when not applicable): templateName,
 * directive, attribute, expression, element (reconstructed open tag), snippet
 * (with surrounding context), line, column (1-based), includeStack (string[]),
 * reason ('cycle' | 'not_found' | 'depth_exceeded'), requested, and cause
 * (wrapped underlying error).
 *
 * The constructor copies every key of `meta` onto the instance (except `cause`,
 * which is assigned to the standard Error.cause), so callers can read any of
 * the fields above directly off the thrown error.
 */
export class ReflowError extends Error {
    /**
     * @param {string} message
     * @param {object} [meta]
     */
    constructor(message, meta = {}) {
        super(message);
        this.name = 'ReflowError';
        if (meta.cause !== undefined) this.cause = meta.cause;
        for (const key of Object.keys(meta)) {
            if (key === 'cause') continue;
            if (key in this) continue;
            this[key] = meta[key];
        }
    }
}

/**
 * Thrown by compile() for problems that are statically detectable: HTML parse
 * errors, unknown x-* attributes, invalid x-data / x-for / x-each values,
 * orphan x-elseif / x-else / x-case / x-nocase, directive combination
 * violations, unregistered helper references, duplicate x-data, x-break outside
 * a loop, expression syntax errors, or duplicate template registration.
 */
export class ReflowCompileError extends ReflowError {
    /**
     * @param {string} message
     * @param {object} [meta]
     */
    constructor(message, meta = {}) {
        super(message, meta);
        this.name = 'ReflowCompileError';
    }
}

/**
 * Thrown by render() for runtime failures that are not include-specific:
 * expression TypeErrors (property access on undefined without `?.`), exceptions
 * raised inside helpers, unsupported value types for x-text / x-html / x-bind
 * (e.g. object or array), or a non-array x-each collection.
 */
export class ReflowRuntimeError extends ReflowError {
    /**
     * @param {string} message
     * @param {object} [meta]
     */
    constructor(message, meta = {}) {
        super(message, meta);
        this.name = 'ReflowRuntimeError';
    }
}

/**
 * Thrown for include-specific runtime failures, identified by `reason`:
 * 'not_found' (the target template is not registered), 'cycle' (the same
 * template re-enters while already on the include stack), or 'depth_exceeded'
 * (the include depth exceeds config.maxIncludeDepth). Carries `requested` (the
 * unresolved name) and `includeStack`.
 */
export class ReflowIncludeError extends ReflowError {
    /**
     * @param {string} message
     * @param {object} [meta]
     */
    constructor(message, meta = {}) {
        super(message, meta);
        this.name = 'ReflowIncludeError';
    }
}
