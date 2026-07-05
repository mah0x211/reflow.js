import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseSelector, isCompiledSelector } from '../../src/selector/parse.js';
import { ReflowSelectorError } from '../../src/errors.js';

function first(compiled) {
    return compiled.selectors[0].parts;
}

test('parse: single type selector', () => {
    const c = parseSelector('div');
    assert.equal(c.type, 'list');
    assert.equal(c.source, 'div');
    assert.equal(c.hasPositional, false);
    const parts = first(c);
    assert.equal(parts.length, 1);
    assert.equal(parts[0].combinator, null);
    assert.equal(parts[0].compound.tag, 'div');
    assert.equal(parts[0].compound.id, null);
    assert.deepEqual(parts[0].compound.classes, []);
    assert.deepEqual(parts[0].compound.attrs, []);
    assert.deepEqual(parts[0].compound.pseudos, []);
});

test('parse: universal selector', () => {
    const c = parseSelector('*');
    const compound = first(c)[0].compound;
    assert.equal(compound.tag, null);
});

test('parse: id / class combinations', () => {
    const c = parseSelector('div#foo.bar.baz');
    const compound = first(c)[0].compound;
    assert.equal(compound.tag, 'div');
    assert.equal(compound.id, 'foo');
    assert.deepEqual(compound.classes, ['bar', 'baz']);
});

test('parse: attribute selectors with all operators', () => {
    for (const op of ['=', '~=', '|=', '^=', '$=', '*=']) {
        const src = `[data-x${op}"v"]`;
        const c = parseSelector(src);
        const compound = first(c)[0].compound;
        assert.equal(compound.attrs.length, 1);
        assert.equal(compound.attrs[0].name, 'data-x');
        assert.equal(compound.attrs[0].op, op);
        assert.equal(compound.attrs[0].value, 'v');
    }
});

test('parse: attribute with ident value and single quotes', () => {
    const c = parseSelector("[data-x='hello world']");
    const compound = first(c)[0].compound;
    assert.equal(compound.attrs[0].value, 'hello world');
});

test('parse: attribute existence (no value)', () => {
    const c = parseSelector('[data-role]');
    const compound = first(c)[0].compound;
    assert.deepEqual(compound.attrs, [{ name: 'data-role', op: null, value: null }]);
});

test('parse: descendant combinator', () => {
    const c = parseSelector('div p');
    const parts = first(c);
    assert.equal(parts.length, 2);
    assert.equal(parts[0].combinator, null);
    assert.equal(parts[0].compound.tag, 'div');
    assert.equal(parts[1].combinator, ' ');
    assert.equal(parts[1].compound.tag, 'p');
});

test('parse: child combinator', () => {
    const c = parseSelector('ul > li');
    const parts = first(c);
    assert.equal(parts[1].combinator, '>');
    assert.equal(parts[1].compound.tag, 'li');
});

test('parse: mixed combinators', () => {
    const c = parseSelector('section > article .body p');
    const parts = first(c);
    assert.deepEqual(parts.map(p => p.combinator), [null, '>', ' ', ' ']);
    assert.deepEqual(parts.map(p => p.compound.tag), ['section', 'article', null, 'p']);
    assert.deepEqual(parts[2].compound.classes, ['body']);
});

test('parse: selector list', () => {
    const c = parseSelector('a, b, c#id');
    assert.equal(c.selectors.length, 3);
    assert.equal(c.selectors[2].parts[0].compound.id, 'id');
});

test('parse: positional pseudo-classes without arg', () => {
    for (const name of ['first-child', 'last-child', 'only-child', 'first-of-type', 'last-of-type', 'only-of-type']) {
        const c = parseSelector(`li:${name}`);
        const p = first(c)[0].compound.pseudos[0];
        assert.equal(p.name, name);
        assert.equal(p.n, null);
        assert.equal(c.hasPositional, true);
    }
});

test('parse: nth-* pseudo-classes with integer arg', () => {
    for (const name of ['nth-child', 'nth-last-child', 'nth-of-type', 'nth-last-of-type']) {
        const c = parseSelector(`li:${name}(3)`);
        const p = first(c)[0].compound.pseudos[0];
        assert.equal(p.name, name);
        assert.equal(p.n, 3);
        assert.equal(c.hasPositional, true);
    }
});

test('parse: complex selector with positional pseudo-class', () => {
    const c = parseSelector('#status li:nth-child(2)');
    const parts = first(c);
    assert.equal(parts.length, 2);
    assert.equal(parts[0].compound.id, 'status');
    assert.equal(parts[1].compound.tag, 'li');
    assert.equal(parts[1].compound.pseudos[0].name, 'nth-child');
    assert.equal(parts[1].compound.pseudos[0].n, 2);
    assert.equal(c.hasPositional, true);
});

test('parse: case-insensitive pseudo-class names accepted', () => {
    const c = parseSelector('li:First-Child');
    assert.equal(first(c)[0].compound.pseudos[0].name, 'first-child');
});

test('parse: tag names lowercased', () => {
    const c = parseSelector('DIV');
    assert.equal(first(c)[0].compound.tag, 'div');
});

test('parse: whitespace tolerance around commas and combinators', () => {
    const c = parseSelector('  a  ,   b  >   c   ');
    assert.equal(c.selectors.length, 2);
    assert.equal(c.selectors[1].parts.length, 2);
    assert.equal(c.selectors[1].parts[1].combinator, '>');
});

test('parse: rejects empty selector', () => {
    assert.throws(() => parseSelector(''), (e) => {
        assert.ok(e instanceof ReflowSelectorError);
        assert.equal(e.reason, 'syntax');
        return true;
    });
    assert.throws(() => parseSelector('   '), (e) => {
        assert.ok(e instanceof ReflowSelectorError);
        assert.equal(e.reason, 'syntax');
        return true;
    });
});

test('parse: rejects non-string source', () => {
    assert.throws(() => parseSelector(null), ReflowSelectorError);
    assert.throws(() => parseSelector(123), ReflowSelectorError);
});

test('parse: rejects sibling combinators', () => {
    for (const src of ['a + b', 'a ~ b']) {
        assert.throws(() => parseSelector(src), (e) => {
            assert.ok(e instanceof ReflowSelectorError);
            assert.equal(e.reason, 'unsupported');
            assert.match(e.feature, /^combinator:/);
            return true;
        });
    }
});

test('parse: rejects column combinator', () => {
    assert.throws(() => parseSelector('a || b'), (e) => {
        assert.equal(e.reason, 'unsupported');
        assert.equal(e.feature, 'combinator:||');
        return true;
    });
});

test('parse: rejects pseudo-elements', () => {
    assert.throws(() => parseSelector('p::before'), (e) => {
        assert.equal(e.reason, 'unsupported');
        assert.equal(e.feature, 'pseudo-element');
        return true;
    });
});

test('parse: rejects unsupported pseudo-classes', () => {
    for (const src of [':not(a)', ':is(a)', ':where(a)', ':has(a)', ':hover', ':focus', ':nth-child(2n+1)']) {
        assert.throws(() => parseSelector(src.startsWith(':') ? `a${src}` : src), (e) => {
            assert.ok(e instanceof ReflowSelectorError);
            assert.equal(e.reason, 'unsupported');
            return true;
        });
    }
});

test('parse: rejects formula args for nth-*', () => {
    for (const src of ['li:nth-child(odd)', 'li:nth-child(2n)', 'li:nth-child(2n+1)', 'li:nth-child(n)', 'li:nth-child(-1)']) {
        assert.throws(() => parseSelector(src), (e) => {
            assert.ok(e instanceof ReflowSelectorError);
            // odd / 2n / 2n+1 / n / -1 : some pass through unsupported, some through syntax
            assert.ok(e.reason === 'unsupported' || e.reason === 'syntax');
            return true;
        });
    }
});

test('parse: rejects positional pseudo-class with unexpected arg', () => {
    assert.throws(() => parseSelector('li:first-child(1)'), (e) => {
        assert.equal(e.reason, 'syntax');
        return true;
    });
});

test('parse: rejects nth-* without arg', () => {
    assert.throws(() => parseSelector('li:nth-child'), (e) => {
        assert.equal(e.reason, 'syntax');
        return true;
    });
});

test('parse: rejects nth-*(0)', () => {
    assert.throws(() => parseSelector('li:nth-child(0)'), (e) => {
        assert.equal(e.reason, 'syntax');
        return true;
    });
});

test('parse: rejects attribute namespaces', () => {
    assert.throws(() => parseSelector('[ns|attr]'), (e) => {
        assert.equal(e.reason, 'unsupported');
        assert.equal(e.feature, 'attr-namespace');
        return true;
    });
});

test('parse: rejects attribute case-sensitivity flag', () => {
    assert.throws(() => parseSelector('[a="b" i]'), (e) => {
        assert.equal(e.reason, 'unsupported');
        assert.equal(e.feature, 'attr-case-flag');
        return true;
    });
});

test('parse: rejects multiple #ids in same compound', () => {
    assert.throws(() => parseSelector('#a#b'), (e) => {
        assert.equal(e.reason, 'syntax');
        return true;
    });
});

test('parse: rejects trailing junk', () => {
    assert.throws(() => parseSelector('a )'), (e) => {
        assert.equal(e.reason, 'syntax');
        return true;
    });
});

test('parse: rejects malformed attribute selectors', () => {
    for (const src of ['[', '[]', '[a=]', '[a ~ b]', '[a=b']) {
        assert.throws(() => parseSelector(src), ReflowSelectorError, `expected error for: ${src}`);
    }
});

test('parse: rejects malformed strings inside attributes', () => {
    assert.throws(() => parseSelector('[a="unterminated'), ReflowSelectorError);
    assert.throws(() => parseSelector('[a="line\nbreak"]'), ReflowSelectorError);
});

test('parse: string escapes inside attribute values', () => {
    const c = parseSelector('[a="he said \\"hi\\""]');
    assert.equal(first(c)[0].compound.attrs[0].value, 'he said "hi"');
});

test('parse: result is frozen', () => {
    const c = parseSelector('#a > .b[c="d"]:first-child');
    assert.ok(Object.isFrozen(c));
    assert.ok(Object.isFrozen(c.selectors));
    assert.ok(Object.isFrozen(c.selectors[0].parts));
    assert.ok(Object.isFrozen(c.selectors[0].parts[0].compound.classes));
});

test('isCompiledSelector: true for parseSelector output, false for strings/objects', () => {
    const c = parseSelector('a');
    assert.equal(isCompiledSelector(c), true);
    assert.equal(isCompiledSelector('a'), false);
    assert.equal(isCompiledSelector({}), false);
    assert.equal(isCompiledSelector(null), false);
    assert.equal(isCompiledSelector({ type: 'list', selectors: [] }), true);
});
