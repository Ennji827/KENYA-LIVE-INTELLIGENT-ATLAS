export function normalizeAdminName(value) {
  if (value === null || value === undefined) return "";
  return String(value)
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/&/g, " and ")
    .replace(/[-_/]+/g, " ")
    .replace(/[^\w\s]/g, "")
    .replace(/\b(county|subcounty|sub county|ward)\b/gi, "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

export function normalizeAdminCode(value) {
  if (value === null || value === undefined) return "";
  return String(value).trim().toUpperCase().replace(/\s+/g, "");
}

export function featureProperty(feature, keys, fallback = "") {
  const props = feature?.properties || {};
  const candidates = Array.isArray(keys) ? keys : [keys];

  for (const key of candidates) {
    const value = props[key];
    if (value !== null && value !== undefined && String(value).trim() !== "") {
      return value;
    }
  }

  return fallback;
}

export function countyName(feature) {
  return featureProperty(feature, ["ADM1_EN", "County", "NAME_1", "NAME"], "");
}

export function countyCode(feature) {
  return featureProperty(feature, ["ADM1_PCODE", "COUNTY_CODE", "countyCode"], "");
}

export function subCountyName(feature) {
  return featureProperty(feature, ["ADM2_EN", "SubCounty", "NAME_2", "NAME"], "");
}

export function subCountyCode(feature) {
  return featureProperty(feature, ["ADM2_PCODE", "SUBCOUNTY_CODE"], "");
}

export function wardName(feature) {
  return featureProperty(feature, ["shapeName", "ADM3_EN", "Ward", "NAME_3", "NAME"], "");
}

export function wardCode(feature) {
  return featureProperty(feature, ["shapeID", "ADM3_PCODE", "WARD_CODE"], "");
}

export function countyNumber(feature) {
  const digits = String(countyCode(feature) || "").replace(/\D/g, "");
  return digits ? String(Number(digits)).padStart(3, "0") : "---";
}

function sameCode(left, right) {
  const a = normalizeAdminCode(left);
  const b = normalizeAdminCode(right);
  return Boolean(a && b && a === b);
}

function sameName(left, right) {
  const a = normalizeAdminName(left);
  const b = normalizeAdminName(right);
  return Boolean(a && b && a === b);
}

export function sameCounty(feature, selectedCounty) {
  if (!feature || !selectedCounty) return false;
  if (sameCode(countyCode(feature), countyCode(selectedCounty))) return true;
  return sameName(countyName(feature), countyName(selectedCounty));
}

export function sameSubCounty(feature, selectedSubCounty) {
  if (!feature || !selectedSubCounty) return false;
  if (sameCode(subCountyCode(feature), subCountyCode(selectedSubCounty))) return true;
  return sameName(subCountyName(feature), subCountyName(selectedSubCounty));
}

export function sameWard(feature, selectedWard) {
  if (!feature || !selectedWard) return false;
  if (sameCode(wardCode(feature), wardCode(selectedWard))) return true;
  return (
    sameName(wardName(feature), wardName(selectedWard)) &&
    (!subCountyName(feature) || !subCountyName(selectedWard) || sameSubCounty(feature, selectedWard))
  );
}
