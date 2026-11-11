/**
 * Strict GitHub Username Validation Middleware.
 *
 * Rules:
 * 1. Username may only contain alphanumeric characters or single hyphens.
 * 2. Username cannot begin or end with a hyphen.
 * 3. Maximum is 39 characters.
 * 4. Case-insensitive alphanumeric.
 */
const GITHUB_USERNAME_REGEX = /^[a-zA-Z0-9](?:[a-zA-Z0-9]|-(?=[a-zA-Z0-9])){0,38}$/;

export function validateUsername(req, res, next) {
  const rawUsername = req.params.username;

  if (!rawUsername || typeof rawUsername !== 'string') {
    return res.status(400).json({
      error: 'Invalid Request',
      message: 'Username parameter is required.'
    });
  }

  const username = rawUsername.trim();

  if (username.length === 0) {
    return res.status(400).json({
      error: 'Invalid Request',
      message: 'Username cannot be empty.'
    });
  }

  if (username.length > 39) {
    return res.status(400).json({
      error: 'Invalid Username',
      message: 'GitHub usernames cannot exceed 39 characters.'
    });
  }

  if (!GITHUB_USERNAME_REGEX.test(username)) {
    return res.status(400).json({
      error: 'Invalid Username',
      message: 'GitHub username contains invalid characters. Only alphanumeric characters and single non-consecutive hyphens are permitted.'
    });
  }

  // Attach sanitized, normalized username to request
  req.sanitizedUsername = username.toLowerCase();
  next();
}

