/**
 * @file Fixture-driven test runner.
 *
 * Each fixture directory under `test/fixtures/valid/<name>/` must contain:
 *   template.html  — main template source
 *   data.json      — data passed as $ globals (may be {})
 *   expected.html  — expected rendered output (trimmed)
 * Optional:
 *   helpers.js     — default export = helpers object
 *   setup.js       — default export = async (reflow) => void, for extra
 *                    template registrations (e.g., includes)
 *
 * Fixtures under `test/fixtures/invalid/<name>/` must contain:
 *   template.html            — the template that should fail
 *   expected-error.json      — { phase, class, reason?, messagePattern? }
 * Optional:
 *   data.json, helpers.js, setup.js
 *
 * `phase`: "compile" | "render"
 * `class`: "ReflowCompileError" | "ReflowRuntimeError" | "ReflowIncludeError"
 * `reason`: expected `err.reason` for include errors
 * `messagePattern`: RegExp source string; err.message must match
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdir, readFile, stat } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { existsSync } from 'node:fs';
import {
  Reflow,
  ReflowCompileError,
  ReflowRuntimeError,
  ReflowIncludeError,
} from '../src/index.js';

const ERROR_CLASSES = {
  ReflowCompileError,
  ReflowRuntimeError,
  ReflowIncludeError,
};

/**
 * @param {string} dir  Absolute path to `test/fixtures/valid` or `.../invalid`.
 * @param {'valid' | 'invalid'} kind
 */
export async function registerFixtures(dir, kind) {
  let names;
  try {
    names = (await readdir(dir, { withFileTypes: true }))
      .filter((d) => d.isDirectory())
      .map((d) => d.name)
      .sort();
  } catch {
    return;
  }
  for (const name of names) {
    const fixtureDir = `${dir}/${name}`;
    if (kind === 'valid') {
      test(`valid: ${name}`, async () => await runValid(fixtureDir));
    } else {
      test(`invalid: ${name}`, async () => await runInvalid(fixtureDir));
    }
  }
}

/**
 * @param {string} dir
 */
async function runValid(dir) {
  const template = await readFile(`${dir}/template.html`, 'utf-8');
  const data = await readJsonIfExists(`${dir}/data.json`);
  const expected = (await readFile(`${dir}/expected.html`, 'utf-8')).replace(/\r\n/g, '\n');
  const helpers = await importDefaultIfExists(`${dir}/helpers.js`);
  const setup = await importDefaultIfExists(`${dir}/setup.js`);
  const config = (await importDefaultIfExists(`${dir}/config.js`)) || {};

  const reflow = new Reflow({ helpers: helpers || {}, ...config });
  if (setup) await setup(reflow);
  await reflow.compile('main', template);
  const actual = reflow.render('main', data || {});
  assert.equal(actual.trim(), expected.trim(), `fixture: ${dir}`);
}

/**
 * @param {string} dir
 */
async function runInvalid(dir) {
  const template = await readFile(`${dir}/template.html`, 'utf-8');
  const expected = JSON.parse(await readFile(`${dir}/expected-error.json`, 'utf-8'));
  const data = await readJsonIfExists(`${dir}/data.json`);
  const helpers = await importDefaultIfExists(`${dir}/helpers.js`);
  const setup = await importDefaultIfExists(`${dir}/setup.js`);
  const config = (await importDefaultIfExists(`${dir}/config.js`)) || {};

  const expectedClass = ERROR_CLASSES[expected.class];
  assert.ok(expectedClass, `unknown error class: ${expected.class}`);

  const reflow = new Reflow({ helpers: helpers || {}, ...config });
  if (setup) await setup(reflow);

  let thrown = null;
  try {
    if (expected.phase === 'compile') {
      await reflow.compile('main', template);
    } else {
      await reflow.compile('main', template);
      reflow.render('main', data || {});
    }
  } catch (e) {
    thrown = e;
  }

  assert.ok(thrown, `expected an error but nothing was thrown`);
  assert.ok(
    thrown instanceof expectedClass,
    `expected ${expected.class}, got ${thrown?.name ?? typeof thrown}: ${thrown?.message}`
  );

  if (expected.reason !== undefined) {
    assert.equal(thrown.reason, expected.reason, `error.reason mismatch`);
  }
  if (expected.messagePattern) {
    const re = new RegExp(expected.messagePattern);
    assert.match(thrown.message, re, `error.message did not match ${expected.messagePattern}`);
  }
}

/**
 * @param {string} path
 * @returns {Promise<unknown | undefined>}
 */
async function readJsonIfExists(path) {
  if (!existsSync(path)) return undefined;
  return JSON.parse(await readFile(path, 'utf-8'));
}

/**
 * @param {string} path
 * @returns {Promise<any>}
 */
async function importDefaultIfExists(path) {
  if (!existsSync(path)) return null;
  const mod = await import(pathToFileURL(path).href);
  return mod.default ?? null;
}
