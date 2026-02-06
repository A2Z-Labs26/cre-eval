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
  });

  const [activeTab, setActiveTab] = useState('model'); // 'model' or 'formulas'

  // --- Calculations ---

  const calculated = useMemo(() => {
    // 1. Derived Deal Metrics
    const year1NOI = inputs.purchasePrice * (inputs.capRate / 100);
    const grossPotentialIncomeStart = year1NOI / (1 - inputs.vacancyRate / 100);
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
      }

      const vacancyLoss = currentGPI * (inputs.vacancyRate / 100);
      const egi = currentGPI - vacancyLoss;
      // Simplified Expense assumption: We derived Year1 NOI, so we assume a constant NOI margin or just grow NOI. 
      // For this model, we'll keep it clean: We derived GPI from NOI, so expenses are implied.
      // We will calc NOI as EGI - (Implied Expenses).
      // Implied Expenses Year 1 = GPI_1 - NOI_1 - Vacancy_1.
      // Let's assume Expenses grow at 2% inflation regardless of revenue toggle to be realistic.
      // Implied Expenses Base:
      const impliedExpensesBase = grossPotentialIncomeStart - (grossPotentialIncomeStart * (inputs.vacancyRate / 100)) - year1NOI;
      const currentExpenses = impliedExpensesBase * Math.pow(1.02, year - 1);

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
    <div className="min-h-screen bg-gray-50 p-4 md:p-8 font-sans text-gray-800">
      <div className="max-w-7xl mx-auto">

        {/* Header */}
        <div className="flex flex-col md:flex-row justify-between items-start md:items-center mb-6">
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
          <div className="grid grid-cols-1 lg:grid-cols-4 gap-6">

            {/* Left Sidebar: Inputs */}
            <div className="lg:col-span-1 space-y-6">

              <Card className="p-4 bg-blue-50/50 border-blue-100">
                <SectionHeader title="1. Acquisition" icon={DollarSign} />
                <InputField label="Purchase Price ($)" value={inputs.purchasePrice} onChange={v => updateInput('purchasePrice', v)} step="1000" />
                <InputField label="Going-In Cap Rate (%)" value={inputs.capRate} onChange={v => updateInput('capRate', v)} />
                <InputField label="Closing Costs (%)" value={inputs.closingCostsPct} onChange={v => updateInput('closingCostsPct', v)} />
                <InputField label="Vacancy Rate (%)" value={inputs.vacancyRate} onChange={v => updateInput('vacancyRate', v)} />
              </Card>

              <Card className="p-4">
                <SectionHeader title="2. Growth Strategy" icon={TrendingUp} />
                <div className="mb-4">
                  <label className="block text-xs font-medium text-gray-500 uppercase mb-2">Revenue Growth Type</label>
                  <div className="flex rounded-md shadow-sm">
                    <button
                      onClick={() => setInputs(p => ({ ...p, growthType: 'Annual' }))}
                      className={`flex-1 py-2 text-xs font-medium border rounded-l-md ${inputs.growthType === 'Annual' ? 'bg-blue-600 text-white border-blue-600' : 'bg-white text-gray-700 border-gray-300'}`}
                    >
                      Annual %
                    </button>
                    <button
                      onClick={() => setInputs(p => ({ ...p, growthType: 'Step-Up' }))}
                      className={`flex-1 py-2 text-xs font-medium border rounded-r-md ${inputs.growthType === 'Step-Up' ? 'bg-blue-600 text-white border-blue-600' : 'bg-white text-gray-700 border-gray-300'}`}
                    >
                      Step-Up
                    </button>
                  </div>
                </div>

                {inputs.growthType === 'Annual' ? (
                  <InputField label="Annual Growth (%)" value={inputs.annualGrowthRate} onChange={v => updateInput('annualGrowthRate', v)} />
                ) : (
                  <>
                    <InputField label="Step Increase (%)" value={inputs.stepUpRate} onChange={v => updateInput('stepUpRate', v)} />
                    <InputField label="Frequency (Years)" value={inputs.stepUpFreq} onChange={v => updateInput('stepUpFreq', v)} step="1" />
                  </>
                )}
                <InputField label="Hold Period (Years)" value={inputs.holdPeriod} onChange={v => updateInput('holdPeriod', v)} step="1" />
              </Card>

              <Card className="p-4">
                <SectionHeader title="3. Debt & Exit" icon={Percent} />
                <InputField label="LTV (%)" value={inputs.ltv} onChange={v => updateInput('ltv', v)} />
                <InputField label="Interest Rate (%)" value={inputs.interestRate} onChange={v => updateInput('interestRate', v)} />
                <InputField label="Amortization (Yrs)" value={inputs.amortization} onChange={v => updateInput('amortization', v)} step="1" />
                <div className="my-4 border-t pt-4">
                  <InputField label="Exit Cap Rate (%)" value={inputs.exitCap} onChange={v => updateInput('exitCap', v)} />
                  <InputField label="Sale Costs (%)" value={inputs.saleCosts} onChange={v => updateInput('saleCosts', v)} />
                </div>
              </Card>

            </div>

            {/* Main Content: Output */}
            <div className="lg:col-span-3 space-y-6">

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

              {/* Sources & Uses Summary */}
              <Card className="p-6">
                <h3 className="text-sm font-bold text-gray-900 uppercase mb-4 border-b pb-2">Deal Summary (Year 0)</h3>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-8 text-sm">
                  <div>
                    <span className="block text-gray-500">Purchase Price</span>
                    <span className="font-semibold">{formatCurrency(inputs.purchasePrice)}</span>
                  </div>
                  <div>
                    <span className="block text-gray-500">Loan Amount</span>
                    <span className="font-semibold">{formatCurrency(calculated.loanAmount)}</span>
                  </div>
                  <div>
                    <span className="block text-gray-500">Initial NOI</span>
                    <span className="font-semibold">{formatCurrency(calculated.year1NOI)}</span>
                  </div>
                  <div>
                    <span className="block text-gray-500">Est. Sale Price</span>
                    <span className="font-semibold">{formatCurrency(calculated.salePrice)}</span>
                  </div>
                </div>
              </Card>

              {/* Pro Forma Table */}
              <Card className="overflow-hidden">
                <div className="p-4 border-b bg-gray-50 flex justify-between items-center">
                  <h3 className="font-bold text-gray-800">Pro Forma Cash Flow</h3>
                  <span className="text-xs text-gray-500">Values in USD</span>
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm text-right">
                    <thead>
                      <tr className="bg-gray-100 text-gray-600 text-xs uppercase">
                        <th className="px-4 py-3 text-left sticky left-0 bg-gray-100">Line Item</th>
                        {calculated.schedule.slice(0, inputs.holdPeriod).map(row => (
                          <th key={row.year} className="px-4 py-3 min-w-[100px]">Year {row.year}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100">
                      {/* Operations */}
                      <tr>
                        <td className="px-4 py-2 font-medium text-left text-gray-700 sticky left-0 bg-white">Gross Potential Income</td>
                        {calculated.schedule.slice(0, inputs.holdPeriod).map(row => (
                          <td key={row.year} className="px-4 py-2">{formatCurrency(row.gpi)}</td>
                        ))}
                      </tr>
                      <tr className="text-red-600">
                        <td className="px-4 py-2 font-medium text-left sticky left-0 bg-white">Vacancy Loss</td>
                        {calculated.schedule.slice(0, inputs.holdPeriod).map(row => (
                          <td key={row.year} className="px-4 py-2">({formatCurrency(row.vacancy)})</td>
                        ))}
                      </tr>
                      <tr className="bg-gray-50 font-semibold">
                        <td className="px-4 py-2 text-left sticky left-0 bg-gray-50">Effective Gross Income</td>
                        {calculated.schedule.slice(0, inputs.holdPeriod).map(row => (
                          <td key={row.year} className="px-4 py-2">{formatCurrency(row.egi)}</td>
                        ))}
                      </tr>
                      <tr className="text-red-600">
                        <td className="px-4 py-2 font-medium text-left sticky left-0 bg-white">Operating Expenses</td>
                        {calculated.schedule.slice(0, inputs.holdPeriod).map(row => (
                          <td key={row.year} className="px-4 py-2">({formatCurrency(row.expenses)})</td>
                        ))}
                      </tr>
                      <tr className="bg-blue-50 font-bold border-t border-blue-100">
                        <td className="px-4 py-3 text-left sticky left-0 bg-blue-50 text-blue-900">Net Operating Income</td>
                        {calculated.schedule.slice(0, inputs.holdPeriod).map(row => (
                          <td key={row.year} className="px-4 py-3 text-blue-900">{formatCurrency(row.noi)}</td>
                        ))}
                      </tr>

                      {/* Debt */}
                      <tr className="text-gray-500 italic text-xs">
                        <td className="px-4 py-2 text-left sticky left-0 bg-white pt-4">Debt Schedule</td>
                        <td colSpan={inputs.holdPeriod} className="pt-4"></td>
                      </tr>
                      <tr className="text-red-600">
                        <td className="px-4 py-2 font-medium text-left sticky left-0 bg-white">Annual Debt Service</td>
                        {calculated.schedule.slice(0, inputs.holdPeriod).map(row => (
                          <td key={row.year} className="px-4 py-2">({formatCurrency(row.debtService)})</td>
                        ))}
                      </tr>
                      <tr>
                        <td className="px-4 py-2 font-medium text-left sticky left-0 bg-white text-gray-500">Ending Loan Balance</td>
                        {calculated.schedule.slice(0, inputs.holdPeriod).map(row => (
                          <td key={row.year} className="px-4 py-2 text-gray-500">{formatCurrency(row.endLoanBal)}</td>
                        ))}
                      </tr>

                      {/* Cash Flow */}
                      <tr className="bg-green-50 font-bold border-t border-green-100 text-green-900">
                        <td className="px-4 py-3 text-left sticky left-0 bg-green-50">Cash Flow After Debt</td>
                        {calculated.schedule.slice(0, inputs.holdPeriod).map(row => (
                          <td key={row.year} className="px-4 py-3">{formatCurrency(row.cfLevered)}</td>
                        ))}
                      </tr>

                      {/* Metrics */}
                      <tr className="text-xs text-gray-500">
                        <td className="px-4 py-2 text-left sticky left-0 bg-white">DSCR</td>
                        {calculated.schedule.slice(0, inputs.holdPeriod).map(row => (
                          <td key={row.year} className={`px-4 py-2 ${row.dscr < 1.2 ? 'text-red-500 font-bold' : ''}`}>{row.dscr.toFixed(2)}x</td>
                        ))}
                      </tr>
                      <tr className="text-xs text-gray-500">
                        <td className="px-4 py-2 text-left sticky left-0 bg-white">Debt Yield</td>
                        {calculated.schedule.slice(0, inputs.holdPeriod).map(row => (
                          <td key={row.year} className="px-4 py-2">{formatPercent(row.debtYield)}</td>
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
                <h3 className="font-bold text-gray-800 border-b pb-2 mb-3">1. The &quot;Step-Up&quot; Growth Formula</h3>
                <p className="text-sm text-gray-600 mb-2">This formula handles the toggle between annual growth and 5-year step-ups.</p>
                <div className="bg-gray-900 text-gray-100 p-4 rounded-md font-mono text-sm overflow-x-auto">
                  =IF($D$10=&quot;Annual&quot;, G20*(1+$D$AnnualPct), IF(MOD(H$5-1, $D$StepFreq)=0, G20*(1+$D$StepPct), G20))
                </div>
                <div className="mt-2 text-xs text-gray-500">
                  <strong>Logic:</strong> <code>MOD(H$5-1, 5)</code> checks if the current year (minus 1) is divisible by 5. If 0, it triggers the step-up.
                </div>
              </section>

              <section>
                <h3 className="font-bold text-gray-800 border-b pb-2 mb-3">2. Debt Service (Annual Aggregation)</h3>
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
                <h3 className="font-bold text-gray-800 border-b pb-2 mb-3">3. Exit Sale Price (Forward NOI)</h3>
                <p className="text-sm text-gray-600 mb-2">Standard logic is to cap the <i>next</i> year&apos;s income.</p>
                <div className="bg-gray-900 text-gray-100 p-4 rounded-md font-mono text-sm">
                  = (NOI_Year_N_Plus_1) / Exit_Cap_Rate
                </div>
              </section>

              <section>
                <h3 className="font-bold text-gray-800 border-b pb-2 mb-3">4. Levered IRR</h3>
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