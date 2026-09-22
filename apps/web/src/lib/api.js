const RAW_BASE = import.meta.env.VITE_API_BASE ?? '';

export const API_BASE = String(RAW_BASE).replace(/\/+$/, '');

let getName = () => '';
let getPin = () => '';

/** Wire the session store accessors in once, at app startup. */
export function configureAuth({ name, pin }) {
  if (typeof name === 'function') getName = name;
  if (typeof pin === 'function') getPin = pin;
}

function isAscii(value) {
  // eslint-disable-next-line no-control-regex
  return /^[\x20-\x7E]*$/.test(value);
}

export function authHeaders() {
  const headers = {};
  const name = getName();
  if (name) {
    headers['x-jukebox-user'] = isAscii(name) ? name : encodeURIComponent(name);
  }
  const pin = getPin();
  if (pin) headers['x-admin-pin'] = pin;
  return headers;
}

export function apiUrl(path) {
  if (/^https?:\/\//i.test(path)) return path;
  return `${API_BASE}${path.startsWith('/') ? path : `/${path}`}`;
}

export class ApiError extends Error {
  constructor(message, status, body) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.body = body;
  }
}

async function parseBody(response) {
  const text = await response.text();
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

export async function request(path, options = {}) {
  const { method = 'GET', body, headers = {}, signal, raw = false } = options;

  const finalHeaders = { Accept: 'application/json', ...authHeaders(), ...headers };
  let payload = body;

  if (body !== undefined && body !== null && !(body instanceof FormData)) {
    finalHeaders['Content-Type'] = 'application/json';
    payload = JSON.stringify(body);
  }

  let response;
  try {
    response = await fetch(apiUrl(path), {
      method,
      headers: finalHeaders,
      body: payload,
      signal,
      credentials: 'same-origin'
    });
  } catch (error) {
    if (error?.name === 'AbortError') throw error;
    throw new ApiError('Network error — is the Jukie server running?', 0, null);
  }

  if (raw) {
    if (!response.ok) {
      const data = await parseBody(response);
      throw new ApiError(errorMessage(data, response), response.status, data);
    }
    return response;
  }

  const data = await parseBody(response);
  if (!response.ok) {
    throw new ApiError(errorMessage(data, response), response.status, data);
  }
  return data;
}

function errorMessage(data, response) {
  if (data && typeof data === 'object' && typeof data.error === 'string') return data.error;
  if (typeof data === 'string' && data.trim()) return data.trim();
  return `Request failed (${response.status} ${response.statusText || 'error'})`;
}

export const api = {
  get: (path, options) => request(path, { ...options, method: 'GET' }),
  post: (path, body, options) => request(path, { ...options, method: 'POST', body }),
  put: (path, body, options) => request(path, { ...options, method: 'PUT', body }),
  del: (path, body, options) => request(path, { ...options, method: 'DELETE', body })
};

/**
 * XHR-based multipart upload so we can report progress.
 */
export function uploadFile(path, formData, { onProgress } = {}) {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('POST', apiUrl(path));
    const headers = authHeaders();
    for (const [key, value] of Object.entries(headers)) xhr.setRequestHeader(key, value);
    xhr.setRequestHeader('Accept', 'application/json');

    xhr.upload.addEventListener('progress', (event) => {
      if (!onProgress) return;
      onProgress(event.lengthComputable ? Math.round((event.loaded / event.total) * 100) : null);
    });

    xhr.addEventListener('load', () => {
      let data = null;
      try {
        data = xhr.responseText ? JSON.parse(xhr.responseText) : null;
      } catch {
        data = xhr.responseText;
      }
      if (xhr.status >= 200 && xhr.status < 300) {
        resolve(data);
        return;
      }
      const message =
        data && typeof data === 'object' && data.error ? data.error : `Upload failed (${xhr.status})`;
      reject(new ApiError(message, xhr.status, data));
    });

    xhr.addEventListener('error', () => reject(new ApiError('Upload failed — network error', 0, null)));
    xhr.addEventListener('abort', () => reject(new ApiError('Upload cancelled', 0, null)));

    xhr.send(formData);
  });
}
