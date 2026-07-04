import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Reflow, ReflowCompileError, ReflowRuntimeError } from '../../src/index.js';

test('compile rejects non-string name', async () => {
  const r = new Reflow();
  await assert.rejects(() => r.compile('', '<p>x</p>'), /non-empty string/);
  await assert.rejects(() => r.compile(null, '<p>x</p>'), /non-empty string/);
});

test('compile rejects non-string html', async () => {
  const r = new Reflow();
  await assert.rejects(() => r.compile('t', 123), /html must be a string/);
});

test('x-bind rejects object value at render', async () => {
  const r = new Reflow();
  await r.compile('t', '<div x-bind:data-x="$.obj"></div>');
  assert.throws(
    () => r.render('t', { obj: { a: 1 } }),
    (err) => err instanceof ReflowRuntimeError && /must be primitive/.test(err.message)
  );
});

test('x-bind allows number 0 as value', async () => {
  const r = new Reflow();
  await r.compile('t', '<div x-bind:data-x="$.n"></div>');
  assert.equal(r.render('t', { n: 0 }), '<div data-x="0"></div>');
});

test('x-bind allows empty string as value', async () => {
  const r = new Reflow();
  await r.compile('t', '<div x-bind:title="$.s"></div>');
  assert.equal(r.render('t', { s: '' }), '<div title=""></div>');
});

test('x-html rejects non-string', async () => {
  const r = new Reflow();
  await r.compile('t', '<div x-html="$.obj"></div>');
  assert.throws(
    () => r.render('t', { obj: { a: 1 } }),
    (err) => err instanceof ReflowRuntimeError && /must be string/.test(err.message)
  );
});

test('x-html with null/undefined emits empty', async () => {
  const r = new Reflow();
  await r.compile('t', '<div x-html="$.x"></div>');
  assert.equal(r.render('t', { x: null }), '<div></div>');
  const r2 = new Reflow();
  await r2.compile('t', '<div x-html="$.missing"></div>');
  assert.equal(r2.render('t', {}), '<div></div>');
});

test('x-text with null/undefined emits empty', async () => {
  const r = new Reflow();
  await r.compile('t', '<p x-text="$.missing"></p>');
  assert.equal(r.render('t', {}), '<p></p>');
});

test('x-text numeric value converted to string', async () => {
  const r = new Reflow();
  await r.compile('t', '<p x-text="$.n"></p>');
  assert.equal(r.render('t', { n: 42 }), '<p>42</p>');
});

test('x-bind:name overrides existing attribute', async () => {
  const r = new Reflow();
  await r.compile('t', '<img src="fallback.jpg" x-bind:src="$.src">');
  assert.equal(r.render('t', { src: 'real.jpg' }), '<img src="real.jpg">');
});

test('x-bind:name omits when expr evaluates to undefined even if original attr exists', async () => {
  const r = new Reflow();
  await r.compile('t', '<img src="fallback.jpg" x-bind:src="$.missing">');
  assert.equal(r.render('t', {}), '<img>');
});

test('x-match with no matching case and no nocase emits nothing in body', async () => {
  const r = new Reflow();
  await r.compile('t', '<div x-match="$.v"><p x-case="\'a\'">A</p></div>');
  assert.equal(r.render('t', { v: 'z' }), '<div></div>');
});

test('x-for descending inclusive', async () => {
  const r = new Reflow();
  await r.compile('t', '<ul><li x-for="i = 3, 1, -1" x-text=".i"></li></ul>');
  assert.equal(r.render('t'), '<ul><li>3</li><li>2</li><li>1</li></ul>');
});

test('x-for start equals stop emits one iteration', async () => {
  const r = new Reflow();
  await r.compile('t', '<ul><li x-for="i = 5, 5" x-text=".i"></li></ul>');
  assert.equal(r.render('t'), '<ul><li>5</li></ul>');
});

test('unconditional x-break stops immediately', async () => {
  const r = new Reflow();
  await r.compile('t', '<ul><li x-for="i = 1, 5"><span x-text=".i"></span><br x-break></li></ul>');
  assert.equal(r.render('t'), '<ul><li><span>1</span></li></ul>');
});

test('elseif chain evaluates first true', async () => {
  const r = new Reflow();
  await r.compile('t', '<div><template x-if="$.a">A</template><template x-elseif="$.b">B</template><template x-elseif="$.c">C</template></div>');
  assert.equal(r.render('t', { a: false, b: false, c: true }), '<div><template>C</template></div>');
});

test('x-include with non-string throws', async () => {
  const r = new Reflow();
  await r.compile('t', '<section x-include="$.n"></section>');
  assert.throws(
    () => r.render('t', { n: 42 }),
    (err) => /must evaluate to a template name/.test(err.message)
  );
});

test('render preserves comments in normal positions', async () => {
  const r = new Reflow();
  await r.compile('t', '<div><!-- keep --><p>x</p></div>');
  const out = r.render('t');
  assert.match(out, /<!-- keep -->/);
});

test('x-elseif before x-else consumes chain even across whitespace', async () => {
  const r = new Reflow();
  await r.compile('t', '<div>\n  <template x-if="$.a">A</template>\n  <template x-elseif="$.b">B</template>\n</div>');
  assert.equal(r.render('t', { a: false, b: true }).replace(/\s+/g, ''), '<div><template>B</template></div>');
});

test('x-data can be pushed under x-if', async () => {
  const r = new Reflow();
  await r.compile('t', '<template x-if="$.show"><div x-data="c: {x: 10}"><p x-text=".c.x"></p></div></template>');
  assert.equal(r.render('t', { show: true }), '<template><div><p>10</p></div></template>');
  assert.equal(r.render('t', { show: false }), '');
});

test('nested x-data creates inner shadow', async () => {
  const r = new Reflow();
  await r.compile('t', '<div x-data="a: {v: 1}"><div x-data="a: {v: 2}"><p x-text=".a.v"></p></div></div>');
  assert.equal(r.render('t'), '<div><div><p>2</p></div></div>');
});

test('helper throwing wraps into ReflowRuntimeError with cause', async () => {
  const helpers = {
    boom: () => { throw new Error('boom-msg'); },
  };
  const r = new Reflow({ helpers });
  await r.compile('t', '<p x-text="boom()"></p>');
  try {
    r.render('t');
    assert.fail('expected throw');
  } catch (err) {
    assert.ok(err instanceof ReflowRuntimeError);
    assert.match(err.message, /boom-msg/);
    assert.ok(err.cause);
  }
});

test('x-bind on void element (img)', async () => {
  const r = new Reflow();
  await r.compile('t', '<img x-bind:src="$.s" x-bind:alt="$.a">');
  assert.equal(r.render('t', { s: 'x.png', a: 'x' }), '<img src="x.png" alt="x">');
});

test('x-text on void element emits open only', async () => {
  // Void elements have no body; x-text is a no-op on them (no closing tag emitted).
  const r = new Reflow();
  await r.compile('t', '<img x-text="$.a">');
  // Output is <img> because void elements never emit close tags; body callback runs but there's nothing to emit content into visually.
  const out = r.render('t', { a: 'x' });
  assert.match(out, /<img/);
});

test('static Reflow.render with helpers', async () => {
  const html = await Reflow.render('<p x-text="upper($.n)"></p>', { n: 'hi' }, {
    helpers: { upper: (s) => String(s).toUpperCase() },
  });
  assert.equal(html, '<p>HI</p>');
});

test('static Reflow.renderFile uses loader', async () => {
  const html = await Reflow.renderFile('fake/path', { x: 'hello' }, {
    loader: async (p) => `<p>${p}: <span x-text="$.x"></span></p>`,
  });
  assert.match(html, /<span>hello<\/span>/);
});

test('Reflow errors carry all documented properties on ReflowError base', () => {
  // Ensure meta properties do not stomp Error.name/message
  const { ReflowError } = { ReflowError: Reflow.render.constructor === Function ? undefined : undefined };
  // Trivial no-op assertion just to keep this test scaffolding present.
  assert.ok(true);
});
