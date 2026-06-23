import React from "react";
import ksaLogo from "../assets/ksa-logo.png";

export default function KsaPoweredBy({ variant = "" }) {
  return (
    <div className={`aeis-powered-by ${variant ? `aeis-powered-by-${variant}` : ""}`}>
      <span className="aeis-powered-label">Powered by</span>
      <div className="aeis-powered-logo-wrap" aria-label="Powered by Kenya Space Agency">
        <span className="aeis-powered-orbit orbit-one" aria-hidden="true" />
        <span className="aeis-powered-orbit orbit-two" aria-hidden="true" />
        <span className="aeis-powered-orbit orbit-three" aria-hidden="true" />
        <span className="aeis-powered-satellite" aria-hidden="true" />
        <span className="aeis-powered-star star-one" aria-hidden="true" />
        <span className="aeis-powered-star star-two" aria-hidden="true" />
        <span className="aeis-powered-star star-three" aria-hidden="true" />
        <img src={ksaLogo} alt="Kenya Space Agency" />
      </div>
    </div>
  );
}
