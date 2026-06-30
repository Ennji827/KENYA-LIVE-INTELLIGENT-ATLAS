export const kenyaCountyNames = [
  "Mombasa",
  "Kwale",
  "Kilifi",
  "Tana River",
  "Lamu",
  "Taita Taveta",
  "Garissa",
  "Wajir",
  "Mandera",
  "Marsabit",
  "Isiolo",
  "Meru",
  "Tharaka-Nithi",
  "Embu",
  "Kitui",
  "Machakos",
  "Makueni",
  "Nyandarua",
  "Nyeri",
  "Kirinyaga",
  "Murang'a",
  "Kiambu",
  "Turkana",
  "West Pokot",
  "Samburu",
  "Trans Nzoia",
  "Uasin Gishu",
  "Elgeyo-Marakwet",
  "Nandi",
  "Baringo",
  "Laikipia",
  "Nakuru",
  "Narok",
  "Kajiado",
  "Kericho",
  "Bomet",
  "Kakamega",
  "Vihiga",
  "Bungoma",
  "Busia",
  "Siaya",
  "Kisumu",
  "Homa Bay",
  "Migori",
  "Kisii",
  "Nyamira",
  "Nairobi",
];

export const countyCodeByName = kenyaCountyNames.reduce((codes, name, index) => {
  const countyNumber = index + 1;
  return {
    ...codes,
    [name]: String(countyNumber).padStart(3, "0"),
  };
}, {});

export function getCountyCode(name) {
  return countyCodeByName[name] || "";
}

function sourceRequiredStats(name, index) {
  const countyNumber = index + 1;
  const countyCode = String(countyNumber).padStart(3, "0");

  return {
    countyNumber,
    countyCode,
    registeredFarms: null,
    mappedAreaHa: null,
    averageNdvi: null,
    vegetationStressLevel: "Source required",
    rainfallRisk: "Live forecast below map",
    soilInputDemandTonnes: null,
    croplandPct: null,
    bareLandPct: null,
    builtUpPct: null,
    grasslandPct: null,
    moistureStatus: "Source required",
    rainfallForecastMm: null,
    vegetationStressScore: null,
    averageRainfall: null,
    rainfallHistory: [],
    rainfallDataSource: "Source required: official historical rainfall feed not connected",
    trends: [],
    fieldSiteRegistrationTrend: [],
    subcountyFarmDistribution: [],
    imageryStatus: {
      satellite: "Real map imagery available",
      ndvi: "Connect GEE/Sentinel/Landsat raster provider for county NDVI values",
      ndwi: "Connect GEE/Sentinel/Landsat raster provider for county NDWI values",
    },
    intelligence: {
      priority: "Source required",
      riskScore: null,
      confidenceScore: null,
      actionWindow: "Blocked until source",
      verificationCoverage: null,
      drivers: [
        { label: "Admin boundary", value: "Loaded from GeoJSON" },
        { label: "Live forecast", value: "Shown below map" },
        { label: "NDVI/NDWI values", value: "Source required" },
        { label: "Field/site registry", value: "Source required" },
      ],
      sourceReadiness: [
        { label: "Admin boundaries", score: 100, status: "Loaded" },
        { label: "Live weather forecast", score: 100, status: "Connected" },
        { label: "County field/site registry", score: 0, status: "Source required" },
        { label: "NDVI/NDWI raster source", score: 0, status: "Source required" },
        { label: "Land-cover classification", score: 0, status: "Source required" },
      ],
      anomalyFlags: [
        {
          type: "Operational analytics",
          detail: "County vegetation, water, land-use, NDVI, NDWI, rainfall-history, soil, and road decisions require connected sources before publication.",
          tone: "medium",
        },
      ],
      recommendations: [
        {
          priority: "Required",
          title: "Connect official data",
          detail: `Connect ${name} field/site registry, mapped boundaries, NDVI/NDWI rasters, land-cover classification, roads, water, soil, and official rainfall history before publishing county decisions.`,
        },
      ],
    },
  };
}

export const kenyaCounties = kenyaCountyNames.map((name, index) => {
  const countyNumber = index + 1;
  const countyCode = String(countyNumber).padStart(3, "0");
  return {
    name,
    countyNumber,
    countyCode,
    displayName: `${countyCode} ${name}`,
    subcounties: [],
    stats: sourceRequiredStats(name, index),
  };
});

export const nationalSummary = {
  title: "AEIS-K Intelligence Dashboard",
  subtitle: "Climate, Water and Land Intelligence System for Kenya",
  registeredFarms: null,
  totalMappedAreaHa: null,
  averageNdvi: null,
  vegetationStressLevel: "Source required",
  rainfallRisk: "Live forecast below map",
  soilInputDemandTonnes: null,
  croplandPct: null,
  bareLandPct: null,
  builtUpPct: null,
  grasslandPct: null,
  reportsReady: 0,
  countiesTracked: kenyaCounties.length,
  rainfallDataStatus: "Live forecast connected; official historical station feed required",
};

export const alerts = [];

export const reports = [];

export const fieldSites = [];

export function getCountyByName(name) {
  if (!name) return null;
  return kenyaCounties.find((county) => county.name === name) || null;
}

export function getDashboardKpis() {
  return [
    { label: "Verified Sites", value: "Source required", note: "Connect verified county registry", tone: "green" },
    { label: "Mapped Land Area", value: "Source required", note: "Connect verified boundaries", tone: "navy" },
    { label: "Average NDVI", value: "Source required", note: "Connect NDVI raster provider", tone: "green" },
    { label: "Vegetation Stress", value: "Blocked", note: "Requires NDVI/NDWI rasters", tone: "amber" },
    { label: "Rainfall Risk", value: "Live forecast", note: "Shown below map", tone: "blue" },
    { label: "Soil/Input Demand", value: "Source required", note: "Registry, land use, soil, rainfall", tone: "green" },
    { label: "Cropland %", value: "Source required", note: "Connect land-cover source", tone: "green" },
    { label: "Bare Land %", value: "Source required", note: "Connect land-cover source", tone: "amber" },
    { label: "Built-up Area %", value: "Source required", note: "Connect land-cover source", tone: "navy" },
    { label: "Grassland %", value: "Source required", note: "Connect land-cover source", tone: "green" },
  ];
}
