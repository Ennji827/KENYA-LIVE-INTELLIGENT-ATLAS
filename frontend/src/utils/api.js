export function getApiBase() {
  if (import.meta.env.VITE_API_BASE) {
    return import.meta.env.VITE_API_BASE.replace(/\/$/, "");
  }

  const { hostname, port, protocol } = window.location;

  if (protocol === "https:" || port === "5173" || port === "5000" || port === "" || port === "80" || port === "443") {
    return "";
  }

  if (!hostname) return "";
  return `http://${hostname}:5000`;
}
