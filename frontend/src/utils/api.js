export function getApiBase() {
  if (import.meta.env.VITE_API_BASE) {
    return import.meta.env.VITE_API_BASE.replace(/\/$/, "");
  }

  // During Vite development, always use its same-origin /api proxy.
  // This remains correct even when a developer overrides the dev-server port.
  if (import.meta.env.DEV) {
    return "";
  }

  const { hostname, port, protocol } = window.location;

  if (protocol === "https:" || port === "8000" || port === "" || port === "80" || port === "443") {
    return "";
  }

  if (!hostname) return "";
  return `http://${hostname}:8000`;
}
