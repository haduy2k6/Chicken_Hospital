export const GOOGLE_LOGIN_PATH = '/auth/google';
export const GOOGLE_CALLBACK_PATH = '/auth/google/callback';

const normalize = (path: string): string => (path.length > 1 ? path.replace(/\/+$/, '') : path);

export const isGoogleLoginPath = (path: string): boolean => normalize(path) === GOOGLE_LOGIN_PATH;
export const isGoogleCallbackPath = (path: string): boolean => normalize(path) === GOOGLE_CALLBACK_PATH;
