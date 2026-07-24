"""M-PESA (Safaricom Daraja) payment gateway for report generation.

Supports two ways to pay for an intelligence report:

* **Paybill** â€” the user manually pushes money to the configured Paybill
  number using an account reference we hand them, then confirms.
* **M-PESA Express (STK push / prompt)** â€” we ask Daraja to pop a PIN
  prompt on the user's phone and poll for the result.

When Daraja credentials are not configured the module runs in a
self-contained *simulation* mode so the whole flow is demoable end to end
without live keys. Transaction state is kept in the Django cache, so no
database migration is required.
"""

from __future__ import annotations

import base64
import json
import urllib.error
import urllib.parse
import urllib.request
import uuid
from typing import Any

from django.conf import settings
from django.core.cache import cache
from django.utils import timezone


class PaymentError(Exception):
    """Raised for user-facing payment problems (bad phone, gateway error)."""

    def __init__(self, message: str, status: int = 400) -> None:
        super().__init__(message)
        self.status = status


# How long a pending transaction is remembered, and how long the simulated
# "customer is entering their PIN" delay lasts.
_TXN_TTL_SECONDS = 900
_SIMULATED_CONFIRM_DELAY = 6


def _cfg(name: str, default: str = "") -> str:
    return str(getattr(settings, name, default) or "").strip()


def is_simulation() -> bool:
    """Live Daraja needs a consumer key, secret and passkey; else we simulate."""
    return not (
        _cfg("MPESA_CONSUMER_KEY")
        and _cfg("MPESA_CONSUMER_SECRET")
        and _cfg("MPESA_PASSKEY")
    )


def _base_url() -> str:
    env = _cfg("MPESA_ENV", "sandbox").lower()
    if env in {"production", "prod", "live"}:
        return "https://api.safaricom.co.ke"
    return "https://sandbox.safaricom.co.ke"


def report_price() -> int:
    try:
        return max(1, int(getattr(settings, "REPORT_PRICE_KES", 50)))
    except (TypeError, ValueError):
        return 50


def normalize_phone(raw: str) -> str:
    """Coerce a Kenyan MSISDN into Daraja's 2547XXXXXXXX / 2541XXXXXXXX form."""
    digits = "".join(ch for ch in str(raw or "") if ch.isdigit())
    if digits.startswith("0") and len(digits) == 10:
        digits = "254" + digits[1:]
    elif digits.startswith("7") or digits.startswith("1"):
        if len(digits) == 9:
            digits = "254" + digits
    elif digits.startswith("2540"):
        digits = "254" + digits[4:]
    if len(digits) != 12 or not digits.startswith("254"):
        raise PaymentError(
            "Enter a valid Safaricom number, e.g. 0712 345 678 or 254712345678."
        )
    return digits


def account_reference(prefix_hint: str = "") -> str:
    """A short, human-readable Paybill account number for this payment."""
    prefix = _cfg("MPESA_ACCOUNT_PREFIX", "KLIA") or "KLIA"
    token = (prefix_hint or uuid.uuid4().hex[:6]).upper()
    token = "".join(ch for ch in token if ch.isalnum())[:8] or uuid.uuid4().hex[:6].upper()
    return f"{prefix}-{token}"


def gateway_config() -> dict[str, Any]:
    """Non-secret config the frontend needs to render the payment screen."""
    return {
        "business_name": _cfg("MPESA_BUSINESS_NAME", "Kenya Space Agency"),
        "paybill": _cfg("MPESA_PAYBILL") or _cfg("MPESA_SHORTCODE", "174379"),
        "amount": report_price(),
        "currency": "KES",
        "account_prefix": _cfg("MPESA_ACCOUNT_PREFIX", "KLIA") or "KLIA",
        "simulation": is_simulation(),
        "methods": ["stk", "paybill"],
    }


# â”€â”€ Cache-backed transaction store â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

def _txn_key(checkout_id: str) -> str:
    return f"mpesa:txn:{checkout_id}"


def _save_txn(txn: dict[str, Any]) -> None:
    cache.set(_txn_key(txn["checkout_id"]), txn, _TXN_TTL_SECONDS)


def _load_txn(checkout_id: str) -> dict[str, Any] | None:
    return cache.get(_txn_key(checkout_id))


# â”€â”€ Live Daraja helpers â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

def _http_json(url: str, *, headers: dict[str, str], data: bytes | None = None) -> dict[str, Any]:
    request = urllib.request.Request(url, data=data, headers=headers, method="POST" if data else "GET")
    try:
        with urllib.request.urlopen(request, timeout=30) as response:
            body = response.read().decode("utf-8")
    except urllib.error.HTTPError as exc:  # pragma: no cover - network
        detail = exc.read().decode("utf-8", "replace")
        raise PaymentError(f"M-PESA gateway error ({exc.code}): {detail[:200]}", status=502) from exc
    except urllib.error.URLError as exc:  # pragma: no cover - network
        raise PaymentError("Could not reach the M-PESA gateway. Try again shortly.", status=502) from exc
    try:
        return json.loads(body)
    except json.JSONDecodeError as exc:  # pragma: no cover - defensive
        raise PaymentError("M-PESA gateway returned an unexpected response.", status=502) from exc


def _access_token() -> str:
    key = _cfg("MPESA_CONSUMER_KEY")
    secret = _cfg("MPESA_CONSUMER_SECRET")
    credentials = base64.b64encode(f"{key}:{secret}".encode()).decode()
    url = f"{_base_url()}/oauth/v1/generate?grant_type=client_credentials"
    payload = _http_json(url, headers={"Authorization": f"Basic {credentials}"})
    token = payload.get("access_token")
    if not token:
        raise PaymentError("M-PESA authentication failed.", status=502)
    return str(token)


def _stk_password(timestamp: str) -> tuple[str, str]:
    shortcode = _cfg("MPESA_SHORTCODE", "174379")
    passkey = _cfg("MPESA_PASSKEY")
    raw = f"{shortcode}{passkey}{timestamp}".encode()
    return base64.b64encode(raw).decode(), shortcode


# â”€â”€ Public API â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

def initiate_stk(*, phone: str, account_ref: str, description: str = "Intelligence report") -> dict[str, Any]:
    """Trigger an STK push (or simulate one) and return tracking identifiers."""
    msisdn = normalize_phone(phone)
    amount = report_price()
    now = timezone.now()

    if is_simulation():
        checkout_id = f"ws_SIM_{uuid.uuid4().hex[:16]}"
        txn = {
            "checkout_id": checkout_id,
            "merchant_request_id": f"SIM-{uuid.uuid4().hex[:12]}",
            "status": "pending",
            "amount": amount,
            "phone": msisdn,
            "account_ref": account_ref,
            "method": "stk",
            "simulation": True,
            "ready_at": now.timestamp() + _SIMULATED_CONFIRM_DELAY,
            "receipt": None,
        }
        _save_txn(txn)
        return {
            "checkout_id": checkout_id,
            "merchant_request_id": txn["merchant_request_id"],
            "customer_message": "A payment prompt has been sent to your phone. Enter your M-PESA PIN to confirm.",
            "simulation": True,
        }

    timestamp = now.strftime("%Y%m%d%H%M%S")
    password, shortcode = _stk_password(timestamp)
    callback = _cfg("MPESA_CALLBACK_URL")
    body = {
        "BusinessShortCode": shortcode,
        "Password": password,
        "Timestamp": timestamp,
        "TransactionType": "CustomerPayBillOnline",
        "Amount": amount,
        "PartyA": msisdn,
        "PartyB": shortcode,
        "PhoneNumber": msisdn,
        "CallBackURL": callback or "https://example.com/api/payments/mpesa/callback",
        "AccountReference": account_ref[:12],
        "TransactionDesc": description[:60] or "Intelligence report",
    }
    token = _access_token()
    result = _http_json(
        f"{_base_url()}/mpesa/stkpush/v1/processrequest",
        headers={"Authorization": f"Bearer {token}", "Content-Type": "application/json"},
        data=json.dumps(body).encode(),
    )
    checkout_id = result.get("CheckoutRequestID")
    if not checkout_id:
        message = result.get("errorMessage") or result.get("ResponseDescription") or "STK push was rejected."
        raise PaymentError(str(message), status=502)

    txn = {
        "checkout_id": checkout_id,
        "merchant_request_id": result.get("MerchantRequestID", ""),
        "status": "pending",
        "amount": amount,
        "phone": msisdn,
        "account_ref": account_ref,
        "method": "stk",
        "simulation": False,
        "receipt": None,
    }
    _save_txn(txn)
    return {
        "checkout_id": checkout_id,
        "merchant_request_id": txn["merchant_request_id"],
        "customer_message": result.get(
            "CustomerMessage", "A payment prompt has been sent to your phone."
        ),
        "simulation": False,
    }


def query_status(checkout_id: str) -> dict[str, Any]:
    """Return the current status of a transaction: pending | completed | failed."""
    checkout_id = str(checkout_id or "").strip()
    if not checkout_id:
        raise PaymentError("A checkout id is required.")
    txn = _load_txn(checkout_id)
    if not txn:
        raise PaymentError("Unknown or expired transaction.", status=404)

    # Terminal states are cached â€” nothing more to do.
    if txn["status"] in {"completed", "failed"}:
        return _status_payload(txn)

    if txn.get("simulation"):
        if timezone.now().timestamp() >= float(txn.get("ready_at", 0)):
            txn["status"] = "completed"
            txn["receipt"] = f"SIM{uuid.uuid4().hex[:8].upper()}"
            _save_txn(txn)
        return _status_payload(txn)

    # Live: ask Daraja directly (the callback may not have landed yet).
    try:
        _reconcile_live(txn)
    except PaymentError:
        # Leave as pending; the client will poll again.
        pass
    return _status_payload(txn)


def _reconcile_live(txn: dict[str, Any]) -> None:  # pragma: no cover - network
    timestamp = timezone.now().strftime("%Y%m%d%H%M%S")
    password, shortcode = _stk_password(timestamp)
    body = {
        "BusinessShortCode": shortcode,
        "Password": password,
        "Timestamp": timestamp,
        "CheckoutRequestID": txn["checkout_id"],
    }
    token = _access_token()
    result = _http_json(
        f"{_base_url()}/mpesa/stkpushquery/v1/query",
        headers={"Authorization": f"Bearer {token}", "Content-Type": "application/json"},
        data=json.dumps(body).encode(),
    )
    result_code = str(result.get("ResultCode", ""))
    if result_code == "0":
        txn["status"] = "completed"
        _save_txn(txn)
    elif result_code and result_code not in {"1032", "1037", ""}:
        # 1032 = cancelled by user is still "failed"; but 500.001.1001 style
        # "still processing" codes should stay pending. Treat clear failures.
        txn["status"] = "failed"
        txn["failure_reason"] = result.get("ResultDesc", "Payment failed.")
        _save_txn(txn)


def handle_callback(payload: dict[str, Any]) -> dict[str, Any]:
    """Process a Daraja STK callback and flip the stored transaction state."""
    stk = (payload.get("Body") or {}).get("stkCallback") or {}
    checkout_id = stk.get("CheckoutRequestID")
    if not checkout_id:
        return {"ResultCode": 0, "ResultDesc": "Ignored: no CheckoutRequestID."}
    txn = _load_txn(checkout_id)
    if not txn:
        return {"ResultCode": 0, "ResultDesc": "Ignored: unknown transaction."}

    if str(stk.get("ResultCode")) == "0":
        txn["status"] = "completed"
        items = (stk.get("CallbackMetadata") or {}).get("Item") or []
        for item in items:
            if item.get("Name") == "MpesaReceiptNumber":
                txn["receipt"] = item.get("Value")
    else:
        txn["status"] = "failed"
        txn["failure_reason"] = stk.get("ResultDesc", "Payment failed.")
    _save_txn(txn)
    return {"ResultCode": 0, "ResultDesc": "Accepted"}


def _status_payload(txn: dict[str, Any]) -> dict[str, Any]:
    return {
        "checkout_id": txn["checkout_id"],
        "status": txn["status"],
        "paid": txn["status"] == "completed",
        "amount": txn.get("amount"),
        "currency": "KES",
        "receipt": txn.get("receipt"),
        "account_ref": txn.get("account_ref"),
        "failure_reason": txn.get("failure_reason"),
        "simulation": bool(txn.get("simulation")),
    }
