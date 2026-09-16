export type HunterRoute = "priority" | "good_cold" | "cold_fit" | "monitor";

export type HunterQualificationReason =
  | "TWO_SIGNAL_RULE"
  | "SCORE_ROUTE"
  | "MISSING_FIT"
  | "MISSING_SIGNAL"
  | "MISSING_BUYER";

export type HunterSignalType =
  | "ai_search_hiring"
  | "seo_hiring"
  | "public_ai_search"
  | "leadership_change"
  | "funding"
  | "expansion"
  | "launch"
  | "foremention_gap"
  | "citation_gap";

export type HunterFitInput = {
  b2bSoftware: boolean;
  employeeBandFit: boolean;
  organicMotion: boolean;
  marketFit: boolean;
};

export type HunterSignalInput = {
  type: HunterSignalType;
  strength: number;
  sourceUrl: string;
  observedAt: string;
};

export type HunterBuyerInput = {
  role: string;
  hasEmail: boolean;
  hasLinkedIn: boolean;
};

export type HunterQualificationInput = {
  fit: HunterFitInput;
  signals: HunterSignalInput[];
  buyer: HunterBuyerInput | null;
};

export type HunterQualificationResult = {
  fitScore: number;
  intentScore: number;
  buyerScore: number;
  totalScore: number;
  outreachReady: boolean;
  route: HunterRoute;
  reason: HunterQualificationReason;
  strongSignalCount: number;
};
