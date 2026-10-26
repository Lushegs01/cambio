// Some wallet SDKs import `cross-fetch`, whose ponyfill can conflict with a sandboxed iframe's
// window.fetch. This alias simply re-exports the platform implementation. It never fabricates
// responses: a failed request fails, so callers can show an honest error.
const nativeFetch: typeof globalThis.fetch = (...args) => globalThis.fetch(...args);

export const fetch = nativeFetch;
export const Headers = globalThis.Headers;
export const Request = globalThis.Request;
export const Response = globalThis.Response;

export default nativeFetch;
