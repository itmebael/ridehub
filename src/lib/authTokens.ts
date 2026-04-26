import {
  getEmailCooldownMessage,
  isEmailRateLimitMessage,
  parseEmailCooldownSeconds,
} from './emailCooldown';

type LocationShape = Pick<Location, 'hash' | 'search' | 'pathname'>;
type QueryShape = Pick<Location, 'hash' | 'search'>;

const getTokenFromParams = (params: URLSearchParams) =>
  params.get('access_token') || params.get('token') || params.get('token_hash');

const getRefreshTokenFromParams = (params: URLSearchParams) => params.get('refresh_token');

const getCodeFromParams = (params: URLSearchParams) => params.get('code');

const getTypeFromParams = (params: URLSearchParams) => params.get('type');

const getErrorDescriptionFromParams = (params: URLSearchParams) => params.get('error_description') || params.get('error');

const getErrorCodeFromParams = (params: URLSearchParams) => params.get('error_code');

export interface AuthCallbackPayload {
  token: string | null;
  refreshToken: string | null;
  code: string | null;
  type: string | null;
  errorDescription: string | null;
  errorCode: string | null;
  isPathToken: boolean;
}

const emptyAuthPayload = (): AuthCallbackPayload => ({
  token: null,
  refreshToken: null,
  code: null,
  type: null,
  errorDescription: null,
  errorCode: null,
  isPathToken: false,
});

const extractPathToken = (pathname: string): { token: string | null; isPathToken: boolean } => {
  if (pathname !== '/' && pathname.length > 20) {
    const pathParts = pathname.split('/').filter(Boolean);
    const potentialToken = pathParts[pathParts.length - 1];

    if (potentialToken && potentialToken.length > 50 && potentialToken.includes('.')) {
      return { token: potentialToken, isPathToken: true };
    }
  }

  return { token: null, isPathToken: false };
};

export const extractAuthPayloadFromLocation = (locationLike: LocationShape): AuthCallbackPayload => {
  const hash = locationLike.hash.startsWith('#') ? locationLike.hash.slice(1) : locationLike.hash;
  const hashParams = new URLSearchParams(hash);
  const searchParams = new URLSearchParams(locationLike.search);
  const pathToken = extractPathToken(locationLike.pathname);

  const hashToken = getTokenFromParams(hashParams);
  const searchToken = getTokenFromParams(searchParams);
  const plainHashToken = !hashToken && hash.length > 50 && hash.includes('.') ? hash : null;

  return {
    token: hashToken || plainHashToken || searchToken || pathToken.token,
    refreshToken: getRefreshTokenFromParams(hashParams) || getRefreshTokenFromParams(searchParams),
    code: getCodeFromParams(searchParams) || getCodeFromParams(hashParams),
    type: getTypeFromParams(hashParams) || getTypeFromParams(searchParams),
    errorDescription: getErrorDescriptionFromParams(searchParams) || getErrorDescriptionFromParams(hashParams),
    errorCode: getErrorCodeFromParams(searchParams) || getErrorCodeFromParams(hashParams),
    isPathToken: pathToken.isPathToken,
  };
};

export const extractAuthTokenFromLocation = (locationLike: LocationShape): string | null => {
  return extractAuthPayloadFromLocation(locationLike).token;
};

export const extractAuthTypeFromLocation = (locationLike: QueryShape): string | null => {
  return extractAuthPayloadFromLocation({ ...locationLike, pathname: '/' }).type;
};

export const cleanAuthToken = (rawToken: string): string => {
  const trimmedToken = rawToken.trim();

  if (!trimmedToken) {
    return trimmedToken;
  }

  const searchLikeParams = new URLSearchParams(trimmedToken.startsWith('?') ? trimmedToken.slice(1) : trimmedToken);
  const searchLikeToken = getTokenFromParams(searchLikeParams);

  if (searchLikeToken) {
    return searchLikeToken;
  }

  if (trimmedToken.startsWith('http://') || trimmedToken.startsWith('https://')) {
    try {
      const url = new URL(trimmedToken);
      const hash = url.hash.startsWith('#') ? url.hash.slice(1) : url.hash;
      const hashToken = getTokenFromParams(new URLSearchParams(hash));

      if (hashToken) {
        return hashToken;
      }

      const queryToken = getTokenFromParams(url.searchParams);

      if (queryToken) {
        return queryToken;
      }

      const pathParts = url.pathname.split('/').filter(Boolean);
      return pathParts[pathParts.length - 1] || trimmedToken;
    } catch {
      return trimmedToken;
    }
  }

  return trimmedToken;
};

export const extractAuthPayloadFromInput = (rawInput: string): AuthCallbackPayload => {
  const trimmedInput = rawInput.trim();

  if (!trimmedInput) {
    return emptyAuthPayload();
  }

  if (trimmedInput.startsWith('http://') || trimmedInput.startsWith('https://')) {
    try {
      const url = new URL(trimmedInput);
      return extractAuthPayloadFromLocation(url);
    } catch {
      return { ...emptyAuthPayload(), token: trimmedInput };
    }
  }

  if (trimmedInput.startsWith('#')) {
    return extractAuthPayloadFromLocation({ hash: trimmedInput, search: '', pathname: '/' });
  }

  if (trimmedInput.startsWith('?') || trimmedInput.includes('access_token=') || trimmedInput.includes('token=')) {
    return extractAuthPayloadFromLocation({ hash: '', search: trimmedInput.startsWith('?') ? trimmedInput : `?${trimmedInput}`, pathname: '/' });
  }

  return { ...emptyAuthPayload(), token: trimmedInput };
};

const safelyDecodeMessage = (message: string) => {
  try {
    return decodeURIComponent(message.replace(/\+/g, ' '));
  } catch {
    return message.replace(/\+/g, ' ');
  }
};

export const normalizeAuthErrorMessage = (message?: string | null): string => {
  const cleanedMessage = safelyDecodeMessage((message || '').trim());
  const lowercaseMessage = cleanedMessage.toLowerCase();

  if (!cleanedMessage) {
    return 'The verification link is invalid or expired. Please request a new verification email and use the latest link or token.';
  }

  if (isEmailRateLimitMessage(cleanedMessage)) {
    return getEmailCooldownMessage(parseEmailCooldownSeconds(cleanedMessage));
  }

  if (
    lowercaseMessage.includes('email link is invalid or has expired') ||
    lowercaseMessage.includes('otp_expired') ||
    lowercaseMessage.includes('expired verification link') ||
    lowercaseMessage.includes('token has expired') ||
    lowercaseMessage.includes('invalid or expired verification token')
  ) {
    return 'This verification link has already been used or has expired. Please resend the verification email and use the newest link or token.';
  }

  if (lowercaseMessage.includes('auth session missing')) {
    return 'The verification link is incomplete. Please open the latest email again or paste the full confirmation link into the verification box.';
  }

  if (lowercaseMessage.includes('invalid refresh token')) {
    return 'This verification session is no longer valid. Please resend the verification email and open the newest link.';
  }

  return cleanedMessage;
};

export const isOtpCode = (token: string) => /^\d{6}$/.test(token);

export const isJwtLikeToken = (token: string) => token.length > 50 && token.split('.').length === 3;
