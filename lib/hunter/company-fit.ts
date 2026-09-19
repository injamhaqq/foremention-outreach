export type HunterCompanyFitInput = {
  companyName: string;
  domain: string;
  evidenceText: string;
  employeeCount?: number | null;
  market?: string | null;
};

const SOFTWARE = /\b(b2b|saas|software|platform|api|cloud|developer\s+tool|martech|fintech|hrtech|cybersecurity|data\s+platform|business\s+software)\b/i;
const ORGANIC = /\b(seo|organic\s+(?:search|growth|traffic)|content\s+(?:marketing|strategy|seo)|search\s+(?:visibility|strategy|traffic)|ai\s+overviews?|generative\s+search|\bgeo\b|\baeo\b)\b/i;
const TARGET_MARKETS = /\b(united\s+states|usa|u\.s\.|uk|united\s+kingdom|canada|australia|europe|north\s+america)\b/i;

export function inferHunterCompanyFit(input: HunterCompanyFitInput) {
  const text = `${input.companyName} ${input.domain} ${input.evidenceText}`;
  const employeeCount = Number(input.employeeCount);
  return {
    b2bSoftware: SOFTWARE.test(text),
    employeeBandFit: Number.isFinite(employeeCount) && employeeCount >= 20 && employeeCount <= 2_000,
    organicMotion: ORGANIC.test(text),
    marketFit: TARGET_MARKETS.test(`${input.market ?? ""} ${input.evidenceText}`),
  };
}
