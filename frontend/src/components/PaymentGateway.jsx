import React, { useEffect, useState } from "react";
import {
  Smartphone,
  Copy,
  Check,
  CheckCircle2,
  Loader2,
  ShieldCheck,
  X,
  AlertCircle,
} from "lucide-react";
import {
  fetchPaymentConfig,
  initiateStkPush,
  pollPaymentStatus,
} from "../utils/payments";

// Payment gateway shown before an intelligence report is unlocked. Offers two
// M-PESA methods: Express / STK push (a PIN prompt on the payer's phone) and a
// manual Paybill flow.
export default function PaymentGateway({ user, description, onPaid, onClose }) {
  const [config, setConfig] = useState(null);
  const [loadErr, setLoadErr] = useState("");
  const [method, setMethod] = useState("stk");

  useEffect(() => {
    let alive = true;
    fetchPaymentConfig()
      .then((c) => alive && setConfig(c))
      .catch((e) => alive && setLoadErr(e.message || "Could not load payment options."));
    return () => {
      alive = false;
    };
  }, []);

  const amount = config?.amount ?? 50;
  const currency = config?.currency ?? "KES";

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="pay" onClick={(e) => e.stopPropagation()}>
        {/* Branded header */}
        <div className="pay__head">
          <div className="pay__brand">
            <MpesaMark />
            <div>
              <div className="pay__brand-title">Lipa na M-PESA</div>
              <div className="pay__brand-sub">
                {config?.business_name || "Kenya Space Agency"}
              </div>
            </div>
          </div>
          <button className="pay__close" onClick={onClose} aria-label="Close">
            <X size={18} />
          </button>
        </div>

        <div className="pay__amount">
          <span className="pay__amount-label">Amount due</span>
          <span className="pay__amount-value">
            {currency} {Number(amount).toLocaleString()}
          </span>
          <span className="pay__amount-hint">Unlocks this intelligence report</span>
        </div>

        {loadErr && (
          <div className="pay__alert pay__alert--error">
            <AlertCircle size={16} /> {loadErr}
          </div>
        )}

        {config?.simulation && (
          <div className="pay__alert pay__alert--info">
            <ShieldCheck size={16} /> Sandbox mode — no real money moves. The
            prompt auto-confirms for demonstration.
          </div>
        )}

        {/* Method switch */}
        <div className="pay__tabs" role="tablist">
          <button
            className={`pay__tab${method === "stk" ? " is-active" : ""}`}
            onClick={() => setMethod("stk")}
            role="tab"
            aria-selected={method === "stk"}
          >
            <Smartphone size={16} /> Prompt (STK)
          </button>
          <button
            className={`pay__tab${method === "paybill" ? " is-active" : ""}`}
            onClick={() => setMethod("paybill")}
            role="tab"
            aria-selected={method === "paybill"}
          >
            <Copy size={16} /> Paybill
          </button>
        </div>

        {method === "stk" ? (
          <StkFlow
            user={user}
            config={config}
            amount={amount}
            currency={currency}
            description={description}
            onPaid={onPaid}
          />
        ) : (
          <PaybillFlow
            config={config}
            amount={amount}
            currency={currency}
            onPaid={onPaid}
          />
        )}

        <div className="pay__secure">
          <ShieldCheck size={14} /> Secured by Safaricom Daraja
        </div>
      </div>
    </div>
  );
}

// ── STK push (prompt) ─────────────────────────────────────────────────
function StkFlow({ user, config, amount, currency, description, onPaid }) {
  const [phone, setPhone] = useState(user?.phone || user?.msisdn || "");
  const [stage, setStage] = useState("idle"); // idle | sending | waiting | done | error
  const [message, setMessage] = useState("");

  const disabled = stage === "sending" || stage === "waiting";

  const pay = async () => {
    if (!phone.trim()) {
      setStage("error");
      setMessage("Enter the phone number to prompt.");
      return;
    }
    setStage("sending");
    setMessage("");
    try {
      const init = await initiateStkPush({
        phone: phone.trim(),
        accountRef: config?.account_ref,
        description,
      });
      setStage("waiting");
      setMessage(init.customer_message || "Check your phone and enter your M-PESA PIN.");
      const status = await pollPaymentStatus(init.checkout_id);
      if (status.paid) {
        setStage("done");
        setMessage("Payment received. Unlocking your report…");
        setTimeout(() => onPaid({ method: "stk", ...status }), 700);
      } else {
        setStage("error");
        setMessage(status.failure_reason || "Payment was not completed.");
      }
    } catch (err) {
      setStage("error");
      setMessage(err.message || "Something went wrong. Please try again.");
    }
  };

  return (
    <div className="pay__body">
      <label className="pay__label" htmlFor="pay-phone">
        Safaricom number
      </label>
      <input
        id="pay-phone"
        className="pay__input"
        type="tel"
        inputMode="numeric"
        placeholder="0712 345 678"
        value={phone}
        onChange={(e) => setPhone(e.target.value)}
        disabled={disabled}
      />
      <p className="pay__note">
        We'll send a payment prompt to this number. Enter your M-PESA PIN to
        authorise {currency} {Number(amount).toLocaleString()}.
      </p>

      {message && (
        <div
          className={`pay__alert ${
            stage === "error"
              ? "pay__alert--error"
              : stage === "done"
              ? "pay__alert--ok"
              : "pay__alert--info"
          }`}
        >
          {stage === "waiting" && <Loader2 size={16} className="pay__spin" />}
          {stage === "done" && <CheckCircle2 size={16} />}
          {stage === "error" && <AlertCircle size={16} />}
          {message}
        </div>
      )}

      <button className="pay__cta" onClick={pay} disabled={disabled}>
        {stage === "sending" && <Loader2 size={16} className="pay__spin" />}
        {stage === "waiting" && <Loader2 size={16} className="pay__spin" />}
        {stage === "sending"
          ? "Sending prompt…"
          : stage === "waiting"
          ? "Waiting for PIN…"
          : `Pay ${currency} ${Number(amount).toLocaleString()}`}
      </button>
    </div>
  );
}

// ── Paybill (manual) ──────────────────────────────────────────────────
function PaybillFlow({ config, amount, currency, onPaid }) {
  const [confirming, setConfirming] = useState(false);
  const paybill = config?.paybill || "—";
  const accountRef = config?.account_ref || "—";

  const confirm = () => {
    setConfirming(true);
    // A manual Paybill payment can't be verified synchronously; we accept the
    // user's confirmation optimistically (real C2B reconciliation happens via
    // the M-PESA callback).
    setTimeout(
      () => onPaid({ method: "paybill", account_ref: accountRef, amount, currency }),
      500,
    );
  };

  return (
    <div className="pay__body">
      <ol className="pay__steps">
        <li>
          Go to <strong>M-PESA</strong> → <strong>Lipa na M-PESA</strong> →{" "}
          <strong>Pay Bill</strong>
        </li>
        <li>
          Enter Business no. and Account no. below, then the amount{" "}
          <strong>{currency} {Number(amount).toLocaleString()}</strong>
        </li>
        <li>Confirm with your M-PESA PIN, then tap “I've paid”.</li>
      </ol>

      <CopyField label="Business no. (Paybill)" value={paybill} />
      <CopyField label="Account no." value={accountRef} />
      <CopyField label="Amount" value={`${currency} ${Number(amount).toLocaleString()}`} />

      <button className="pay__cta" onClick={confirm} disabled={confirming}>
        {confirming && <Loader2 size={16} className="pay__spin" />}
        {confirming ? "Confirming…" : "I've paid"}
      </button>
    </div>
  );
}

function CopyField({ label, value }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(String(value));
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* clipboard unavailable — value is still visible to copy manually */
    }
  };
  return (
    <div className="pay__copy">
      <div className="pay__copy-meta">
        <span className="pay__copy-label">{label}</span>
        <span className="pay__copy-value">{value}</span>
      </div>
      <button className="pay__copy-btn" onClick={copy} aria-label={`Copy ${label}`}>
        {copied ? <Check size={16} /> : <Copy size={16} />}
      </button>
    </div>
  );
}

// Simple text mark styled as the M-PESA logo lockup.
function MpesaMark() {
  return (
    <div className="mpesa-mark" aria-label="M-PESA">
      <span className="mpesa-mark__m">M</span>
      <span className="mpesa-mark__pesa">PESA</span>
    </div>
  );
}
