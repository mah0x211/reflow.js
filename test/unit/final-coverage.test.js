import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Reflow, ReflowCompileError } from '../../src/index.js';

test('x-match with non-whitespace text child fails', async () => {
  const r = new Reflow();
  await assert.rejects(
    () => r.compile('t', '<div x-match="$.v">plain-text<p x-case="\'a\'">A</p></div>'),
    /x-match: direct children must be x-case or x-nocase/
  );
});

test('x-match with comments between cases is OK', async () => {
  const r = new Reflow();
  await r.compile('t', '<div x-match="$.v"><!-- comment --><p x-case="\'a\'">A</p><!-- --><p x-nocase>D</p></div>');
  assert.equal(r.render('t', { v: 'a' }), '<div><p>A</p></div>');
});

test('x-if chain with comments between chain members is OK', async () => {
  const r = new Reflow();
  await r.compile('t', '<div><p x-if="$.a">A</p><!-- ok --><p x-elseif="$.b">B</p><!-- --><p x-else>D</p></div>');
  assert.equal(r.render('t', { a: false, b: true }), '<div><p>B</p></div>');
});

test('compile error reconstructs open tag including regular attributes', async () => {
  const r = new Reflow();
  try {
    await r.compile('t', '<div class="foo" id="bar" x-unknown="x">');
    assert.fail();
  } catch (err) {
    assert.ok(err instanceof ReflowCompileError);
    assert.match(err.element, /<div class="foo" id="bar">/);
  }
});

test('compile error reconstructs tag with attribute containing special chars', async () => {
  const r = new Reflow();
  try {
    await r.compile('t', '<div data-x=\'a"b<c&d\' x-unknown="x">');
    assert.fail();
  } catch (err) {
    assert.match(err.element, /&quot;/);
    assert.match(err.element, /&lt;/);
    assert.match(err.element, /&amp;/);
  }
});

test('x-for start greater than stop with positive step fails', async () => {
  const r = new Reflow();
  await assert.rejects(
    () => r.compile('t', '<li x-for="i = 5, 1, 1" x-text=".i"></li>'),
    /direction mismatch/
  );
});

test('x-each with only whitespace collection is rejected by regex', async () => {
  const r = new Reflow();
  // The regex requires at least one non-whitespace char to match; empty
  // trailing whitespace produces a regex-non-match error, not the "collection
  // is required" one — either is acceptable for this fixture.
  await assert.rejects(
    () => r.compile('t', '<li x-each="u in    " x-text=".u"></li>'),
    /x-each/
  );
});

test('x-each with break-if hits break signal path', async () => {
  const r = new Reflow();
  await r.compile('t', '<ul><li x-each="u in $.items"><span x-text=".u"></span><br x-break-if=".u == 2"></li></ul>');
  assert.equal(r.render('t', { items: [1, 2, 3, 4] }), '<ul><li><span>1</span></li><li><span>2</span></li></ul>');
});

test('x-include with null value throws describeValue null path', async () => {
  const r = new Reflow();
  await r.compile('t', '<section x-include="$.n"></section>');
  try {
    r.render('t', { n: null });
    assert.fail();
  } catch (err) {
    assert.match(err.message, /got null/);
  }
});

test('conflicting I×I (x-for + x-each) fails', async () => {
  const r = new Reflow();
  await assert.rejects(
    () => r.compile('t', '<li x-for="i = 1, 3" x-each="u in $.u"></li>'),
    /conflicting iteration/
  );
});

test('conflicting K×K (x-break + x-break-if) fails', async () => {
  const r = new Reflow();
  await assert.rejects(
    () => r.compile('t', '<ul><li x-for="i = 1, 3"><br x-break x-break-if=".i > 1"></li></ul>'),
    /conflicting control/
  );
});

test('conflicting I×K on same element fails', async () => {
  const r = new Reflow();
  await assert.rejects(
    () => r.compile('t', '<li x-for="i = 1, 3" x-break></li>'),
    /iteration.*control|control.*iteration/
  );
});

test('bad expression in x-if triggers parseExprValue catch wrapping', async () => {
  const r = new Reflow();
  await assert.rejects(
    () => r.compile('t', '<template x-if=":::">bad</template>'),
    /x-if.*unexpected|x-if.*parse/
  );
});

test('x-bind: with empty attribute name fails', async () => {
  const r = new Reflow();
  await assert.rejects(
    () => r.compile('t', '<div x-bind:="$.x"></div>'),
    /attribute name after "bind:" is required/
  );
});

test('multiple structural directives on same element fails', async () => {
  const r = new Reflow();
  await assert.rejects(
    () => r.compile('t', '<template x-if=".a" x-elseif=".b">x</template>'),
    /conflicting structural/
  );
});

test('chain scan breaks on element with unrelated directive', async () => {
  // x-if is immediately followed by an element that has directives but
  // is neither x-elseif nor x-else. Chain collection must stop there.
  const r = new Reflow();
  await r.compile('t', '<div><template x-if="$.a">A</template><p x-text="$.msg">middle</p></div>');
  assert.equal(r.render('t', { a: true, msg: 'hi' }), '<div><template>A</template><p>hi</p></div>');
  assert.equal(r.render('t', { a: false, msg: 'hi' }), '<div><p>hi</p></div>');
});

test('orphan x-nocase outside x-match fails', async () => {
  const r = new Reflow();
  await assert.rejects(
    () => r.compile('t', '<div><p x-nocase>D</p></div>'),
    /x-nocase must be a direct child of x-match/
  );
});


