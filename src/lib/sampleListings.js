// Shared fallback listings, used by both LandingPage (public, anonymous)
// and BuyerListingsPanel (post-login, inside Platform) whenever Supabase
// returns no live rows yet - e.g. a fresh database - so the marketplace
// never looks empty. Single source of truth so the two never drift.
export var SAMPLE_LISTINGS = [
  { id: 's1', business_name: 'Precision Auto Components', sector: 'Manufacturing', city: 'Coimbatore', state: 'Tamil Nadu', revenue_lakhs: 850, ebitda_lakhs: 128, asking_price_lakhs: 950, verification_status: 'verified', years_in_operation: 12 },
  { id: 's2', business_name: 'Southline IT Services', sector: 'IT Services / BPO', city: 'Hyderabad', state: 'Telangana', revenue_lakhs: 420, ebitda_lakhs: 92, asking_price_lakhs: 650, verification_status: 'verified', years_in_operation: 7 },
  { id: 's3', business_name: 'Coastal Foods Distribution', sector: 'Trading / Distribution', city: 'Kochi', state: 'Kerala', revenue_lakhs: 1200, ebitda_lakhs: 96, asking_price_lakhs: 480, verification_status: 'self_reported', years_in_operation: 15 },
  { id: 's4', business_name: 'Vertex Diagnostics Chain', sector: 'Healthcare Services', city: 'Pune', state: 'Maharashtra', revenue_lakhs: 640, ebitda_lakhs: 154, asking_price_lakhs: 1400, verification_status: 'expert_verified', years_in_operation: 9 },
  { id: 's5', business_name: 'Northgate Logistics', sector: 'Transportation / Logistics', city: 'Delhi NCR', state: 'Delhi NCR', revenue_lakhs: 980, ebitda_lakhs: 118, asking_price_lakhs: 900, verification_status: 'verified', years_in_operation: 11 },
  { id: 's6', business_name: 'Lumen EdTech Platform', sector: 'Education / EdTech', city: 'Bengaluru', state: 'Karnataka', revenue_lakhs: 310, ebitda_lakhs: 55, asking_price_lakhs: 700, verification_status: 'self_reported', years_in_operation: 4 },
  { id: 's7', business_name: 'Ashoka Precision Tooling', sector: 'Manufacturing', city: 'Pune', state: 'Maharashtra', revenue_lakhs: 560, ebitda_lakhs: 84, asking_price_lakhs: 620, verification_status: 'verified', years_in_operation: 18 },
  { id: 's8', business_name: 'Meridian Consulting Group', sector: 'Professional Services', city: 'Mumbai', state: 'Maharashtra', revenue_lakhs: 275, ebitda_lakhs: 68, asking_price_lakhs: 540, verification_status: 'self_reported', years_in_operation: 6 },
];
