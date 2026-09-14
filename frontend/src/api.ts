const server = import.meta.env.VITE_API_URL ?? 'http://localhost:3000';
let csrf = '';
export async function api(path: string, options: RequestInit = {}) {
  if (!csrf && !['GET','HEAD'].includes(options.method ?? 'GET') && path !== '/api/v1/demo') {
    const session = await fetch(server + '/api/v1/session', {credentials:'include'});
    if (session.ok) csrf = (await session.json()).csrf;
  }
  const headers = new Headers(options.headers);
  if (csrf) headers.set('X-CSRF-Token',csrf);
  const response = await fetch(server + path,{...options,headers,credentials:'include'});
  if (path === '/api/v1/demo' && response.ok) csrf = (await response.clone().json()).csrf;
  return response;
}
export const googleLogin = server + '/auth/google';
