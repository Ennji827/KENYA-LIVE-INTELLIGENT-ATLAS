export function getApiBase() {
  if (import.meta.env.VITE_API_BASE) return import.meta.env.VITE_API_BASE;

  const hostname = window.location.hostname || "127.0.0.1";
  return `http://${hostname}:5000`;
}
