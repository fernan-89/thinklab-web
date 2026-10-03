import { describe, expect, it } from 'vitest';
import { jwtWith } from '../test-utils';
import { subjectOf } from './jwt';

describe('subjectOf', () => {
  it('reads the sub claim, including a base64url payload that needs padding', () => {
    expect(subjectOf(jwtWith({ sub: 'user-42' }))).toBe('user-42');
    expect(subjectOf(jwtWith({ sub: 'a-subject-that-is-longer??>>' }))).toBe('a-subject-that-is-longer??>>');
  });

  it('is undefined for a token without a usable subject or one that is not a JWT at all', () => {
    expect(subjectOf(jwtWith({ sub: '' }))).toBeUndefined();
    expect(subjectOf(jwtWith({ sub: 42 }))).toBeUndefined();
    expect(subjectOf(jwtWith({ iss: 'x' }))).toBeUndefined();
    expect(subjectOf('not-a-jwt')).toBeUndefined();
    expect(subjectOf('a.%%%.c')).toBeUndefined();
    expect(subjectOf('')).toBeUndefined();
  });
});
