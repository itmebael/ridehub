const STORAGE_PREFIX = 'ridehub-email-cooldown';

export const DEFAULT_EMAIL_COOLDOWN_SECONDS = 60;

const safeDecode = (value: string) => {
  try {
    return decodeURIComponent(value.replace(/\+/g, ' '));
  } catch {
    return value.replace(/\+/g, ' ');
  }
};

const normalizeEmail = (email: string) => email.trim().toLowerCase();

const getStorageKey = (scope: string, email: string) => `${STORAGE_PREFIX}:${scope}:${normalizeEmail(email)}`;

const getStorage = () => {
  if (typeof window === 'undefined') {
    return null;
  }

  try {
    return window.localStorage;
  } catch {
    return null;
  }
};

export const formatCooldownDuration = (seconds: number) => {
  const clampedSeconds = Math.max(0, Math.ceil(seconds));
  const minutes = Math.floor(clampedSeconds / 60);
  const remainingSeconds = clampedSeconds % 60;

  if (minutes > 0 && remainingSeconds > 0) {
    return `${minutes}m ${remainingSeconds}s`;
  }

  if (minutes > 0) {
    return `${minutes}m`;
  }

  return `${remainingSeconds}s`;
};

export const getEmailCooldownRemaining = (scope: string, email: string) => {
  if (!normalizeEmail(email)) {
    return 0;
  }

  const storage = getStorage();

  if (!storage) {
    return 0;
  }

  const expiresAt = storage.getItem(getStorageKey(scope, email));

  if (!expiresAt) {
    return 0;
  }

  const remainingMilliseconds = Number(expiresAt) - Date.now();

  if (!Number.isFinite(remainingMilliseconds) || remainingMilliseconds <= 0) {
    storage.removeItem(getStorageKey(scope, email));
    return 0;
  }

  return Math.ceil(remainingMilliseconds / 1000);
};

export const setEmailCooldown = (
  scope: string,
  email: string,
  seconds: number = DEFAULT_EMAIL_COOLDOWN_SECONDS
) => {
  if (!normalizeEmail(email)) {
    return;
  }

  const storage = getStorage();

  if (!storage) {
    return;
  }

  const expiresAt = Date.now() + Math.max(1, Math.ceil(seconds)) * 1000;
  storage.setItem(getStorageKey(scope, email), String(expiresAt));
};

export const isEmailRateLimitMessage = (message?: string | null) => {
  const normalizedMessage = safeDecode((message || '').trim()).toLowerCase();

  return (
    normalizedMessage.includes('email rate limit') ||
    normalizedMessage.includes('rate limit exceeded') ||
    normalizedMessage.includes('too many requests') ||
    normalizedMessage.includes('too many emails') ||
    normalizedMessage.includes('for security purposes')
  );
};

export const parseEmailCooldownSeconds = (
  message?: string | null,
  fallbackSeconds: number = DEFAULT_EMAIL_COOLDOWN_SECONDS
) => {
  const normalizedMessage = safeDecode((message || '').trim()).toLowerCase();

  const minuteMatch = normalizedMessage.match(/(\d+)\s*(minute|min|minutes)\b/);

  if (minuteMatch) {
    return Math.max(1, Number(minuteMatch[1])) * 60;
  }

  const secondMatch = normalizedMessage.match(/(\d+)\s*(second|sec|seconds)\b/);

  if (secondMatch) {
    return Math.max(1, Number(secondMatch[1]));
  }

  return fallbackSeconds;
};

export const getEmailCooldownMessage = (
  seconds: number,
  emailLabel: string = 'email'
) => `Too many ${emailLabel} requests. Please wait ${formatCooldownDuration(seconds)} before trying again.`;
