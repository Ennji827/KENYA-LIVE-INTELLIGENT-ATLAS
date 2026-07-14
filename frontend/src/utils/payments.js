// Client helpers for the M-PESA payment gateway that gates report generation.
import { getApiBase } from "./api";

async function postJson(path, body) {
  const res = await fetch(`${getApiBase()}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(data.error || "Payment request failed.");
  }
  return data;
}

async function getJson(path) {
  const res = await fetch(`${getApiBase()}${path}`);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(data.error || "Request failed.");
  }
  return data;
}

// Paybill number, amount, business name and a per-payment account reference.
export function fetchPaymentConfig() {
  return getJson("/api/payments/config");
}

// Trigger an STK push (PIN prompt) on the payer's phone.
export function initiateStkPush({ phone, accountRef, description }) {
  return postJson("/api/payments/mpesa/stk-push", {
    phone,
    account_ref: accountRef,
    description,
  });
}

export function fetchPaymentStatus(checkoutId) {
  return getJson(`/api/payments/mpesa/status?checkout_id=${encodeURIComponent(checkoutId)}`);
}

// Poll status until the payment settles (completed/failed) or we time out.
export function pollPaymentStatus(checkoutId, { intervalMs = 3000, timeoutMs = 90000 } = {}) {
  const started = Date.now();
  return new Promise((resolve, reject) => {
    const tick = async () => {
      try {
        const status = await fetchPaymentStatus(checkoutId);
        if (status.status === "completed" || status.status === "failed") {
          resolve(status);
          return;
        }
        if (Date.now() - started >= timeoutMs) {
          reject(new Error("Payment timed out. If you were charged, use Paybill confirmation."));
          return;
        }
        setTimeout(tick, intervalMs);
      } catch (err) {
        reject(err);
      }
    };
    setTimeout(tick, intervalMs);
  });
}
