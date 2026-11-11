/**
 * Unit tests for GitHub Username Validator Regex & Logic.
 */
import { describe, it, expect } from 'vitest';

const GITHUB_USERNAME_REGEX = /^[a-zA-Z0-9](?:[a-zA-Z0-9]|-(?=[a-zA-Z0-9])){0,38}$/;

describe('GitHub Username Validator', () => {
  it('should accept valid standard usernames', () => {
    const validUsernames = ['octocat', 'torvalds', 'gaearon', 'sindresorhus', 'google', 'microsoft'];
    validUsernames.forEach((name) => {
      expect(GITHUB_USERNAME_REGEX.test(name)).toBe(true);
    });
  });

  it('should accept usernames with numbers and single hyphens', () => {
    const validUsernames = ['user-1', 'john-doe-2024', 'a-b', '12345'];
    validUsernames.forEach((name) => {
      expect(GITHUB_USERNAME_REGEX.test(name)).toBe(true);
    });
  });

  it('should reject usernames starting or ending with a hyphen', () => {
    expect(GITHUB_USERNAME_REGEX.test('-octocat')).toBe(false);
    expect(GITHUB_USERNAME_REGEX.test('octocat-')).toBe(false);
  });

  it('should reject usernames with consecutive hyphens', () => {
    expect(GITHUB_USERNAME_REGEX.test('octo--cat')).toBe(false);
    expect(GITHUB_USERNAME_REGEX.test('user---name')).toBe(false);
  });

  it('should reject usernames longer than 39 characters', () => {
    const tooLong = 'a'.repeat(40);
    expect(GITHUB_USERNAME_REGEX.test(tooLong)).toBe(false);

    const maxLength = 'a'.repeat(39);
    expect(GITHUB_USERNAME_REGEX.test(maxLength)).toBe(true);
  });

  it('should reject invalid characters and injection attempts', () => {
    const invalid = [
      'user name',
      'user@name',
      'user.name',
      'user_name',
      '<script>alert(1)</script>',
      "'; DROP TABLE users; --",
      'user$name'
    ];
    invalid.forEach((name) => {
      expect(GITHUB_USERNAME_REGEX.test(name)).toBe(false);
    });
  });
});

