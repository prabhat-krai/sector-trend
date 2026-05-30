import React, { useState, useEffect, useRef } from 'react';
import axios from 'axios';

// Utility to format large market cap numbers (e.g. 115000000000 -> $115.0B or 15000000000 -> ₹1.5T depending on currency)
const formatMarketCap = (value, currency) => {
  if (!value) return 'N/A';
  const symbol = currency === 'INR' ? '₹' : '$';
  const suffix = currency === 'INR' ? 'T' : 'B';
  const divider = currency === 'INR' ? 1e12 : 1e9; // 1 Trillion INR or 1 Billion USD
  
  // For smaller Indian companies, show in Crore (Cr) or Arab (100 Cr = 1 Arab = 10 Billion INR)
  // Let's use B (Billion) or T (Trillion) / M (Million) for USD, and T (Trillion) or B (Billion) for INR.
  if (value >= 1e12) {
    return `${symbol}${(value / 1e12).toFixed(2)}T`;
  }
  if (value >= 1e9) {
    return `${symbol}${(value / 1e9).toFixed(2)}${suffix}`;
  }
  if (value >= 1e6) {
    return `${symbol}${(value / 1e6).toFixed(2)}M`;
  }
  return `${symbol}${value.toLocaleString()}`;
};

// SVG Sparkline Component for Stock Grid Cards
const Sparkline = ({ chartData, isPositive }) => {
  if (!chartData || chartData.length === 0) {
    return <div style={{ color: 'var(--text-muted)', fontSize: '0.8rem', textAlign: 'center', paddingTop: '1.5rem' }}>No trend data</div>;
  }

  const prices = chartData.map(d => d.close);
  const min = Math.min(...prices);
  const max = Math.max(...prices);
  const range = max - min;
  const padding = 4;
  const width = 300;
  const height = 60;

  // Map index & price to coordinates
  const points = chartData.map((d, i) => {
    const x = (i / (chartData.length - 1)) * width;
    const y = range === 0 
      ? height / 2 
      : padding + (height - 2 * padding) * (1 - (d.close - min) / range);
    return { x, y };
  });

  const pathD = `M ${points.map(p => `${p.x.toFixed(1)} ${p.y.toFixed(1)}`).join(' L ')}`;
  const fillD = `${pathD} L ${width} ${height} L 0 ${height} Z`;
  const color = isPositive ? 'var(--trend-up)' : 'var(--trend-down)';
  const gradId = `grad-${Math.random().toString(36).substr(2, 9)}`;

  return (
    <div className="sparkline-container">
      <svg viewBox={`0 0 ${width} ${height}`} className="sparkline-svg">
        <defs>
          <linearGradient id={gradId} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={color} stopOpacity="0.2" />
            <stop offset="100%" stopColor={color} stopOpacity="0" />
          </linearGradient>
        </defs>
        <path d={fillD} fill={`url(#${gradId})`} className="sparkline-gradient" />
        <path d={pathD} stroke={color} className="sparkline-path" />
      </svg>
    </div>
  );
};

// Large Interactive Detailed Chart Component for Modal
const InteractiveChart = ({ chartData, isPositive }) => {
  const [hoveredPoint, setHoveredPoint] = useState(null);
  const svgRef = useRef(null);

  if (!chartData || chartData.length === 0) {
    return <div style={{ textAlign: 'center', padding: '4rem 0', color: 'var(--text-muted)' }}>No chart data available</div>;
  }

  const width = 720;
  const height = 280;
  const paddingX = 50;
  const paddingY = 30;

  const prices = chartData.map(d => d.close);
  const minPrice = Math.min(...prices);
  const maxPrice = Math.max(...prices);
  const priceRange = maxPrice - minPrice;

  // Map to SVG coordinate space
  const points = chartData.map((d, i) => {
    const x = paddingX + (i / (chartData.length - 1)) * (width - 2 * paddingX);
    const y = priceRange === 0
      ? height / 2
      : paddingY + (height - 2 * paddingY) * (1 - (d.close - minPrice) / priceRange);
    return { x, y, date: d.date, close: d.close };
  });

  const pathD = `M ${points.map(p => `${p.x.toFixed(1)} ${p.y.toFixed(1)}`).join(' L ')}`;
  const fillD = `${pathD} L ${width - paddingX} ${height - paddingY} L ${paddingX} ${height - paddingY} Z`;
  const color = isPositive ? 'var(--trend-up)' : 'var(--trend-down)';
  const gradId = `main-grad-${isPositive ? 'up' : 'down'}`;

  // Handle Mouse Hover Interactions
  const handleMouseMove = (e) => {
    if (!svgRef.current || points.length === 0) return;
    const rect = svgRef.current.getBoundingClientRect();
    const mouseX = e.clientX - rect.left;
    
    // Find points in SVG scaled X coordinate
    const scaleX = width / rect.width;
    const svgMouseX = mouseX * scaleX;

    // Binary search/find the closest point
    let closest = points[0];
    let minDiff = Math.abs(points[0].x - svgMouseX);

    for (let i = 1; i < points.length; i++) {
      const diff = Math.abs(points[i].x - svgMouseX);
      if (diff < minDiff) {
        minDiff = diff;
        closest = points[i];
      }
    }

    // Set hover coordinate in client coordinates for tooltip placement
    const svgXPercent = (closest.x / width) * 100;
    const svgYPercent = (closest.y / height) * 100;

    setHoveredPoint({
      ...closest,
      left: `${(closest.x / width) * 100}%`,
      top: `${(closest.y / height) * 100}%`,
      clientX: mouseX,
      clientY: (closest.y / width) * rect.width
    });
  };

  const handleMouseLeave = () => {
    setHoveredPoint(null);
  };

  // Generate grid values
  const gridLines = [0, 0.25, 0.5, 0.75, 1];
  const gridPriceLabel = (val) => {
    const p = maxPrice - val * priceRange;
    return p.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  };

  return (
    <div className="main-chart-container" ref={svgRef} onMouseMove={handleMouseMove} onMouseLeave={handleMouseLeave}>
      {/* Tooltip Overlay */}
      {hoveredPoint && (
        <div 
          className="chart-tooltip" 
          style={{ 
            left: `calc(${hoveredPoint.left} - 60px)`, 
            top: `calc(${hoveredPoint.top} - 65px)` 
          }}
        >
          <div className="tooltip-date">{hoveredPoint.date}</div>
          <div className="tooltip-price" style={{ color }}>
            {hoveredPoint.close.toLocaleString(undefined, { minimumFractionDigits: 2 })}
          </div>
        </div>
      )}

      <svg viewBox={`0 0 ${width} ${height}`} className="chart-svg">
        <defs>
          <linearGradient id={gradId} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={color} className="chart-gradient-stop-0" />
            <stop offset="100%" stopColor={color} className="chart-gradient-stop-1" />
          </linearGradient>
        </defs>

        {/* Y Gridlines and Labels */}
        {gridLines.map((gl, i) => {
          const y = paddingY + gl * (height - 2 * paddingY);
          return (
            <g key={i}>
              <line x1={paddingX} y1={y} x2={width - paddingX} y2={y} className="chart-grid-line" />
              <text x={paddingX - 10} y={y + 4} textAnchor="end" className="chart-axis-text">
                {gridPriceLabel(gl)}
              </text>
            </g>
          );
        })}

        {/* X Axis Labels */}
        {points.length > 1 && (
          <>
            <text x={paddingX} y={height - 10} textAnchor="start" className="chart-axis-text">
              {points[0].date}
            </text>
            <text x={width / 2} y={height - 10} textAnchor="middle" className="chart-axis-text">
              {points[Math.floor(points.length / 2)].date}
            </text>
            <text x={width - paddingX} y={height - 10} textAnchor="end" className="chart-axis-text">
              {points[points.length - 1].date}
            </text>
          </>
        )}

        {/* Gradient fill */}
        <path d={fillD} fill={`url(#${gradId})`} />

        {/* Chart Line */}
        <path d={pathD} stroke={color} className="chart-trendline" />

        {/* Crosshair & Interactive Dots */}
        {hoveredPoint && (
          <>
            {/* Vertical crosshair line */}
            <line 
              x1={hoveredPoint.x} 
              y1={paddingY} 
              x2={hoveredPoint.x} 
              y2={height - paddingY} 
              stroke="rgba(255, 255, 255, 0.2)" 
              strokeWidth="1.5" 
              strokeDasharray="3 3"
            />
            {/* Glowing outer circle */}
            <circle 
              cx={hoveredPoint.x} 
              cy={hoveredPoint.y} 
              r="6" 
              fill={color} 
              opacity="0.4"
            />
            {/* Solid inner circle */}
            <circle 
              cx={hoveredPoint.x} 
              cy={hoveredPoint.y} 
              r="3.5" 
              fill="#ffffff" 
              stroke={color}
              strokeWidth="2"
            />
          </>
        )}
      </svg>
    </div>
  );
};

export default function App() {
  const [query, setQuery] = useState('');
  const [timeframe, setTimeframe] = useState('3mo');
  const [loading, setLoading] = useState(false);
  const [results, setResults] = useState(null);
  const [error, setError] = useState(null);
  
  // Settings Drawer and API Key
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [apiKeyInput, setApiKeyInput] = useState('');
  const [hasApiKey, setHasApiKey] = useState(false);

  // Active step loading messages
  const [steps, setSteps] = useState([]);
  const [activeStep, setActiveStep] = useState('');

  // Selected Detail Modals
  const [selectedCompany, setSelectedCompany] = useState(null);
  
  // Screenshot Modals
  const [screenshotCompany, setScreenshotCompany] = useState(null);
  const [screenshotImage, setScreenshotImage] = useState(null);
  const [screenshotLoading, setScreenshotLoading] = useState(false);
  const [screenshotError, setScreenshotError] = useState(null);

  // Load API key from local storage on load
  useEffect(() => {
    const key = localStorage.getItem('OPENROUTER_API_KEY');
    if (key) {
      setApiKeyInput(key);
      setHasApiKey(true);
    }
  }, []);

  const saveApiKey = (e) => {
    e.preventDefault();
    if (apiKeyInput.trim()) {
      localStorage.setItem('OPENROUTER_API_KEY', apiKeyInput.trim());
      setHasApiKey(true);
      setDrawerOpen(false);
    } else {
      localStorage.removeItem('OPENROUTER_API_KEY');
      setHasApiKey(false);
    }
  };

  // Poll progress steps when backend handles analyze request
  const fetchAnalysis = async (searchQuery, selectedTimeframe) => {
    setLoading(true);
    setError(null);
    setResults(null);
    setSteps([]);
    setActiveStep('Scraping web indexes...');

    const interval = setInterval(() => {
      // Mock progress visual updates while waiting for server steps response
      setSteps(prev => {
        if (prev.length === 0) return ['Connecting to analyzer backend...'];
        if (prev.length === 1 && !prev.includes('Scraping search engine index results...')) return [...prev, 'Scraping search engine index results...'];
        if (prev.length === 2 && !prev.includes('Analyzing search snippets using Gemini 3.5 Flash...')) return [...prev, 'Analyzing search snippets using Gemini 3.5 Flash...'];
        if (prev.length === 3 && !prev.includes('Extracting ticker symbols and global exchanges...')) return [...prev, 'Extracting ticker symbols and global exchanges...'];
        if (prev.length === 4 && !prev.includes('Querying financial metrics from Yahoo Finance...')) return [...prev, 'Querying financial metrics from Yahoo Finance...'];
        if (prev.length === 5 && !prev.includes('Parsing historical daily closing price chart feeds...')) return [...prev, 'Parsing historical daily closing price chart feeds...'];
        return prev;
      });
    }, 2000);

    try {
      const openRouterKey = localStorage.getItem('OPENROUTER_API_KEY') || '';
      const response = await axios.post('/api/analyze', {
        query: searchQuery,
        range: selectedTimeframe,
        openRouterKey
      });

      clearInterval(interval);
      if (response.data.success) {
        setResults(response.data);
        if (response.data.steps) {
          setSteps(response.data.steps);
        }
      } else {
        setError(response.data.error || 'Failed to complete sector analysis.');
      }
    } catch (err) {
      clearInterval(interval);
      console.error(err);
      const serverError = err.response?.data?.error;
      const needsKey = err.response?.data?.needsKey;
      
      if (needsKey) {
        setError('OpenRouter API key is missing. Please click Settings to configure a key to search new sectors.');
        setDrawerOpen(true);
      } else {
        setError(serverError || 'Error connecting to the backend. Please verify server.js is running.');
      }
    } finally {
      setLoading(false);
    }
  };

  const handleSearchSubmit = (e) => {
    e.preventDefault();
    if (query.trim()) {
      fetchAnalysis(query.trim(), timeframe);
    }
  };

  const selectSuggestedQuery = (q) => {
    setQuery(q);
    fetchAnalysis(q, timeframe);
  };

  const changeTimeframe = (tf) => {
    setTimeframe(tf);
    if (results?.query) {
      fetchAnalysis(results.query, tf);
    }
  };

  // Fetch real-time Puppeteer Google screenshot
  const loadLiveScreenshot = async (company, e) => {
    e.stopPropagation(); // Avoid opening the detail SVG modal
    setScreenshotCompany(company);
    setScreenshotImage(null);
    setScreenshotLoading(true);
    setScreenshotError(null);

    try {
      const response = await axios.post('/api/screenshot', { ticker: company.symbol, range: timeframe });
      if (response.data.success) {
        setScreenshotImage(response.data.screenshot);
      } else {
        setScreenshotError('Could not fetch screenshot.');
      }
    } catch (err) {
      console.error(err);
      setScreenshotError(err.response?.data?.error || 'Failed to spin up browser session.');
    } finally {
      setScreenshotLoading(false);
    }
  };

  return (
    <div className="container">
      {/* App Header */}
      <header className="app-header">
        <div className="logo-container">
          <div className="logo-icon">S</div>
          <span className="logo-text">SectorTrend</span>
        </div>
        <div style={{ display: 'flex', gap: '0.75rem' }}>
          <button className="btn btn-secondary btn-small" onClick={() => setDrawerOpen(true)}>
            ⚙️ Settings
          </button>
          {hasApiKey ? (
            <span className="key-badge">OpenRouter Connected</span>
          ) : (
            <span className="key-badge missing">Key Missing (US/India Only)</span>
          )}
        </div>
      </header>

      {/* Settings Drawer Panel */}
      {drawerOpen && <div className="settings-overlay" onClick={() => setDrawerOpen(false)} />}
      <div className={`settings-drawer ${drawerOpen ? 'open' : ''}`}>
        <button className="drawer-close" onClick={() => setDrawerOpen(false)}>×</button>
        <h3 className="drawer-title">Settings</h3>
        
        <form onSubmit={saveApiKey}>
          <div className="settings-field">
            <label className="settings-label">OpenRouter API Key</label>
            <input 
              type="password" 
              className="settings-input" 
              placeholder="sk-or-..." 
              value={apiKeyInput}
              onChange={(e) => setApiKeyInput(e.target.value)}
            />
            <p className="settings-help">
              Your key is saved locally in your browser cache. This key is used to invoke the <strong>Gemini 3.5 Flash</strong> model on OpenRouter to resolve stocks. 
              <br /><em>Note: If left empty, only the search queries "Cybersecurity, US" and "Steel, India" will function using local fallback catalogs.</em>
            </p>
          </div>
          <button type="submit" className="btn btn-primary" style={{ width: '100%' }}>
            Save Settings
          </button>
        </form>
      </div>

      {/* Main Search Panel */}
      <section style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', margin: '1.5rem 0' }}>
        <form onSubmit={handleSearchSubmit} className="search-form">
          <div className="input-wrapper">
            <span className="search-icon">🔍</span>
            <input 
              type="text" 
              className="search-input" 
              placeholder='Try "Cybersecurity, US" or "Steel, India"...' 
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              disabled={loading}
            />
          </div>
          <button type="submit" className="btn btn-primary" disabled={loading}>
            Analyze
          </button>
        </form>

        {!results && !loading && (
          <div className="suggested-queries">
            <span className="suggested-tag" onClick={() => selectSuggestedQuery('Cybersecurity, US')}>
              Cybersecurity, US
            </span>
            <span className="suggested-tag" onClick={() => selectSuggestedQuery('Steel, India')}>
              Steel, India
            </span>
            <span className="suggested-tag" onClick={() => selectSuggestedQuery('Automotive, Germany')}>
              Automotive, Germany
            </span>
            <span className="suggested-tag" onClick={() => selectSuggestedQuery('Biotech, UK')}>
              Biotech, UK
            </span>
          </div>
        )}
      </section>

      {/* Error Alert Box */}
      {error && (
        <div className="error-banner">
          <span>⚠️</span>
          <div style={{ flex: 1 }}>{error}</div>
        </div>
      )}

      {/* Interactive Controls Row */}
      {results && !loading && (
        <div className="control-row glass-panel" style={{ padding: '0.85rem 1.5rem' }}>
          <div>
            <span style={{ color: 'var(--text-secondary)' }}>Sector: </span>
            <strong style={{ fontFamily: 'var(--font-heading)', fontSize: '1.1rem' }}>
              {results.correctedSector || results.query}
            </strong>
          </div>
          
          <div className="timeframe-group">
            <button 
              className={`timeframe-btn ${timeframe === '1mo' ? 'active' : ''}`}
              onClick={() => changeTimeframe('1mo')}
            >
              1 Month
            </button>
            <button 
              className={`timeframe-btn ${timeframe === '3mo' ? 'active' : ''}`}
              onClick={() => changeTimeframe('3mo')}
            >
              3 Months
            </button>
            <button 
              className={`timeframe-btn ${timeframe === '6mo' ? 'active' : ''}`}
              onClick={() => changeTimeframe('6mo')}
            >
              6 Months
            </button>
            <button 
              className={`timeframe-btn ${timeframe === '1y' ? 'active' : ''}`}
              onClick={() => changeTimeframe('1y')}
            >
              1 Year
            </button>
          </div>
        </div>
      )}

      {/* Progress Shimmer Loader Screen */}
      {loading && (
        <div className="glass-panel loader-container">
          <div className="spinner"></div>
          <h3 className="loader-title">Analyzing Sector Trends</h3>
          <div className="loader-steps">
            {steps.map((step, idx) => (
              <div key={idx} className="loader-step completed">
                <span className="step-bullet"></span>
                <span>{step}</span>
              </div>
            ))}
            <div className="loader-step active">
              <span className="step-bullet"></span>
              <span>{activeStep}</span>
            </div>
          </div>
        </div>
      )}

      {/* Grid Dashboard Result Panel */}
      {results && !loading && (
        <section className="dashboard-grid">
          {results.companies.map((company, index) => {
            const chartData = company.chart || [];
            const hasData = chartData.length > 0;
            const startVal = hasData ? chartData[0].close : 0;
            const endVal = hasData ? chartData[chartData.length - 1].close : 0;
            const priceDiff = endVal - startVal;
            const changePercent = startVal === 0 ? 0 : (priceDiff / startVal) * 100;
            const isPositive = priceDiff >= 0;

            return (
              <div 
                key={company.symbol} 
                className="glass-panel stock-card"
                onClick={() => setSelectedCompany(company)}
              >
                <div className="stock-card-header">
                  <div>
                    <span className="ticker-badge">{company.symbol}</span>
                    <div style={{ marginTop: '0.5rem' }} className="market-cap">
                      Valuation: <span className="market-cap-value">{formatMarketCap(company.marketCap, company.currency)}</span>
                    </div>
                  </div>
                  <div style={{ fontSize: '1.2rem', fontWeight: '800', color: 'var(--text-muted)' }}>
                    #{index + 1}
                  </div>
                </div>

                <div className="company-name" title={company.name}>{company.name}</div>

                <div className="stock-card-price-section">
                  <div className="stock-price">
                    {company.currency === 'INR' ? '₹' : '$'}
                    {company.price.toLocaleString(undefined, { minimumFractionDigits: 2 })}
                  </div>
                  
                  <div className={`trend-indicator ${company.change >= 0 ? 'trend-up' : 'trend-down'}`}>
                    {company.change >= 0 ? '▲' : '▼'} {Math.abs(company.change).toFixed(2)}%
                  </div>
                </div>

                {/* SVG sparkline chart */}
                <Sparkline chartData={chartData} isPositive={isPositive} />

                {/* Sparkline Metadata & Google Screenshot Button */}
                <div className="card-actions">
                  <span className="card-exchange">{company.exchange}</span>
                  <button 
                    className="btn btn-secondary btn-small" 
                    onClick={(e) => loadLiveScreenshot(company, e)}
                  >
                    📸 Live Proof
                  </button>
                </div>
              </div>
            );
          })}
        </section>
      )}

      {/* Welcome Blank State */}
      {!results && !loading && (
        <section className="glass-panel welcome-panel">
          <h2 className="welcome-title">Market Trend Intelligence</h2>
          <p className="welcome-subtitle">
            Enter any industry and country (e.g. <em>"Cybersecurity, US"</em>) to map the top 10 companies sorted by market capitalisation, alongside their historical chart trajectories.
          </p>
          <div style={{ fontSize: '0.85rem', color: 'var(--text-muted)' }}>
            Uses real-time search extraction parsed by <strong>Gemini 3.5 Flash</strong> and live Yahoo Finance chart aggregates.
          </div>
        </section>
      )}

      {/* SVG Detail Chart Modal */}
      {selectedCompany && (
        <div className="modal-overlay" onClick={() => setSelectedCompany(null)}>
          <div className="glass-panel modal-content" onClick={(e) => e.stopPropagation()}>
            <button className="close-btn" onClick={() => setSelectedCompany(null)}>×</button>
            
            <div className="detail-header">
              <div className="detail-title-group">
                <span className="ticker-badge" style={{ verticalAlign: 'middle', marginRight: '0.75rem' }}>
                  {selectedCompany.symbol}
                </span>
                <span style={{ fontSize: '0.85rem', color: 'var(--text-secondary)' }}>{selectedCompany.exchange}</span>
                <h2>{selectedCompany.name}</h2>
              </div>
              <div style={{ textAlign: 'right' }}>
                <div style={{ fontSize: '2rem', fontWeight: '800', fontFamily: 'var(--font-heading)' }}>
                  {selectedCompany.currency === 'INR' ? '₹' : '$'}
                  {selectedCompany.price.toLocaleString(undefined, { minimumFractionDigits: 2 })}
                </div>
                <div className={`trend-indicator ${selectedCompany.change >= 0 ? 'trend-up' : 'trend-down'}`} style={{ marginTop: '0.25rem' }}>
                  {selectedCompany.change >= 0 ? '▲' : '▼'} {Math.abs(selectedCompany.change).toFixed(2)}% (1D)
                </div>
              </div>
            </div>

            {/* Financial Metrics Summary boxes */}
            <div className="detail-stats">
              <div className="stat-box">
                <div className="stat-label">Market Capitalisation</div>
                <div className="stat-value">{formatMarketCap(selectedCompany.marketCap, selectedCompany.currency)}</div>
              </div>
              <div className="stat-box">
                <div className="stat-label">Valuation Currency</div>
                <div className="stat-value">{selectedCompany.currency}</div>
              </div>
              <div className="stat-box">
                <div className="stat-label">Historical Trend ({timeframe})</div>
                {selectedCompany.chart && selectedCompany.chart.length > 0 ? (() => {
                  const first = selectedCompany.chart[0].close;
                  const last = selectedCompany.chart[selectedCompany.chart.length - 1].close;
                  const diff = last - first;
                  const percent = first === 0 ? 0 : (diff / first) * 100;
                  return (
                    <div className={`stat-value ${percent >= 0 ? 'trend-up' : 'trend-down'}`} style={{ color: percent >= 0 ? 'var(--trend-up)' : 'var(--trend-down)' }}>
                      {percent >= 0 ? '+' : ''}{percent.toFixed(2)}%
                    </div>
                  );
                })() : <div className="stat-value">N/A</div>}
              </div>
            </div>

            {/* Main Interactive Chart rendering */}
            <h3 style={{ fontFamily: 'var(--font-heading)', marginTop: '2rem', fontSize: '1.2rem' }}>
              Historical Price Performance ({timeframe})
            </h3>
            
            <InteractiveChart 
              chartData={selectedCompany.chart} 
              isPositive={
                selectedCompany.chart && selectedCompany.chart.length > 0 
                  ? selectedCompany.chart[selectedCompany.chart.length - 1].close >= selectedCompany.chart[0].close 
                  : true
              } 
            />

            <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: '1rem' }}>
              <button 
                className="btn btn-secondary" 
                onClick={(e) => {
                  loadLiveScreenshot(selectedCompany, e);
                  setSelectedCompany(null); // Close this modal and open screenshot
                }}
              >
                📸 Capture Live Google Screenshot Proof
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Live Google Screenshot View Modal */}
      {screenshotCompany && (
        <div className="modal-overlay" onClick={() => setScreenshotCompany(null)}>
          <div className="glass-panel modal-content" style={{ maxWidth: '680px' }} onClick={(e) => e.stopPropagation()}>
            <button className="close-btn" onClick={() => setScreenshotCompany(null)}>×</button>
            
            <h3 className="drawer-title" style={{ marginBottom: '1rem' }}>
              Live Market Proof: {screenshotCompany.symbol}
            </h3>
            <p style={{ fontSize: '0.85rem', color: 'var(--text-secondary)', marginBottom: '1rem' }}>
              Spins up a headless Chromium browser instance (`puppeteer`) on the backend and captures the live official price chart directly from Google Finance.
            </p>

            {screenshotLoading && (
              <div style={{ padding: '4rem 0', textAlign: 'center' }}>
                <div className="spinner" style={{ margin: '0 auto 1.5rem' }}></div>
                <p style={{ color: 'var(--text-secondary)', fontSize: '0.9rem' }}>
                  Launching headless browser, loading Google Finance page & capturing chart area... (Takes ~3-4s)
                </p>
              </div>
            )}

            {screenshotError && (
              <div className="error-banner">
                <span>⚠️</span>
                <div>{screenshotError}</div>
              </div>
            )}

            {screenshotImage && (
              <div className="screenshot-container">
                <img src={screenshotImage} alt="Google Stock Chart Screenshot" className="screenshot-img" />
                <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: '0.5rem' }}>
                  Screenshot taken live at {new Date().toLocaleTimeString()}
                </div>
              </div>
            )}

            <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: '1.5rem', gap: '0.75rem' }}>
              {screenshotImage && (
                <button className="btn btn-primary" onClick={(e) => loadLiveScreenshot(screenshotCompany, e)}>
                  🔄 Refresh Capture
                </button>
              )}
              <button className="btn btn-secondary" onClick={() => setScreenshotCompany(null)}>
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
