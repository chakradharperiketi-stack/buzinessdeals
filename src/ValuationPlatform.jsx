// ValuationPlatform.jsx
// Extracted from BuzinessDealsFull.jsx — BuzinessDeals.com
// Contains: UNIT_MULT, SECTORS, computeDCF, initForm, NumInput, S0-S8, generateReportHTML, ValuationPlatform
// V3 stores all values in raw INR internally. Display converts to Lakhs/Crores.
// When passing data FROM analyst interview (Lakhs) TO V3: multiply by 100,000

import React, { useState, useEffect, useRef, useMemo } from 'react';
import { supabase } from './supabase';
import { sendNotification } from './lib/notifications';

const UNIT_MULT = {Actual:1,Thousands:1e3,Lakhs:1e5,Crores:1e7,Millions:1e6,Billions:1e9};
const FORECAST_OPTS = [3,5,7,10];
const INDIA_ERP=7.075, RF_DEFAULT=7.2;

const SECTORS = [
  {name:"Technology / SaaS",beta:0.463,unlevBeta:0.428,template:"saas",reco:["dcf","vc","comparable"]},
  {name:"IT Services / BPO",beta:0.731,unlevBeta:0.717,template:"services",reco:["dcf","earnings","comparable"]},
  {name:"E-commerce / Marketplace",beta:1.098,unlevBeta:1.057,template:"saas",reco:["dcf","vc","comparable"]},
  {name:"D2C / Consumer Brands",beta:0.804,unlevBeta:0.765,template:"manufacturing",reco:["dcf","comparable","nav"]},
  {name:"Manufacturing",beta:0.827,unlevBeta:0.778,template:"manufacturing",reco:["dcf","nav","comparable"]},
  {name:"Trading / Distribution",beta:0.560,unlevBeta:0.457,template:"trading",reco:["dcf","nav","comparable"]},
  {name:"Professional Services",beta:0.710,unlevBeta:0.645,template:"services",reco:["dcf","earnings","comparable"]},
  {name:"Healthcare Services",beta:0.528,unlevBeta:0.506,template:"services",reco:["dcf","comparable","earnings"]},
  {name:"Healthcare Products / Devices",beta:2.002,unlevBeta:1.979,template:"manufacturing",reco:["dcf","comparable","nav"]},
  {name:"Drugs / Pharmaceuticals",beta:0.767,unlevBeta:0.742,template:"manufacturing",reco:["dcf","comparable","nav"]},
  {name:"Education / EdTech",beta:0.610,unlevBeta:0.573,template:"services",reco:["dcf","vc","comparable"]},
  {name:"Financial Services (Non-Banking)",beta:0.604,unlevBeta:0.298,template:"services",reco:["dcf","earnings","nav"]},
  {name:"Real Estate (Development)",beta:0.755,unlevBeta:0.657,template:"manufacturing",reco:["dcf","nav","comparable"]},
  {name:"Engineering / Construction",beta:1.041,unlevBeta:0.893,template:"manufacturing",reco:["dcf","nav","comparable"]},
  {name:"Hospitality / Hotels / F&B",beta:0.783,unlevBeta:0.733,template:"services",reco:["dcf","comparable","nav"]},
  {name:"Transportation / Logistics",beta:1.129,unlevBeta:0.983,template:"services",reco:["dcf","comparable","nav"]},
  {name:"Telecom Services",beta:0.861,unlevBeta:0.641,template:"services",reco:["dcf","comparable","nav"]},
  {name:"Green / Renewable Energy",beta:1.276,unlevBeta:0.946,template:"manufacturing",reco:["dcf","nav","comparable"]},
  {name:"Agritech / Farming",beta:0.665,unlevBeta:0.621,template:"trading",reco:["dcf","nav","comparable"]},
  {name:"Media / Entertainment / OTT",beta:0.483,unlevBeta:0.418,template:"saas",reco:["dcf","vc","comparable"]},
];

const STAGES = ["Pre-Revenue (Idea / MVP)","Early Stage (0-2 yrs revenue)","Growth Stage (scaling)","Mature / Profitable"];
const PURPOSES = [
  "Issuance of Equity Shares (FEMA / RBI)","Angel Tax / Section 56(2)(viib) Defence",
  "Fundraising - Seed / Angel","Fundraising - Series A / Growth",
  "CCPS / Preference Share Pricing","Merger & Acquisition",
  "ESOP Pricing","Buyback of Shares","Internal / Board Assessment",
];
const DESIGNATIONS = ["Director","Shareholder","Director cum Shareholder"];

const PRODUCT_TYPES = ["Manufacturing","Trading","Services","Technology","SaaS","Consulting","Healthcare","Others"];
const REVENUE_MODELS = ["Subscription","Transaction Based","Licensing","Project Based","Product Sales","Recurring Revenue","Others"];
const CUSTOMER_SEGS = ["B2B","B2C","B2G","Enterprise","SME","Retail","International","Others"];
const COMP_ADVANTAGES = ["Proprietary Technology","Strong Brand","Customer Relationships","Distribution Network","Cost Leadership","Regulatory Approvals","Strategic Partnerships","Others"];
const GROWTH_DRIVERS = ["Market Expansion","New Products","Geographic Expansion","Capacity Expansion","Technology Adoption","Strategic Alliances","Others"];
const RISK_TYPES = ["Customer Concentration","Regulatory Risk","Competition","Technology Risk","Management Dependency","Working Capital Constraints","Economic Slowdown","Others"];

const METHOD_DEFS = [
  {id:"dcf",name:"Discounted Cash Flow (DCF)",icon:"ti-chart-line",purpose:"Values business based on projected FCFFs discounted at WACC.",best_for:"Revenue-generating businesses with projectable cash flows.",limitation:"Sensitive to WACC and terminal growth assumptions.",applicability_fn:()=>true,reliability_fn:(s)=>s.includes("Pre")?"Medium":"High"},
  {id:"vc",name:"VC Method",icon:"ti-rocket",purpose:"Back-solves current value from exit value discounted at investor IRR.",best_for:"Pre-revenue and early-stage startups.",limitation:"Exit multiple and IRR assumptions are subjective.",applicability_fn:(s)=>!s.includes("Mature"),reliability_fn:(s)=>s.includes("Pre")?"High":"Medium"},
  {id:"comparable",name:"Comparable Company Multiples",icon:"ti-building-skyscraper",purpose:"Applies EV/Revenue or EV/EBITDA multiples from listed peers.",best_for:"Businesses with identifiable listed comparable companies.",limitation:"True comparables are scarce in unlisted Indian markets.",applicability_fn:(s)=>!s.includes("Pre"),reliability_fn:(s)=>s.includes("Mature")?"High":"Medium"},
  {id:"nav",name:"Net Asset Value (NAV)",icon:"ti-building-factory-2",purpose:"Values business at fair value of adjusted net assets.",best_for:"Asset-heavy: manufacturing, real estate, holding companies.",limitation:"Ignores future earnings potential and goodwill.",applicability_fn:()=>true,reliability_fn:()=>"Medium"},
  {id:"earnings",name:"Earnings Capitalization",icon:"ti-coin",purpose:"Capitalizes maintainable annual earnings at a capitalisation rate.",best_for:"Stable, mature businesses with consistent earnings.",limitation:"Not applicable for loss-making or high-growth businesses.",applicability_fn:(s)=>s.includes("Mature")||s.includes("Growth"),reliability_fn:(s)=>s.includes("Mature")?"High":"Medium"},
  {id:"transactions",name:"Comparable Transactions",icon:"ti-arrows-exchange",purpose:"Uses multiples from recent M&A transactions in same sector.",best_for:"M&A advisory, exit planning, strategic transactions.",limitation:"Transaction data largely unavailable in Indian private markets.",applicability_fn:()=>true,reliability_fn:()=>"Low"},
];

const TIPS = {
  wacc:{title:"WACC - Weighted Average Cost of Capital",meaning:"The minimum blended return a business must generate to satisfy both equity investors and lenders.",range:"Seed startups: 25-40%. Growth: 18-28%. Mature: 12-18%."},
  ev:{title:"Enterprise Value (EV)",meaning:"Total value of business - what a buyer would pay including assumption of all debt, net of cash.",range:"EV = Equity Value + Debt - Cash"},
  equity_value:{title:"Equity Value",meaning:"The portion of Enterprise Value belonging to shareholders after repaying all debt and adding back cash.",range:"Equity Value = EV - Total Debt + Cash"},
  ebitda:{title:"EBITDA",meaning:"Earnings before Interest, Tax, Depreciation & Amortisation. A proxy for operating cash generation.",range:"SaaS: 15-30%. Manufacturing: 10-20%. Trading: 3-10%."},
  terminal_growth:{title:"Terminal Growth Rate",meaning:"The assumed perpetual growth rate beyond forecast period. Must be lower than WACC.",range:"Conservative: 3-4%. Moderate: 5-6%. Maximum: India nominal GDP (~7%)."},
  irr:{title:"IRR - Internal Rate of Return",meaning:"The annual return an investor demands given the risk of the investment.",range:"Angel: 35-60%. Seed VC: 30-50%. Series A: 25-40%."},
  exit_multiple:{title:"Exit Multiple",meaning:"The EV/Revenue or EV/EBITDA multiple at which investor expects to sell at exit.",range:"SaaS (EV/Rev): 4-8x. FMCG (EV/EBITDA): 12-18x. Manufacturing: 6-10x."},
  beta:{title:"Beta",meaning:"Measures how much company returns move relative to the overall market. B=1 means same as market.",range:"Low risk: B<0.7. Moderate: 0.7-1.2. High risk: B>1.2."},
  dso:{title:"DSO - Debtor Days",meaning:"Average days customers take to pay. Higher DSO = more working capital locked in receivables.",range:"B2B services: 45-90 days. Retail: 0-15 days. Manufacturing: 30-60 days."},
  dpo:{title:"DPO - Creditor Days",meaning:"Average days to pay suppliers. Higher DPO = less cash tied up.",range:"SMEs: 15-45 days. Large cos: 45-90 days."},
};

const PL_TEMPLATES = {
  saas:[
    {id:"revenue",label:"Revenue",type:"input",group:"Revenue"},
    {id:"hosting",label:"Hosting & Infrastructure",type:"input",group:"Cost of Revenue"},
    {id:"emp_tech",label:"Technology / Product Salaries",type:"input",group:"Cost of Revenue"},
    {id:"licenses",label:"Third-Party APIs / Licenses",type:"input",group:"Cost of Revenue"},
    {id:"gross_profit",label:"Gross Profit",type:"computed",bold:true,fn:r=>(r.revenue||0)-(r.hosting||0)-(r.emp_tech||0)-(r.licenses||0)},
    {id:"sales_mktg",label:"Sales & Marketing",type:"input",group:"Operating Expenses"},
    {id:"gen_admin",label:"General & Administrative",type:"input",group:"Operating Expenses"},
    {id:"rd",label:"R&D / Product Development",type:"input",group:"Operating Expenses"},
    {id:"ebitda",label:"EBITDA",type:"computed",bold:true,highlight:true,fn:r=>(r.revenue||0)-(r.hosting||0)-(r.emp_tech||0)-(r.licenses||0)-(r.sales_mktg||0)-(r.gen_admin||0)-(r.rd||0)},
    {id:"da",label:"Depreciation & Amortisation",type:"input",group:"Non-Operating"},
    {id:"ebit",label:"EBIT",type:"computed",bold:true,fn:r=>(r.revenue||0)-(r.hosting||0)-(r.emp_tech||0)-(r.licenses||0)-(r.sales_mktg||0)-(r.gen_admin||0)-(r.rd||0)-(r.da||0)},
    {id:"interest",label:"Finance Cost / Interest",type:"input",group:"Non-Operating"},
    {id:"ebt",label:"Profit Before Tax",type:"computed",bold:true,fn:r=>(r.revenue||0)-(r.hosting||0)-(r.emp_tech||0)-(r.licenses||0)-(r.sales_mktg||0)-(r.gen_admin||0)-(r.rd||0)-(r.da||0)-(r.interest||0)},
  ],
  manufacturing:[
    {id:"revenue",label:"Revenue / Net Sales",type:"input",group:"Revenue"},
    {id:"raw_mat",label:"Raw Materials Consumed",type:"input",group:"Cost of Production"},
    {id:"direct_labour",label:"Direct Labour",type:"input",group:"Cost of Production"},
    {id:"factory_exp",label:"Factory / Manufacturing Expenses",type:"input",group:"Cost of Production"},
    {id:"gross_profit",label:"Gross Profit",type:"computed",bold:true,fn:r=>(r.revenue||0)-(r.raw_mat||0)-(r.direct_labour||0)-(r.factory_exp||0)},
    {id:"selling_exp",label:"Selling & Distribution Expenses",type:"input",group:"Operating Expenses"},
    {id:"gen_admin",label:"General & Administrative",type:"input",group:"Operating Expenses"},
    {id:"ebitda",label:"EBITDA",type:"computed",bold:true,highlight:true,fn:r=>(r.revenue||0)-(r.raw_mat||0)-(r.direct_labour||0)-(r.factory_exp||0)-(r.selling_exp||0)-(r.gen_admin||0)},
    {id:"da",label:"Depreciation & Amortisation",type:"input",group:"Non-Operating"},
    {id:"ebit",label:"EBIT",type:"computed",bold:true,fn:r=>(r.revenue||0)-(r.raw_mat||0)-(r.direct_labour||0)-(r.factory_exp||0)-(r.selling_exp||0)-(r.gen_admin||0)-(r.da||0)},
    {id:"interest",label:"Finance Cost / Interest",type:"input",group:"Non-Operating"},
    {id:"ebt",label:"Profit Before Tax",type:"computed",bold:true,fn:r=>(r.revenue||0)-(r.raw_mat||0)-(r.direct_labour||0)-(r.factory_exp||0)-(r.selling_exp||0)-(r.gen_admin||0)-(r.da||0)-(r.interest||0)},
  ],
  trading:[
    {id:"revenue",label:"Revenue / Net Sales",type:"input",group:"Revenue"},
    {id:"purchases",label:"Purchases",type:"input",group:"Cost of Goods Sold"},
    {id:"inv_adj",label:"Inventory Adjustment (+/-)",type:"input",group:"Cost of Goods Sold"},
    {id:"gross_profit",label:"Gross Profit",type:"computed",bold:true,fn:r=>(r.revenue||0)-(r.purchases||0)+(r.inv_adj||0)},
    {id:"selling_exp",label:"Selling & Distribution",type:"input",group:"Operating Expenses"},
    {id:"gen_admin",label:"General & Administrative",type:"input",group:"Operating Expenses"},
    {id:"ebitda",label:"EBITDA",type:"computed",bold:true,highlight:true,fn:r=>(r.revenue||0)-(r.purchases||0)+(r.inv_adj||0)-(r.selling_exp||0)-(r.gen_admin||0)},
    {id:"da",label:"Depreciation & Amortisation",type:"input",group:"Non-Operating"},
    {id:"interest",label:"Finance Cost / Interest",type:"input",group:"Non-Operating"},
    {id:"ebt",label:"Profit Before Tax",type:"computed",bold:true,fn:r=>(r.revenue||0)-(r.purchases||0)+(r.inv_adj||0)-(r.selling_exp||0)-(r.gen_admin||0)-(r.da||0)-(r.interest||0)},
  ],
  services:[
    {id:"revenue",label:"Revenue / Fees",type:"input",group:"Revenue"},
    {id:"emp_cost",label:"Employee / Consultant Cost",type:"input",group:"Direct Cost"},
    {id:"delivery",label:"Delivery / Project Execution Cost",type:"input",group:"Direct Cost"},
    {id:"software",label:"Software / Tools",type:"input",group:"Direct Cost"},
    {id:"gross_margin",label:"Gross Margin",type:"computed",bold:true,fn:r=>(r.revenue||0)-(r.emp_cost||0)-(r.delivery||0)-(r.software||0)},
    {id:"admin_exp",label:"Administrative Expenses",type:"input",group:"Operating Expenses"},
    {id:"sales_mktg",label:"Sales & Business Development",type:"input",group:"Operating Expenses"},
    {id:"ebitda",label:"EBITDA",type:"computed",bold:true,highlight:true,fn:r=>(r.revenue||0)-(r.emp_cost||0)-(r.delivery||0)-(r.software||0)-(r.admin_exp||0)-(r.sales_mktg||0)},
    {id:"da",label:"Depreciation & Amortisation",type:"input",group:"Non-Operating"},
    {id:"ebit",label:"EBIT",type:"computed",bold:true,fn:r=>(r.revenue||0)-(r.emp_cost||0)-(r.delivery||0)-(r.software||0)-(r.admin_exp||0)-(r.sales_mktg||0)-(r.da||0)},
    {id:"interest",label:"Finance Cost / Interest",type:"input",group:"Non-Operating"},
    {id:"ebt",label:"Profit Before Tax",type:"computed",bold:true,fn:r=>(r.revenue||0)-(r.emp_cost||0)-(r.delivery||0)-(r.software||0)-(r.admin_exp||0)-(r.sales_mktg||0)-(r.da||0)-(r.interest||0)},
  ],
};

const getDynamicYears = (period,base=2026) => Array.from({length:period},(_,i)=>{const y=base+i; return `FY${y}-${String(y+1).slice(2)}`;});
const fmt=(v,d=0)=>{const n=parseFloat(v);if(isNaN(n))return "0";return new Intl.NumberFormat("en-IN",{minimumFractionDigits:d,maximumFractionDigits:d}).format(n);};
const toRaw=(dv,u)=>parseFloat(dv||0)*(UNIT_MULT[u]||1);
const fromRaw=(raw,u,d=2)=>{const n=(raw||0)/(UNIT_MULT[u]||1); return isNaN(n)?"":n.toFixed(d);};

// --- COMPUTATION ENGINES -----------------------------------------------------

function computeWACC(f){
  const rf=parseFloat(f.rf)||RF_DEFAULT, beta=parseFloat(f.beta)||1, erp=parseFloat(f.indiaERP)||INDIA_ERP;
  const ke=rf+beta*erp, t=(parseFloat(f.taxRate)||26)/100;
  const kd=(parseFloat(f.costOfDebt)||14)*(1-t);
  const ep=(parseFloat(f.equityPct)||100)/100, dp=(parseFloat(f.debtPct)||0)/100;
  return {ke,kd,wacc:ke*ep+kd*dp};
}

function computeDCF(f,years){
  const {ke,kd,wacc}=computeWACC(f);
  const wD=wacc/100, tg=(parseFloat(f.terminalGrowth)||4)/100, t=(parseFloat(f.taxRate)||26)/100;
  const sector=SECTORS.find(s=>s.name===f.sector);
  const templateKey=sector?.template||"saas";
  const template=PL_TEMPLATES[templateKey];
  const dso=parseFloat(f.dso)||45, dpo=parseFloat(f.dpo)||30, invD=parseFloat(f.invDays)||0;
  let cumLoss=parseFloat(f.openingLoss)||0;
  const rows=[];

  years.forEach((yr,i)=>{
    // Get effective forecast data (auto or manual)
    const raw=f.forecastMode==="auto"?computeAutoYear(f,years,i):f.forecast[yr]||{};
    const ebtLine=template.find(l=>l.id==="ebt");
    const ebt=ebtLine?.fn?ebtLine.fn(raw):0;
    const ebitdaLine=template.find(l=>l.id==="ebitda");
    const ebitda=ebitdaLine?.fn?ebitdaLine.fn(raw):0;
    const da=parseFloat(raw.da)||0, interest=parseFloat(raw.interest)||0;
    const rev=parseFloat(raw.revenue)||0;
    // Tax loss carry-forward logic
    const openingLossYear=cumLoss;
    let taxableIncome=ebt, setOff=0;
    if(ebt>0&&cumLoss>0){setOff=Math.min(cumLoss,ebt);taxableIncome=ebt-setOff;cumLoss-=setOff;}
    else if(ebt<0){cumLoss+=Math.abs(ebt);}
    const tax=Math.max(0,taxableIncome)*t;
    const pat=ebt-tax;
    const closingLoss=cumLoss;
    // NWC
    const cogsProxy=rev*0.35;
    const nwc=rev*dso/365+cogsProxy*invD/365-cogsProxy*dpo/365;
    const prevRev=i>0?(parseFloat((f.forecastMode==="auto"?computeAutoYear(f,years,i-1):(f.forecast[years[i-1]]||{})).revenue)||0):0;
    const prevNWC=i===0?(parseFloat(f.baseNWC)||0):(prevRev*dso/365+prevRev*0.35*invD/365-prevRev*0.35*dpo/365);
    const dnwc=nwc-prevNWC;
    const capex=parseFloat(f.capex?.[yr])||0;
    const intNetTax=interest*(1-t);
    const fcff=pat+da+intNetTax-capex-dnwc;
    rows.push({yr,rev,ebitda,ebt,taxableIncome,setOff,tax,pat,da,interest,capex,dnwc,intNetTax,fcff,nwc,openingLoss:openingLossYear,closingLoss});
  });

  const pvF=[0.75,1.75,2.75,3.75,4.75,5.75,6.75,7.75,8.75,9.75].slice(0,years.length).map(y=>1/Math.pow(1+wD,y));
  const pvFCFF=rows.map((r,i)=>r.fcff*pvF[i]);
  const sumPV=pvFCFF.reduce((a,b)=>a+b,0);
  const lastFCFF=rows[rows.length-1]?.fcff||0;
  const tv=wD>tg&&wD-tg>0.001?lastFCFF*(1+tg)/(wD-tg):0;
  const pvTV=tv*pvF[years.length-1];
  const ev=sumPV+pvTV;
  const debt=parseFloat(f.debt)||0, cash=parseFloat(f.cash)||0;
  const eqVal=ev-debt+cash;
  const shares=parseFloat(f.numShares)||1;
  return {rows,pvF,pvFCFF,sumPV,tv,pvTV,ev,eqVal,vps:eqVal/shares,wacc,ke,kd};
}

function computeAutoYear(f,years,idx){
  const p=f.autoParams||{};
  const base=parseFloat(p.baseRevenue)||0;
  const g=(parseFloat(p.revenueGrowth)||30)/100;
  const em=(parseFloat(p.ebitdaMargin)||20)/100;
  const daPct=(parseFloat(p.daPct)||3)/100;
  const intPct=(parseFloat(p.interestPct)||0)/100;
  const mult=UNIT_MULT[f.unit]||1;
  const rev=base*Math.pow(1+g,idx+1)*mult;
  const ebitda=rev*em;
  const totalCost=rev-ebitda;
  const da=rev*daPct;
  const interest=rev*intPct;
  const sector=SECTORS.find(s=>s.name===f.sector);
  const tk=sector?.template||"saas";
  const row={revenue:rev,da,interest};
  if(tk==="saas"){row.hosting=totalCost*0.2;row.emp_tech=totalCost*0.4;row.licenses=totalCost*0.1;row.sales_mktg=totalCost*0.15;row.gen_admin=totalCost*0.1;row.rd=totalCost*0.05;}
  else if(tk==="manufacturing"){row.raw_mat=totalCost*0.5;row.direct_labour=totalCost*0.2;row.factory_exp=totalCost*0.1;row.selling_exp=totalCost*0.1;row.gen_admin=totalCost*0.1;}
  else if(tk==="trading"){row.purchases=totalCost*0.7;row.inv_adj=0;row.selling_exp=totalCost*0.15;row.gen_admin=totalCost*0.15;}
  else{row.emp_cost=totalCost*0.5;row.delivery=totalCost*0.2;row.software=totalCost*0.1;row.admin_exp=totalCost*0.1;row.sales_mktg=totalCost*0.1;}
  return row;
}

function computeVC(f,rows){
  const irr=(parseFloat(f.vcIRR)||40)/100, exitYr=parseInt(f.vcExitYear)||5;
  const mult=parseFloat(f.vcExitMultiple)||5;
  const row=rows[Math.min(exitYr,rows.length)-1]||{};
  const base=f.vcBasis==="ebitda"?(row.ebitda||0):(row.rev||0);
  const exitVal=base*mult;
  const postMoney=exitVal/Math.pow(1+irr,exitYr);
  const inv=parseFloat(f.vcInvestment)||0;
  const preMoney=postMoney-inv;
  const shares=parseFloat(f.numShares)||1;
  const debt=parseFloat(f.debt)||0,cash=parseFloat(f.cash)||0;
  return {exitVal,postMoney,preMoney,eqVal:preMoney+cash-debt,vps:preMoney/shares,irr,exitYr,mult};
}

function computeRevMult(f,rows){
  const mult=parseFloat(f.rmMultiple)||4,yr=Math.min(parseInt(f.rmYear)||3,rows.length);
  const row=rows[yr-1]||{};
  const base=f.rmBasis==="ebitda"?(row.ebitda||0):(row.rev||0);
  const ev=base*mult, debt=parseFloat(f.debt)||0,cash=parseFloat(f.cash)||0;
  const eqVal=ev-debt+cash, shares=parseFloat(f.numShares)||1;
  return {ev,eqVal,vps:eqVal/shares,mult,yr};
}

function computeEarningsCap(f,rows){
  const capRate=(parseFloat(f.capRate)||15)/100;
  const maintainable=rows.slice(-2).reduce((s,r)=>s+r.pat,0)/2;
  const ev=maintainable/capRate, debt=parseFloat(f.debt)||0,cash=parseFloat(f.cash)||0;
  const eqVal=ev-debt+cash, shares=parseFloat(f.numShares)||1;
  return {ev,eqVal,vps:eqVal/shares,maintainable,capRate};
}

function computeSensitivity(f,years){
  const wAdj=[-2,0,2], tAdj=[-1,0,1];
  return {table:wAdj.map(wa=>tAdj.map(ta=>{const adj={...f,rf:String(parseFloat(f.rf)+wa),terminalGrowth:String(parseFloat(f.terminalGrowth)+ta)};return computeDCF(adj,years).vps;})),waccAdj:wAdj,tgAdj:tAdj};
}

const initForm=()=>{
  const s=SECTORS[0];
  return {
    engagementType:null,
    valueName:"",valueFirm:"",valueMembership:"",valueDesig:"Chartered Accountant",
    valuePhone:"",valueEmail:"",valueCity:"",valueWebsite:"",valueUDIN:"",udin:"",valueFirmAddress:"",
    companyName:"",cin:"",regDate:"",regOffice:"",incorporationState:"",
    valuationDate:new Date().toISOString().split("T")[0],purpose:PURPOSES[2],
    authCapital:"",paidUpCapital:"",faceValue:"10",numShares:"",
    shareholders:[{name:"",din:"",shares:"",designation:"Director"}],
    sector:s.name,stage:STAGES[0],
    sectorBeta:s.beta.toFixed(3),sectorUnlev:s.unlevBeta.toFixed(3),
    productsServices:[],revenueModel:[],customerSegments:[],
    competitiveAdvantage:[],growthDrivers:[],keyRisks:[],
    businessDescription:"",
    unit:"Lakhs",forecastPeriod:5,taxRate:"26",
    forecastMode:"manual",
    autoParams:{baseRevenue:"",revenueGrowth:"30",ebitdaMargin:"20",wcPct:"15",capexPct:"5",daPct:"3",interestPct:"0"},
    forecast:{},openingLoss:"0",
    rf:RF_DEFAULT.toString(),beta:s.beta.toFixed(3),indiaERP:String(INDIA_ERP),
    costOfDebt:"14",equityPct:"100",debtPct:"0",terminalGrowth:"4",
    dso:"45",dpo:"30",invDays:"0",baseNWC:"0",
    capex:{},debt:"0",cash:"0",
    selectedMethods:["dcf","vc","comparable"],
    methodWeights:{dcf:60,vc:30,comparable:10,nav:0,earnings:0,transactions:0},
    vcIRR:"40",vcExitYear:"5",vcExitMultiple:"5",vcBasis:"revenue",vcInvestment:"",
    rmMultiple:"4",rmYear:"3",rmBasis:"revenue",
    capRate:"15",
    navBookValue:"",navRevaluation:"",navSurplusAssets:"",navContingentLiab:"",
    raiseAmount:"",raiseTerms:"Equity stake",
  };
};

// --- UI COMPONENTS -----------------------------------------------------------

const base_inp = {width:"100%",fontSize:"13px",padding:"9px 12px",borderRadius:"8px",border:"1.5px solid #c4cdd9",background:"#ffffff",color:"#1a2332",boxSizing:"border-box",fontFamily:"var(--font-sans)"};
const lbl={display:"block",fontSize:"12px",color:"var(--text-secondary)",marginBottom:"4px"};
const nt={fontSize:"11px",color:"var(--text-muted)",margin:"2px 0 0"};
const thS={padding:"5px 8px",fontWeight:"500",color:"var(--text-secondary)",textAlign:"left",borderBottom:"0.5px solid var(--border)",fontSize:"11px",whiteSpace:"nowrap"};
const tdS={padding:"4px 8px",fontSize:"11px",borderBottom:"0.5px solid var(--border)"};

// Fix cursor-jump: show raw value while focused, formatted on blur
function NumInput({value,onChange,placeholder="0",style:sx,readOnly}){
  const [focused,setFocused]=useState(false);
  const [draft,setDraft]=useState("");
  const handleFocus=()=>{setFocused(true);setDraft(value!=null&&value!==""?String(value):"");};
  const handleBlur=()=>{setFocused(false);const n=parseFloat(draft.replace(/,/g,""));onChange(isNaN(n)?"":String(n));};
  const display=focused?draft:(value!=null&&value!==""?new Intl.NumberFormat("en-IN",{maximumFractionDigits:4}).format(parseFloat(value)):"");
  return <input type="text" inputMode="decimal" value={display}
    onChange={e=>setDraft(e.target.value)} onFocus={handleFocus} onBlur={handleBlur}
    placeholder={placeholder} readOnly={readOnly}
    style={{...base_inp,...sx,background:readOnly?"#f1f4f8":sx?.background||base_inp.background}}/>;
}

function TipIcon({term}){
  const [show,setShow]=useState(false);
  const t=TIPS[term];
  if(!t) return null;
  return <span style={{display:"inline-block",marginLeft:"5px",verticalAlign:"middle",position:"relative"}}>
    <i className="ti ti-info-circle" aria-hidden="true" onClick={()=>setShow(s=>!s)} style={{fontSize:"13px",color:"var(--color-text-tertiary)",cursor:"pointer"}}/>
    {show&&<div style={{position:"absolute",top:"22px",left:"-10px",zIndex:99,width:"240px",padding:"10px 12px",background:"var(--color-background-primary)",border:"0.5px solid var(--color-border-secondary)",borderRadius:"8px",boxShadow:"0 3px 10px rgba(0,0,0,0.15)"}}>
      <p style={{fontSize:"12px",fontWeight:"500",margin:"0 0 4px"}}>{t.title}</p>
      <p style={{fontSize:"11px",color:"var(--color-text-secondary)",margin:"0 0 3px"}}>{t.meaning}</p>
      {t.range&&<p style={{fontSize:"10px",color:"var(--color-text-tertiary)",margin:"0 0 5px"}}>Range: {t.range}</p>}
      <span onClick={()=>setShow(false)} style={{fontSize:"10px",color:"var(--color-text-tertiary)",cursor:"pointer"}}>Close x</span>
    </div>}
  </span>;
}

function F({label,value,onChange,type="text",placeholder="",n="",tip=""}){
  return <div style={{marginBottom:"10px"}}>
    <label style={lbl}>{label}{tip&&<TipIcon term={tip}/>}</label>
    <input type={type} value={value} onChange={e=>onChange(e.target.value)} placeholder={placeholder} style={base_inp}/>
    {n&&<p style={nt}>{n}</p>}
  </div>;
}
function Sel({label,value,onChange,options,n="",tip=""}){
  return <div style={{marginBottom:"10px"}}>
    <label style={lbl}>{label}{tip&&<TipIcon term={tip}/>}</label>
    <select value={value} onChange={e=>onChange(e.target.value)} style={{...base_inp}}>
      {options.map(o=><option key={o.value??o} value={o.value??o}>{o.label??o}</option>)}
    </select>
    {n&&<p style={nt}>{n}</p>}
  </div>;
}
function G({cols=2,children}){return <div style={{display:"grid",gridTemplateColumns:`repeat(${cols},1fr)`,gap:"10px"}}>{children}</div>;}
function Divider({label}){return <div style={{display:"flex",alignItems:"center",gap:"10px",margin:"14px 0 10px"}}><div style={{flex:1,height:"0.5px",background:"var(--color-border-tertiary)"}}/>
  <span style={{fontSize:"11px",color:"var(--color-text-tertiary)",fontWeight:"500",textTransform:"uppercase",letterSpacing:"0.06em"}}>{label}</span>
  <div style={{flex:1,height:"0.5px",background:"var(--color-border-tertiary)"}}/></div>;}

function MultiSelect({label,options,value,onChange,n=""}){
  const vals=value||[];
  const toggle=opt=>onChange(vals.includes(opt)?vals.filter(v=>v!==opt):[...vals,opt]);
  return <div style={{marginBottom:"10px"}}>
    <label style={{...lbl,marginBottom:"6px"}}>{label}</label>
    <div style={{display:"flex",flexWrap:"wrap",gap:"5px"}}>
      {options.map(opt=><button key={opt} onClick={()=>toggle(opt)} type="button"
        style={{fontSize:"11px",padding:"4px 10px",borderRadius:"20px",cursor:"pointer",border:"0.5px solid",
          background:vals.includes(opt)?"var(--color-background-info)":"var(--color-background-secondary)",
          color:vals.includes(opt)?"var(--color-text-info)":"var(--color-text-secondary)",
          borderColor:vals.includes(opt)?"var(--color-border-info)":"var(--color-border-tertiary)"}}>
        {vals.includes(opt)&&<i className="ti ti-check" aria-hidden="true" style={{marginRight:"4px",fontSize:"10px"}}/>}{opt}
      </button>)}
    </div>
    {n&&<p style={nt}>{n}</p>}
  </div>;
}

function AccordionSection({id,num,title,subtitle,isOpen,onToggle,complete,children}){
  return <div style={{border:"0.5px solid var(--border)",borderRadius:"10px",marginBottom:"8px",boxShadow:"var(--shadow-sm)"}}>
    <div onClick={onToggle} style={{display:"flex",alignItems:"center",padding:"14px 16px",cursor:"pointer",background:isOpen?"var(--bg-accent)":"var(--surface-1)",borderBottom:isOpen?"0.5px solid var(--border-accent)":"none",borderLeft:isOpen?"3px solid var(--text-accent)":"3px solid transparent",borderRadius:isOpen?"10px 10px 0 0":"10px",userSelect:"none"}}>
      <div style={{width:"28px",height:"28px",borderRadius:"50%",display:"flex",alignItems:"center",justifyContent:"center",fontSize:"12px",fontWeight:"500",marginRight:"12px",flexShrink:0,
        background:complete?"var(--bg-success)":isOpen?"var(--bg-accent)":"var(--surface-3)",
        color:complete?"var(--text-success)":isOpen?"var(--text-accent)":"var(--text-muted)",
        border:"0.5px solid "+(complete?"var(--border-success)":isOpen?"var(--border-accent)":"var(--border-strong)")}}>
        {complete?<i className="ti ti-check" aria-hidden="true"/>:num}
      </div>
      <div style={{flex:1}}>
        <p style={{fontSize:"13px",fontWeight:"500",margin:0,color:isOpen?"var(--text-accent)":"var(--text-primary)"}}>{title}</p>
        {subtitle&&<p style={{fontSize:"11px",color:"var(--text-muted)",margin:"1px 0 0"}}>{subtitle}</p>}
      </div>
      <i className={"ti "+(isOpen?"ti-chevron-up":"ti-chevron-down")} style={{fontSize:"14px",color:isOpen?"var(--text-accent)":"var(--text-muted)"}} aria-hidden="true"/>
    </div>
    {isOpen&&<div style={{background:"var(--surface-0)",padding:"20px 24px"}}>{children}</div>}
  </div>;
}
function ContinueBtn({onClick}){return <div style={{marginTop:"16px",borderTop:"0.5px solid var(--border)",paddingTop:"14px",display:"flex",justifyContent:"flex-end"}}>
  <button onClick={onClick} style={{fontSize:"13px",padding:"10px 20px",background:"#2563eb",color:"#fff",border:"none",borderRadius:"8px",cursor:"pointer",fontWeight:"500"}}>
    Continue <i className="ti ti-arrow-right" aria-hidden="true" style={{marginLeft:"4px"}}/>
  </button></div>;}

// --- ENGAGEMENT TYPE LANDING --------------------------------------------------

function EngagementLanding({onSelect}){
  return <div style={{minHeight:"60vh",display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",padding:"20px"}}>
    <i className="ti ti-report-analytics" aria-hidden="true" style={{fontSize:"40px",color:"var(--color-text-info)",marginBottom:"16px"}}/>
    <h2 style={{fontSize:"20px",fontWeight:"500",margin:"0 0 6px",textAlign:"center"}}>Business Valuation Platform</h2>
    <p style={{fontSize:"13px",color:"var(--color-text-secondary)",margin:"0 0 28px",textAlign:"center",maxWidth:"400px"}}>Before we begin, please select who is performing this valuation.</p>
    <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:"14px",width:"100%",maxWidth:"560px"}}>
      {[
        {type:"valuer",icon:"ti-certificate",title:"Registered Valuer / Professional Valuer",desc:"CA, CFA, IBBI Registered Valuer. Report generated on valuer letterhead with UDIN and credentials."},
        {type:"internal",icon:"ti-building",title:"Company Management / Internal Use",desc:"CFO, Finance team, Management. Report generated with company branding for board / investor use."},
      ].map(opt=><div key={opt.type} onClick={()=>onSelect(opt.type)}
        style={{padding:"20px",border:"0.5px solid var(--color-border-tertiary)",borderRadius:"12px",cursor:"pointer",textAlign:"center",transition:"all 0.15s",background:"var(--color-background-primary)"}}
        onMouseEnter={e=>{e.currentTarget.style.borderColor="var(--color-border-info)";e.currentTarget.style.background="var(--color-background-info)";}}
        onMouseLeave={e=>{e.currentTarget.style.borderColor="var(--color-border-tertiary)";e.currentTarget.style.background="var(--color-background-primary)";}}>
        <i className={"ti "+opt.icon} aria-hidden="true" style={{fontSize:"28px",color:"var(--color-text-info)",marginBottom:"10px",display:"block"}}/>
        <p style={{fontSize:"13px",fontWeight:"500",margin:"0 0 6px"}}>{opt.title}</p>
        <p style={{fontSize:"11px",color:"var(--color-text-secondary)",margin:0,lineHeight:"1.5"}}>{opt.desc}</p>
      </div>)}
    </div>
  </div>;
}

// --- SECTION 0: VALUER PROFILE ------------------------------------------------
function S0_Valuer({f,setF,onNext,isFromBuzinessDeals,setSection}){
  return <div>
    {isFromBuzinessDeals&&(
      <div style={{padding:"10px 14px",background:"#dbeafe",
        borderRadius:"8px",border:"0.5px solid #93c5fd",
        marginBottom:"16px",display:"flex",alignItems:"center",gap:"8px"}}>
        <i className="ti ti-info-circle" aria-hidden="true"
          style={{fontSize:"14px",color:"#1d4ed8"}}/>
        <p style={{fontSize:"12px",color:"#1d4ed8",margin:0}}>
          This valuation is being prepared through BuzinessDeals.
          Valuer details are pre-filled. You may edit them or proceed directly to Section 1.
        </p>
      </div>
    )}
    <div style={{marginBottom:"20px"}}>
      <h3 style={{fontSize:"16px",fontWeight:"500",margin:"0 0 6px",
        color:"var(--text-primary)"}}>Valuer and engagement details</h3>
      <p style={{fontSize:"12px",color:"var(--text-muted)",margin:0,lineHeight:"1.5"}}>
        For regulatory submissions, enter the valuer's professional details.
        For internal valuations, these fields are pre-filled and optional.
      </p>
    </div>
    <G cols={2}>
      <F label="Full name" value={f.valueName} onChange={v=>setF({...f,valueName:v})} placeholder="CA / CFA Name"/>
      <F label="Designation" value={f.valueDesig} onChange={v=>setF({...f,valueDesig:v})} placeholder="Chartered Accountant"/>
    </G>
    <G cols={2}>
      <F label="Firm / Practice name" value={f.valueFirm} onChange={v=>setF({...f,valueFirm:v})} placeholder="Firm or organisation"/>
      <F label="ICAI / IBBI / Professional membership no." value={f.valueMembership} onChange={v=>setF({...f,valueMembership:v})} placeholder="Membership / Regn No."/>
    </G>
    <G cols={3}>
      <F label="Phone" value={f.valuePhone} onChange={v=>setF({...f,valuePhone:v})} placeholder="+91 XXXXXXXXXX"/>
      <F label="Email" value={f.valueEmail} onChange={v=>setF({...f,valueEmail:v})} placeholder="email@firm.com"/>
      <F label="City" value={f.valueCity} onChange={v=>setF({...f,valueCity:v})} placeholder="Hyderabad"/>
    </G>
    <G cols={2}>
      <F label="Website" value={f.valueWebsite} onChange={v=>setF({...f,valueWebsite:v})} placeholder="www.firm.com"/>
      <F label="UDIN (fill before final issuance)" value={f.valueUDIN} onChange={v=>setF({...f,valueUDIN:v})} placeholder="Generated from ICAI portal"/>
    </G>
    <div style={{marginTop:"16px",borderTop:"0.5px solid var(--border)",paddingTop:"14px",display:"flex",justifyContent:"flex-end"}}>
      {isFromBuzinessDeals&&(
        <button onClick={function(){if(setSection)setSection(1);}}
          style={{padding:"9px 20px",borderRadius:"8px",fontSize:"13px",
            cursor:"pointer",background:"var(--surface-1)",
            color:"var(--text-secondary)",border:"0.5px solid var(--border)",
            marginRight:"8px"}}>
          Skip — pre-filled by BuzinessDeals
        </button>
      )}
      <button onClick={onNext}
        style={{fontSize:"13px",padding:"10px 20px",background:"#2563eb",color:"#fff",
          border:"none",borderRadius:"8px",cursor:"pointer",fontWeight:"500"}}>
        Continue <i className="ti ti-arrow-right" aria-hidden="true" style={{marginLeft:"4px"}}/>
      </button>
    </div>
  </div>;
}

// --- SECTION 1: COMPANY INFORMATION ------------------------------------------
function S1_Company({f,setF,onNext}){
  const addSH=()=>setF({...f,shareholders:[...f.shareholders,{name:"",din:"",shares:"",designation:"Shareholder"}]});
  const remSH=i=>setF({...f,shareholders:f.shareholders.filter((_,j)=>j!==i)});
  const setSH=(i,k,v)=>setF({...f,shareholders:f.shareholders.map((s,j)=>j===i?{...s,[k]:v}:s)});
  const total=f.shareholders.reduce((s,r)=>s+(parseFloat(r.shares)||0),0);
  return <div>
    <p style={{fontSize:"12px",color:"var(--color-text-tertiary)",marginBottom:"10px"}}>
      <i className="ti ti-database" aria-hidden="true" style={{marginRight:"5px"}}/>
      Future: MCA / GSTIN API integration will auto-populate. All fields manually entered for now.
    </p>
    <F label="Company name (as per MCA records)" value={f.companyName} onChange={v=>setF({...f,companyName:v})} placeholder="ABC Private Limited"/>
    <G cols={2}>
      <F label="CIN" value={f.cin} onChange={v=>setF({...f,cin:v})} placeholder="U72200TG2024PTC..."/>
      <F label="Incorporation date" value={f.regDate} onChange={v=>setF({...f,regDate:v})} type="date"/>
    </G>
    <F label="Registered office address" value={f.regOffice} onChange={v=>setF({...f,regOffice:v})} placeholder="Full address with PIN code"/>
    <G cols={2}>
      <F label="Valuation date" value={f.valuationDate} onChange={v=>setF({...f,valuationDate:v})} type="date"/>
      <Sel label="Purpose of valuation" value={f.purpose} onChange={v=>setF({...f,purpose:v})} options={PURPOSES}/>
    </G>
    {(f.purpose||"").toLowerCase().match(/fundrais|capital|loan|equity|series|angel|seed/)&&(
      <div style={{marginTop:"16px",padding:"14px 16px",background:"#fef3c7",
        border:"1px solid #fcd34d",borderRadius:"8px"}}>
        <p style={{fontSize:"11px",fontWeight:"500",color:"#92400e",margin:"0 0 12px",
          textTransform:"uppercase",letterSpacing:"0.05em"}}>
          Fundraising details — for post-money calculation only
        </p>
        <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:"12px"}}>
          <div>
            <label style={{fontSize:"12px",color:"var(--text-secondary)",
              display:"block",marginBottom:"4px"}}>
              Capital being raised ({f.unit||"Lakhs"})
            </label>
            <input type="number"
              value={f.raiseAmount||""}
              onChange={function(e){setF(function(prev){
                return Object.assign({},prev,{raiseAmount:e.target.value});
              });}}
              placeholder="e.g. 100"
              style={{width:"100%",padding:"8px 12px",borderRadius:"6px",
                border:"1.5px solid #fcd34d",background:"#fff",
                fontSize:"13px",boxSizing:"border-box"}}/>
            <p style={{fontSize:"10px",color:"#92400e",margin:"4px 0 0"}}>
              Enter in {f.unit||"Lakhs"}
            </p>
          </div>
          <div>
            <label style={{fontSize:"12px",color:"var(--text-secondary)",
              display:"block",marginBottom:"4px"}}>
              Terms offered to investor
            </label>
            <select value={f.raiseTerms||"Equity stake"}
              onChange={function(e){setF(function(prev){
                return Object.assign({},prev,{raiseTerms:e.target.value});
              });}}
              style={{width:"100%",padding:"8px 12px",borderRadius:"6px",
                border:"1.5px solid #fcd34d",background:"#fff",
                fontSize:"13px",boxSizing:"border-box"}}>
              <option>Equity stake</option>
              <option>Compulsory convertible debentures (CCD)</option>
              <option>Optionally convertible debentures (OCD)</option>
              <option>Structured debt with equity warrants</option>
              <option>Revenue share</option>
              <option>Term loan</option>
            </select>
          </div>
        </div>
      </div>
    )}
    <Divider label="Capital Structure"/>
    <G cols={3}>
      <div style={{marginBottom:"10px"}}><label style={lbl}>Authorised capital (INR)</label>
        <NumInput value={f.authCapital} onChange={v=>setF({...f,authCapital:v})} placeholder="1000000"/></div>
      <div style={{marginBottom:"10px"}}><label style={lbl}>Paid-up capital (INR)</label>
        <NumInput value={f.paidUpCapital} onChange={v=>setF({...f,paidUpCapital:v})} placeholder="103100"/></div>
      <div style={{marginBottom:"10px"}}><label style={lbl}>Face value per share (INR)</label>
        <NumInput value={f.faceValue} onChange={v=>setF({...f,faceValue:v})} placeholder="10"/></div>
    </G>
    <div style={{marginBottom:"10px"}}><label style={lbl}>Total equity shares</label>
      <NumInput value={f.numShares} onChange={v=>setF({...f,numShares:v})} placeholder="10310"/>
      <p style={nt}>= Paid-up capital / face value</p></div>
    <Divider label="Shareholding Pattern"/>
    <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:"8px"}}>
      <label style={lbl}>Directors / Shareholders</label>
      <button onClick={addSH} style={{fontSize:"11px",padding:"3px 10px"}}>+ Add row</button>
    </div>
    <div style={{overflowX:"auto"}}>
      <table style={{borderCollapse:"collapse",width:"100%",fontSize:"12px"}}>
        <thead><tr style={{borderBottom:"0.5px solid var(--color-border-tertiary)"}}>
          {["Name","DIN","Designation","Shares held","% Holding",""].map(h=><th key={h} style={thS}>{h}</th>)}
        </tr></thead>
        <tbody>{f.shareholders.map((s,i)=><tr key={i} style={{borderBottom:"0.5px solid var(--color-border-tertiary)"}}>
          <td style={{padding:"3px 4px"}}><input value={s.name} onChange={e=>setSH(i,"name",e.target.value)} style={{border:"1.5px solid #c4cdd9",borderRadius:"6px",background:"#ffffff",padding:"7px 10px",fontSize:"12px",width:"100%",boxSizing:"border-box"}}/></td>
          <td style={{padding:"3px 4px"}}><input value={s.din} onChange={e=>setSH(i,"din",e.target.value)} style={{border:"1.5px solid #c4cdd9",borderRadius:"6px",background:"#ffffff",padding:"7px 10px",fontSize:"12px",width:"100%",boxSizing:"border-box"}}/></td>
          <td style={{padding:"3px 4px"}}>
            <select value={s.designation} onChange={e=>setSH(i,"designation",e.target.value)} style={{border:"1.5px solid #c4cdd9",borderRadius:"6px",background:"#ffffff",padding:"7px 10px",fontSize:"12px",width:"100%",boxSizing:"border-box"}}>
              {DESIGNATIONS.map(d=><option key={d}>{d}</option>)}
            </select>
          </td>
          <td style={{padding:"3px 4px"}}><NumInput value={s.shares} onChange={v=>setSH(i,"shares",v)} style={{width:"80px",fontSize:"12px",padding:"3px 7px"}}/></td>
          <td style={tdS}>{total>0?((parseFloat(s.shares)||0)/total*100).toFixed(1)+"%":"--"}</td>
          <td style={{padding:"3px 4px"}}>{f.shareholders.length>1&&<button onClick={()=>remSH(i)} style={{fontSize:"11px",color:"var(--color-text-danger)"}}>x</button>}</td>
        </tr>)}</tbody>
      </table>
    </div>
    <ContinueBtn onClick={onNext}/>
  </div>;
}

// --- SECTION 2: BUSINESS UNDERSTANDING ---------------------------------------
function S2_Business({f,setF,onNext}){
  const handleSector=v=>{
    const s=SECTORS.find(x=>x.name===v);
    setF({...f,sector:v,sectorBeta:s?s.beta.toFixed(3):f.sectorBeta,sectorUnlev:s?s.unlevBeta.toFixed(3):f.sectorUnlev,beta:s?s.beta.toFixed(3):f.beta,selectedMethods:s?s.reco:f.selectedMethods});
  };
  return <div>
    <G cols={2}>
      <Sel label="Industry / Sector" value={f.sector} onChange={handleSector} options={SECTORS.map(s=>({value:s.name,label:s.name}))} n={`Damodaran India Jan 2026 - Levered B: ${f.sectorBeta} | Unlevered B: ${f.sectorUnlev}`}/>
      <Sel label="Business stage" value={f.stage} onChange={v=>setF({...f,stage:v})} options={STAGES} n="Drives recommended valuation methods"/>
    </G>
    <div style={{marginBottom:"10px"}}><label style={lbl}>Business description <span style={{color:"var(--color-text-tertiary)"}}>(narrative used in report)</span></label>
      <textarea value={f.businessDescription} onChange={e=>setF({...f,businessDescription:e.target.value})} rows={3}
        placeholder="Describe the business model, scale of operations, and what makes it distinctive..."
        style={{...base_inp,resize:"vertical",lineHeight:"1.6"}}/></div>
    <Divider label="Structured Business Profile"/>
    <G cols={2}>
      <MultiSelect label="Products / Services" options={PRODUCT_TYPES} value={f.productsServices} onChange={v=>setF({...f,productsServices:v})}/>
      <MultiSelect label="Revenue Model" options={REVENUE_MODELS} value={f.revenueModel} onChange={v=>setF({...f,revenueModel:v})}/>
    </G>
    <G cols={2}>
      <MultiSelect label="Customer Segments" options={CUSTOMER_SEGS} value={f.customerSegments} onChange={v=>setF({...f,customerSegments:v})}/>
      <MultiSelect label="Competitive Advantage" options={COMP_ADVANTAGES} value={f.competitiveAdvantage} onChange={v=>setF({...f,competitiveAdvantage:v})}/>
    </G>
    <G cols={2}>
      <MultiSelect label="Growth Drivers" options={GROWTH_DRIVERS} value={f.growthDrivers} onChange={v=>setF({...f,growthDrivers:v})}/>
      <MultiSelect label="Key Risk Factors" options={RISK_TYPES} value={f.keyRisks} onChange={v=>setF({...f,keyRisks:v})}/>
    </G>
    <ContinueBtn onClick={onNext}/>
  </div>;
}

// --- SECTION 3: FORECAST P&L --------------------------------------------------
function S3_Forecast({f,setF,years,onNext}){
  const sector=SECTORS.find(s=>s.name===f.sector);
  const templateKey=sector?.template||"saas";
  const template=PL_TEMPLATES[templateKey];
  const u=f.unit, mult=UNIT_MULT[u]||1;
  const p=f.autoParams||{};
  const setVal=(yr,id,v)=>setF({...f,forecast:{...f.forecast,[yr]:{...(f.forecast[yr]||{}),[id]:parseFloat(v||0)*mult}}});
  const getVal=(yr,id)=>{const raw=(f.forecast[yr]||{})[id];return raw!=null?(raw/mult).toFixed(2):"";};
  const isAuto=f.forecastMode==="auto";

  const copyAutoToManual=()=>{
    const newForecast={};
    years.forEach((yr,i)=>{newForecast[yr]={};const auto=computeAutoYear(f,years,i);Object.keys(auto).forEach(k=>{newForecast[yr][k]=auto[k];});});
    setF({...f,forecast:newForecast,forecastMode:"manual"});
  };

  return <div>
    <div style={{display:"flex",alignItems:"center",gap:"12px",marginBottom:"14px",flexWrap:"wrap"}}>
      <div><label style={lbl}>Unit</label>
        <select value={u} onChange={e=>setF({...f,unit:e.target.value})} style={{...base_inp,width:"120px"}}>{UNIT_OPTS.map(x=><option key={x}>{x}</option>)}</select></div>
      <div><label style={lbl}>Forecast period</label>
        <select value={f.forecastPeriod} onChange={e=>setF({...f,forecastPeriod:parseInt(e.target.value)})} style={{...base_inp,width:"100px"}}>{FORECAST_OPTS.map(x=><option key={x} value={x}>{x} years</option>)}</select></div>
      <div><label style={lbl}>Tax rate (%)</label>
        <NumInput value={f.taxRate} onChange={v=>setF({...f,taxRate:v})} style={{width:"70px"}}/></div>
      <div><label style={lbl}>Opening carried-forward loss ({u})</label>
        <NumInput value={f.openingLoss?(parseFloat(f.openingLoss)/mult).toFixed(2):""} onChange={v=>setF({...f,openingLoss:String(parseFloat(v||0)*mult)})} style={{width:"100px"}} placeholder="0"/>
      </div>
      <div style={{padding:"5px 10px",background:"var(--color-background-info)",borderRadius:"6px",fontSize:"11px",color:"var(--color-text-info)"}}>
        Template: <strong>{templateKey}</strong> for {f.sector.split(" ")[0]}
      </div>
    </div>

    <div style={{display:"flex",gap:"8px",marginBottom:"14px"}}>
      <button onClick={()=>setF({...f,forecastMode:"manual"})} style={{fontSize:"12px",padding:"6px 14px",background:!isAuto?"var(--color-background-info)":"var(--color-background-secondary)",color:!isAuto?"var(--color-text-info)":"var(--color-text-secondary)",border:"0.5px solid",borderColor:!isAuto?"var(--color-border-info)":"var(--color-border-tertiary)",borderRadius:"6px",cursor:"pointer"}}>Manual entry</button>
      <button onClick={()=>setF({...f,forecastMode:"auto"})} style={{fontSize:"12px",padding:"6px 14px",background:isAuto?"var(--color-background-info)":"var(--color-background-secondary)",color:isAuto?"var(--color-text-info)":"var(--color-text-secondary)",border:"0.5px solid",borderColor:isAuto?"var(--color-border-info)":"var(--color-border-tertiary)",borderRadius:"6px",cursor:"pointer"}}>Growth-driven (auto)</button>
      {isAuto&&<button onClick={copyAutoToManual} style={{fontSize:"12px",padding:"6px 14px",borderRadius:"6px",cursor:"pointer"}}>Copy to manual and edit</button>}
    </div>

    {isAuto&&<div style={{padding:"12px 14px",background:"var(--color-background-secondary)",borderRadius:"8px",marginBottom:"14px",border:"0.5px solid var(--color-border-tertiary)"}}>
      <p style={{fontSize:"12px",fontWeight:"500",margin:"0 0 10px"}}>Growth-driven forecast assumptions</p>
      <div style={{display:"grid",gridTemplateColumns:"repeat(4,1fr)",gap:"10px"}}>
        {[
          {k:"baseRevenue",label:`Base revenue (${u}, Year 0)`,placeholder:"Current year revenue"},
          {k:"revenueGrowth",label:"Revenue growth rate (%)",placeholder:"30"},
          {k:"ebitdaMargin",label:"EBITDA margin (%)",placeholder:"20"},
          {k:"daPct",label:"D&A (% of revenue)",placeholder:"3"},
          {k:"interestPct",label:"Interest (% of revenue)",placeholder:"0"},
          {k:"capexPct",label:"Capex (% of revenue)",placeholder:"5"},
          {k:"wcPct",label:"Working capital (% of revenue)",placeholder:"15"},
        ].map(({k,label,placeholder})=><div key={k} style={{marginBottom:"8px"}}>
          <label style={lbl}>{label}</label>
          <NumInput value={p[k]} onChange={v=>setF({...f,autoParams:{...p,[k]:v}})} placeholder={placeholder} style={{fontSize:"12px",padding:"4px 8px"}}/>
        </div>)}
      </div>
    </div>}

    <div style={{overflowX:"auto"}}>
      <table style={{borderCollapse:"collapse",minWidth:"100%"}}>
        <thead><tr style={{borderBottom:"1px solid var(--color-border-tertiary)"}}>
          <th style={{...thS,minWidth:"180px",position:"sticky",left:0,background:"var(--color-background-primary)"}}>Line Item</th>
          {years.map(y=><th key={y} style={{...thS,textAlign:"center",minWidth:"96px"}}>{y}</th>)}
        </tr></thead>
        <tbody>
          {template.map(line=>{
            if(line.id==="pat") return null; // PAT computed separately with carry-forward
            return <tr key={line.id} style={{borderBottom:"0.5px solid var(--color-border-tertiary)",background:line.highlight?"var(--color-background-info)":"transparent"}}>
              <td style={{...tdS,fontWeight:line.bold?"500":"400",color:line.highlight?"var(--color-text-info)":"var(--color-text-primary)",paddingLeft:line.type==="input"&&!["revenue","gross_profit","gross_margin","ebitda","ebt"].includes(line.id)?"16px":"8px"}}>{line.label}</td>
              {years.map(yr=>{
                const raw=isAuto?computeAutoYear(f,years,years.indexOf(yr)):(f.forecast[yr]||{});
                if(line.type==="computed"){
                  const v=line.fn?line.fn(raw):0;
                  return <td key={yr} style={{...tdS,textAlign:"right",fontWeight:line.bold?"500":"400",color:v<0?"var(--color-text-danger)":line.highlight?"var(--color-text-info)":"var(--color-text-primary)"}}>{(v/mult).toFixed(2)}</td>;
                }
                return <td key={yr} style={{padding:"3px 4px",textAlign:"right"}}>
                  <NumInput value={isAuto?(raw[line.id]!=null?(raw[line.id]/mult).toFixed(2):undefined):getVal(yr,line.id)}
                    onChange={v=>setVal(yr,line.id,v)} readOnly={isAuto}
                    style={{width:"86px",textAlign:"right",padding:"3px 7px",fontSize:"12px"}}/>
                </td>;
              })}
            </tr>;
          })}
          {/* PAT row - computed with carry-forward */}
          {[{id:"pat",label:"Profit After Tax (PAT)",bold:true,highlight:true}].map(()=>
            <tr key="pat" style={{borderBottom:"0.5px solid var(--color-border-tertiary)",background:"var(--color-background-success)"}}>
              <td style={{...tdS,fontWeight:"500",color:"var(--color-text-success)"}}>Profit After Tax (PAT) <span style={{fontSize:"10px",color:"var(--color-text-tertiary)"}}>(after tax loss set-off)</span></td>
              {years.map((yr,i)=>{
                const raw=isAuto?computeAutoYear(f,years,i):(f.forecast[yr]||{});
                const ebtLine=template.find(l=>l.id==="ebt");
                const ebt=ebtLine?.fn?ebtLine.fn(raw):0;
                // Compute PAT with running carry-forward (simplified display)
                const prevPATs=years.slice(0,i).map((pyr,pi)=>{const pr=isAuto?computeAutoYear(f,years,pi):(f.forecast[pyr]||{});return ebtLine?.fn?ebtLine.fn(pr):0;});
                let cl=parseFloat(f.openingLoss)||0;
                prevPATs.forEach(e=>{if(e<0)cl+=Math.abs(e);else if(cl>0){const so=Math.min(cl,e);cl-=so;}});
                const setOff=ebt>0&&cl>0?Math.min(cl,ebt):0;
                const taxable=ebt-setOff;
                const tax=Math.max(0,taxable)*(parseFloat(f.taxRate)||26)/100;
                const pat=ebt-tax;
                return <td key={yr} style={{...tdS,textAlign:"right",fontWeight:"500",color:pat<0?"var(--color-text-danger)":"var(--color-text-success)"}}>{(pat/mult).toFixed(2)}</td>;
              })}
            </tr>
          )}
        </tbody>
      </table>
    </div>
    <ContinueBtn onClick={onNext}/>
  </div>;
}

// --- SECTION 4: WORKING CAPITAL & CAPEX --------------------------------------
function S4_WC({f,setF,years,onNext}){
  const u=f.unit, mult=UNIT_MULT[u]||1;
  const {nwcArr,deltaArr}=useMemo(()=>{
    const dso=parseFloat(f.dso)||45, dpo=parseFloat(f.dpo)||30, invD=parseFloat(f.invDays)||0;
    const isAuto=f.forecastMode==="auto";
    const nwcArr=years.map((yr,i)=>{
      const raw=isAuto?computeAutoYear(f,years,i):(f.forecast[yr]||{});
      const rev=parseFloat(raw.revenue)||0, cogs=rev*0.35;
      return rev*dso/365+cogs*invD/365-cogs*dpo/365;
    });
    const base=parseFloat(f.baseNWC)||0;
    return {nwcArr,deltaArr:nwcArr.map((n,i)=>n-(i===0?base:nwcArr[i-1]))};
  },[f.dso,f.dpo,f.invDays,f.baseNWC,f.forecast,f.forecastMode,f.autoParams,years]);

  return <div>
    <Divider label="Working Capital Assumptions"/>
    <G cols={3}>
      <div><label style={{...lbl}}>Debtor days - DSO<TipIcon term="dso"/></label><NumInput value={f.dso} onChange={v=>setF({...f,dso:v})} style={{fontSize:"13px"}}/><p style={nt}>Credit period to customers</p></div>
      <div><label style={{...lbl}}>Creditor days - DPO<TipIcon term="dpo"/></label><NumInput value={f.dpo} onChange={v=>setF({...f,dpo:v})} style={{fontSize:"13px"}}/><p style={nt}>Credit from suppliers</p></div>
      <div><label style={{...lbl}}>Inventory / WIP days</label><NumInput value={f.invDays} onChange={v=>setF({...f,invDays:v})} style={{fontSize:"13px"}}/><p style={nt}>0 for pure service / digital</p></div>
    </G>
    <div style={{marginBottom:"10px"}}><label style={lbl}>Current NWC baseline ({u})</label>
      <NumInput value={f.baseNWC?(parseFloat(f.baseNWC)/mult).toFixed(2):""} onChange={v=>setF({...f,baseNWC:String(parseFloat(v||0)*mult)})} style={{width:"150px"}}/><p style={nt}>Opening NWC from which Year 1 change is measured</p></div>
    <div style={{overflowX:"auto",marginBottom:"14px"}}>
      <table style={{borderCollapse:"collapse",width:"100%"}}>
        <thead><tr style={{borderBottom:"0.5px solid var(--color-border-tertiary)"}}>
          <th style={{...thS,minWidth:"160px"}}>Item ({u})</th>{years.map(y=><th key={y} style={{...thS,textAlign:"right",minWidth:"88px"}}>{y}</th>)}
        </tr></thead>
        <tbody>
          {[["Net working capital",nwcArr],["Delta Working capital (FCFF)",deltaArr]].map(([label,arr])=><tr key={label} style={{borderBottom:"0.5px solid var(--color-border-tertiary)",background:label.includes("Delta")?"var(--color-background-info)":"transparent"}}>
            <td style={{...tdS,fontWeight:label.includes("Delta")?"500":"400",color:label.includes("Delta")?"var(--color-text-info)":"var(--color-text-secondary)"}}>{label}</td>
            {arr.map((v,i)=><td key={i} style={{...tdS,textAlign:"right",color:label.includes("Delta")?"var(--color-text-info)":v<0?"var(--color-text-danger)":"inherit"}}>{(v/mult).toFixed(2)}</td>)}
          </tr>)}
        </tbody>
      </table>
    </div>
    <Divider label="Capital Expenditure"/>
    <div style={{overflowX:"auto",marginBottom:"14px"}}>
      <table style={{borderCollapse:"collapse"}}>
        <thead><tr style={{borderBottom:"0.5px solid var(--color-border-tertiary)"}}>
          <th style={{...thS,minWidth:"160px"}}>Capex ({u})</th>
          {years.map(y=><th key={y} style={{...thS,textAlign:"center",minWidth:"96px"}}>{y}</th>)}
        </tr></thead>
        <tbody><tr>
          <td style={{...tdS,color:"var(--color-text-secondary)"}}>Capital expenditure</td>
          {years.map(yr=><td key={yr} style={{padding:"3px 4px"}}>
            <NumInput value={f.capex?.[yr]?(parseFloat(f.capex[yr])/mult).toFixed(2):""} onChange={v=>setF({...f,capex:{...f.capex,[yr]:parseFloat(v||0)*mult}})} style={{width:"86px",textAlign:"right",padding:"3px 7px",fontSize:"12px"}}/>
          </td>)}
        </tr></tbody>
      </table>
    </div>
    <Divider label="Funding Position as at Valuation Date"/>
    <G cols={2}>
      <div><label style={lbl}>Total debt ({u})</label><NumInput value={f.debt?(parseFloat(f.debt)/mult).toFixed(2):""} onChange={v=>setF({...f,debt:String(parseFloat(v||0)*mult)})}/><p style={nt}>Term loans + debentures + ECB</p></div>
      <div><label style={lbl}>Cash & equivalents ({u})</label><NumInput value={f.cash?(parseFloat(f.cash)/mult).toFixed(2):""} onChange={v=>setF({...f,cash:String(parseFloat(v||0)*mult)})}/><p style={nt}>Bank + liquid MF + FDs under 90 days</p></div>
    </G>
    <ContinueBtn onClick={onNext}/>
  </div>;
}

// --- SECTION 5: METHODS ------------------------------------------------------
function S5_Methods({f,setF,onNext}){
  const sector=SECTORS.find(s=>s.name===f.sector);
  const toggle=id=>{const cur=f.selectedMethods||[];setF({...f,selectedMethods:cur.includes(id)?cur.filter(m=>m!==id):[...cur,id]});};
  const setWt=(id,v)=>setF({...f,methodWeights:{...f.methodWeights,[id]:parseInt(v)||0}});
  const totalWt=Object.entries(f.methodWeights||{}).filter(([id])=>(f.selectedMethods||[]).includes(id)).reduce((s,[,v])=>s+v,0);
  return <div>
    <p style={{fontSize:"12px",color:"var(--color-text-secondary)",marginBottom:"12px"}}>Recommended for <strong>{f.sector}</strong> at <strong>{f.stage}</strong>: <strong>{(sector?.reco||["dcf"]).join(", ").toUpperCase()}</strong></p>
    <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(260px,1fr))",gap:"8px",marginBottom:"14px"}}>
      {METHOD_DEFS.map(m=>{
        const selected=(f.selectedMethods||[]).includes(m.id);
        const recommended=(sector?.reco||[]).includes(m.id);
        const rel=m.reliability_fn(f.stage);
        return <div key={m.id} onClick={()=>toggle(m.id)} style={{padding:"12px 14px",borderRadius:"8px",border:selected?"1px solid var(--color-border-info)":"0.5px solid var(--color-border-tertiary)",background:selected?"var(--color-background-info)":"var(--color-background-primary)",cursor:"pointer",position:"relative"}}>
          {recommended&&<span style={{position:"absolute",top:"8px",right:"8px",fontSize:"10px",padding:"2px 6px",background:"var(--color-background-success)",color:"var(--color-text-success)",borderRadius:"4px"}}>Recommended</span>}
          <div style={{display:"flex",alignItems:"center",gap:"8px",marginBottom:"5px"}}>
            <i className={"ti "+m.icon} style={{fontSize:"16px",color:selected?"var(--color-text-info)":"var(--color-text-tertiary)"}} aria-hidden="true"/>
            <p style={{fontSize:"12px",fontWeight:"500",margin:0,color:selected?"var(--color-text-info)":"var(--color-text-primary)"}}>{m.name}</p>
          </div>
          <p style={{fontSize:"11px",color:"var(--color-text-secondary)",margin:"0 0 5px"}}>{m.purpose}</p>
          <div style={{display:"flex",gap:"5px"}}>
            <span style={{fontSize:"10px",padding:"1px 6px",borderRadius:"3px",background:m.applicability_fn(f.stage)?"var(--color-background-success)":"var(--color-background-secondary)",color:m.applicability_fn(f.stage)?"var(--color-text-success)":"var(--color-text-tertiary)"}}>{m.applicability_fn(f.stage)?"Applicable":"Limited"}</span>
            <span style={{fontSize:"10px",padding:"1px 6px",borderRadius:"3px",background:"var(--color-background-secondary)",color:"var(--color-text-secondary)"}}>{rel} reliability</span>
          </div>
        </div>;
      })}
    </div>
    {(f.selectedMethods||[]).length>0&&<>
      <Divider label="Weightage for Weighted Average Conclusion"/>
      <div style={{overflowX:"auto"}}>
        <table style={{borderCollapse:"collapse",width:"100%"}}>
          <thead><tr style={{borderBottom:"0.5px solid var(--color-border-tertiary)"}}>{["Method","Role","Reliability","Weight (%)","Rationale"].map(h=><th key={h} style={thS}>{h}</th>)}</tr></thead>
          <tbody>
            {METHOD_DEFS.filter(m=>(f.selectedMethods||[]).includes(m.id)).map(m=>{
              const rec=(sector?.reco||[]).includes(m.id);
              return <tr key={m.id} style={{borderBottom:"0.5px solid var(--color-border-tertiary)",background:m.id==="dcf"?"var(--color-background-info)":"transparent"}}>
                <td style={{...tdS,fontWeight:"500",color:m.id==="dcf"?"var(--color-text-info)":"inherit"}}>{m.name}</td>
                <td style={tdS}>{m.id==="dcf"?"Primary":rec?"Cross-check":"Supporting"}</td>
                <td style={tdS}>{m.reliability_fn(f.stage)}</td>
                <td style={{padding:"3px 6px"}}><NumInput value={f.methodWeights?.[m.id]||0} onChange={v=>setWt(m.id,v)} style={{width:"55px",textAlign:"right",fontSize:"12px",padding:"3px 6px"}}/></td>
                <td style={{...tdS,fontSize:"10px",color:"var(--color-text-tertiary)",maxWidth:"160px"}}>{m.best_for}</td>
              </tr>;
            })}
            <tr style={{background:"var(--color-background-secondary)",borderTop:"1px solid var(--color-border-tertiary)"}}>
              <td colSpan={3} style={{...tdS,fontWeight:"500"}}>Total</td>
              <td style={{...tdS,fontWeight:"500",color:totalWt===100?"var(--color-text-success)":"var(--color-text-danger)"}}>{totalWt}%{totalWt!==100?" - must be 100%":""}</td><td/>
            </tr>
          </tbody>
        </table>
      </div>
    </>}
    {(f.selectedMethods||[]).includes("vc")&&<><Divider label="VC Method Inputs"/>
      <G cols={3}>
        <div><label style={{...lbl}}>Required IRR (%)<TipIcon term="irr"/></label><NumInput value={f.vcIRR} onChange={v=>setF({...f,vcIRR:v})} style={{fontSize:"13px"}}/><p style={nt}>Seed: 40-60%. Series A: 25-40%.</p></div>
        <div><label style={lbl}>Exit year</label><NumInput value={f.vcExitYear} onChange={v=>setF({...f,vcExitYear:v})} style={{fontSize:"13px"}}/><p style={nt}>Years from today</p></div>
        <div><label style={{...lbl}}>Exit multiple (EV/basis)<TipIcon term="exit_multiple"/></label><NumInput value={f.vcExitMultiple} onChange={v=>setF({...f,vcExitMultiple:v})} style={{fontSize:"13px"}}/></div>
      </G>
      <G cols={2}>
        <Sel label="Exit multiple basis" value={f.vcBasis} onChange={v=>setF({...f,vcBasis:v})} options={[{value:"revenue",label:"EV / Revenue"},{value:"ebitda",label:"EV / EBITDA"}]}/>
        <div><label style={lbl}>Investment being raised ({f.unit})</label><NumInput value={f.vcInvestment?(parseFloat(f.vcInvestment)/(UNIT_MULT[f.unit]||1)).toFixed(2):""} onChange={v=>setF({...f,vcInvestment:String(parseFloat(v||0)*(UNIT_MULT[f.unit]||1))})} style={{fontSize:"13px"}}/><p style={nt}>Pre-money = Post-money - Investment</p></div>
      </G>
    </>}
    {(f.selectedMethods||[]).includes("comparable")&&<><Divider label="Comparable Multiple Inputs"/>
      <G cols={3}>
        <Sel label="Basis" value={f.rmBasis} onChange={v=>setF({...f,rmBasis:v})} options={[{value:"revenue",label:"EV / Revenue"},{value:"ebitda",label:"EV / EBITDA"}]}/>
        <div><label style={lbl}>Multiple (x)</label><NumInput value={f.rmMultiple} onChange={v=>setF({...f,rmMultiple:v})} style={{fontSize:"13px"}}/><p style={nt}>Listed Indian peers or recent deals</p></div>
        <div><label style={lbl}>Apply to year</label><NumInput value={f.rmYear} onChange={v=>setF({...f,rmYear:v})} style={{fontSize:"13px"}}/><p style={nt}>Year 1 to {f.forecastPeriod}</p></div>
      </G>
    </>}
    {(f.selectedMethods||[]).includes("nav")&&<><Divider label="NAV Method Inputs"/>
      <G cols={2}>
        <div><label style={lbl}>Book net worth ({f.unit})</label><NumInput value={f.navBookValue?(parseFloat(f.navBookValue)/(UNIT_MULT[f.unit]||1)).toFixed(2):""} onChange={v=>setF({...f,navBookValue:String(parseFloat(v||0)*(UNIT_MULT[f.unit]||1))})} style={{fontSize:"13px"}}/><p style={nt}>From latest audited balance sheet</p></div>
        <div><label style={lbl}>Revaluation surplus/deficit ({f.unit})</label><NumInput value={f.navRevaluation?(parseFloat(f.navRevaluation)/(UNIT_MULT[f.unit]||1)).toFixed(2):""} onChange={v=>setF({...f,navRevaluation:String(parseFloat(v||0)*(UNIT_MULT[f.unit]||1))})} style={{fontSize:"13px"}}/><p style={nt}>+ve gain, -ve deficit</p></div>
        <div><label style={lbl}>Surplus / hidden assets ({f.unit})</label><NumInput value={f.navSurplusAssets?(parseFloat(f.navSurplusAssets)/(UNIT_MULT[f.unit]||1)).toFixed(2):""} onChange={v=>setF({...f,navSurplusAssets:String(parseFloat(v||0)*(UNIT_MULT[f.unit]||1))})} style={{fontSize:"13px"}}/></div>
        <div><label style={lbl}>Contingent liabilities ({f.unit})</label><NumInput value={f.navContingentLiab?(parseFloat(f.navContingentLiab)/(UNIT_MULT[f.unit]||1)).toFixed(2):""} onChange={v=>setF({...f,navContingentLiab:String(parseFloat(v||0)*(UNIT_MULT[f.unit]||1))})} style={{fontSize:"13px"}}/></div>
      </G>
    </>}
    {(f.selectedMethods||[]).includes("earnings")&&<><Divider label="Earnings Capitalisation Inputs"/>
      <div><label style={lbl}>Capitalisation rate (%)</label><NumInput value={f.capRate} onChange={v=>setF({...f,capRate:v})} style={{width:"100px",fontSize:"13px"}}/><p style={nt}>= 1 / P/E multiple. Mature stable: 12-18%.</p></div>
    </>}
    <ContinueBtn onClick={onNext}/>
  </div>;
}

// --- SECTION 6: WACC ---------------------------------------------------------
function S6_WACC({f,setF,onNext}){
  const {ke,kd,wacc}=useMemo(()=>computeWACC(f),[f]);
  const relever=()=>{const t=(parseFloat(f.taxRate)||26)/100;const s=SECTORS.find(x=>x.name===f.sector);if(s){const de=(parseFloat(f.debtPct)||0)/(parseFloat(f.equityPct)||100);setF({...f,beta:(s.unlevBeta*(1+(1-t)*de)).toFixed(3)});}};
  return <div>
    <G cols={2}>
      <div>
        <p style={{fontSize:"12px",fontWeight:"500",margin:"0 0 10px"}}>Cost of equity (CAPM)<TipIcon term="wacc"/></p>
        <div style={{marginBottom:"10px"}}><label style={lbl}>Risk-free rate - Rf (%)</label><NumInput value={f.rf} onChange={v=>setF({...f,rf:v})} style={{fontSize:"13px"}}/><p style={nt}>GOISEC 10-yr bond yield, Jan 2026: 7.20%</p></div>
        <div style={{marginBottom:"10px"}}><label style={{...lbl}}>Levered beta<TipIcon term="beta"/></label><NumInput value={f.beta} onChange={v=>setF({...f,beta:v})} style={{fontSize:"13px"}}/><p style={nt}>Damodaran India Jan 2026: {f.sectorBeta} for {f.sector}</p></div>
        <button onClick={relever} style={{fontSize:"11px",padding:"3px 10px",marginBottom:"10px"}}>Re-lever from unlevered beta</button>
        <div style={{marginBottom:"10px"}}><label style={lbl}>India total ERP (%)</label><NumInput value={f.indiaERP} onChange={v=>setF({...f,indiaERP:v})} style={{fontSize:"13px"}}/><p style={nt}>Damodaran Jan 2026: Mature 4.23% + India CRP 2.845% = 7.075%</p></div>
        <div style={{padding:"10px 12px",background:"var(--color-background-secondary)",borderRadius:"6px",border:"0.5px solid var(--color-border-tertiary)"}}>
          <p style={{fontSize:"11px",color:"var(--color-text-tertiary)",margin:"0 0 3px"}}>Ke = {f.rf}% + {f.beta} x {f.indiaERP}%</p>
          <p style={{fontSize:"20px",fontWeight:"500",margin:0}}>{ke.toFixed(2)}%</p>
        </div>
      </div>
      <div>
        <p style={{fontSize:"12px",fontWeight:"500",margin:"0 0 10px"}}>Capital structure and cost of debt</p>
        <div style={{marginBottom:"10px"}}><label style={lbl}>Cost of debt - Kd (%)</label><NumInput value={f.costOfDebt} onChange={v=>setF({...f,costOfDebt:v})} style={{fontSize:"13px"}}/><p style={nt}>Weighted avg borrowing rate. Bank base: ~14%.</p></div>
        <G cols={2}>
          <div><label style={lbl}>Equity weight (%)</label><NumInput value={f.equityPct} onChange={v=>setF({...f,equityPct:v,debtPct:String(Math.max(0,100-parseFloat(v)))})} style={{fontSize:"13px"}}/></div>
          <div><label style={lbl}>Debt weight (%)</label><NumInput value={f.debtPct} onChange={v=>setF({...f,debtPct:v,equityPct:String(Math.max(0,100-parseFloat(v)))})} style={{fontSize:"13px"}}/></div>
        </G>
        <div style={{padding:"10px 12px",background:"var(--color-background-secondary)",borderRadius:"6px",border:"0.5px solid var(--color-border-tertiary)",marginBottom:"10px"}}>
          <p style={{fontSize:"11px",color:"var(--color-text-tertiary)",margin:"0 0 2px"}}>Kd net of tax = {kd.toFixed(2)}%</p>
          <p style={{fontSize:"11px",color:"var(--color-text-tertiary)",margin:"0 0 4px"}}>WACC = Ke x {f.equityPct}% + Kd(1-t) x {f.debtPct}%</p>
          <p style={{fontSize:"20px",fontWeight:"500",margin:0}}>WACC = {wacc.toFixed(2)}%</p>
        </div>
        <div><label style={{...lbl}}>Terminal growth rate (%)<TipIcon term="terminal_growth"/></label><NumInput value={f.terminalGrowth} onChange={v=>setF({...f,terminalGrowth:v})} style={{fontSize:"13px"}}/><p style={nt}>Conservative: 4%. India nominal GDP: 6-7%.</p></div>
      </div>
    </G>
    <ContinueBtn onClick={onNext}/>
  </div>;
}

// --- SECTION 7: RESULTS ------------------------------------------------------
function S7_Results({f,dcf,vc,rm,ec,navCalc,years,sensitivity}){
  const u=f.unit, mult=UNIT_MULT[u]||1;
  const d=v=>(v/mult).toFixed(2);
  const methods=f.selectedMethods||["dcf"];
  const weights=f.methodWeights||{dcf:100};
  const totalW=methods.reduce((s,id)=>s+(weights[id]||0),0);
  const methodResults=[
    {id:"dcf",name:"DCF Method",ev:dcf.ev,eqVal:dcf.eqVal,vps:dcf.vps},
    vc&&{id:"vc",name:"VC Method",ev:vc.exitVal,eqVal:vc.preMoney,vps:vc.vps},
    rm&&{id:"comparable",name:"Revenue / EBITDA Multiple",ev:rm.ev,eqVal:rm.eqVal,vps:rm.vps},
    ec&&{id:"earnings",name:"Earnings Capitalisation",ev:ec.ev,eqVal:ec.eqVal,vps:ec.vps},
    navCalc&&{id:"nav",name:"NAV Method",ev:navCalc.ev,eqVal:navCalc.eqVal,vps:navCalc.vps},
  ].filter(Boolean).filter(m=>methods.includes(m.id));
  const wVPS=totalW>0?methodResults.reduce((s,m)=>s+m.vps*(weights[m.id]||0)/totalW,0):dcf.vps;

  return <div>
    <div style={{display:"grid",gridTemplateColumns:"repeat(3,1fr)",gap:"10px",marginBottom:"16px"}}>
      {[["Enterprise value (DCF)",`${u} ${fmt(parseFloat(d(dcf.ev)),0)}`],["Equity value (DCF)",`${u} ${fmt(parseFloat(d(dcf.eqVal)),0)}`],["Weighted value per share",`INR ${fmt(wVPS.toFixed(2),2)}`,true]].map(([l,v,hi])=>(
        <div key={l} style={{padding:"12px 14px",background:hi?"var(--color-background-info)":"var(--color-background-secondary)",borderRadius:"8px",border:hi?"0.5px solid var(--color-border-info)":"none"}}>
          <p style={{fontSize:"11px",color:hi?"var(--color-text-info)":"var(--color-text-tertiary)",margin:"0 0 4px",textTransform:"uppercase",letterSpacing:"0.04em"}}>{l}</p>
          <p style={{fontSize:"18px",fontWeight:"500",margin:0,color:hi?"var(--color-text-info)":"var(--color-text-primary)"}}>{v}</p>
        </div>
      ))}
    </div>
    <Divider label="Method Comparison"/>
    <div style={{overflowX:"auto",marginBottom:"14px"}}>
      <table style={{borderCollapse:"collapse",width:"100%"}}>
        <thead><tr style={{borderBottom:"1px solid var(--color-border-tertiary)"}}>{[`Method`,`EV (${u})`,`Equity Value (${u})`,`Per Share (INR)`,`Weight`,`Contribution`].map(h=><th key={h} style={thS}>{h}</th>)}</tr></thead>
        <tbody>
          {methodResults.map(m=><tr key={m.id} style={{borderBottom:"0.5px solid var(--color-border-tertiary)",background:m.id==="dcf"?"var(--color-background-info)":"transparent"}}>
            <td style={{...tdS,fontWeight:"500",color:m.id==="dcf"?"var(--color-text-info)":"inherit"}}>{m.name}</td>
            <td style={{...tdS,textAlign:"right"}}>{fmt(parseFloat(d(m.ev)),0)}</td>
            <td style={{...tdS,textAlign:"right"}}>{fmt(parseFloat(d(m.eqVal)),0)}</td>
            <td style={{...tdS,textAlign:"right",fontWeight:"500"}}>INR {fmt(m.vps.toFixed(2),2)}</td>
            <td style={{...tdS,textAlign:"right"}}>{weights[m.id]||0}%</td>
            <td style={{...tdS,textAlign:"right",color:"var(--color-text-secondary)"}}>INR {fmt((m.vps*(weights[m.id]||0)/(totalW||100)).toFixed(2),2)}</td>
          </tr>)}
          <tr style={{background:"var(--color-background-secondary)",borderTop:"1px solid var(--color-border-tertiary)"}}>
            <td style={{...tdS,fontWeight:"500"}}>Weighted average</td><td colSpan={2}></td>
            <td style={{...tdS,textAlign:"right",fontWeight:"500",fontSize:"13px"}}>INR {fmt(wVPS.toFixed(2),2)}</td>
            <td style={{...tdS,textAlign:"right"}}>100%</td><td/>
          </tr>
        </tbody>
      </table>
    </div>
    <Divider label="Tax Loss Carry-Forward Schedule"/>
    <div style={{overflowX:"auto",marginBottom:"14px"}}>
      <table style={{borderCollapse:"collapse",width:"100%",fontSize:"11px"}}>
        <thead><tr style={{borderBottom:"0.5px solid var(--color-border-tertiary)"}}>{[`Year`,`Opening BF (${u})`,`EBT (${u})`,`Set-off (${u})`,`Taxable Income (${u})`,`Tax (${u})`,`PAT (${u})`,`Closing BF (${u})`].map(h=><th key={h} style={thS}>{h}</th>)}</tr></thead>
        <tbody>{dcf.rows.map(r=><tr key={r.yr} style={{borderBottom:"0.5px solid var(--color-border-tertiary)",background:r.setOff>0?"var(--color-background-success)":"transparent"}}>
          <td style={tdS}>{r.yr}</td>
          <td style={{...tdS,textAlign:"right",color:r.openingLoss>0?"var(--color-text-danger)":"inherit"}}>{fmt(parseFloat(d(r.openingLoss)),2)}</td>
          <td style={{...tdS,textAlign:"right",color:r.ebt<0?"var(--color-text-danger)":"inherit"}}>{fmt(parseFloat(d(r.ebt)),2)}</td>
          <td style={{...tdS,textAlign:"right",color:"var(--color-text-success)"}}>{r.setOff>0?fmt(parseFloat(d(r.setOff)),2):"--"}</td>
          <td style={{...tdS,textAlign:"right"}}>{fmt(parseFloat(d(r.taxableIncome)),2)}</td>
          <td style={{...tdS,textAlign:"right"}}>{fmt(parseFloat(d(r.tax)),2)}</td>
          <td style={{...tdS,textAlign:"right",fontWeight:"500",color:r.pat<0?"var(--color-text-danger)":"var(--color-text-success)"}}>{fmt(parseFloat(d(r.pat)),2)}</td>
          <td style={{...tdS,textAlign:"right",color:r.closingLoss>0?"var(--color-text-danger)":"inherit"}}>{fmt(parseFloat(d(r.closingLoss)),2)}</td>
        </tr>)}</tbody>
      </table>
    </div>
    <Divider label="DCF Sensitivity Analysis - Value Per Share (INR)"/>
    <p style={{fontSize:"11px",color:"var(--color-text-tertiary)",marginBottom:"8px"}}>Rows: WACC +/-2%. Columns: Terminal growth rate +/-1%.</p>
    <div style={{overflowX:"auto"}}>
      <table style={{borderCollapse:"collapse"}}>
        <thead><tr style={{borderBottom:"0.5px solid var(--color-border-tertiary)"}}>
          <th style={thS}>WACC vs TG</th>
          {sensitivity.tgAdj.map(t=><th key={t} style={{...thS,textAlign:"right"}}>TG {t>0?"+":""}{t}% = {(parseFloat(f.terminalGrowth)+t).toFixed(1)}%</th>)}
        </tr></thead>
        <tbody>{sensitivity.table.map((row,wi)=><tr key={wi} style={{borderBottom:"0.5px solid var(--color-border-tertiary)"}}>
          <td style={{...tdS,fontWeight:"500"}}>WACC {sensitivity.waccAdj[wi]>0?"+":""}{sensitivity.waccAdj[wi]}% = {(dcf.wacc+sensitivity.waccAdj[wi]).toFixed(1)}%</td>
          {row.map((v,ti)=><td key={ti} style={{...tdS,textAlign:"right",fontWeight:wi===1&&ti===1?"500":"400",background:wi===1&&ti===1?"var(--color-background-info)":"transparent",color:wi===1&&ti===1?"var(--color-text-info)":"inherit"}}>INR {fmt(v.toFixed(2),2)}</td>)}
        </tr>)}</tbody>
      </table>
    </div>
    {f.raiseAmount&&parseFloat(f.raiseAmount)>0&&(function(){
      var raise=parseFloat(f.raiseAmount)||0;
      var mult=UNIT_MULT[f.unit]||100000;
      var preMoney=(dcf.ev||0)/mult;
      var postMoney=preMoney+raise;
      var impliedStake=postMoney>0?(raise/postMoney*100):0;
      var dilutionRows=[10,15,20,25,30,49];
      return (
        <div style={{marginTop:"24px",padding:"16px 20px",background:"#fef3c7",
          border:"1px solid #fcd34d",borderRadius:"10px"}}>
          <div style={{display:"flex",alignItems:"center",gap:"8px",marginBottom:"14px"}}>
            <i className="ti ti-calculator" aria-hidden="true"
              style={{fontSize:"16px",color:"#92400e"}}/>
            <p style={{fontSize:"12px",fontWeight:"500",color:"#92400e",margin:0,
              textTransform:"uppercase",letterSpacing:"0.05em"}}>
              Post-money analysis — {f.raiseTerms||"Equity stake"}
            </p>
          </div>
          <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr",gap:"10px",marginBottom:"16px"}}>
            {[
              ["Pre-money valuation",preMoney.toFixed(0)+" "+f.unit,"#92400e"],
              ["Capital being raised",raise.toFixed(0)+" "+f.unit,"#92400e"],
              ["Post-money valuation",postMoney.toFixed(0)+" "+f.unit,"#92400e"],
            ].map(function(item){
              return (
                <div key={item[0]} style={{padding:"10px 12px",background:"#fff",
                  borderRadius:"8px",border:"0.5px solid #fcd34d",textAlign:"center"}}>
                  <p style={{fontSize:"9px",color:"#92400e",margin:"0 0 4px",
                    textTransform:"uppercase",letterSpacing:"0.04em"}}>{item[0]}</p>
                  <p style={{fontSize:"15px",fontWeight:"600",margin:0,color:item[2]}}>{item[1]}</p>
                </div>
              );
            })}
          </div>
          <div style={{padding:"10px 14px",background:"#fff",borderRadius:"8px",
            border:"0.5px solid #fcd34d",marginBottom:"16px"}}>
            <p style={{fontSize:"12px",color:"#92400e",margin:0,lineHeight:"1.6"}}>
              At this pre-money valuation, raising {raise.toFixed(0)} {f.unit} implies
              <strong> {impliedStake.toFixed(1)}% investor stake</strong> post-money.
              The investor owns {raise.toFixed(0)} / {postMoney.toFixed(0)} = {impliedStake.toFixed(1)}% of the business.
            </p>
          </div>
          <p style={{fontSize:"10px",fontWeight:"500",color:"#92400e",margin:"0 0 8px",
            textTransform:"uppercase",letterSpacing:"0.05em"}}>
            Dilution reference table
          </p>
          <table style={{width:"100%",borderCollapse:"collapse",fontSize:"12px"}}>
            <thead>
              <tr style={{borderBottom:"1px solid #fcd34d"}}>
                {["Stake offered","Capital raised ("+f.unit+")","Pre-money implied","Post-money"].map(function(h){
                  return <th key={h} style={{padding:"6px 8px",textAlign:"right",
                    fontWeight:"500",color:"#92400e",fontSize:"10px",
                    textTransform:"uppercase"}}>{h}</th>;
                })}
              </tr>
            </thead>
            <tbody>
              {dilutionRows.map(function(stake){
                var raiseAtStake=preMoney*stake/(100-stake);
                var postAtStake=preMoney+raiseAtStake;
                var isMatch=Math.abs(impliedStake-stake)<1;
                return (
                  <tr key={stake} style={{
                    borderBottom:"0.5px solid #fcd34d",
                    background:isMatch?"rgba(146,64,14,0.08)":"transparent",
                    fontWeight:isMatch?"500":"400"
                  }}>
                    <td style={{padding:"6px 8px",textAlign:"right",color:"#92400e"}}>{stake}%</td>
                    <td style={{padding:"6px 8px",textAlign:"right",color:"#1a2332"}}>{Math.round(raiseAtStake).toLocaleString("en-IN")}</td>
                    <td style={{padding:"6px 8px",textAlign:"right",color:"#1a2332"}}>{Math.round(preMoney).toLocaleString("en-IN")}</td>
                    <td style={{padding:"6px 8px",textAlign:"right",color:"#1a2332"}}>{Math.round(postAtStake).toLocaleString("en-IN")}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          <p style={{fontSize:"10px",color:"#92400e",margin:"10px 0 0",lineHeight:"1.5",
            fontStyle:"italic"}}>
            The highlighted row is closest to the proposed raise. Pre-money valuation is derived from DCF on current operations. Post-money figures are arithmetic calculations only — not independent projections.
          </p>
        </div>
      );
    })()}
  </div>;
}

// --- PRINT REPORT HTML GENERATOR ---------------------------------------------

function generateReportHTML(f,dcf,vc,rm,ec,navCalc,ai,years,sensitivity){
  const u=f.unit, mult=UNIT_MULT[u]||1;
  const d=(v,dec=0)=>new Intl.NumberFormat("en-IN",{minimumFractionDigits:dec,maximumFractionDigits:dec}).format(Math.round(v/mult*Math.pow(10,dec))/Math.pow(10,dec));
  const vDate=new Date(f.valuationDate).toLocaleDateString("en-IN",{day:"numeric",month:"long",year:"numeric"});
  const isValuer=f.engagementType==="valuer";
  var isProfessional=f.valueMembership&&!f.valueMembership.includes("Indicative");
  var udinLine=f.udin?'<p style="font-size:11px;color:#64748b;margin:2px 0 0;">UDIN: '+f.udin+'</p>':'';
  var valuerSection=isProfessional?`
  <div style="margin-bottom:8px;">
    <p style="font-size:13px;font-weight:600;margin:0;">${f.valueName||""}</p>
    <p style="font-size:12px;color:#334155;margin:2px 0 0;">${f.valueMembership||""} | ${f.valueFirm||""}</p>
    ${udinLine}
  </div>
  `:`
  <div style="margin-bottom:8px;">
    <p style="font-size:13px;font-weight:600;margin:0;">BuzinessDeals Platform</p>
    <p style="font-size:12px;color:#334155;margin:2px 0 0;">Zenius Advisors | Hyderabad</p>
    <p style="font-size:11px;color:#94a3b8;margin:2px 0 0;">Indicative valuation — not for statutory use</p>
  </div>
  `;
  const total=f.shareholders.reduce((s,r)=>s+(parseFloat(r.shares)||0),0);
  const methods=f.selectedMethods||["dcf"];
  const weights=f.methodWeights||{dcf:100};
  const totalW=methods.reduce((s,id)=>s+(weights[id]||0),0);
  const wVPS=totalW>0?[{id:"dcf",vps:dcf.vps},vc&&{id:"vc",vps:vc.vps},rm&&{id:"comparable",vps:rm.vps},ec&&{id:"earnings",vps:ec.vps},navCalc&&{id:"nav",vps:navCalc.vps}].filter(Boolean).filter(m=>methods.includes(m.id)).reduce((s,m)=>s+m.vps*(weights[m.id]||0)/totalW,0):dcf.vps;
  const sector=SECTORS.find(s=>s.name===f.sector);
  const templateKey=sector?.template||"saas";
  const template=PL_TEMPLATES[templateKey];

  const css=`
    @page{size:A4 portrait;margin:2cm 1.5cm 2cm 1.5cm;}
    *{box-sizing:border-box;margin:0;padding:0;}
    body{font-family:Arial,Helvetica,sans-serif;font-size:10pt;color:#1a1a1a;line-height:1.5;}
    h1{font-size:16pt;font-weight:700;}h2{font-size:13pt;font-weight:700;margin-top:14pt;margin-bottom:6pt;color:#1e3a5f;border-bottom:1.5pt solid #1e3a5f;padding-bottom:3pt;}
    h3{font-size:11pt;font-weight:700;margin-top:10pt;margin-bottom:4pt;color:#2c5282;}
    p{margin-bottom:6pt;}
    .cover{text-align:center;padding-top:80pt;min-height:600pt;display:flex;flex-direction:column;align-items:center;justify-content:flex-start;}
    .cover .company-name{font-size:22pt;font-weight:700;color:#1e3a5f;margin-bottom:8pt;}
    .cover .cin{font-size:10pt;color:#555;margin-bottom:4pt;}
    .cover .address{font-size:9pt;color:#777;margin-bottom:20pt;}
    .cover .report-type{font-size:13pt;font-weight:700;border:1.5pt solid #1e3a5f;padding:6pt 20pt;margin-bottom:20pt;color:#1e3a5f;}
    .cover .meta{font-size:10pt;margin-bottom:5pt;}
    .cover .valuer-box{margin-top:30pt;padding:16pt 24pt;border:1pt solid #ccc;text-align:center;min-width:300pt;}
    .cover .valuer-name{font-size:13pt;font-weight:700;margin-bottom:4pt;}
    .cover .udin{font-size:9pt;color:#777;margin-top:4pt;}
    .page-break{page-break-after:always;}
    .toc table{border-collapse:collapse;width:100%;}
    .toc td{padding:4pt 8pt;border-bottom:0.5pt solid #eee;font-size:10pt;}
    .toc .num{width:50pt;font-weight:700;}
    .toc .title{font-weight:400;}
    .section{margin-bottom:12pt;}
    table.data{border-collapse:collapse;width:100%;margin:8pt 0;}
    table.data th{background:#1e3a5f;color:#fff;padding:5pt 8pt;font-size:9pt;text-align:left;font-weight:600;}
    table.data td{padding:4pt 8pt;font-size:9pt;border-bottom:0.5pt solid #ddd;}
    table.data tr:nth-child(even){background:#f7f9fc;}
    table.data .bold{font-weight:700;}
    table.data .hi-blue{background:#dbeafe;font-weight:700;}
    table.data .hi-green{background:#d1fae5;font-weight:700;}
    table.data .num-col{text-align:right;}
    table.data .neg{color:#c0392b;}
    .conclusion-box{border:1.5pt solid #1e3a5f;padding:14pt;margin:10pt 0;background:#f0f7ff;}
    .conclusion-box table{width:100%;border-collapse:collapse;}
    .conclusion-box td{padding:5pt 8pt;border-bottom:0.5pt solid #ccc;font-size:10pt;}
    .conclusion-box .label{width:200pt;color:#555;}
    .conclusion-box .value{font-weight:700;font-size:11pt;}
    .footer{position:running(footer);}
    .header-line{border-bottom:1pt solid #1e3a5f;margin-bottom:4pt;padding-bottom:4pt;}
    .source-list li{margin-bottom:3pt;font-size:9pt;}
    .tag{display:inline-block;background:#e8f0fe;color:#1a56db;font-size:8pt;padding:1pt 5pt;border-radius:3pt;margin:1pt;}
    .annex-title{font-size:12pt;font-weight:700;color:#1e3a5f;border-bottom:1pt solid #1e3a5f;padding-bottom:4pt;margin:16pt 0 8pt;}
    .sign-block{margin-top:30pt;display:flex;justify-content:space-between;}
    .sign-left{}.sign-right{text-align:right;}
    .sign-name{font-weight:700;font-size:11pt;}
    ul{padding-left:18pt;margin-bottom:6pt;}
    ul li{margin-bottom:3pt;font-size:10pt;}
    .info-row{display:flex;gap:20pt;margin-bottom:4pt;}
    .info-key{color:#555;min-width:120pt;font-size:9pt;}
    .info-val{font-weight:500;font-size:9pt;}
  `;

  const yearsHdr=years.map(y=>`<th class="num-col">${y}</th>`).join("");

  var fundraisingSection="";
  if(f.raiseAmount&&parseFloat(f.raiseAmount)>0){
    var raise=parseFloat(f.raiseAmount)||0;
    var preMoney=(dcf.ev||0)/mult;
    var postMoney=preMoney+raise;
    var impliedStake=postMoney>0?(raise/postMoney*100):0;
    fundraisingSection=`
    <div class="section">
      <h2>Annexure I — Fundraising and Post-Money Analysis</h2>
      <p>This annexure is presented for information purposes only. The pre-money valuation is derived from the DCF methodology applied to current business operations. Post-money figures are arithmetic calculations based on the proposed raise amount.</p>
      <table class="data">
        <tr><td><strong>Pre-money Enterprise Value</strong></td><td class="num-col">${new Intl.NumberFormat("en-IN",{maximumFractionDigits:0}).format(Math.round(preMoney))} ${f.unit}</td></tr>
        <tr><td><strong>Capital proposed to be raised</strong></td><td class="num-col">${new Intl.NumberFormat("en-IN",{maximumFractionDigits:0}).format(Math.round(raise))} ${f.unit}</td></tr>
        <tr><td><strong>Terms offered</strong></td><td>${f.raiseTerms||"Equity stake"}</td></tr>
        <tr><td><strong>Post-money valuation</strong></td><td class="num-col">${new Intl.NumberFormat("en-IN",{maximumFractionDigits:0}).format(Math.round(postMoney))} ${f.unit}</td></tr>
        <tr><td><strong>Implied investor stake</strong></td><td class="num-col">${impliedStake.toFixed(2)}%</td></tr>
      </table>
      <p style="margin-top:12px;font-style:italic;font-size:11px;">
        Disclaimer: Post-money valuation and implied stake are mathematical derivations from the pre-money DCF valuation. They do not constitute investment advice. The pre-money valuation reflects the present value of projected free cash flows from current operations only. No post-investment revenue projections have been incorporated into the valuation model.
      </p>
    </div>
  `;
  }

  // Annexure A: P&L
  const plRows=template.filter(l=>l.id!=="pat").map(line=>{
    const cells=years.map(yr=>{
      const raw=f.forecastMode==="auto"?computeAutoYear(f,years,years.indexOf(yr)):(f.forecast[yr]||{});
      const v=line.type==="computed"?(line.fn?line.fn(raw):0):parseFloat(raw[line.id])||0;
      return `<td class="num-col${v<0?" neg":""}${line.highlight?" hi-blue":""}">${d(v,2)}</td>`;
    }).join("");
    const indent=line.type==="input"&&!["revenue","gross_profit","gross_margin","ebitda","ebt"].includes(line.id)?"padding-left:16pt":"";
    return `<tr><td class="${line.bold?"bold":""}" style="${indent}">${line.label}</td>${cells}</tr>`;
  }).join("");
  // PAT rows with carry-forward
  const patRows=years.map((yr,i)=>{const r=dcf.rows[i];return `<td class="num-col hi-green${r.pat<0?" neg":""}">${d(r.pat,2)}</td>`;}).join("");

  // Annexure F: DCF
  const dcfRows=dcf.rows.map((r,i)=>`
    <tr><td>Revenue</td><td class="num-col">${d(r.rev,2)}</td></tr>
    <tr><td class="bold">EBITDA</td><td class="num-col hi-blue">${d(r.ebitda,2)}</td></tr>
    <tr><td>Profit Before Tax (EBT)</td><td class="num-col${r.ebt<0?" neg":""}">${d(r.ebt,2)}</td></tr>
    <tr><td>Set-off of brought-forward losses</td><td class="num-col hi-green">${r.setOff>0?d(r.setOff,2):"--"}</td></tr>
    <tr><td>Taxable income</td><td class="num-col">${d(r.taxableIncome,2)}</td></tr>
    <tr><td>Tax @ ${f.taxRate}%</td><td class="num-col">${d(r.tax,2)}</td></tr>
    <tr class="bold"><td>Profit After Tax (PAT)</td><td class="num-col hi-green${r.pat<0?" neg":""}">${d(r.pat,2)}</td></tr>
    <tr><td>Add: Depreciation & Amortisation</td><td class="num-col">${d(r.da,2)}</td></tr>
    <tr><td>Add: Interest paid (net of tax)</td><td class="num-col">${d(r.intNetTax,2)}</td></tr>
    <tr><td>Less: Capital Expenditure</td><td class="num-col">${d(r.capex,2)}</td></tr>
    <tr><td>Less: Change in Working Capital</td><td class="num-col">${d(r.dnwc,2)}</td></tr>
    <tr class="bold"><td class="hi-blue">Free Cash Flow to Entity (FCFF)</td><td class="num-col hi-blue${r.fcff<0?" neg":""}">${d(r.fcff,2)}</td></tr>
    <tr><td>PV Factor (mid-year: ${(dcf.pvF[i]||0).toFixed(3)})</td><td class="num-col">${(dcf.pvF[i]||0).toFixed(4)}</td></tr>
    <tr class="bold"><td>Present Value of FCFF</td><td class="num-col">${d(dcf.pvFCFF[i],2)}</td></tr>
    <tr><td colspan="2" style="border-bottom:1pt solid #ccc;padding:0;"></td></tr>
  `).join("");

  // sensitivity table
  const sensRows=sensitivity.table.map((row,wi)=>`<tr>
    <td class="bold">WACC ${sensitivity.waccAdj[wi]>0?"+":""}${sensitivity.waccAdj[wi]}% = ${(dcf.wacc+sensitivity.waccAdj[wi]).toFixed(1)}%</td>
    ${row.map((v,ti)=>`<td class="num-col${wi===1&&ti===1?" hi-blue":""}">${wi===1&&ti===1?"<b>":""}INR ${new Intl.NumberFormat("en-IN",{minimumFractionDigits:2,maximumFractionDigits:2}).format(v)}${wi===1&&ti===1?"</b>":""}</td>`).join("")}
  </tr>`).join("");

  // Method comparison
  const mRows=[
    {id:"dcf",name:"DCF Method",ev:dcf.ev,eqVal:dcf.eqVal,vps:dcf.vps,role:"Primary"},
    vc&&{id:"vc",name:"VC Method",ev:vc.exitVal,eqVal:vc.preMoney,vps:vc.vps,role:"Cross-check"},
    rm&&{id:"comparable",name:"Comparable Multiple",ev:rm.ev,eqVal:rm.eqVal,vps:rm.vps,role:"Cross-check"},
    ec&&{id:"earnings",name:"Earnings Capitalisation",ev:ec.ev,eqVal:ec.eqVal,vps:ec.vps,role:"Cross-check"},
    navCalc&&{id:"nav",name:"NAV Method",ev:navCalc.ev,eqVal:navCalc.eqVal,vps:navCalc.vps,role:"Cross-check"},
  ].filter(Boolean).filter(m=>methods.includes(m.id));

  const industryOutlook=ai?.industryOutlook||"Industry outlook not generated.";
  const companyBg=ai?.companyBackground||"Company background not generated.";
  const risks=ai?.riskFactors||[];
  const conclusion=ai?.conclusion||"Valuation conclusion not generated.";

  const chips=(arr)=>arr&&arr.length>0?arr.map(x=>`<span class="tag">${x}</span>`).join(" "):"Not specified";

  return `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"><title>Valuation Report - ${f.companyName||""}</title><style>${css}</style></head><body>

<!-- COVER PAGE -->
<div class="cover">
  ${isValuer&&f.valueFirm?`<div style="font-size:14pt;font-weight:700;color:#1e3a5f;margin-bottom:4pt">${f.valueFirm}</div>`:""}
  ${isValuer?`<div style="font-size:10pt;color:#555;margin-bottom:30pt">${[f.valueDesig,f.valueCity].filter(Boolean).join(" | ")}</div>`:""}
  <div style="width:100%;border-top:3pt solid #1e3a5f;margin-bottom:20pt;"></div>
  <div class="report-type">EQUITY VALUATION REPORT</div>
  <div class="company-name">${f.companyName||"Company Name"}</div>
  <div class="cin">${f.cin||""}</div>
  <div class="address">${f.regOffice||""}</div>
  <div class="meta"><strong>Report Date:</strong> ${vDate}</div>
  <div class="meta"><strong>Valuation Date:</strong> ${vDate}</div>
  <div class="meta"><strong>Purpose:</strong> ${f.purpose}</div>
  <div style="width:100%;border-top:1pt solid #ccc;margin:20pt 0;"></div>
  <div class="valuer-box">
    ${valuerSection}
  </div>
</div>
<div class="page-break"></div>

<!-- TABLE OF CONTENTS -->
<h2>TABLE OF CONTENTS</h2>
<div class="toc">
<table><tbody>
<tr><td class="num">1.</td><td class="title"><strong>Overview</strong></td></tr>
<tr><td></td><td>1.1 Corporate Structure</td></tr>
<tr><td></td><td>1.2 Industry Outlook</td></tr>
<tr><td></td><td>1.3 Background of the Company</td></tr>
<tr><td></td><td>1.4 Current Assignment</td></tr>
<tr><td></td><td>1.5 Shareholding Pattern</td></tr>
${isValuer?`<tr><td></td><td>1.6 About the Valuer</td></tr><tr><td></td><td>1.7 Disclosure by Valuer</td></tr>`:""}
<tr><td></td><td>1.${isValuer?8:6} Management's Perception of Risk Factors</td></tr>
<tr><td class="num">2.</td><td class="title"><strong>Valuation Analysis</strong></td></tr>
<tr><td></td><td>2.1 Methodology</td></tr>
<tr><td></td><td>2.2 Business Analysis</td></tr>
<tr><td></td><td>2.3 Valuation Computation Summary</td></tr>
<tr><td class="num">3.</td><td class="title"><strong>Conclusion</strong></td></tr>
<tr><td class="num">4.</td><td class="title"><strong>Sources of Information</strong></td></tr>
<tr><td class="num">5.</td><td class="title"><strong>Caveats and Limitations</strong></td></tr>
<tr><td></td><td>Annexure A - Forecast Profit & Loss Statement</td></tr>
<tr><td></td><td>Annexure B - Working Capital Schedule</td></tr>
<tr><td></td><td>Annexure C - WACC Computation</td></tr>
<tr><td></td><td>Annexure F - DCF Valuation Calculation</td></tr>
<tr><td></td><td>Annexure G - Comparable Valuation Analysis</td></tr>
<tr><td></td><td>Annexure H - Sensitivity Analysis</td></tr>
</tbody></table>
</div>
<div class="page-break"></div>

<!-- SECTION 1: OVERVIEW -->
<h2>1. OVERVIEW</h2>
<h3>1.1 Corporate Structure</h3>
<p>The Company <strong>${f.companyName||"[Company Name]"}</strong> was incorporated as a Private Limited Company under the provisions of the Companies Act, 2013${f.regDate?` on ${new Date(f.regDate).toLocaleDateString("en-IN",{day:"numeric",month:"long",year:"numeric"})}`:""}${f.cin?` vide CIN ${f.cin}`:""}${f.regOffice?` and having its Registered Office at ${f.regOffice}`:""}.  It is engaged in the ${f.sector} sector and is at the <strong>${f.stage}</strong> stage of its business lifecycle.</p>
<p>The capital structure of the Company as on ${vDate} is as follows:</p>
<table class="data"><tbody>
<tr><td>Authorised Capital</td><td class="num-col">INR ${new Intl.NumberFormat("en-IN").format(parseFloat(f.authCapital)||0)}/-</td></tr>
<tr><td>Issued, Subscribed & Paid-up Capital</td><td class="num-col">INR ${new Intl.NumberFormat("en-IN").format(parseFloat(f.paidUpCapital)||0)}/-</td></tr>
<tr><td>Face Value per Equity Share</td><td class="num-col">INR ${f.faceValue}/-</td></tr>
<tr><td>Total Number of Equity Shares</td><td class="num-col">${new Intl.NumberFormat("en-IN").format(parseFloat(f.numShares)||0)}</td></tr>
</tbody></table>

<h3>1.2 Industry Outlook</h3>
${industryOutlook.split("\n").filter(Boolean).map(p=>`<p>${p}</p>`).join("")}

<h3>1.3 Background of the Company</h3>
${companyBg.split("\n").filter(Boolean).map(p=>`<p>${p}</p>`).join("")}
<p><strong>Business Profile:</strong></p>
<table class="data"><tbody>
<tr><td style="width:180pt">Products / Services</td><td>${chips(f.productsServices)}</td></tr>
<tr><td>Revenue Model</td><td>${chips(f.revenueModel)}</td></tr>
<tr><td>Customer Segments</td><td>${chips(f.customerSegments)}</td></tr>
<tr><td>Competitive Advantage</td><td>${chips(f.competitiveAdvantage)}</td></tr>
<tr><td>Growth Drivers</td><td>${chips(f.growthDrivers)}</td></tr>
</tbody></table>

<h3>1.4 Current Assignment</h3>
<p>${isValuer?`We have been appointed by the Board of Directors of <strong>${f.companyName||"the Company"}</strong> to carry out the valuation of fair price of the equity shares as on ${vDate}. The purpose of this valuation is: <strong>${f.purpose}</strong>.`:`This valuation report has been prepared by the management of <strong>${f.companyName||"the Company"}</strong> for the purpose of: <strong>${f.purpose}</strong>. The valuation date is ${vDate}.`}</p>

<h3>1.5 Shareholding Pattern</h3>
<table class="data"><thead><tr><th>Name</th><th>DIN</th><th>Designation</th><th class="num-col">No. of Shares</th><th class="num-col">% Holding</th></tr></thead>
<tbody>
${f.shareholders.map(s=>`<tr><td>${s.name||"--"}</td><td>${s.din||"--"}</td><td>${s.designation}</td><td class="num-col">${new Intl.NumberFormat("en-IN").format(parseFloat(s.shares)||0)}</td><td class="num-col">${total>0?((parseFloat(s.shares)||0)/total*100).toFixed(2)+"%":"--"}</td></tr>`).join("")}
<tr class="bold"><td>Total</td><td></td><td></td><td class="num-col">${new Intl.NumberFormat("en-IN").format(total)}</td><td class="num-col">100.00%</td></tr>
</tbody></table>

${isValuer?`
<h3>1.6 About the Valuer</h3>
<p><strong>${f.valueName||"[Valuer Name]"}</strong> is a ${f.valueDesig||"Chartered Accountant"}${f.valueFirm?` practicing at ${f.valueFirm}`:""}.${f.valueMembership?` Membership / Registration No: ${f.valueMembership}.`:""}</p>
<p>No other expert was involved in this valuation exercise.</p>
<h3>1.7 Disclosure by the Valuer</h3>
<p>I, <strong>${f.valueName||"[Valuer Name]"}</strong>, hereby declare that I have no interest, either direct or indirect, in the Company <strong>${f.companyName||"[Company Name]"}</strong>. Further, I declare that I am not having any relation or connection with the promoters, directors, or any officer of the Company directly or indirectly. I confirm that I am independent and have been appointed in my individual/firm capacity.</p>`:""}

<h3>1.${isValuer?8:6} Management's Perception of Risk Factors</h3>
<p>The Company's management has identified the following key risk factors:</p>
<ul>${risks.length>0?risks.map(r=>`<li><strong>${r.title}:</strong> ${r.detail}</li>`).join(""):f.keyRisks&&f.keyRisks.length>0?f.keyRisks.map(r=>`<li>${r}</li>`).join(""):"<li>Risk assessment not provided.</li>"}</ul>
<div class="page-break"></div>

<!-- SECTION 2: VALUATION ANALYSIS -->
<h2>2. VALUATION ANALYSIS</h2>
<h3>2.1 Methodology</h3>
<p>In accordance with standard valuation practice, the following methodologies have been evaluated for their applicability to the subject company:</p>
${METHOD_DEFS.map(m=>{
  const sel=methods.includes(m.id);
  const rel=m.reliability_fn(f.stage);
  const app=m.applicability_fn(f.stage);
  return `<p><strong>${m.name}:</strong> ${m.purpose} ${sel?`<em>This method has been <strong>applied</strong> as ${rel.toLowerCase()} reliability for the subject company at ${f.stage} stage.</em>`:`<em>This method has <strong>not been applied</strong> as it is ${app?"of limited reliability":"not applicable"} given ${m.limitation}</em>`}</p>`;
}).join("")}
<p>The <strong>Discounted Cash Flow (DCF) Method</strong> has been adopted as the primary methodology, consistent with internationally accepted valuation standards and applicable Indian regulatory provisions including Rule 11UA of the Income Tax Rules, 1962, and FEMA pricing guidelines. DCF concentrates on the cash generation potential of the business and is widely accepted as the most appropriate method for going concern entities.</p>

<h3>2.2 Business Analysis</h3>
<p>${f.businessDescription||"Business description not provided."}</p>
<p><strong>Growth strategy:</strong> ${f.growthDrivers&&f.growthDrivers.length>0?f.growthDrivers.join(", "):"Not specified."}</p>
<p><strong>Competitive position:</strong> ${f.competitiveAdvantage&&f.competitiveAdvantage.length>0?f.competitiveAdvantage.join(", "):"Not specified."}</p>

<h3>2.3 Valuation Computation Summary</h3>
<table class="data"><thead><tr><th>Method</th><th>Role</th><th class="num-col">Enterprise Value (${u})</th><th class="num-col">Equity Value (${u})</th><th class="num-col">Per Share (INR)</th><th class="num-col">Weight</th></tr></thead>
<tbody>
${mRows.map(m=>`<tr${m.id==="dcf"?" class=\"hi-blue\"":""}><td class="bold">${m.name}</td><td>${m.role}</td><td class="num-col">${d(m.ev,2)}</td><td class="num-col">${d(m.eqVal,2)}</td><td class="num-col">INR ${new Intl.NumberFormat("en-IN",{minimumFractionDigits:2}).format(m.vps)}</td><td class="num-col">${weights[m.id]||0}%</td></tr>`).join("")}
<tr class="bold"><td colspan="4">Weighted Average Value Per Share</td><td class="num-col hi-blue">INR ${new Intl.NumberFormat("en-IN",{minimumFractionDigits:2}).format(wVPS)}</td><td class="num-col">100%</td></tr>
</tbody></table>
<div class="page-break"></div>

<!-- SECTION 3: CONCLUSION -->
<h2>3. CONCLUSION</h2>
<p>${conclusion}</p>
<div class="conclusion-box">
<p style="font-weight:700;margin-bottom:8pt;color:#1e3a5f">Based on our analysis of <strong>${f.companyName||"the Company"}</strong> and subject to our caveats, as per the DCF Method, the fair value of equity shares as on ${vDate} is:</p>
<table><tbody>
<tr><td class="label">Number of equity shares</td><td class="value">${new Intl.NumberFormat("en-IN").format(parseFloat(f.numShares)||0)}</td></tr>
<tr><td class="label">Enterprise Value (DCF)</td><td class="value">${u} ${d(dcf.ev,2)}</td></tr>
<tr><td class="label">Less: Total Debt</td><td class="value">${u} ${d(parseFloat(f.debt)||0,2)}</td></tr>
<tr><td class="label">Add: Cash & Equivalents</td><td class="value">${u} ${d(parseFloat(f.cash)||0,2)}</td></tr>
<tr><td class="label">Total Equity Value (DCF)</td><td class="value">${u} ${d(dcf.eqVal,2)}</td></tr>
<tr><td class="label" style="font-size:11pt;color:#1e3a5f"><strong>Fair Value per Equity Share (DCF)</strong></td><td class="value" style="font-size:13pt;color:#1e3a5f">INR ${new Intl.NumberFormat("en-IN",{minimumFractionDigits:2}).format(dcf.vps)}/-</td></tr>
${mRows.length>1?`<tr><td class="label" style="font-size:11pt;color:#1e3a5f"><strong>Weighted Average Value per Share</strong></td><td class="value" style="font-size:13pt;color:#1e3a5f">INR ${new Intl.NumberFormat("en-IN",{minimumFractionDigits:2}).format(wVPS)}/-</td></tr>`:""}
</tbody></table>
</div>
<p><strong>Hence, the indicative fair value per equity share of ${f.companyName||"the Company"} of face value INR ${f.faceValue}/- each as on ${vDate} is INR ${new Intl.NumberFormat("en-IN",{minimumFractionDigits:2}).format(dcf.vps)}/- per share (DCF basis).</strong></p>
<div class="page-break"></div>

<!-- SECTION 4: SOURCES -->
<h2>4. SOURCES OF INFORMATION</h2>
<p>This valuation analysis is based on the following information and data:</p>
<ul class="source-list">
<li>Financial projections and business plan as provided by the management of ${f.companyName||"the Company"}</li>
<li>Unaudited / provisional financials as provided by management</li>
<li>Damodaran Beta dataset - India - January 2026 (pages.stern.nyu.edu/~adamodar) - Beta: ${f.beta} for ${f.sector}</li>
<li>Damodaran Country Risk Premiums - January 2026 update (Mature ERP 4.23% + India CRP 2.845% = Total India ERP ${f.indiaERP}%)</li>
<li>Risk-free rate: GOISEC 10-year bond yield @ ${f.rf}% (RBI / Bloomberg)</li>
<li>MCA21 V3 portal - Company master data and filing history</li>
<li>Industry reports and publicly available data on the ${f.sector} sector in India</li>
<li>Such other information as considered relevant for the purpose of this analysis</li>
</ul>
<p>We have not independently verified or audited the information and have relied on the representations made to us.</p>

<!-- SECTION 5: CAVEATS -->
<h2>5. CAVEATS AND LIMITATIONS</h2>
<ul>
<li>This report is prepared solely for the stated purpose and shall not be used for any other purpose without prior written consent of the Valuer.</li>
<li>The valuation is based on information and projections provided by management and has not been independently audited or verified.</li>
<li>Projections reflect management estimates; actual performance may differ materially due to market, regulatory, competitive, and execution factors.</li>
<li>Valuation analysis and results are specific to the valuation date. The Valuer has no obligation to update this report for subsequent events.</li>
<li>Valuation is not an exact science and ultimately depends on the judgment of the valuer and assumptions adopted. Different valuers applying equally valid assumptions may arrive at different conclusions.</li>
<li>No investigation of title to assets has been made; the Company's claim to such rights has been assumed to be valid.</li>
<li>This report should be read in its entirety. No individual section should be relied upon in isolation.</li>
<li>This is not an audit, due diligence, or legal opinion. Readers should seek independent professional advice before relying on this report for financial decisions.</li>
${isValuer?`<li>The fee for this report is not contingent upon the results reported or upon any action taken by any party subsequent to this report.</li>`:""}
</ul>
<div class="page-break"></div>

<!-- ANNEXURE A: P&L -->
<div class="annex-title">Annexure A - Forecast Profit &amp; Loss Statement</div>
<p style="font-size:9pt;color:#555;margin-bottom:6pt">All amounts in ${u}. Industry template: ${templateKey}. Forecast mode: ${f.forecastMode}. Tax rate: ${f.taxRate}%.</p>
<table class="data"><thead><tr><th>Line Item</th>${yearsHdr}</tr></thead><tbody>
${plRows}
<tr class="bold"><td class="hi-green">Profit After Tax (PAT)</td>${patRows}</tr>
</tbody></table>

<div class="page-break"></div>
<!-- ANNEXURE B: WC SCHEDULE -->
<div class="annex-title">Annexure B - Working Capital Schedule</div>
<p style="font-size:9pt;color:#555;margin-bottom:6pt">DSO: ${f.dso} days | DPO: ${f.dpo} days | Inventory days: ${f.invDays} days | Base NWC: ${u} ${d(parseFloat(f.baseNWC)||0,2)}</p>
<table class="data"><thead><tr><th>Item (${u})</th>${yearsHdr}</tr></thead>
<tbody>
${dcf.rows.map(r=>`<tr><td>Net Working Capital</td><td class="num-col">${d(r.nwc,2)}</td></tr>`).slice(0,1).join("")}
<tr>
${dcf.rows.map((r,i)=>{const prev=i===0?(parseFloat(f.baseNWC)||0):dcf.rows[i-1].nwc;return `<td class="num-col hi-blue${r.dnwc<0?" neg":""}">${d(r.dnwc,2)}</td>`;}).join("")}
</tr>
</tbody></table>
<table class="data"><thead><tr><th>Item (${u})</th>${yearsHdr}</tr></thead><tbody>
<tr><td>Net Working Capital</td>${dcf.rows.map(r=>`<td class="num-col">${d(r.nwc,2)}</td>`).join("")}</tr>
<tr class="bold"><td class="hi-blue">Change in Working Capital</td>${dcf.rows.map(r=>`<td class="num-col${r.dnwc<0?" neg":""} hi-blue">${d(r.dnwc,2)}</td>`).join("")}</tr>
</tbody></table>

<!-- ANNEXURE C: WACC -->
<div class="annex-title">Annexure C - WACC Computation</div>
<table class="data"><thead><tr><th>Assumption</th><th class="num-col">Rate</th><th>Source</th></tr></thead><tbody>
<tr><td>Risk-free Rate (Rf)</td><td class="num-col">${f.rf}%</td><td>GOISEC 10-year bond yield (RBI / Bloomberg)</td></tr>
<tr><td>India Equity Risk Premium (ERP)</td><td class="num-col">${f.indiaERP}%</td><td>Damodaran Jan 2026: Mature ERP 4.23% + India CRP 2.845%</td></tr>
<tr><td>Beta</td><td class="num-col">${f.beta}</td><td>Damodaran India industry betas - ${f.sector} - Jan 2026</td></tr>
<tr><td>Cost of Equity (Ke = Rf + B x ERP)</td><td class="num-col bold">${dcf.ke.toFixed(2)}%</td><td>CAPM</td></tr>
<tr><td>Cost of Debt (Kd)</td><td class="num-col">${f.costOfDebt}%</td><td>Weighted average borrowing rate</td></tr>
<tr><td>Tax Rate</td><td class="num-col">${f.taxRate}%</td><td>Applicable corporate tax rate</td></tr>
<tr><td>Kd Net of Tax</td><td class="num-col">${dcf.kd.toFixed(2)}%</td><td>Kd x (1 - ${f.taxRate}%)</td></tr>
<tr><td>Equity Weight</td><td class="num-col">${f.equityPct}%</td><td>Capital structure assumption</td></tr>
<tr><td>Debt Weight</td><td class="num-col">${f.debtPct}%</td><td>Capital structure assumption</td></tr>
<tr class="bold hi-blue"><td>WACC</td><td class="num-col">${dcf.wacc.toFixed(2)}%</td><td>Ke x E% + Kd(1-t) x D%</td></tr>
<tr><td>Terminal Growth Rate</td><td class="num-col">${f.terminalGrowth}%</td><td>Conservative proxy for India nominal GDP CAGR</td></tr>
</tbody></table>
<div class="page-break"></div>

<!-- ANNEXURE F: DCF COMPUTATION -->
<div class="annex-title">Annexure F - DCF Valuation Calculation</div>
<p style="font-size:9pt;color:#555;margin-bottom:6pt">All amounts in ${u}. Discount rate: ${dcf.wacc.toFixed(2)}%. Terminal growth: ${f.terminalGrowth}%. Mid-year convention applied.</p>
<table class="data"><thead><tr><th>Description</th>${years.map(y=>`<th class="num-col">${y}</th>`).join("")}</tr></thead><tbody>
${[["Revenue","rev",false,false],["EBITDA","ebitda",true,true],["Profit Before Tax (EBT)","ebt",true,false],["Tax set-off (BF losses)","setOff",false,true],["Tax","tax",false,false],["PAT","pat",true,true],["Add: D&A","da",false,false],["Less: Capex","capex",false,false],["Less: Delta NWC","dnwc",false,false],["FCFF","fcff",true,true]].map(([label,key,bold,hi])=>{
  const cells=dcf.rows.map(r=>`<td class="num-col${hi?" hi-blue":""}${r[key]<0?" neg":""}">${d(r[key],2)}</td>`).join("");
  return `<tr${hi?` class="bold"`:""}><td${bold?` class="bold"`:""}>${label}</td>${cells}</tr>`;
}).join("")}
<tr><td class="bold">PV Factor</td>${dcf.pvF.map(v=>`<td class="num-col">${v.toFixed(4)}</td>`).join("")}</tr>
<tr class="bold hi-blue"><td>PV of FCFF</td>${dcf.pvFCFF.map(v=>`<td class="num-col${v<0?" neg":""}">${d(v,2)}</td>`).join("")}</tr>
</tbody></table>
<table class="data"><thead><tr><th>DCF Summary (${u})</th><th class="num-col">Amount</th></tr></thead><tbody>
<tr><td>Sum of PV of FCFFs</td><td class="num-col">${d(dcf.sumPV,2)}</td></tr>
<tr><td>Terminal Value</td><td class="num-col">${d(dcf.tv,2)}</td></tr>
<tr><td>PV of Terminal Value (discounted at year ${years.length-0.25})</td><td class="num-col">${d(dcf.pvTV,2)}</td></tr>
<tr class="bold hi-blue"><td>Enterprise Value</td><td class="num-col">${d(dcf.ev,2)}</td></tr>
<tr><td>Less: Total Debt</td><td class="num-col">${d(parseFloat(f.debt)||0,2)}</td></tr>
<tr><td>Add: Cash & Equivalents</td><td class="num-col">${d(parseFloat(f.cash)||0,2)}</td></tr>
<tr class="bold hi-blue"><td>Equity Value Attributable to Shareholders</td><td class="num-col">${d(dcf.eqVal,2)}</td></tr>
<tr><td>Number of Equity Shares</td><td class="num-col">${new Intl.NumberFormat("en-IN").format(parseFloat(f.numShares)||0)}</td></tr>
<tr class="bold hi-green"><td>Fair Value per Equity Share (INR)</td><td class="num-col">INR ${new Intl.NumberFormat("en-IN",{minimumFractionDigits:2}).format(dcf.vps)}/-</td></tr>
</tbody></table>

<div class="page-break"></div>
<!-- ANNEXURE H: SENSITIVITY + SIGNATURE -->
<div class="annex-title">Annexure H - Sensitivity Analysis</div>
<p style="font-size:9pt;color:#555;margin-bottom:6pt">Value per share (INR) across WACC and terminal growth rate scenarios. Base case highlighted.</p>
<table class="data"><thead><tr><th>WACC vs Terminal Growth</th>
${sensitivity.tgAdj.map(t=>`<th class="num-col">TG ${t>0?"+":""}${t}% = ${(parseFloat(f.terminalGrowth)+t).toFixed(1)}%</th>`).join("")}
</tr></thead><tbody>${sensRows}</tbody></table>

<!-- SIGNATURE BLOCK (merged with Annexure H page) -->
<div class="sign-block" style="margin-top:40pt;border-top:1pt solid #ccc;padding-top:16pt;">
<div class="sign-left">
<div class="sign-name">${isValuer?(f.valueName||"Valuer Name"):(f.companyName||"Company Name")}</div>
${isValuer?`<div>${f.valueDesig}${f.valueFirm?" | "+f.valueFirm:""}</div>
<div>${f.valueCity||""}</div>
${f.valueMembership?`<div>Membership No: ${f.valueMembership}</div>`:""}
${f.valueUDIN?`<div>UDIN: ${f.valueUDIN}</div>`:(f.udin?`<div>UDIN: ${f.udin}</div>`:"")}`:
`<div>Management Valuation Report</div>`}
</div>
<div class="sign-right">
<div>Date: ${vDate}</div>
<div>Place: ${isValuer?(f.valueCity||"Place"):(f.regOffice?.split(",").slice(-2,-1)[0]?.trim()||"Place")}</div>
<div style="margin-top:20pt;font-style:italic">Signature ${isValuer?"& Seal":""}</div>
</div>
</div>
${fundraisingSection}
</body></html>`;
}

// --- SECTION 8: REPORT -------------------------------------------------------
function CreateListingModal(p) {
  var fSt = useState({
    businessName: p.companyName || "",
    sector: p.sector || "",
    city: "",
    state: "",
    description: p.businessDescription || "",
    yearsInOperation: "",
    employeeCount: "",
    revenueLakhs: p.revenueLakhs || "",
    ebitdaLakhs: p.ebitdaLakhs || "",
    ebitdaMarginPct: p.ebitdaMarginPct || "",
    askingPriceLakhs: "",
    evFromDcfLakhs: p.evFromDcfLakhs || "",
    purpose: p.purpose || "sale",
    dealStructure: ["Full acquisition"],
    managementStays: true,
    closingTimeline: "6-12 months",
    hasValuationReport: true,
  });
  var lf = fSt[0], setLf = fSt[1];
  var savingSt = useState(false), saving = savingSt[0], setSaving = savingSt[1];
  var errorSt = useState(""), error = errorSt[0], setError = errorSt[1];

  function updateLf(key, val) {
    setLf(function(prev){ return Object.assign({}, prev, {[key]: val}); });
  }

  async function handleSubmit() {
    if (!lf.businessName || !lf.sector || !lf.city || !lf.askingPriceLakhs) {
      setError("Please fill in business name, sector, city and asking price.");
      return;
    }
    setSaving(true);
    setError("");
    try {
      var res = await supabase.from('listings').insert({
        seller_id: p.userId,
        engagement_id: p.engagementId || null,
        business_name: lf.businessName,
        business_type: lf.sector,
        sector: lf.sector,
        city: lf.city,
        state: lf.state,
        description: lf.description,
        years_in_operation: parseInt(lf.yearsInOperation) || null,
        employee_count: parseInt(lf.employeeCount) || null,
        revenue_lakhs: parseFloat(lf.revenueLakhs) || null,
        ebitda_lakhs: parseFloat(lf.ebitdaLakhs) || null,
        ebitda_margin_pct: parseFloat(lf.ebitdaMarginPct) || null,
        asking_price_lakhs: parseFloat(lf.askingPriceLakhs),
        ev_from_dcf_lakhs: parseFloat(lf.evFromDcfLakhs) || null,
        purpose: lf.purpose,
        deal_structure: lf.dealStructure,
        management_stays: lf.managementStays,
        closing_timeline: lf.closingTimeline,
        has_valuation_report: lf.hasValuationReport,
        verification_status: lf.hasValuationReport ? 'verified' : 'self_reported',
        status: 'pending_review',
      });
      if (res.error) throw res.error;
      await sendNotification('new_listing', {
        business_name: lf.businessName,
        sector: lf.sector,
        city: lf.city,
        asking_price_lakhs: lf.askingPriceLakhs,
        verification_status: lf.hasValuationReport ? 'verified' : 'self_reported'
      });
      setSaving(false);
      p.onSuccess();
    } catch(err) {
      setSaving(false);
      setError("Failed to create listing: " + (err.message || "Please try again."));
    }
  }

  var inp = {width:"100%", padding:"9px 12px", borderRadius:"8px",
    border:"1.5px solid #c4cdd9", background:"#fff", fontSize:"13px",
    boxSizing:"border-box", fontFamily:"var(--font-sans)"};
  var lbl = {fontSize:"12px", color:"var(--text-secondary)",
    display:"block", marginBottom:"4px", fontWeight:"500"};

  return (
    <div style={{position:"fixed", inset:0, background:"rgba(0,0,0,0.5)",
      zIndex:1000, display:"flex", alignItems:"center", justifyContent:"center",
      padding:"20px", overflowY:"auto"}}>
      <div style={{background:"#fff", borderRadius:"16px", padding:"28px",
        width:"100%", maxWidth:"600px", maxHeight:"90vh", overflowY:"auto",
        boxShadow:"0 20px 60px rgba(0,0,0,0.2)"}}>

        <div style={{display:"flex", justifyContent:"space-between",
          alignItems:"center", marginBottom:"20px"}}>
          <div>
            <h2 style={{fontSize:"18px", fontWeight:"600", margin:"0 0 4px"}}>
              Create your listing
            </h2>
            <p style={{fontSize:"12px", color:"var(--text-muted)", margin:0}}>
              Your listing goes to review before going live. We will notify you within 24 hours.
            </p>
          </div>
          <button onClick={p.onClose}
            style={{padding:"6px 12px", borderRadius:"6px", cursor:"pointer",
              background:"var(--surface-1)", color:"var(--text-secondary)",
              border:"0.5px solid var(--border)", fontSize:"12px"}}>
            Cancel
          </button>
        </div>

        <div style={{display:"grid", gridTemplateColumns:"1fr 1fr", gap:"14px", marginBottom:"14px"}}>
          <div style={{gridColumn:"span 2"}}>
            <label style={lbl}>Business name (public name — not company registration name)</label>
            <input value={lf.businessName} onChange={function(e){updateLf("businessName",e.target.value);}} style={inp} placeholder="e.g. South India IT Services Firm"/>
          </div>
          <div>
            <label style={lbl}>Sector</label>
            <select value={lf.sector} onChange={function(e){updateLf("sector",e.target.value);}} style={inp}>
              {["Trading / Distribution","Manufacturing","IT Services","Professional Services","Healthcare","Construction / Infrastructure","Food and Beverage","Logistics","Other"].map(function(s){return <option key={s}>{s}</option>;})}
            </select>
          </div>
          <div>
            <label style={lbl}>Purpose</label>
            <select value={lf.purpose} onChange={function(e){updateLf("purpose",e.target.value);}} style={inp}>
              <option value="sale">Promoter exit / sale</option>
              <option value="fundraising">Raising equity capital</option>
              <option value="succession">Succession planning</option>
              <option value="minority">Minority stake sale</option>
            </select>
          </div>
          <div>
            <label style={lbl}>City</label>
            <input value={lf.city} onChange={function(e){updateLf("city",e.target.value);}} style={inp} placeholder="e.g. Hyderabad"/>
          </div>
          <div>
            <label style={lbl}>State</label>
            <select value={lf.state} onChange={function(e){updateLf("state",e.target.value);}} style={inp}>
              {["Telangana","Maharashtra","Karnataka","Tamil Nadu","Delhi NCR","Gujarat","Rajasthan","Uttar Pradesh","West Bengal","Kerala","Punjab","Madhya Pradesh","Other"].map(function(s){return <option key={s}>{s}</option>;})}
            </select>
          </div>
          <div>
            <label style={lbl}>Revenue (Lakhs) — approximate</label>
            <input type="number" value={lf.revenueLakhs} onChange={function(e){updateLf("revenueLakhs",e.target.value);}} style={inp} placeholder="e.g. 320"/>
          </div>
          <div>
            <label style={lbl}>EBITDA (Lakhs) — approximate</label>
            <input type="number" value={lf.ebitdaLakhs} onChange={function(e){updateLf("ebitdaLakhs",e.target.value);}} style={inp} placeholder="e.g. 64"/>
          </div>
          <div>
            <label style={lbl}>Asking price (Lakhs)</label>
            <input type="number" value={lf.askingPriceLakhs} onChange={function(e){updateLf("askingPriceLakhs",e.target.value);}} style={inp} placeholder="e.g. 300"/>
          </div>
          <div>
            <label style={lbl}>DCF enterprise value (Lakhs) — auto-filled</label>
            <input type="number" value={lf.evFromDcfLakhs} onChange={function(e){updateLf("evFromDcfLakhs",e.target.value);}} style={inp} placeholder="From valuation"/>
          </div>
          <div>
            <label style={lbl}>Years in operation</label>
            <input type="number" value={lf.yearsInOperation} onChange={function(e){updateLf("yearsInOperation",e.target.value);}} style={inp} placeholder="e.g. 8"/>
          </div>
          <div>
            <label style={lbl}>Team size (approx.)</label>
            <input type="number" value={lf.employeeCount} onChange={function(e){updateLf("employeeCount",e.target.value);}} style={inp} placeholder="e.g. 25"/>
          </div>
          <div style={{gridColumn:"span 2"}}>
            <label style={lbl}>Brief description (visible to buyers)</label>
            <textarea value={lf.description} onChange={function(e){updateLf("description",e.target.value);}} rows={3}
              style={Object.assign({},inp,{resize:"vertical", lineHeight:"1.5"})}
              placeholder="Describe the business in 2-3 sentences. Do not include company name or contact details."/>
          </div>
          <div>
            <label style={lbl}>Closing timeline</label>
            <select value={lf.closingTimeline} onChange={function(e){updateLf("closingTimeline",e.target.value);}} style={inp}>
              <option>3-6 months</option>
              <option>6-12 months</option>
              <option>12-18 months</option>
              <option>Flexible</option>
            </select>
          </div>
          <div>
            <label style={lbl}>Management post-acquisition</label>
            <select value={lf.managementStays} onChange={function(e){updateLf("managementStays",e.target.value==="true");}} style={inp}>
              <option value="true">Available for transition (6-12 months)</option>
              <option value="false">Exits at closing</option>
            </select>
          </div>
        </div>

        <div style={{padding:"12px 14px", background:"#fef3c7", borderRadius:"8px",
          border:"0.5px solid #fcd34d", marginBottom:"16px"}}>
          <p style={{fontSize:"11px", color:"#92400e", margin:0, lineHeight:"1.6"}}>
            Your listing will be reviewed by our team before going live. Company name and exact contact details are never shown publicly — only to buyers after a formal introduction is arranged. Revenue and financial figures are shown as ranges to anonymous visitors.
          </p>
        </div>

        {error && <p style={{fontSize:"12px", color:"#dc2626", marginBottom:"12px"}}>{error}</p>}

        <button onClick={handleSubmit} disabled={saving}
          style={{width:"100%", padding:"12px", borderRadius:"8px", fontSize:"14px",
            fontWeight:"500", cursor:saving?"default":"pointer",
            background:saving?"var(--surface-1)":"#16a34a",
            color:saving?"var(--text-muted)":"#fff", border:"none"}}>
          {saving ? "Submitting..." : "Submit listing for review →"}
        </button>
      </div>
    </div>
  );
}

function S8_Report({f,setF,dcf,vc,rm,ec,navCalc,ai,generating,onGenerate,years,sensitivity,props}){
  const u=f.unit, mult=UNIT_MULT[u]||1;
  const hasRev=years.some(y=>parseFloat((f.forecastMode==="auto"?computeAutoYear(f,years,years.indexOf(y)):f.forecast[y]||{}).revenue)>0);

  const openPrint=()=>{
    const html=generateReportHTML(f,dcf,vc,rm,ec,navCalc,ai,years,sensitivity);
    const win=window.open("","_blank","width=900,height=700");
    if(win){win.document.write(html);win.document.close();setTimeout(()=>{win.focus();win.print();},600);}
  };

  var showListingSt=useState(false), showListingForm=showListingSt[0], setShowListingForm=showListingSt[1];
  var listingSubmittedSt=useState(false), listingSubmitted=listingSubmittedSt[0], setListingSubmitted=listingSubmittedSt[1];

  return <div>
    {!hasRev&&<div style={{padding:"10px 12px",background:"var(--color-background-warning)",border:"0.5px solid var(--color-border-warning)",borderRadius:"6px",marginBottom:"12px"}}>
      <p style={{fontSize:"12px",color:"var(--color-text-warning)",margin:0}}>Revenue projections are empty. Complete the Forecast P&L section first.</p>
    </div>}
    <div style={{display:"grid",gridTemplateColumns:"repeat(3,1fr)",gap:"10px",marginBottom:"16px"}}>
      {[["Company",f.companyName||"--"],[`EV (${u})`,new Intl.NumberFormat("en-IN",{maximumFractionDigits:0}).format(dcf.ev/(UNIT_MULT[u]||1))],["Per share (DCF)","INR "+new Intl.NumberFormat("en-IN",{minimumFractionDigits:2}).format(dcf.vps)]].map(([l,v])=>(
        <div key={l} style={{padding:"10px 12px",background:"var(--color-background-secondary)",borderRadius:"6px"}}>
          <p style={{fontSize:"11px",color:"var(--color-text-tertiary)",margin:"0 0 2px"}}>{l}</p>
          <p style={{fontSize:"14px",fontWeight:"500",margin:0}}>{v}</p>
        </div>
      ))}
    </div>
    {f.valueMembership&&!f.valueMembership.includes("Indicative")&&(
      <div style={{padding:"14px 16px",background:"var(--surface-2)",
        border:"0.5px solid var(--border)",borderRadius:"10px",
        marginBottom:"16px"}}>
        <p style={{fontSize:"12px",fontWeight:"500",margin:"0 0 4px"}}>
          UDIN (Unique Document Identification Number)
        </p>
        <p style={{fontSize:"11px",color:"var(--text-muted)",margin:"0 0 10px",lineHeight:"1.5"}}>
          Generate UDIN on icai.in after reviewing this report, then enter it here
          before sharing with your client. The report will include the UDIN once entered.
        </p>
        <div style={{display:"flex",gap:"8px"}}>
          <input
            value={f.udin||""}
            onChange={function(e){
              setF(function(prev){return Object.assign({},prev,{udin:e.target.value});});
            }}
            placeholder="e.g. 24012345AAAAAA1234"
            style={{flex:1,padding:"8px 12px",borderRadius:"6px",
              border:"1.5px solid var(--border)",fontSize:"12px",
              background:"#fff",fontFamily:"var(--font-sans)"}}/>
          <a href="https://udin.icai.org" target="_blank" rel="noopener noreferrer"
            style={{padding:"8px 14px",borderRadius:"6px",fontSize:"12px",
              background:"var(--bg-accent)",color:"var(--text-accent)",
              border:"0.5px solid var(--border-accent)",textDecoration:"none",
              whiteSpace:"nowrap",display:"flex",alignItems:"center"}}>
            Generate on ICAI →
          </a>
        </div>
      </div>
    )}
    {!ai?<div>
      <p style={{fontSize:"12px",color:"var(--color-text-secondary)",marginBottom:"14px"}}>Click to generate the AI-assisted report. The AI generates the industry outlook, company narrative, risk analysis, and conclusion. All financial computations (DCF, WACC, sensitivity) auto-populate from your inputs.</p>
      <div style={{display:"flex",gap:"10px",flexWrap:"wrap"}}>
        <button onClick={onGenerate} disabled={generating} style={{fontSize:"13px",padding:"10px 22px",background:"var(--color-background-info)",color:"var(--color-text-info)",border:"0.5px solid var(--color-border-info)",borderRadius:"6px",cursor:generating?"default":"pointer",opacity:generating?0.7:1}}>
          <i className="ti ti-sparkles" aria-hidden="true" style={{marginRight:"6px"}}/>
          {generating?"Generating AI report...":"Generate AI valuation report"}
        </button>
        <button onClick={openPrint} style={{fontSize:"13px",padding:"10px 22px",borderRadius:"6px",cursor:"pointer"}}>
          <i className="ti ti-printer" aria-hidden="true" style={{marginRight:"6px"}}/>
          Print report (without AI narrative)
        </button>
      </div>
    </div>:
    <div>
      <p style={{fontSize:"12px",color:"var(--color-text-secondary)",marginBottom:"10px"}}>AI report generated. Click Print to open a clean A4-ready version in a new window.</p>
      <div style={{display:"flex",gap:"10px",marginBottom:"16px",flexWrap:"wrap"}}>
        <button onClick={openPrint} style={{fontSize:"13px",padding:"10px 22px",background:"var(--color-background-info)",color:"var(--color-text-info)",border:"0.5px solid var(--color-border-info)",borderRadius:"6px",cursor:"pointer"}}>
          <i className="ti ti-printer" aria-hidden="true" style={{marginRight:"6px"}}/>
          Open & Print Report (A4)
        </button>
        <button onClick={onGenerate} disabled={generating} style={{fontSize:"13px",padding:"10px 22px",borderRadius:"6px",cursor:generating?"default":"pointer",opacity:generating?0.7:1}}>
          <i className="ti ti-refresh" aria-hidden="true" style={{marginRight:"6px"}}/>
          {generating?"Regenerating...":"Regenerate AI narrative"}
        </button>
        <button onClick={function(){ setShowListingForm(true); }}
          style={{padding:"10px 22px", borderRadius:"8px", fontSize:"13px", fontWeight:"500",
            cursor:"pointer", background:"#16a34a", color:"#fff", border:"none",
            marginLeft:"8px"}}>
          <i className="ti ti-building-store" aria-hidden="true" style={{marginRight:"6px"}}/>
          Create a listing
        </button>
      </div>
      <div style={{padding:"12px 14px",background:"var(--color-background-secondary)",borderRadius:"8px",border:"0.5px solid var(--color-border-tertiary)"}}>
        <p style={{fontSize:"12px",fontWeight:"500",margin:"0 0 8px"}}>AI-generated narrative preview</p>
        <p style={{fontSize:"12px",color:"var(--color-text-secondary)",margin:"0 0 4px",fontWeight:"500"}}>Industry outlook (first 200 chars):</p>
        <p style={{fontSize:"12px",margin:"0 0 10px"}}>{ai.industryOutlook?.substring(0,200)}...</p>
        <p style={{fontSize:"12px",color:"var(--color-text-secondary)",margin:"0 0 4px",fontWeight:"500"}}>Risk factors identified: {ai.riskFactors?.length||0}</p>
        {ai.riskFactors?.map((r,i)=><p key={i} style={{fontSize:"11px",color:"var(--color-text-secondary)",margin:"1px 0 1px 10px"}}>- <strong>{r.title}:</strong> {r.detail}</p>)}
      </div>
    </div>}
    {showListingForm && !listingSubmitted && (
      <CreateListingModal
        companyName={f.companyName}
        sector={f.sector}
        businessDescription={f.businessDescription}
        revenueLakhs={dcf && dcf.rows && dcf.rows[0] ? Math.round(dcf.rows[0].rev / (UNIT_MULT[f.unit]||100000)) : ""}
        ebitdaLakhs={dcf && dcf.rows && dcf.rows[0] ? Math.round(dcf.rows[0].ebitda / (UNIT_MULT[f.unit]||100000)) : ""}
        evFromDcfLakhs={dcf ? Math.round((dcf.ev||0) / (UNIT_MULT[f.unit]||100000)) : ""}
        purpose={f.purpose && f.purpose.toLowerCase().includes("sale") ? "sale" : f.purpose && f.purpose.toLowerCase().includes("fund") ? "fundraising" : "sale"}
        userId={props && props.user && props.user.id}
        engagementId={props && props.engagementId}
        onClose={function(){ setShowListingForm(false); }}
        onSuccess={function(){ setShowListingForm(false); setListingSubmitted(true); }}
      />
    )}
    {listingSubmitted && (
      <div style={{marginTop:"16px", padding:"16px 20px", background:"#f0fdf4",
        border:"1px solid #86efac", borderRadius:"10px",
        display:"flex", alignItems:"center", gap:"12px"}}>
        <i className="ti ti-circle-check" aria-hidden="true"
          style={{fontSize:"24px", color:"#16a34a", flexShrink:0}}/>
        <div>
          <p style={{fontSize:"14px", fontWeight:"500", color:"#16a34a", margin:"0 0 3px"}}>
            Listing submitted for review
          </p>
          <p style={{fontSize:"12px", color:"#16a34a", margin:0, opacity:0.8}}>
            Our team will review your listing within 24 hours. You will be notified when it goes live. Buyers will only see financial ranges — your exact details remain confidential until a formal introduction is arranged.
          </p>
        </div>
      </div>
    )}
  </div>;
}

// --- MAIN APP -----------------------------------------------------------------
const SECTIONS=[
  {id:"valuer",num:"0",title:"Valuer profile",subtitle:"Credentials and letterhead for report"},
  {id:"company",num:"1",title:"Company information",subtitle:"CIN, incorporation, capital structure, shareholding"},
  {id:"business",num:"2",title:"Business understanding",subtitle:"Sector, stage, products, revenue model, key risks"},
  {id:"forecast",num:"3",title:"Forecast assumptions & P&L",subtitle:"Industry-specific P&L with dynamic years, unit scaling, manual or auto mode"},
  {id:"wc_capex",num:"4",title:"Working capital & capex",subtitle:"Credit periods, NWC computation, capex, funding position"},
  {id:"methods",num:"5",title:"Valuation methodology",subtitle:"Method selection, comparison matrix, method-specific inputs"},
  {id:"wacc",num:"6",title:"WACC & discount rate",subtitle:"Damodaran India beta (Jan 2026), ERP, capital structure"},
  {id:"results",num:"7",title:"Valuation results & analysis",subtitle:"EV, equity value, per share, loss carry-forward schedule, sensitivity"},
  {id:"report",num:"8",title:"Report generation",subtitle:"Professional A4 print-ready valuation report"},
];

function ValuationPlatform(props){
  const [form,setForm]=useState(()=>{const d=initForm();return (props&&props.initialForm)?Object.assign({},d,props.initialForm):d;});
  const [open,setOpen]=useState((props.initialForm&&props.initialForm.engagementType==="internal")?"company":null);
  const [ai,setAi]=useState(null);
  const [gen,setGen]=useState(false);
  const [err,setErr]=useState("");
  const [lastSaved,setLastSaved]=useState(null);
  var origFormSt=useState(null),origForm=origFormSt[0],setOrigForm=origFormSt[1];
  var bannerSt=useState(null),bannerMsg=bannerSt[0],setBannerMsg=bannerSt[1];
  var bannerTimerSt=useState(null),bannerTimer=bannerTimerSt[0],setBannerTimer=bannerTimerSt[1];

  async function saveValuationForm(formData,engagementId){
    if(!props.user||!engagementId)return;
    try{
      await supabase.from("engagements").update({
        valuation_form:formData,
        status:"model_ready",
        updated_at:new Date().toISOString()
      }).eq("id",engagementId);
      setLastSaved(new Date().toLocaleTimeString("en-IN",{hour:"2-digit",minute:"2-digit"}));
    }catch(e){console.error("Auto-save failed:",e);}
  }

  useEffect(function(){
    if(!props.user||!props.engagementId)return;
    var interval=setInterval(function(){saveValuationForm(form,props.engagementId);},30000);
    return function(){clearInterval(interval);};
  },[form,props.engagementId,props.user]);

  useEffect(function(){
    async function restoreForm(){
      if(!props.engagementId||!props.user){
        if(props.initialForm)setOrigForm(props.initialForm);
        return;
      }
      try{
        var res=await supabase.from("engagements").select("valuation_form, updated_at").eq("id",props.engagementId).single();
        if(res.data&&res.data.valuation_form){
          var saved=res.data.valuation_form;
          var defaults=initForm();
          var merged=Object.assign({},defaults,saved);
          setForm(merged);
          setOrigForm(merged);
          setLastSaved(new Date(res.data.updated_at).toLocaleTimeString("en-IN",{hour:"2-digit",minute:"2-digit"}));
        }else if(props.initialForm){
          setOrigForm(props.initialForm);
        }
      }catch(err){
        if(props.initialForm)setOrigForm(props.initialForm);
        console.error("Restore failed:",err);
      }
    }
    restoreForm();
  },[props.engagementId]);

  useEffect(function(){
    async function loadProfile(){
      if(!props.user)return;
      var res=await supabase.from('profiles').select('*').eq('id',props.user.id).maybeSingle();
      if(res.data&&res.data.full_name){
        setForm(function(prev){
          return Object.assign({},prev,{
            valueName:res.data.is_professional
              ?(res.data.designation||"CA")+" "+res.data.full_name
              :"BuzinessDeals Platform",
            valueFirm:res.data.firm_name||"Zenius Advisors",
            valueMembership:res.data.is_professional
              ?(res.data.membership_number||"")
              :"Indicative Valuation — Not for Statutory Use",
            valueFirmAddress:res.data.firm_address||"Hyderabad, Telangana",
          });
        });
      }
    }
    loadProfile();
  },[props.user]);

  function showChangeBanner(fieldLabel){
    if(bannerTimer)clearTimeout(bannerTimer);
    setBannerMsg(fieldLabel+" updated — DCF will recalculate automatically.");
    var timer=setTimeout(function(){setBannerMsg(null);},4000);
    setBannerTimer(timer);
  }

  useEffect(function(){
    if(!origForm)return;
    var watchedFields=[
      {key:"forecast",label:"Forecast"},
      {key:"dso",label:"Debtor days"},
      {key:"dpo",label:"Creditor days"},
      {key:"debt",label:"Total debt"},
      {key:"rf",label:"Risk-free rate"},
      {key:"beta",label:"Beta"},
      {key:"terminalGrowth",label:"Terminal growth rate"},
      {key:"taxRate",label:"Tax rate"},
    ];
    var changed=watchedFields.find(function(f){
      if(f.key==="forecast"){
        return JSON.stringify(form.forecast)!==JSON.stringify(origForm.forecast);
      }
      return String(form[f.key])!==String(origForm[f.key]);
    });
    if(changed)showChangeBanner(changed.label);
  },[form.forecast,form.dso,form.dpo,form.debt,form.rf,form.beta,form.terminalGrowth,form.taxRate]);

  const years=useMemo(()=>getDynamicYears(form.forecastPeriod),[form.forecastPeriod]);
  const dcf=useMemo(()=>computeDCF(form,years),[form,years]);
  const vc=useMemo(()=>(form.selectedMethods||[]).includes("vc")?computeVC(form,dcf.rows):null,[form,dcf.rows]);
  const rm=useMemo(()=>(form.selectedMethods||[]).includes("comparable")?computeRevMult(form,dcf.rows):null,[form,dcf.rows]);
  const ec=useMemo(()=>(form.selectedMethods||[]).includes("earnings")?computeEarningsCap(form,dcf.rows):null,[form,dcf.rows]);
  const navCalc=useMemo(()=>{
    if(!(form.selectedMethods||[]).includes("nav"))return null;
    const book=parseFloat(form.navBookValue)||0,reval=parseFloat(form.navRevaluation)||0;
    const surplus=parseFloat(form.navSurplusAssets)||0,cont=parseFloat(form.navContingentLiab)||0;
    const ev=book+reval+surplus-cont, debt=parseFloat(form.debt)||0, cash=parseFloat(form.cash)||0;
    const shares=parseFloat(form.numShares)||1;
    return{ev,eqVal:ev+cash-debt,vps:(ev+cash-debt)/shares};
  },[form]);
  const sensitivity=useMemo(()=>computeSensitivity(form,years),[form,years]);
  const {wacc}=useMemo(()=>computeWACC(form),[form]);

  const isComplete=id=>{
    if(id==="valuer")return !!form.valueName;
    if(id==="company")return !!(form.companyName&&form.cin);
    if(id==="business")return form.businessDescription?.length>10;
    if(id==="forecast")return years.some(y=>{const raw=form.forecastMode==="auto"?computeAutoYear(form,years,years.indexOf(y)):(form.forecast[y]||{});return parseFloat(raw.revenue)>0;});
    if(id==="wc_capex")return !!(form.dso&&form.dpo);
    if(id==="methods")return (form.selectedMethods||[]).length>0;
    if(id==="wacc")return !!(form.rf&&form.beta);
    return false;
  };
  const goNext=id=>{const i=SECTIONS.findIndex(s=>s.id===id);if(i<SECTIONS.length-1)setOpen(SECTIONS[i+1].id);if(props.engagementId)saveValuationForm(form,props.engagementId);};

  const generate=async()=>{
    setGen(true);setErr("");
    try{
      const prompt=`You are a senior CA/Registered Valuer writing a professional Indian equity valuation report.
Company: ${form.companyName||"the Company"}
Sector: ${form.sector}
Stage: ${form.stage}
Purpose: ${form.purpose}
Business: ${form.businessDescription||"Not provided"}
Products/Services: ${(form.productsServices||[]).join(", ")||"Not specified"}
Revenue model: ${(form.revenueModel||[]).join(", ")||"Not specified"}
Customer segments: ${(form.customerSegments||[]).join(", ")||"Not specified"}
Competitive advantage: ${(form.competitiveAdvantage||[]).join(", ")||"Not specified"}
Growth strategy: ${(form.growthDrivers||[]).join(", ")||"Not specified"}
Key risks: ${(form.keyRisks||[]).join(", ")||"Not specified"}
EV: ${form.unit} ${Math.round(dcf.ev/(UNIT_MULT[form.unit]||1))} | Per share: INR ${dcf.vps.toFixed(2)} | WACC: ${dcf.wacc.toFixed(2)}%

Return ONLY valid JSON (no markdown, no preamble):
{"industryOutlook":"2-3 professional paragraphs on the Indian ${form.sector} industry outlook - growth drivers, regulatory landscape, investment activity. Paragraphs separated by \n.","companyBackground":"1-2 paragraphs on the company based on the description.","riskFactors":[{"title":"Risk 1 title","detail":"One sentence on risk and impact"},{"title":"Risk 2","detail":"One sentence"},{"title":"Risk 3","detail":"One sentence"},{"title":"Risk 4","detail":"One sentence"},{"title":"Risk 5","detail":"One sentence"}],"conclusion":"One professional paragraph summarising the valuation conclusion - EV, equity value, per share value, methodology applied, and confidence basis."}`;

      const res=await fetch("https://mpjxulzllmmoiqaqwart.supabase.co/functions/v1/quick-worker",{method:"POST",headers:{"Content-Type":"application/json","apikey":"sb_publishable_0Xkatb8dUNbdP44AWek6Hg_Br4SNyf2","Authorization":"Bearer sb_publishable_0Xkatb8dUNbdP44AWek6Hg_Br4SNyf2"},body:JSON.stringify({model:"claude-sonnet-4-6",max_tokens:4000,messages:[{role:"user",content:prompt}]})});
      const data=await res.json();
      const text=data.content?.map(c=>c.text||"").join("").trim();
      setAi(JSON.parse(text.replace(/```json|```/g,"").trim()));
    }catch(e){
      setErr("Generation error: "+e.message);
      setAi({industryOutlook:"Industry outlook not generated. Please try again.",companyBackground:"Company background not generated.",riskFactors:[],conclusion:"Conclusion not generated."});
    }finally{setGen(false);}
  };

  const hasRev=years.some(y=>parseFloat((form.forecastMode==="auto"?computeAutoYear(form,years,years.indexOf(y)):(form.forecast[y]||{})).revenue)>0);
  const u=form.unit, mult=UNIT_MULT[u]||1;

  useEffect(function(){
    return function(){
      if(bannerTimer)clearTimeout(bannerTimer);
    };
  },[bannerTimer]);

  // Landing: select engagement type
  if(!form.engagementType){
    return <EngagementLanding onSelect={type=>{
      const showValuer=type==="valuer";
      setForm({...form,engagementType:type});
      setOpen(showValuer?"valuer":"company");
    }}/>;
  }

  const visibleSections=SECTIONS.filter(s=>!(s.id==="valuer"&&form.engagementType==="internal"));

  return <div style={{maxWidth:"800px",margin:"0 auto",fontFamily:"var(--font-sans)",height:"calc(100vh - 48px)",overflowY:"auto",padding:"0 24px 24px"}}>
    <div style={{position:"sticky",top:0,zIndex:10,background:"#1a2332",padding:"14px 16px",margin:"-24px -24px 14px",borderBottom:"1px solid rgba(255,255,255,0.1)"}}>
      <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",flexWrap:"wrap",gap:"8px"}}>
        <div style={{flex:1}}>
          <h1 style={{fontSize:"17px",fontWeight:"500",margin:"0 0 2px",color:"#ffffff"}}>Business Valuation Platform</h1>
          <p style={{fontSize:"12px",color:"rgba(255,255,255,0.7)",margin:0}}>
              {form.companyName?<strong style={{color:"#ffffff"}}>{form.companyName}</strong>:"No company"} | {form.sector.split(" ")[0]} | WACC {wacc.toFixed(2)}% | {form.forecastPeriod}Y | {u}
            </p>
        </div>
        <div style={{display:"flex",gap:"8px",alignItems:"center"}}>
          {hasRev&&<>
            {[["EV",Math.round(dcf.ev/mult)],["Equity",Math.round(dcf.eqVal/mult)]].map(([l,v])=><div key={l} style={{padding:"5px 10px",background:"rgba(255,255,255,0.08)",borderRadius:"6px",textAlign:"center"}}>
              <p style={{fontSize:"10px",color:"rgba(255,255,255,0.5)",margin:"0 0 1px"}}>{l} ({u})</p>
              <p style={{fontSize:"13px",fontWeight:"500",margin:0,color:"#ffffff"}}>{new Intl.NumberFormat("en-IN").format(v)}</p>
            </div>)}
            <div style={{padding:"5px 10px",background:"rgba(37,99,235,0.25)",borderRadius:"6px",textAlign:"center"}}>
              <p style={{fontSize:"10px",color:"rgba(255,255,255,0.7)",margin:"0 0 1px"}}>Per share</p>
              <p style={{fontSize:"13px",fontWeight:"500",margin:0,color:"#93c5fd"}}>INR {new Intl.NumberFormat("en-IN",{minimumFractionDigits:2}).format(dcf.vps)}</p>
            </div>
          </>}
          {lastSaved&&<span style={{fontSize:"10px",color:"rgba(255,255,255,0.5)"}}>Saved {lastSaved}</span>}
          <button onClick={function(){if(props.onHome){props.onHome();}else{setForm({...form,engagementType:null});}}} title="Back to home"
            style={{padding:"7px 12px",background:"transparent",border:"1px solid rgba(255,255,255,0.2)",borderRadius:"6px",cursor:"pointer",display:"flex",alignItems:"center",gap:"5px"}}>
            <i className="ti ti-home" aria-hidden="true" style={{fontSize:"14px",color:"#ffffff"}}/>
            <span style={{fontSize:"12px",color:"#ffffff"}}>Home</span>
          </button>
        </div>
      </div>
    </div>

    {bannerMsg&&(
      <div style={{
        display:"flex",alignItems:"center",justifyContent:"space-between",
        padding:"9px 20px",
        background:"#fef3c7",
        borderBottom:"1px solid #fcd34d",
        flexShrink:0
      }}>
        <div style={{display:"flex",alignItems:"center",gap:"8px"}}>
          <i className="ti ti-refresh" aria-hidden="true"
            style={{fontSize:"14px",color:"#92400e"}}/>
          <span style={{fontSize:"12px",color:"#92400e",fontWeight:"500"}}>
            {bannerMsg}
          </span>
        </div>
        <button onClick={function(){setBannerMsg(null);}}
          style={{fontSize:"11px",padding:"2px 8px",borderRadius:"4px",
            cursor:"pointer",background:"transparent",
            color:"#92400e",border:"0.5px solid #fcd34d"}}>
          Dismiss
        </button>
      </div>
    )}

    {visibleSections.map(sec=><AccordionSection key={sec.id} id={sec.id} num={sec.num} title={sec.title} subtitle={sec.subtitle}
      isOpen={open===sec.id} onToggle={()=>setOpen(s=>s===sec.id?null:sec.id)} complete={isComplete(sec.id)}>
      {sec.id==="valuer"&&<S0_Valuer f={form} setF={setForm} onNext={()=>goNext("valuer")} isFromBuzinessDeals={!!props.initialForm} setSection={function(){setOpen("company");}}/>}
      {sec.id==="company"&&<S1_Company f={form} setF={setForm} onNext={()=>goNext("company")}/>}
      {sec.id==="business"&&<S2_Business f={form} setF={setForm} onNext={()=>goNext("business")}/>}
      {sec.id==="forecast"&&<S3_Forecast f={form} setF={setForm} years={years} onNext={()=>goNext("forecast")}/>}
      {sec.id==="wc_capex"&&<S4_WC f={form} setF={setForm} years={years} onNext={()=>goNext("wc_capex")}/>}
      {sec.id==="methods"&&<S5_Methods f={form} setF={setForm} onNext={()=>goNext("methods")}/>}
      {sec.id==="wacc"&&<S6_WACC f={form} setF={setForm} onNext={()=>goNext("wacc")}/>}
      {sec.id==="results"&&<S7_Results f={form} dcf={dcf} vc={vc} rm={rm} ec={ec} navCalc={navCalc} years={years} sensitivity={sensitivity}/>}
      {sec.id==="report"&&<S8_Report f={form} setF={setForm} dcf={dcf} vc={vc} rm={rm} ec={ec} navCalc={navCalc} ai={ai} generating={gen} onGenerate={generate} years={years} sensitivity={sensitivity} props={props}/>}
    </AccordionSection>)}
    {err&&<p style={{fontSize:"11px",color:"var(--color-text-danger)",marginTop:"8px"}}>{err}</p>}
  </div>;
}

// ================================================================
// AI FINANCIAL ANALYST
// ================================================================
// --- SYSTEM PROMPT: CA Financial Analyst Persona -----------------------------

export { ValuationPlatform, SECTORS, initForm, UNIT_MULT };
