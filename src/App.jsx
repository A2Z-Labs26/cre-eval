import { useState, useMemo } from 'react';
import { Calculator, TrendingUp, DollarSign, Percent, FileText } from 'lucide-react';

const Card = ({ children, className = "" }) => (
  <div className={`bg-white rounded-lg border border-gray-200 shadow-sm ${className}`}>
    {children}
  </div>
);

const SectionHeader = ({ title, icon: Icon }) => (
  <div className="flex items-center gap-2 mb-4 pb-2 border-b border-gray-100">
    {Icon && <Icon className="w-5 h-5 text-blue-600" />}
    <h3 className="font-semibold text-gray-800">{title}</h3>
  </div>
);

const InputField = ({ label, value, onChange, type = "number", prefix = "", suffix = "", step = "0.01", tooltip }) => (
  <div className="mb-3">
    <label className="block text-xs font-medium text-gray-500 uppercase tracking-wide mb-1 flex justify-between">
      {label}
      {tooltip && <span title={tooltip} className="cursor-help text-gray-400">ⓘ</span>}
    </label>
    <div className="relative rounded-md shadow-sm">
      {prefix && (
        <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
          <span className="text-gray-500 sm:text-sm">{prefix}</span>
        </div>
      )}
      <input
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        step={step}
        className={`focus:ring-blue-500 focus:border-blue-500 block w-full sm:text-sm border-gray-300 rounded-md py-2 ${prefix ? 'pl-7' : 'pl-3'} ${suffix ? 'pr-8' : 'pr-3'} bg-gray-50 border`}
      />
      {suffix && (
        <div className="absolute inset-y-0 right-0 pr-3 flex items-center pointer-events-none">
          <span className="text-gray-500 sm:text-sm">{suffix}</span>
        </div>
      )}
    </div>
  </div>
);

const formatCurrency = (val) => new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(val);
const formatPercent = (val) => new Intl.NumberFormat('en-US', { style: 'percent', minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(val);

// --- Financial Helper Functions ---

// IRR Calculation (Newton-Raphson approximation)
const calculateIRR = (cashFlows, guess = 0.1) => {
  const maxIterations = 1000;
  const tolerance = 0.0000001;
  let rate = guess;

  for (let i = 0; i < maxIterations; i++) {
    let npv = 0;
    let derivative = 0;
    for (let t = 0; t < cashFlows.length; t++) {
      npv += cashFlows[t] / Math.pow(1 + rate, t);
      derivative -= (t * cashFlows[t]) / Math.pow(1 + rate, t + 1);
    }
    const newRate = rate - npv / derivative;
    if (Math.abs(newRate - rate) < tolerance) return newRate;
    rate = newRate;
  }
  return null;
};

export default function App() {
  // --- State: Inputs (Defaulted to CSV snippet roughly) ---
  const [inputs, setInputs] = useState({
    purchasePrice: 1725325,
    capRate: 8.97, // Going-in Cap
    closingCostsPct: 1.0,
    vacancyRate: 5.0,
    holdPeriod: 5,
    growthType: 'Annual', // 'Annual' or 'Step-Up'
    annualGrowthRate: 2.0,
    stepUpRate: 10.0,
    stepUpFreq: 5,
    ltv: 65.0,
    interestRate: 6.5,
    amortization: 30,
    loanTerm: 10,
    originationFee: 1.0,
    exitCap: 9.25, // Usually slightly higher than going-in
    saleCosts: 2.0,
    annualExpenses: 50000,
    expenseGrowthRate: 2.0,
  });

  const [activeTab, setActiveTab] = useState('model'); // 'model' or 'formulas'

  // --- Calculations ---

  const calculated = useMemo(() => {
    // 1. Derived Deal Metrics
    // Logic Change: We start with NOI from Cap Rate => derive EGI => derive GPI
    const year1NOI = inputs.purchasePrice * (inputs.capRate / 100);
    const year1Expenses = inputs.annualExpenses;
    const year1EGI = year1NOI + year1Expenses;
    const grossPotentialIncomeStart = year1EGI / (1 - inputs.vacancyRate / 100);

    const loanAmount = inputs.purchasePrice * (inputs.ltv / 100);
    const loanFee = loanAmount * (inputs.originationFee / 100);
    const closingCostsAmt = inputs.purchasePrice * (inputs.closingCostsPct / 100);
    const totalEquity = inputs.purchasePrice + closingCostsAmt + loanFee - loanAmount;

    // 2. Loan Constants (Monthly)
    const monthlyRate = (inputs.interestRate / 100) / 12;
    const totalMonths = inputs.amortization * 12;
    const monthlyPayment = (loanAmount * monthlyRate) / (1 - Math.pow(1 + monthlyRate, -totalMonths));

    // 3. Projection Loop
    const schedule = [];
    let currentLoanBalance = loanAmount;
    let currentGPI = grossPotentialIncomeStart;
    let currentExpenses = year1Expenses;

    // We project one year past hold to get forward NOI for sale
    const projectionYears = Math.max(inputs.holdPeriod + 1, 10);

    for (let year = 1; year <= projectionYears; year++) {
      // -- Operations --
      // Growth Logic
      if (year > 1) {
        if (inputs.growthType === 'Annual') {
          currentGPI *= (1 + inputs.annualGrowthRate / 100);
        } else {
          // Step Up Logic: Increases only if (Year-1) is divisible by Frequency
          if ((year - 1) % inputs.stepUpFreq === 0) {
            currentGPI *= (1 + inputs.stepUpRate / 100);
          }
        }
        // Grow Expenses
        currentExpenses *= (1 + inputs.expenseGrowthRate / 100);
      }

      const vacancyLoss = currentGPI * (inputs.vacancyRate / 100);
      const egi = currentGPI - vacancyLoss;
      const noi = egi - currentExpenses;

      // -- Debt Service (Aggregation of 12 months) --
      let interestPaymentYear = 0;
      let principalPaymentYear = 0;
      let startBalance = currentLoanBalance;

      for (let m = 0; m < 12; m++) {
        const interest = currentLoanBalance * monthlyRate;
        const principal = monthlyPayment - interest;
        interestPaymentYear += interest;
        principalPaymentYear += principal;
        currentLoanBalance -= principal;
      }

      const debtService = interestPaymentYear + principalPaymentYear;
      const cashFlowBeforeDebt = noi;
      const cashFlowAfterDebt = cashFlowBeforeDebt - debtService;

      // -- Credit Metrics --
      const dscr = debtService > 0 ? noi / debtService : 0;
      const debtYield = startBalance > 0 ? noi / startBalance : 0;

      schedule.push({
        year,
        gpi: currentGPI,
        vacancy: vacancyLoss,
        egi,
        expenses: currentExpenses,
        noi,
        startLoanBal: startBalance,
        debtService,
        interest: interestPaymentYear,
        principal: principalPaymentYear,
        endLoanBal: currentLoanBalance,
        cfUnlevered: cashFlowBeforeDebt,
        cfLevered: cashFlowAfterDebt,
        dscr,
        debtYield
      });
    }

    // 4. Exit & Returns (at Hold Period)
    const exitYearIdx = inputs.holdPeriod - 1;
    const forwardYearIdx = inputs.holdPeriod;
    const forwardNOI = schedule[forwardYearIdx]?.noi || 0;

    const salePrice = forwardNOI / (inputs.exitCap / 100);
    const saleCostsAmt = salePrice * (inputs.saleCosts / 100);
    const loanPayoff = schedule[exitYearIdx].endLoanBal;
    const netSaleProceeds = salePrice - saleCostsAmt - loanPayoff;

    // Cash Flow Stream for IRR
    const cfStream = [-totalEquity]; // Year 0
    for (let i = 0; i < inputs.holdPeriod; i++) {
      let cf = schedule[i].cfLevered;
      // Add sale proceeds to final year
      if (i === inputs.holdPeriod - 1) {
        cf += netSaleProceeds;
      }
      cfStream.push(cf);
    }

    const leveredIRR = calculateIRR(cfStream);
    const totalProfit = cfStream.reduce((a, b) => a + b, 0) + totalEquity; // Sum of positive flows
    const equityMultiple = (totalProfit + totalEquity) / totalEquity;

    // Average Cash on Cash
    const totalLeveredCF = schedule.slice(0, inputs.holdPeriod).reduce((sum, yr) => sum + yr.cfLevered, 0);
    const avgCoC = (totalLeveredCF / inputs.holdPeriod) / totalEquity;

    return {
      year1NOI,
      year1Expenses,
      loanAmount,
      totalEquity,
      schedule,
      salePrice,
      netSaleProceeds,
      leveredIRR,
      equityMultiple,
      avgCoC,
      cfStream
    };
  }, [inputs]);

  const updateInput = (key, val) => setInputs(prev => ({ ...prev, [key]: parseFloat(val) || 0 }));

  return (
    <div className="min-h-screen bg-gray-50 p-4 font-sans text-gray-800">
      <div className="max-w-[1920px] mx-auto">

        {/* Header */}
        <div className="flex flex-col md:flex-row justify-between items-start md:items-center mb-6 px-2">
          <div>
            <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
              <Calculator className="w-8 h-8 text-blue-700" />
              CRE Underwriting Model
            </h1>
            <p className="text-gray-500 text-sm mt-1">Single-Sheet Pro Forma Architecture</p>
          </div>
          <div className="mt-4 md:mt-0 bg-white p-1 rounded-lg border shadow-sm">
            <button
              onClick={() => setActiveTab('model')}
              className={`px-4 py-2 rounded-md text-sm font-medium transition-colors ${activeTab === 'model' ? 'bg-blue-100 text-blue-700' : 'text-gray-600 hover:bg-gray-50'}`}
            >
              Model View
            </button>
            <button
              onClick={() => setActiveTab('formulas')}
              className={`px-4 py-2 rounded-md text-sm font-medium transition-colors ${activeTab === 'formulas' ? 'bg-blue-100 text-blue-700' : 'text-gray-600 hover:bg-gray-50'}`}
            >
              Excel Formula Guide
            </button>
          </div>
        </div>

        {activeTab === 'model' ? (
          <div className="space-y-6">

            {/* Top Section: Inputs Grid (Responsive: 1 col mobile, 2 col tablet, 4 col desktop) */}
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">

              {/* 1. Acquisition */}
              <Card className="p-4 bg-blue-50/50 border-blue-100 h-full">
                <SectionHeader title="1. Acquisition" icon={DollarSign} />
                <div className="space-y-4">
                  <InputField label="Purchase Price ($)" value={inputs.purchasePrice} onChange={v => updateInput('purchasePrice', v)} step="1000" />
                  <InputField label="Going-In Cap Rate (%)" value={inputs.capRate} onChange={v => updateInput('capRate', v)} />
                  <InputField label="Closing Costs (%)" value={inputs.closingCostsPct} onChange={v => updateInput('closingCostsPct', v)} />
                </div>
              </Card>

              {/* 2. Operations & Growth */}
              <Card className="p-4 h-full">
                <SectionHeader title="2. Operations" icon={TrendingUp} />
                <div className="space-y-4">
                  <InputField label="Vacancy Rate (%)" value={inputs.vacancyRate} onChange={v => updateInput('vacancyRate', v)} />
                  <InputField label="Annual Expenses ($)" value={inputs.annualExpenses} onChange={v => updateInput('annualExpenses', v)} step="100" />
                  <InputField label="Expense Growth (%)" value={inputs.expenseGrowthRate} onChange={v => updateInput('expenseGrowthRate', v)} />
                </div>
              </Card>

              {/* 3. Revenue Growth */}
              <Card className="p-4 h-full">
                <SectionHeader title="3. Revenue Growth" icon={TrendingUp} />
                <div className="space-y-4">
                  <div className="mb-2">
                    <label className="block text-xs font-medium text-gray-500 uppercase mb-2">Growth Strategy</label>
                    <div className="flex rounded-md shadow-sm">
                      <button
                        onClick={() => setInputs(p => ({ ...p, growthType: 'Annual' }))}
                        className={`flex-1 py-1.5 text-xs font-medium border rounded-l-md ${inputs.growthType === 'Annual' ? 'bg-blue-600 text-white border-blue-600' : 'bg-white text-gray-700 border-gray-300'}`}
                      >
                        Annual
                      </button>
                      <button
                        onClick={() => setInputs(p => ({ ...p, growthType: 'Step-Up' }))}
                        className={`flex-1 py-1.5 text-xs font-medium border rounded-r-md ${inputs.growthType === 'Step-Up' ? 'bg-blue-600 text-white border-blue-600' : 'bg-white text-gray-700 border-gray-300'}`}
                      >
                        Step-Up
                      </button>
                    </div>
                  </div>

                  {inputs.growthType === 'Annual' ? (
                    <InputField label="Annual Growth (%)" value={inputs.annualGrowthRate} onChange={v => updateInput('annualGrowthRate', v)} />
                  ) : (
                    <div className="grid grid-cols-2 gap-2">
                      <InputField label="Step Increase (%)" value={inputs.stepUpRate} onChange={v => updateInput('stepUpRate', v)} />
                      <InputField label="Freq (Years)" value={inputs.stepUpFreq} onChange={v => updateInput('stepUpFreq', v)} step="1" />
                    </div>
                  )}
                  <InputField label="Hold Period (Years)" value={inputs.holdPeriod} onChange={v => updateInput('holdPeriod', v)} step="1" />
                </div>
              </Card>

              {/* 4. Debt & Exit */}
              <Card className="p-4 h-full">
                <SectionHeader title="4. Debt & Exit" icon={Percent} />
                <div className="space-y-4">
                  <div className="grid grid-cols-2 gap-2">
                    <InputField label="LTV (%)" value={inputs.ltv} onChange={v => updateInput('ltv', v)} />
                    <InputField label="Interest (%)" value={inputs.interestRate} onChange={v => updateInput('interestRate', v)} />
                  </div>
                  <InputField label="Amortization (Yrs)" value={inputs.amortization} onChange={v => updateInput('amortization', v)} step="1" />
                  <div className="pt-2 border-t border-gray-100">
                    <div className="grid grid-cols-2 gap-2">
                      <InputField label="Exit Cap (%)" value={inputs.exitCap} onChange={v => updateInput('exitCap', v)} />
                      <InputField label="Sale Costs (%)" value={inputs.saleCosts} onChange={v => updateInput('saleCosts', v)} />
                    </div>
                  </div>
                </div>
              </Card>

            </div>

            {/* Output Section */}
            <div className="space-y-6">

              {/* Summary Metrics Cards */}
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                <Card className="p-4 border-l-4 border-l-blue-500">
                  <div className="text-gray-500 text-xs uppercase font-bold">Total Equity</div>
                  <div className="text-xl font-bold text-gray-900 mt-1">{formatCurrency(calculated.totalEquity)}</div>
                </Card>
                <Card className="p-4 border-l-4 border-l-green-500">
                  <div className="text-gray-500 text-xs uppercase font-bold">Levered IRR</div>
                  <div className="text-xl font-bold text-green-700 mt-1">{formatPercent(calculated.leveredIRR)}</div>
                </Card>
                <Card className="p-4 border-l-4 border-l-purple-500">
                  <div className="text-gray-500 text-xs uppercase font-bold">Equity Multiple</div>
                  <div className="text-xl font-bold text-purple-700 mt-1">{calculated.equityMultiple.toFixed(2)}x</div>
                </Card>
                <Card className="p-4 border-l-4 border-l-orange-500">
                  <div className="text-gray-500 text-xs uppercase font-bold">Avg Cash-on-Cash</div>
                  <div className="text-xl font-bold text-orange-700 mt-1">{formatPercent(calculated.avgCoC)}</div>
                </Card>
              </div>

              {/* Deal Summary */}
              <Card className="p-6">
                <div className="flex justify-between items-center mb-4 border-b pb-2">
                  <h3 className="text-sm font-bold text-gray-900 uppercase">Deal Summary (Year 1)</h3>
                  <span className="text-xs text-gray-400">Values calculated based on inputs</span>
                </div>
                <div className="grid grid-cols-2 md:grid-cols-5 gap-8 text-sm">
                  <div>
                    <span className="block text-gray-500 text-xs uppercase">Purchase Price</span>
                    <span className="font-semibold text-base">{formatCurrency(inputs.purchasePrice)}</span>
                  </div>
                  <div>
                    <span className="block text-gray-500 text-xs uppercase">Initial Expenses</span>
                    <span className="font-semibold text-base">{formatCurrency(calculated.year1Expenses)}</span>
                  </div>
                  <div>
                    <span className="block text-gray-500 text-xs uppercase">Initial NOI</span>
                    <span className="font-semibold text-base text-blue-700">{formatCurrency(calculated.year1NOI)}</span>
                  </div>
                  <div>
                    <span className="block text-gray-500 text-xs uppercase">Debt Service</span>
                    <span className="font-semibold text-base text-red-600">({formatCurrency(calculated.schedule[0].debtService)})</span>
                  </div>
                  <div>
                    <span className="block text-gray-500 text-xs uppercase">Est. Exit Price</span>
                    <span className="font-semibold text-base">{formatCurrency(calculated.salePrice)}</span>
                  </div>
                </div>
              </Card>

              {/* Pro Forma Table - Optimized for High Res */}
              <Card className="overflow-hidden">
                <div className="p-4 border-b bg-gray-50 flex justify-between items-center">
                  <h3 className="font-bold text-gray-800">Pro Forma Cash Flow</h3>
                  <span className="text-xs text-gray-500">Values in USD</span>
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm text-right">
                    <thead>
                      <tr className="bg-gray-100 text-gray-600 text-xs uppercase">
                        <th className="px-4 py-3 text-left sticky left-0 bg-gray-100 z-10 w-48">Line Item</th>
                        {calculated.schedule.slice(0, inputs.holdPeriod).map(row => (
                          <th key={row.year} className="px-2 py-3 min-w-[90px] 2xl:min-w-[auto]">Year {row.year}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100">
                      {/* Operations */}
                      <tr>
                        <td className="px-4 py-2 font-medium text-left text-gray-700 sticky left-0 bg-white z-10">Gross Potential Income</td>
                        {calculated.schedule.slice(0, inputs.holdPeriod).map(row => (
                          <td key={row.year} className="px-2 py-2">{formatCurrency(row.gpi)}</td>
                        ))}
                      </tr>
                      <tr className="text-red-500">
                        <td className="px-4 py-2 font-medium text-left sticky left-0 bg-white z-10">Vacancy Loss</td>
                        {calculated.schedule.slice(0, inputs.holdPeriod).map(row => (
                          <td key={row.year} className="px-2 py-2">({formatCurrency(row.vacancy)})</td>
                        ))}
                      </tr>
                      <tr className="bg-gray-50 font-semibold">
                        <td className="px-4 py-2 text-left sticky left-0 bg-gray-50 z-10">Effective Gross Income</td>
                        {calculated.schedule.slice(0, inputs.holdPeriod).map(row => (
                          <td key={row.year} className="px-2 py-2">{formatCurrency(row.egi)}</td>
                        ))}
                      </tr>
                      <tr className="text-red-500">
                        <td className="px-4 py-2 font-medium text-left sticky left-0 bg-white z-10">Operating Expenses</td>
                        {calculated.schedule.slice(0, inputs.holdPeriod).map(row => (
                          <td key={row.year} className="px-2 py-2">({formatCurrency(row.expenses)})</td>
                        ))}
                      </tr>
                      <tr className="bg-blue-50 font-bold border-t border-blue-100 text-blue-900">
                        <td className="px-4 py-3 text-left sticky left-0 bg-blue-50 z-10">Net Operating Income</td>
                        {calculated.schedule.slice(0, inputs.holdPeriod).map(row => (
                          <td key={row.year} className="px-2 py-3">{formatCurrency(row.noi)}</td>
                        ))}
                      </tr>

                      {/* Debt */}
                      <tr className="text-gray-400 italic text-[10px] uppercase tracking-wider">
                        <td className="px-4 py-2 text-left sticky left-0 bg-white z-10 pt-4">Debt Service</td>
                        <td colSpan={inputs.holdPeriod} className="pt-4"></td>
                      </tr>
                      <tr className="text-red-500">
                        <td className="px-4 py-2 font-medium text-left sticky left-0 bg-white z-10">Annual Debt Service</td>
                        {calculated.schedule.slice(0, inputs.holdPeriod).map(row => (
                          <td key={row.year} className="px-2 py-2">({formatCurrency(row.debtService)})</td>
                        ))}
                      </tr>
                      <tr>
                        <td className="px-4 py-2 font-medium text-left sticky left-0 bg-white z-10 text-gray-500">Ending Loan Balance</td>
                        {calculated.schedule.slice(0, inputs.holdPeriod).map(row => (
                          <td key={row.year} className="px-2 py-2 text-gray-500">{formatCurrency(row.endLoanBal)}</td>
                        ))}
                      </tr>

                      {/* Cash Flow */}
                      <tr className="bg-green-50 font-bold border-t border-green-100 text-green-900">
                        <td className="px-4 py-3 text-left sticky left-0 bg-green-50 z-10">Cash Flow After Debt</td>
                        {calculated.schedule.slice(0, inputs.holdPeriod).map(row => (
                          <td key={row.year} className="px-2 py-3">{formatCurrency(row.cfLevered)}</td>
                        ))}
                      </tr>

                      {/* Metrics */}
                      <tr className="text-xs text-gray-500">
                        <td className="px-4 py-2 text-left sticky left-0 bg-white z-10">DSCR</td>
                        {calculated.schedule.slice(0, inputs.holdPeriod).map(row => (
                          <td key={row.year} className={`px-2 py-2 ${row.dscr < 1.2 ? 'text-red-500 font-bold' : ''}`}>{row.dscr.toFixed(2)}x</td>
                        ))}
                      </tr>
                      <tr className="text-xs text-gray-500">
                        <td className="px-4 py-2 text-left sticky left-0 bg-white z-10">Debt Yield</td>
                        {calculated.schedule.slice(0, inputs.holdPeriod).map(row => (
                          <td key={row.year} className="px-2 py-2">{formatPercent(row.debtYield)}</td>
                        ))}
                      </tr>

                    </tbody>
                  </table>
                </div>
              </Card>

            </div>
          </div>
        ) : (
          /* --- Formula Guide Tab --- */
          <div className="max-w-4xl mx-auto space-y-8 animate-in fade-in">
            <Card className="p-8 border-l-4 border-l-blue-600">
              <div className="flex items-start gap-4">
                <FileText className="w-8 h-8 text-blue-600 mt-1" />
                <div>
                  <h2 className="text-xl font-bold text-gray-900">Excel Implementation Guide</h2>
                  <p className="text-gray-600 mt-2">
                    To build this exact model in Excel, copy the formulas below into the corresponding cells.
                    Assume <span className="font-mono bg-gray-100 px-1 rounded">Year 1</span> starts in Column
                    <span className="font-mono bg-gray-100 px-1 rounded">G</span>.
                  </p>
                </div>
              </div>
            </Card>

            <div className="space-y-6">
              <section>
                <h3 className="font-bold text-gray-800 border-b pb-2 mb-3">1. Operating Expenses & NOI Build-Up</h3>
                <p className="text-sm text-gray-600 mb-2">We now derive Top Line Income from your Target NOI (Based on Cap Rate) + Expenses.</p>
                <div className="bg-gray-900 text-gray-100 p-4 rounded-md font-mono text-sm overflow-x-auto">
                  = (Price * CapRate) + AnnualExpenses
                </div>
                <div className="mt-2 text-xs text-gray-500">
                  This gives us the required Effective Gross Income (EGI). We then divide by (1 - Vacancy) to find the Gross Potential Income (GPI).
                </div>
              </section>

              <section>
                <h3 className="font-bold text-gray-800 border-b pb-2 mb-3">2. The &quot;Step-Up&quot; Growth Formula</h3>
                <p className="text-sm text-gray-600 mb-2">This formula handles the toggle between annual growth and 5-year step-ups.</p>
                <div className="bg-gray-900 text-gray-100 p-4 rounded-md font-mono text-sm overflow-x-auto">
                  =IF($D$10=&quot;Annual&quot;, G20*(1+$D$AnnualPct), IF(MOD(H$5-1, $D$StepFreq)=0, G20*(1+$D$StepPct), G20))
                </div>
                <div className="mt-2 text-xs text-gray-500">
                  <strong>Logic:</strong> <code>MOD(H$5-1, 5)</code> checks if the current year (minus 1) is divisible by 5. If 0, it triggers the step-up.
                </div>
              </section>

              <section>
                <h3 className="font-bold text-gray-800 border-b pb-2 mb-3">3. Debt Service (Annual Aggregation)</h3>
                <p className="text-sm text-gray-600 mb-2">Use these cumulative functions to sum up monthly payments for the year.</p>

                <div className="grid gap-4">
                  <div>
                    <span className="text-xs font-bold uppercase text-gray-500">Interest Payment (IPMT)</span>
                    <div className="bg-gray-900 text-gray-100 p-3 rounded-md font-mono text-sm mt-1">
                      =-CUMIPMT(Rate/12, Amort*12, LoanAmt, (Year-1)*12+1, Year*12, 0)
                    </div>
                  </div>
                  <div>
                    <span className="text-xs font-bold uppercase text-gray-500">Principal Payment (PPMT)</span>
                    <div className="bg-gray-900 text-gray-100 p-3 rounded-md font-mono text-sm mt-1">
                      =-CUMPRINC(Rate/12, Amort*12, LoanAmt, (Year-1)*12+1, Year*12, 0)
                    </div>
                  </div>
                </div>
              </section>

              <section>
                <h3 className="font-bold text-gray-800 border-b pb-2 mb-3">4. Exit Sale Price (Forward NOI)</h3>
                <p className="text-sm text-gray-600 mb-2">Standard logic is to cap the <i>next</i> year&apos;s income.</p>
                <div className="bg-gray-900 text-gray-100 p-4 rounded-md font-mono text-sm">
                  = (NOI_Year_N_Plus_1) / Exit_Cap_Rate
                </div>
              </section>

              <section>
                <h3 className="font-bold text-gray-800 border-b pb-2 mb-3">5. Levered IRR</h3>
                <p className="text-sm text-gray-600 mb-2">Your range must include the negative equity outflow in Year 0.</p>
                <div className="bg-gray-900 text-gray-100 p-4 rounded-md font-mono text-sm">
                  = IRR( F40:P40 )
                </div>
                <div className="mt-2 text-xs text-gray-500">
                  Where F40 is Year 0 (Total Equity as negative) and P40 is Year 10 (Cash Flow + Sale Proceeds).
                </div>
              </section>
            </div>
          </div>
        )}

      </div>
    </div>
  );
}